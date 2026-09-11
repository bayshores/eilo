'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const popupSource = fs.readFileSync(path.join(__dirname, '../activity/extension/popup.js'), 'utf8');
const BROWSER_ORIGINS = ['http://*/*', 'https://*/*'];
const json = (value) => JSON.parse(JSON.stringify(value));

class Element {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.listeners = new Map();
    this.textContent = '';
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async fire(type) {
    for (const listener of this.listeners.get(type) || []) await listener({});
  }
}

async function mount({
  granted = false,
  requestResult = true,
  removeResult = true,
  setFails = false,
  tabUrl = 'https://example.test/study',
  excludedHosts = [],
  approvedOrigin = (url) =>
    url?.startsWith('https://example.test/') ? 'https://example.test' : null,
  nativeState = null,
} = {}) {
  const elements = Object.fromEntries(
    [
      'allow',
      'open-eilo',
      'exclude',
      'remove-access',
      'excluded-hosts',
      'status',
      'native-status',
    ].map((id) => [id, new Element()]),
  );
  const calls = [];
  const stored = { excludedHosts };
  let resolveRequest = null;
  const chrome = {
    runtime:
      nativeState === null
        ? {}
        : {
            sendMessage: async (value) => {
              calls.push(['sendMessage', value]);
              return typeof nativeState === 'string' ? { state: nativeState } : nativeState;
            },
          },
    permissions: {
      contains: async (value) => {
        calls.push(['contains', value]);
        return granted;
      },
      request: (value) => {
        calls.push(['request', value]);
        if (requestResult === 'pending')
          return new Promise((resolve) => {
            resolveRequest = () => {
              granted = true;
              resolve(true);
            };
          });
        if (requestResult) granted = true;
        return Promise.resolve(requestResult);
      },
      remove: async (value) => {
        calls.push(['remove', value]);
        if (removeResult) granted = false;
        return removeResult;
      },
    },
    storage: {
      local: {
        get: async (key) => {
          calls.push(['storage.get', key]);
          return { excludedHosts: stored.excludedHosts };
        },
        set: async (value) => {
          calls.push(['storage.set', value]);
          if (setFails) throw new Error('storage unavailable');
          stored.excludedHosts = value.excludedHosts;
        },
      },
    },
    tabs: {
      create: async (value) => calls.push(['create', value]),
      query: async (value) => {
        calls.push(['query', value]);
        return [{ url: tabUrl }];
      },
    },
  };
  const document = {
    body: new Element(),
    addEventListener() {},
    createElement: () => new Element(),
    querySelector: (selector) => elements[selector.slice(1)],
  };
  const context = {
    URL,
    Promise,
    Set,
    chrome,
    document,
    globalThis: {
      EiloActivityExtensionCore: {
        BROWSER_ORIGINS,
        PAGE_ORIGIN: 'http://127.0.0.1:8765',
        approvedOrigin,
      },
    },
  };
  context.globalThis.globalThis = context.globalThis;
  vm.runInNewContext(popupSource, context);
  await new Promise(setImmediate);
  return { calls, elements, resolveRequest: () => resolveRequest?.(true), stored };
}

test('popup mount reads only permission and excluded-host state', async () => {
  const popup = await mount();
  assert.deepEqual(json(popup.calls), [
    ['contains', { origins: BROWSER_ORIGINS }],
    ['storage.get', 'excludedHosts'],
  ]);
});

test('a preexisting grant starts one bounded native-status check without requesting access', async () => {
  const popup = await mount({ granted: true, nativeState: 'connected' });
  await new Promise(setImmediate);
  assert.equal(
    popup.calls.filter(([name]) => name === 'request').length,
    0,
    'status monitoring never asks Chrome for access',
  );
  assert.equal(
    popup.calls.filter(([name]) => name === 'contains').length >= 2,
    true,
    'the initial mount schedules a bounded follow-up status check',
  );
  assert.equal(popup.calls.filter(([name]) => name === 'sendMessage').length >= 2, true);
});

test('popup distinguishes a verified transport and activity sent from an attached port', async () => {
  const popup = await mount({ nativeState: 'ready' });
  assert.equal(popup.elements['native-status'].textContent, '');
  assert.deepEqual(json(popup.calls.at(-1)), ['sendMessage', { type: 'eilo-native-status' }]);
  const verified = await mount({ nativeState: { state: 'ready', handshake_verified: true } });
  assert.equal(verified.elements['native-status'].textContent, 'Connected to eïlo.');
  const shared = await mount({ nativeState: { state: 'shared', handshake_verified: true } });
  assert.equal(shared.elements['native-status'].textContent, 'Recent activity sent to eïlo.');
});

test('Allow Chrome requests in the click gesture and remains in setup after a grant', async () => {
  const popup = await mount({ requestResult: 'pending' });
  const pending = popup.elements.allow.fire('click');
  assert.deepEqual(json(popup.calls.at(-1)), ['request', { origins: BROWSER_ORIGINS }]);
  assert.equal(
    popup.calls.some(([name]) => name === 'create'),
    false,
  );
  popup.resolveRequest();
  await pending;
  assert.equal(
    popup.calls.some(([name]) => name === 'create'),
    false,
  );
  assert.equal(popup.elements.status.textContent, 'Chrome allowed. Looking for eïlo on this Mac.');
  assert.equal(popup.elements['open-eilo'].hidden, false);
});

test('a denied Chrome grant opens nothing and Open eïlo uses Home after an existing grant', async () => {
  const denied = await mount({ requestResult: false });
  await denied.elements.allow.fire('click');
  assert.equal(
    denied.calls.some(([name]) => name === 'create'),
    false,
  );
  assert.equal(denied.elements.status.textContent, 'Chrome access was not allowed.');

  const granted = await mount({ granted: true });
  await granted.elements['open-eilo'].fire('click');
  assert.equal(
    granted.calls.some(([name]) => name === 'request'),
    false,
  );
  assert.deepEqual(json(granted.calls.at(-1)), ['create', { url: 'http://127.0.0.1:8765/home/' }]);
});

test('Exclude this site stores the canonical hostname and renders text safely', async () => {
  const popup = await mount({
    excludedHosts: ['<img src=x onerror=alert(1)>'],
    tabUrl: 'https://example.test/private?query=one',
  });
  assert.equal(
    popup.elements['excluded-hosts'].children[0].children[0].textContent,
    '<img src=x onerror=alert(1)>',
  );
  await popup.elements.exclude.fire('click');
  assert.deepEqual(json(popup.stored.excludedHosts), [
    '<img src=x onerror=alert(1)>',
    'example.test',
  ]);
  assert.equal(
    popup.calls.some(([name]) => name === 'query'),
    true,
  );
});

test('failed exclusion removal reports the error without replacing the list', async () => {
  const popup = await mount({ excludedHosts: ['example.test'], setFails: true });
  await popup.elements['excluded-hosts'].children[0].children[1].fire('click');
  assert.equal(popup.elements.status.textContent, 'Chrome could not update excluded sites.');
  assert.equal(
    popup.elements['excluded-hosts'].children[0].children[0].textContent,
    'example.test',
  );
});

test('Remove browser access confirms the refreshed permission state', async () => {
  const removed = await mount({ granted: true, removeResult: true });
  await removed.elements['remove-access'].fire('click');
  assert.equal(removed.elements.status.textContent, 'Browser access removed.');

  const retained = await mount({ granted: true, removeResult: false });
  await retained.elements['remove-access'].fire('click');
  assert.equal(retained.elements.status.textContent, 'Browser access is still allowed.');
});
