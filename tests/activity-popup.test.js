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
      'retry-connection',
      'connection-help',
      'permission-consequence',
      'connection-heading',
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

test('an already-granted disconnected Chrome stays in setup without repermission or Home navigation', async () => {
  const popup = await mount({ granted: true, nativeState: 'disconnected' });
  await new Promise(setImmediate);
  assert.equal(
    popup.calls.filter(([name]) => name === 'request').length,
    0,
    'status monitoring never asks Chrome for access',
  );
  assert.equal(popup.calls.filter(([name]) => name === 'sendMessage').length >= 2, true);
  assert.equal(
    popup.calls.some(([name]) => name === 'create'),
    false,
  );
  assert.equal(popup.elements.allow.hidden, true);
  assert.equal(popup.elements['retry-connection'].hidden, false);
  assert.equal(popup.elements['connection-help'].hidden, false);
  assert.equal(
    popup.elements['permission-consequence'].textContent,
    'Keep the eïlo desktop app open, then retry the connection.',
  );
  assert.equal(popup.elements['connection-heading'].textContent, 'Chrome access is allowed');
});

test('popup does not treat an attached port as a verified desktop connection', async () => {
  const popup = await mount({ granted: true, nativeState: 'ready' });
  assert.equal(popup.elements['native-status'].textContent, '');
  assert.equal(popup.elements['retry-connection'].hidden, false);
  assert.deepEqual(json(popup.calls.at(-1)), ['sendMessage', { type: 'eilo-native-status' }]);
});

test('popup distinguishes verified ready, shared, and disabled states', async () => {
  const verified = await mount({
    granted: true,
    nativeState: { state: 'ready', connected: true, handshake_verified: true },
  });
  assert.equal(verified.elements['native-status'].textContent, '');
  assert.equal(verified.elements['retry-connection'].hidden, true);
  assert.equal(verified.elements['connection-heading'].textContent, 'Chrome connected');
  const shared = await mount({
    granted: true,
    nativeState: { state: 'shared', connected: true, handshake_verified: true },
  });
  assert.equal(shared.elements['native-status'].textContent, 'Recent activity was sent to eïlo.');
  const disabled = await mount({
    granted: true,
    nativeState: { state: 'disabled', connected: true, handshake_verified: true },
  });
  assert.equal(disabled.elements['native-status'].textContent, '');
  assert.equal(disabled.elements['connection-heading'].textContent, 'Chrome is ready');
});

test('a verified unshared page remains connected without a retry', async () => {
  const popup = await mount({
    granted: true,
    nativeState: { state: 'unshared', connected: true, handshake_verified: true },
  });
  assert.equal(popup.elements['native-status'].textContent, 'This page is not being shared.');
  assert.equal(popup.elements['connection-heading'].textContent, 'Chrome connected');
  assert.equal(popup.elements['retry-connection'].hidden, true);
  assert.equal(popup.elements.status.textContent, '');
});

test('a disconnected port or revoked grant cannot keep the connected heading', async () => {
  const closed = await mount({
    granted: true,
    nativeState: { state: 'ready', connected: false, handshake_verified: true },
  });
  assert.equal(closed.elements['connection-heading'].textContent, 'Chrome access is allowed');
  assert.equal(closed.elements['retry-connection'].hidden, false);
  const revoked = await mount({ granted: true, nativeState: 'browser-access-off' });
  assert.equal(revoked.elements['connection-heading'].textContent, 'Allow Chrome access');
  assert.equal(revoked.elements.allow.hidden, false);
  assert.equal(
    revoked.calls.some(([name]) => name === 'request'),
    false,
  );
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
  assert.equal(popup.elements.allow.hidden, true);
  assert.equal(popup.elements['retry-connection'].hidden, false);
});

test('a verified connection clears the temporary grant-success message', async () => {
  const popup = await mount({
    nativeState: { state: 'ready', connected: true, handshake_verified: true },
  });
  await popup.elements.allow.fire('click');
  await new Promise(setImmediate);
  assert.equal(popup.elements.status.textContent, '');
  assert.equal(popup.elements['connection-heading'].textContent, 'Chrome connected');
});

test('a denied Chrome grant opens nothing and leaves Chrome access setup available', async () => {
  const denied = await mount({ requestResult: false });
  await denied.elements.allow.fire('click');
  assert.equal(
    denied.calls.some(([name]) => name === 'create'),
    false,
  );
  assert.equal(denied.elements.status.textContent, 'Chrome access was not allowed.');
  assert.equal(denied.elements.allow.hidden, false);
  assert.equal(denied.elements['retry-connection'].hidden, true);
});

test('Retry connection sends only bounded native-status checks', async () => {
  const popup = await mount({ granted: true, nativeState: 'disconnected' });
  await new Promise(setImmediate);
  const before = popup.calls.length;
  await popup.elements['retry-connection'].fire('click');
  await new Promise(setImmediate);
  const retryCalls = popup.calls.slice(before);
  assert.equal(
    retryCalls.some(([name]) => name === 'sendMessage'),
    true,
  );
  assert.equal(
    retryCalls.some(([name]) => name === 'contains' || name === 'request'),
    false,
  );
  assert.equal(
    retryCalls.some(([name]) => name === 'create'),
    false,
  );
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
