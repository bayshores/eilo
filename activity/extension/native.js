'use strict';

(() => {
  const HOST_NAME = 'app.eilo.context';
  const SCHEMA_VERSION = 1;
  const TEXT_LIMIT = 8000;
  const BROWSER_ORIGINS = ['http://*/*', 'https://*/*'];
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const cleanText = (value, limit) =>
    typeof value === 'string'
      ? value
          // eslint-disable-next-line no-control-regex -- Native payloads must never carry controls from a page.
          .replace(/[\x00-\x1f\x7f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, limit)
      : '';
  const identifier = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : '';
  const normalizeDomains = (value) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter((host) => typeof host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(host)),
          ),
        ]
      : null;

  function validPolicy(message) {
    if (!isObject(message) || Object.keys(message).length !== 7 || message.kind !== 'policy')
      return null;
    const session_id = identifier(message.session_id);
    const excluded_domains = normalizeDomains(message.excluded_domains);
    if (
      message.schema_version !== SCHEMA_VERSION ||
      !session_id ||
      !Number.isInteger(message.policy_epoch) ||
      message.policy_epoch < 0 ||
      typeof message.enabled !== 'boolean' ||
      typeof message.text_enabled !== 'boolean' ||
      !excluded_domains
    )
      return null;
    return {
      kind: 'policy',
      schema_version: SCHEMA_VERSION,
      session_id,
      policy_epoch: message.policy_epoch,
      enabled: message.enabled,
      text_enabled: message.text_enabled,
      excluded_domains,
    };
  }
  function validSample(message, policy) {
    return Boolean(
      policy?.enabled &&
      isObject(message) &&
      Object.keys(message).length === 3 &&
      message.kind === 'sample' &&
      message.session_id === policy.session_id &&
      message.policy_epoch === policy.policy_epoch,
    );
  }
  function resourceUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return `${url.origin}${url.pathname}`;
    } catch {
      return '';
    }
  }
  function usableTab(tab, windowId) {
    return Boolean(
      tab &&
      tab.active === true &&
      tab.incognito === false &&
      tab.discarded !== true &&
      tab.hidden !== true &&
      tab.windowId === windowId,
    );
  }
  function sameTab(first, second) {
    return Boolean(
      first &&
      second &&
      first.id === second.id &&
      first.windowId === second.windowId &&
      first.url === second.url &&
      first.title === second.title,
    );
  }
  function visibleText(limit = TEXT_LIMIT) {
    const ignored = new Set([
      'SCRIPT',
      'STYLE',
      'NOSCRIPT',
      'INPUT',
      'TEXTAREA',
      'SELECT',
      'OPTION',
    ]);
    const pieces = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (
      let node = walker.nextNode();
      node && pieces.join(' ').length < limit;
      node = walker.nextNode()
    ) {
      const parent = node.parentElement;
      if (!parent || ignored.has(parent.tagName)) continue;
      const style = getComputedStyle(parent);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parent.closest('[aria-hidden="true"]')
      )
        continue;
      const value = node.nodeValue.replace(/\s+/g, ' ').trim();
      if (value) pieces.push(value);
    }
    return pieces.join(' ').slice(0, limit);
  }

  function createNativeContext({ chrome, core, onStatus } = {}) {
    if (!chrome?.runtime?.connectNative || !core?.approvedOrigin)
      throw new TypeError('Chrome and activity core are required.');
    let port = null;
    let policy = null;
    let generation = 0;
    const status = () => ({
      connected: Boolean(port),
      enabled: Boolean(policy?.enabled),
      policy_epoch: policy?.policy_epoch ?? null,
    });
    const report = (state) => onStatus?.({ state, ...status() });
    const connected = () => Boolean(port && port.__eiloNativeClosed !== true);
    const send = (message) => {
      if (!connected()) return false;
      try {
        port.postMessage(message);
        return true;
      } catch {
        return false;
      }
    };
    const current = (expectedPolicy, expectedGeneration) =>
      connected() &&
      policy === expectedPolicy &&
      generation === expectedGeneration &&
      expectedPolicy.enabled;
    const hasGrant = () =>
      chrome.permissions.contains({ origins: core.BROWSER_ORIGINS || BROWSER_ORIGINS });
    const allowed = async (origin, expectedPolicy, expectedGeneration) => {
      const stored = await chrome.storage.local.get('excludedHosts');
      return (
        current(expectedPolicy, expectedGeneration) &&
        !core.isExcluded?.(origin, expectedPolicy.excluded_domains) &&
        !core.isExcluded?.(origin, stored.excludedHosts || []) &&
        (await hasGrant()) &&
        current(expectedPolicy, expectedGeneration)
      );
    };

    async function sample(request) {
      const expectedPolicy = policy;
      const expectedGeneration = generation;
      if (!validSample(request, expectedPolicy) || !current(expectedPolicy, expectedGeneration))
        return;
      try {
        if (!(await hasGrant()) || !current(expectedPolicy, expectedGeneration))
          return report('unshared');
        const firstWindow = await chrome.windows.getLastFocused();
        if (
          !current(expectedPolicy, expectedGeneration) ||
          !firstWindow?.focused ||
          firstWindow.incognito !== false ||
          firstWindow.type !== 'normal'
        )
          return report('unshared');
        const first = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (!current(expectedPolicy, expectedGeneration) || !usableTab(first, firstWindow.id))
          return report('unshared');
        const origin = core.approvedOrigin(first.url);
        if (!origin || !(await allowed(origin, expectedPolicy, expectedGeneration)))
          return report('unshared');
        let text = '';
        if (expectedPolicy.text_enabled) {
          const extracted = await chrome.scripting.executeScript({
            target: { tabId: first.id },
            func: visibleText,
            args: [TEXT_LIMIT],
          });
          if (!current(expectedPolicy, expectedGeneration)) return report('unshared');
          text = cleanText(extracted?.[0]?.result, TEXT_LIMIT);
        }
        const finalWindow = await chrome.windows.getLastFocused();
        const second = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
        if (
          !current(expectedPolicy, expectedGeneration) ||
          !finalWindow?.focused ||
          finalWindow.incognito !== false ||
          finalWindow.type !== 'normal' ||
          finalWindow.id !== firstWindow.id ||
          !usableTab(second, finalWindow.id) ||
          !sameTab(first, second)
        )
          return report('unshared');
        if (!(await allowed(origin, expectedPolicy, expectedGeneration))) return report('unshared');
        const event = {
          schema_version: SCHEMA_VERSION,
          id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          source_id: 'browser',
          session_id: expectedPolicy.session_id,
          policy_epoch: expectedPolicy.policy_epoch,
          captured_at: Date.now() / 1000,
          kind: 'browser',
          bundle_id: 'com.google.Chrome',
          app_name: 'Google Chrome',
          origin,
          title: cleanText(second.title, 180),
          text,
        };
        const localResource = resourceUrl(second.url);
        if (localResource) event.resource_url = localResource;
        if (current(expectedPolicy, expectedGeneration) && send(event)) report('shared');
      } catch {
        if (current(expectedPolicy, expectedGeneration)) report('error');
      }
    }
    function connect() {
      if (connected()) return status();
      generation++;
      const nextPort = chrome.runtime.connectNative(HOST_NAME);
      port = nextPort;
      nextPort.__eiloNativeClosed = false;
      nextPort.onDisconnect.addListener(() => {
        nextPort.__eiloNativeClosed = true;
        if (port !== nextPort) return;
        generation++;
        port = null;
        policy = null;
        report('disconnected');
      });
      nextPort.onMessage.addListener((message) => {
        if (port !== nextPort || nextPort.__eiloNativeClosed) return;
        const next = validPolicy(message);
        if (next) {
          policy = next;
          generation++;
          report(next.enabled ? 'ready' : 'disabled');
          return;
        }
        void sample(message);
      });
      send({ kind: 'hello', protocol: 1, extension_id: chrome.runtime.id || '' });
      report('connected');
      return status();
    }
    function disconnect() {
      generation++;
      policy = null;
      if (connected()) {
        port.__eiloNativeClosed = true;
        try {
          port.disconnect();
        } catch {
          /* closed native channel */
        }
      }
      port = null;
      report('disconnected');
      return status();
    }
    return {
      connect,
      disconnect,
      status,
      invalidatePrivacy: () => {
        generation++;
        if (policy)
          send({
            kind: 'status',
            state: 'privacy_changed',
            session_id: policy.session_id,
            policy_epoch: policy.policy_epoch,
          });
      },
    };
  }

  globalThis.EiloNativeContext = {
    HOST_NAME,
    TEXT_LIMIT,
    validPolicy,
    validSample,
    resourceUrl,
    cleanText,
    createNativeContext,
  };
})();
