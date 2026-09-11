'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../activity/extension/native.js'), 'utf8');
const event = () => {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    fire(value) {
      for (const fn of listeners) fn(value);
    },
  };
};
function setup({
  granted = true,
  switchTab = false,
  privateTab = false,
  focused = true,
  windowIncognito = false,
  windowType = 'normal',
  text = 'Visible page text',
  revokeAfterRead = false,
  afterTextRead = null,
} = {}) {
  const message = event(),
    disconnect = event(),
    calls = [],
    statuses = [];
  const port = {
    onMessage: message,
    onDisconnect: disconnect,
    posted: [],
    postMessage(value) {
      this.posted.push(value);
    },
    disconnect() {
      disconnect.fire();
    },
  };
  let tabReads = 0;
  const tab = () => ({
    id: switchTab && tabReads++ > 0 ? 2 : 1,
    windowId: 9,
    active: true,
    incognito: privateTab,
    url: 'https://example.test/path?secret=yes#fragment',
    title: ' A private\n title ',
  });
  const chrome = {
    runtime: {
      id: 'extension-id',
      connectNative(name) {
        calls.push(['connectNative', name]);
        return port;
      },
    },
    permissions: {
      contains: async () => {
        calls.push(['contains']);
        return granted;
      },
    },
    windows: {
      getLastFocused: async () => ({
        id: 9,
        focused,
        incognito: windowIncognito,
        type: windowType,
      }),
    },
    storage: { local: { get: async () => ({ excludedHosts: [] }) } },
    tabs: { query: async () => [tab()] },
    scripting: {
      executeScript: async () => {
        calls.push(['executeScript']);
        if (revokeAfterRead) granted = false;
        afterTextRead?.();
        return [{ result: text }];
      },
    },
  };
  const core = {
    BROWSER_ORIGINS: ['http://*/*', 'https://*/*'],
    approvedOrigin(url) {
      try {
        const parsed = new URL(url);
        return parsed.hostname === 'example.test' && !parsed.username ? parsed.origin : null;
      } catch {
        return null;
      }
    },
    isExcluded(origin, domains) {
      return domains.includes(new URL(origin).hostname);
    },
  };
  const context = { URL, Date, Math, Set, globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return {
    api: context.EiloNativeContext,
    controller: context.EiloNativeContext.createNativeContext({
      chrome,
      core,
      onStatus: (value) => statuses.push(value),
    }),
    port,
    calls,
    statuses,
  };
}
const policy = (overrides = {}) => ({
  kind: 'policy',
  schema_version: 1,
  session_id: 'session-1',
  policy_epoch: 3,
  enabled: true,
  text_enabled: false,
  excluded_domains: [],
  ...overrides,
});
const sample = (overrides = {}) => ({
  kind: 'sample',
  session_id: 'session-1',
  policy_epoch: 3,
  ...overrides,
});

test('strict policy helpers reject unexpected fields and sanitize local resource URLs', () => {
  const { api } = setup();
  assert.equal(api.validPolicy(policy()).enabled, true);
  assert.equal(api.validPolicy({ ...policy(), extra: true }), null);
  assert.equal(api.validSample(sample(), policy()), true);
  assert.equal(api.resourceUrl('https://u:p@example.test/a?q=s#f'), '');
  assert.equal(api.resourceUrl('https://example.test/a?q=s#f'), 'https://example.test/a');
});
test('connect only opens native messaging and sends a hello; it never samples or changes permissions', () => {
  const { controller, port, calls } = setup();
  controller.connect();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['connectNative', 'app.eilo.context']]);
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted)), [
    { kind: 'hello', protocol: 1, extension_id: 'extension-id' },
  ]);
});
test('matching enabled policy gates a metadata-only sample and strips sensitive URL parts', async () => {
  const { controller, port } = setup();
  controller.connect();
  port.onMessage.fire(policy());
  port.onMessage.fire(sample());
  await new Promise(setImmediate);
  const event = port.posted.at(-1);
  assert.equal(event.kind, 'browser');
  assert.equal(event.origin, 'https://example.test');
  assert.equal(event.title, 'A private title');
  assert.equal(event.text, '');
  assert.equal(event.resource_url, 'https://example.test/path');
  assert.equal(typeof event.captured_at, 'number');
  assert.equal(Number.isFinite(event.captured_at), true);
});
test('a disabled replacement policy revokes an earlier enabled policy before a sample can run', async () => {
  const { controller, port } = setup();
  controller.connect();
  port.onMessage.fire(policy());
  port.onMessage.fire(policy({ enabled: false, policy_epoch: 4 }));
  port.onMessage.fire(sample({ policy_epoch: 4 }));
  await new Promise(setImmediate);
  assert.equal(
    port.posted.some((value) => value.kind === 'browser'),
    false,
  );
});
test('text extraction is opt-in, bounded, and permission revocation wins after asynchronous extraction', async () => {
  const large = 'x'.repeat(9000);
  const withText = setup({ text: large });
  withText.controller.connect();
  withText.port.onMessage.fire(policy({ text_enabled: true }));
  withText.port.onMessage.fire(sample());
  await new Promise(setImmediate);
  assert.equal(withText.port.posted.at(-1).text.length, 8000);
  const revoked = setup({ text: 'private', revokeAfterRead: true });
  revoked.controller.connect();
  revoked.port.onMessage.fire(policy({ text_enabled: true }));
  revoked.port.onMessage.fire(sample());
  await new Promise(setImmediate);
  assert.equal(
    revoked.port.posted.some((value) => value.kind === 'browser'),
    false,
  );
});
test('an optional exclusion policy change during text extraction invalidates the queued sample', async () => {
  let item;
  item = setup({
    afterTextRead: () =>
      item.port.onMessage.fire(policy({ policy_epoch: 4, excluded_domains: ['example.test'] })),
  });
  item.controller.connect();
  item.port.onMessage.fire(policy({ text_enabled: true }));
  item.port.onMessage.fire(sample());
  await new Promise(setImmediate);
  assert.equal(
    item.port.posted.some((value) => value.kind === 'browser'),
    false,
  );
  assert.equal(item.controller.status().policy_epoch, 4);
});
test('private tabs, unfocused windows, excluded domains, switched active tabs, stale policy, denied grants, and disconnect emit no sample', async () => {
  for (const options of [
    { privateTab: true },
    { focused: false },
    { windowIncognito: true },
    { windowType: 'popup' },
    { switchTab: true },
    { granted: false },
  ]) {
    const item = setup(options);
    item.controller.connect();
    item.port.onMessage.fire(policy());
    item.port.onMessage.fire(sample());
    await new Promise(setImmediate);
    assert.equal(
      item.port.posted.some((value) => value.kind === 'browser'),
      false,
    );
  }
  const excluded = setup();
  excluded.controller.connect();
  excluded.port.onMessage.fire(policy({ excluded_domains: ['example.test'] }));
  excluded.port.onMessage.fire(sample());
  await new Promise(setImmediate);
  assert.equal(
    excluded.port.posted.some((value) => value.kind === 'browser'),
    false,
  );
  const stale = setup();
  stale.controller.connect();
  stale.port.onMessage.fire(policy());
  stale.port.onMessage.fire(sample({ policy_epoch: 2 }));
  stale.port.onDisconnect.fire();
  await new Promise(setImmediate);
  assert.equal(
    stale.port.posted.some((value) => value.kind === 'browser'),
    false,
  );
  const disconnected = setup();
  disconnected.controller.connect();
  disconnected.port.onMessage.fire(policy());
  disconnected.port.onMessage.fire(sample());
  disconnected.port.onDisconnect.fire();
  await new Promise(setImmediate);
  assert.equal(
    disconnected.port.posted.some((value) => value.kind === 'browser'),
    false,
  );
});
test('native disconnect clears enabled policy status', () => {
  const { controller, port, statuses } = setup();
  controller.connect();
  port.onMessage.fire(policy());
  port.onDisconnect.fire();
  assert.deepEqual(JSON.parse(JSON.stringify(controller.status())), {
    connected: false,
    enabled: false,
    policy_epoch: null,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(statuses.at(-1))), {
    state: 'disconnected',
    connected: false,
    enabled: false,
    policy_epoch: null,
  });
});
