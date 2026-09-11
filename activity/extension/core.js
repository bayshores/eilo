'use strict';

(() => {
  const BROWSER_ORIGINS = ['http://*/*', 'https://*/*'];
  const PAGE_ORIGIN = 'http://127.0.0.1:8765';
  const PORT_NAME = 'eilo-metadata-v1';

  function title(value) {
    return typeof value === 'string'
      ? value
          // eslint-disable-next-line no-control-regex -- Strip control characters before extension data leaves Chrome.
          .replace(/[\x00-\x1f\x7f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180)
      : '';
  }
  function approvedOrigin(rawUrl) {
    if (typeof rawUrl !== 'string' || /\s/.test(rawUrl)) return null;
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname ||
        url.origin === PAGE_ORIGIN ||
        privateHost(host)
      )
        return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  function privateHost(host) {
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    const octets = host.split('.').map(Number);
    if (
      octets.length === 4 &&
      octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ) {
      return (
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168)
      );
    }
    const normalized = host.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      /^fe[89ab][0-9a-f]:/.test(normalized) ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.includes('::ffff:')
    );
  }
  function observationForTab(tab) {
    const origin = tab?.incognito ? null : approvedOrigin(tab && tab.url);
    const safeTitle = title(tab && tab.title);
    return origin && safeTitle
      ? { kind: 'approved_study_context', origin, title: safeTitle }
      : { kind: 'activity_unshared' };
  }
  function isExcluded(origin, excludedHosts) {
    if (!origin || !Array.isArray(excludedHosts)) return false;
    const hostname = new URL(origin).hostname;
    return excludedHosts.some(
      (host) =>
        typeof host === 'string' &&
        host.length > 0 &&
        (hostname === host || hostname.endsWith(`.${host}`)),
    );
  }
  function senderIsEiloPage(sender) {
    // frameId is present for normal extension page ports. If a Chrome build omits
    // it for this external-port API, retain origin enforcement instead of guessing.
    if (
      !sender ||
      typeof sender.url !== 'string' ||
      (typeof sender.frameId === 'number' && sender.frameId !== 0)
    )
      return false;
    try {
      return new URL(sender.url).origin === PAGE_ORIGIN;
    } catch {
      return false;
    }
  }
  function validRequest(message, now = Date.now()) {
    if (
      !message ||
      typeof message !== 'object' ||
      Object.keys(message).length !== 4 ||
      message.type !== 'snapshot'
    )
      return false;
    if (typeof message.nonce !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(message.nonce))
      return false;
    if (typeof message.client_id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(message.client_id))
      return false;
    return (
      Number.isInteger(message.expires_at) &&
      message.expires_at >= now &&
      message.expires_at <= now + 9000
    );
  }
  function equivalentTab(first, second) {
    return (
      first &&
      second &&
      first.id === second.id &&
      first.windowId === second.windowId &&
      first.url === second.url &&
      first.title === second.title
    );
  }
  globalThis.EiloActivityExtensionCore = {
    BROWSER_ORIGINS,
    PAGE_ORIGIN,
    PORT_NAME,
    approvedOrigin,
    observationForTab,
    isExcluded,
    senderIsEiloPage,
    validRequest,
    equivalentTab,
  };
})();
