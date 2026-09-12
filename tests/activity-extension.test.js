'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const extension = path.join(__dirname, '../activity/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
assert.deepEqual(
  manifest.permissions,
  ['storage', 'nativeMessaging', 'scripting'],
  'the native bridge needs only storage, native messaging, and bounded script injection',
);
assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
assert.equal(manifest.host_permissions, undefined, 'website access is never installed by default');
assert.equal(manifest.externally_connectable.matches[0], 'http://127.0.0.1/*');
assert.deepEqual(manifest.options_ui, { page: 'popup.html', open_in_tab: true });
const manifestId = [
  ...crypto
    .createHash('sha256')
    .update(Buffer.from(manifest.key, 'base64'))
    .digest()
    .subarray(0, 16),
]
  .map((byte) => 'abcdefghijklmnop'[byte >> 4] + 'abcdefghijklmnop'[byte & 15])
  .join('');
const configContext = { window: {} };
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, '../web/activity/config.js'), 'utf8'),
  configContext,
);
assert.equal(
  manifestId,
  configContext.window.EILO_ACTIVITY_EXTENSION_ID,
  'public manifest key and page target resolve to the same Chrome ID',
);
const coreContext = { URL, Set, globalThis: {} };
coreContext.globalThis = coreContext;
vm.runInNewContext(fs.readFileSync(path.join(extension, 'core.js'), 'utf8'), coreContext);
const core = coreContext.EiloActivityExtensionCore;

assert.equal(core.senderIsEiloPage({ url: 'http://127.0.0.1:8765/', frameId: 0 }), true);
assert.equal(
  core.senderIsEiloPage({ url: 'http://127.0.0.1:8765/' }),
  true,
  'accepts only when this API omits frameId',
);
assert.equal(core.senderIsEiloPage({ url: 'http://127.0.0.1:8766/', frameId: 0 }), false);
assert.equal(core.senderIsEiloPage({ url: 'http://127.0.0.1:8765/', frameId: 1 }), false);
assert.equal(
  core.validRequest(
    { type: 'snapshot', nonce: 'nonce-123', client_id: 'client-123', expires_at: 1008 },
    1000,
  ),
  true,
);
assert.equal(
  core.validRequest(
    { type: 'snapshot', nonce: 'nonce-123', client_id: 'client-123', expires_at: 10001 },
    1000,
  ),
  false,
);
assert.equal(
  JSON.stringify(
    core.observationForTab({
      url: 'https://leetcode.com/problems/two-sum/?secret=yes#answer',
      title: '  Two\nSum  ',
    }),
  ),
  JSON.stringify({
    kind: 'approved_study_context',
    origin: 'https://leetcode.com',
    title: 'Two Sum',
  }),
);
assert.equal(
  JSON.stringify(
    core.observationForTab({ url: 'https://mail.google.com/mail/u/0', title: 'private mail' }),
  ),
  JSON.stringify({
    kind: 'approved_study_context',
    origin: 'https://mail.google.com',
    title: 'private mail',
  }),
);
assert.equal(
  core.approvedOrigin('https://docs.python.org/3/library/?q=private#frag'),
  'https://docs.python.org',
);
assert.equal(core.approvedOrigin('http://docs.python.org/'), 'http://docs.python.org');
assert.equal(
  core.approvedOrigin('https://a-new-site.example:8443/path?q=secret'),
  'https://a-new-site.example:8443',
);
for (const url of [
  'chrome://settings',
  'file:///private/document',
  'https://user:pass@example.com',
  'http://127.0.0.1:8765/home/',
  'http://localhost:3000/',
  'http://127.0.0.2:3000/',
  'http://192.168.1.1/',
  'http://169.254.1.1/',
  'http://[::1]:8080/',
  'http://[fe80::1]/',
  'http://[fe90::1]/',
  'http://[::ffff:192.168.1.1]/',
])
  assert.equal(core.approvedOrigin(url), null);
assert.equal(
  core.observationForTab({ url: 'https://example.com', title: 'Private', incognito: true }).kind,
  'activity_unshared',
);
assert.equal(core.isExcluded('https://child.example.com', ['example.com']), true);
assert.equal(core.isExcluded('https://notexample.com', ['example.com']), false);
assert.equal(
  core.equivalentTab(
    { id: 1, windowId: 2, url: 'https://leetcode.com/x', title: 'A' },
    { id: 1, windowId: 2, url: 'https://leetcode.com/x', title: 'A' },
  ),
  true,
);
assert.equal(
  core.equivalentTab(
    { id: 1, windowId: 2, url: 'https://leetcode.com/x', title: 'A' },
    { id: 1, windowId: 2, url: 'https://leetcode.com/y', title: 'A' },
  ),
  false,
);

async function backgroundSnapshot({
  granted = true,
  changed = false,
  disconnectDuringFirst = false,
  incognito = false,
  excluded = false,
  excludeDuringFinal = false,
  revokeDuringFinal = false,
} = {}) {
  let calls = 0;
  let tabCalls = 0;
  let stillAllowed = true;
  let permissionCalls = 0,
    preferenceCalls = 0;
  const backgroundContext = {
    URL,
    Set,
    console,
    __EILO_ACTIVITY_TEST__: {},
    importScripts() {
      vm.runInNewContext(
        fs.readFileSync(path.join(extension, 'core.js'), 'utf8'),
        backgroundContext,
      );
    },
    chrome: {
      runtime: {
        onConnectExternal: {
          addListener() {},
        },
      },
      permissions: {
        onRemoved: event(),
        contains: async (request) => {
          assert.deepEqual([...request.origins], ['http://*/*', 'https://*/*']);
          return granted && !(revokeDuringFinal && ++permissionCalls >= 3);
        },
      },
      storage: {
        onChanged: event(),
        local: {
          get: async () => ({
            excludedHosts:
              excluded || (excludeDuringFinal && ++preferenceCalls >= 2)
                ? ['new-site.example']
                : [],
          }),
        },
      },
      windows: {
        getLastFocused: async () => {
          if (disconnectDuringFirst) stillAllowed = false;
          return { id: 9, focused: true };
        },
      },
      tabs: {
        query: async () => {
          tabCalls++;
          return [
            {
              id: changed && ++calls > 1 ? 2 : 1,
              windowId: 9,
              active: true,
              status: 'complete',
              incognito,
              url: 'https://new-site.example/path?secret=1',
              title: 'Context',
            },
          ];
        },
      },
    },
  };
  backgroundContext.globalThis = backgroundContext;
  vm.runInNewContext(
    fs.readFileSync(path.join(extension, 'background.js'), 'utf8'),
    backgroundContext,
  );
  return {
    result: await backgroundContext.__EILO_ACTIVITY_TEST__.activeSnapshot(() => stillAllowed),
    tabCalls,
  };
}
const backgroundChecks = (async () => {
  assert.equal(
    JSON.stringify((await backgroundSnapshot({ granted: false })).result),
    JSON.stringify({ observation: { kind: 'activity_unshared' } }),
    'revoked/missing host grant never emits metadata',
  );
  assert.equal(
    (await backgroundSnapshot({ changed: true })).result,
    null,
    'focus or navigation change drops the sample',
  );
  const aborted = await backgroundSnapshot({ disconnectDuringFirst: true });
  assert.equal(aborted.result, null);
  assert.equal(aborted.tabCalls, 0, 'disconnect/expiry prevents later Chrome reads');
  assert.equal(
    (await backgroundSnapshot({ granted: false })).tabCalls,
    0,
    'partial or missing broad access prevents tab reads',
  );
  assert.equal(
    (await backgroundSnapshot({ incognito: true })).result,
    null,
    'private windows are never shared',
  );
  for (const options of [
    { excluded: true },
    { excludeDuringFinal: true },
    { revokeDuringFinal: true },
  ])
    assert.equal(
      (await backgroundSnapshot(options)).result.observation.kind,
      'activity_unshared',
      'exclusion and revocation suppress an in-flight sample',
    );
  const admitted = (await backgroundSnapshot()).result.observation;
  assert.equal(admitted.origin, 'https://new-site.example');
  assert.equal(admitted.title, 'Context');
})();

async function extensionPortChecks() {
  let connectListener,
    resolveWindow,
    windowCalls = 0;
  const onMessage = event(),
    onDisconnect = event();
  const testPort = {
    name: 'eilo-metadata-v1',
    sender: { url: 'http://127.0.0.1:8765/', frameId: 0 },
    onMessage,
    onDisconnect,
    posted: [],
    postMessage(value) {
      this.posted.push(value);
    },
    disconnect() {},
  };
  const context = {
    URL,
    Set,
    console,
    __EILO_ACTIVITY_TEST__: {},
    importScripts() {
      vm.runInNewContext(fs.readFileSync(path.join(extension, 'core.js'), 'utf8'), context);
    },
    chrome: {
      runtime: {
        onConnectExternal: {
          addListener(fn) {
            connectListener = fn;
          },
        },
      },
      permissions: { onRemoved: event(), contains: async () => true },
      storage: { onChanged: event(), local: { get: async () => ({ excludedHosts: [] }) } },
      windows: {
        getLastFocused: () => {
          windowCalls++;
          return windowCalls === 1
            ? new Promise((resolve) => {
                resolveWindow = resolve;
              })
            : Promise.resolve({ id: 9, focused: true });
        },
      },
      tabs: {
        query: async () => [
          {
            id: 1,
            windowId: 9,
            active: true,
            status: 'complete',
            url: 'https://leetcode.com/problems/x?private=1',
            title: 'One',
          },
        ],
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  connectListener(testPort);
  const request = {
    type: 'snapshot',
    nonce: 'nonce-abc',
    client_id: 'client-abc',
    expires_at: Date.now() + 8000,
  };
  onMessage.emit(request);
  onMessage.emit(request);
  onMessage.emit({ ...request, nonce: 'nonce-def' });
  await new Promise(setImmediate);
  assert.equal(windowCalls, 1, 'one port permits only one in-flight sample');
  resolveWindow({ id: 9, focused: true });
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.equal(testPort.posted.filter((item) => item.type === 'observation').length, 1);
  const callsAfterFirst = windowCalls;
  onMessage.emit(request);
  await new Promise(setImmediate);
  assert.equal(windowCalls, callsAfterFirst, 'the completed nonce is retained as a duplicate');
  assert.equal(testPort.posted.filter((item) => item.type === 'observation').length, 1);
}
const portChecks = extensionPortChecks();

async function externalSetupChecks() {
  let externalListener;
  const created = [];
  let tabReads = 0;
  let nativeAttempts = 0;
  const context = {
    URL,
    Set,
    console,
    EiloNativeContext: {
      createNativeContext: () => ({
        connect() {
          nativeAttempts++;
        },
        status: () => ({ state: 'disconnected' }),
      }),
    },
    importScripts() {
      vm.runInNewContext(fs.readFileSync(path.join(extension, 'core.js'), 'utf8'), context);
    },
    chrome: {
      runtime: {
        getURL(value) {
          return `chrome-extension://fixed/${value}`;
        },
        onConnectExternal: { addListener() {} },
        onMessage: { addListener() {} },
        onMessageExternal: {
          addListener(listener) {
            externalListener = listener;
          },
        },
      },
      permissions: { onRemoved: event(), contains: async () => true },
      storage: { onChanged: event(), local: { get: async () => ({ excludedHosts: [] }) } },
      tabs: {
        create: async (value) => created.push(value),
        query: async () => {
          tabReads++;
          return [];
        },
      },
      windows: { onFocusChanged: { addListener() {} } },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  const sender = { url: 'http://127.0.0.1:8765/home/', frameId: 0 };
  let opened;
  assert.equal(
    externalListener({ type: 'eilo-open-setup' }, sender, (response) => (opened = response)),
    true,
  );
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(created)), [
    { url: 'chrome-extension://fixed/popup.html', active: true },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), { opened: true });
  assert.equal(tabReads, 0, 'opening setup never reads browser activity');

  let status;
  const attemptsBeforeStatus = nativeAttempts;
  assert.equal(
    externalListener({ type: 'eilo-setup-status' }, sender, (response) => (status = response)),
    true,
  );
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(status)), {
    installed: true,
    granted: true,
    setup_protocol: 2,
    native: { state: 'disconnected', connected: false, handshake_verified: false, enabled: false },
  });
  assert.equal(
    nativeAttempts,
    attemptsBeforeStatus + 1,
    'the status check retries an allowed native connection',
  );
  assert.equal(tabReads, 0, 'status detection never reads browser activity');
  assert.equal(
    externalListener({ type: 'eilo-open-setup', extra: true }, sender, () => {}),
    undefined,
  );
  assert.equal(
    externalListener(
      { type: 'eilo-open-setup' },
      { url: 'http://127.0.0.1:8766/', frameId: 0 },
      () => {},
    ),
    undefined,
  );
}
const externalChecks = externalSetupChecks();

async function firstInstallSetupChecks() {
  let installedListener;
  const created = [];
  let permissionChecks = 0;
  let tabReads = 0;
  const context = {
    URL,
    Set,
    console,
    importScripts() {
      vm.runInNewContext(fs.readFileSync(path.join(extension, 'core.js'), 'utf8'), context);
    },
    chrome: {
      runtime: {
        getURL(value) {
          return `chrome-extension://fixed/${value}`;
        },
        onConnectExternal: { addListener() {} },
        onMessage: { addListener() {} },
        onMessageExternal: { addListener() {} },
        onInstalled: {
          addListener(listener) {
            installedListener = listener;
          },
        },
      },
      permissions: {
        onRemoved: event(),
        onAdded: { addListener() {} },
        contains: async () => {
          permissionChecks++;
          return false;
        },
      },
      storage: { onChanged: event(), local: { get: async () => ({ excludedHosts: [] }) } },
      tabs: {
        create: async (value) => created.push(value),
        query: async () => {
          tabReads++;
          return [];
        },
      },
      windows: { onFocusChanged: { addListener() {} } },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(extension, 'background.js'), 'utf8'), context);
  await new Promise(setImmediate);
  const initialPermissionChecks = permissionChecks;
  installedListener({ reason: 'install' });
  await new Promise(setImmediate);
  assert.deepEqual(JSON.parse(JSON.stringify(created)), [
    { url: 'chrome-extension://fixed/popup.html', active: true },
  ]);
  assert.equal(
    permissionChecks,
    initialPermissionChecks,
    'first setup handoff does not check or grant access',
  );
  assert.equal(tabReads, 0, 'first setup handoff does not inspect browser tabs');
  installedListener({ reason: 'update' });
  await new Promise(setImmediate);
  assert.equal(created.length, 1, 'updates never reopen setup automatically');
}
const firstInstallChecks = firstInstallSetupChecks();

function event() {
  const callbacks = [];
  return {
    addListener(fn) {
      callbacks.push(fn);
    },
    emit(value) {
      callbacks.forEach((fn) => fn(value));
    },
  };
}
function port() {
  return {
    onMessage: event(),
    onDisconnect: event(),
    posted: [],
    postMessage(value) {
      this.posted.push(value);
    },
    disconnect() {
      this.onDisconnect.emit();
    },
  };
}
async function bridgeChecks() {
  const clientContext = { globalThis: {}, Date, console, setTimeout, clearTimeout };
  clientContext.globalThis = clientContext;
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../web/activity/bridge.js'), 'utf8'),
    clientContext,
  );
  const bridge = clientContext.EiloActivityBridge;
  let statuses = [],
    observed = [],
    activePort,
    granted = true;
  clientContext.globalThis.chrome = {
    runtime: {
      connect(id, options) {
        assert.equal(id, 'a'.repeat(32));
        assert.equal(JSON.stringify(options), JSON.stringify({ name: 'eilo-metadata-v1' }));
        activePort = port();
        const connected = activePort;
        queueMicrotask(() => connected.onMessage.emit({ type: 'ready', protocol: 2, granted }));
        return activePort;
      },
    },
  };
  assert.equal(
    JSON.stringify(
      await bridge.connect(
        'a'.repeat(32),
        'client-123',
        (nonce, value) => observed.push([nonce, value]),
        (connected, reason) => statuses.push([connected, reason]),
      ),
    ),
    JSON.stringify({ ok: true }),
  );
  assert.equal(
    bridge.update({
      sample_request: {
        nonce: 'nonce-123',
        client_id: 'client-123',
        expires_at: Date.now() + 8000,
      },
    }),
    true,
  );
  assert.equal(
    bridge.update({
      sample_request: {
        nonce: 'nonce-123',
        client_id: 'client-123',
        expires_at: Date.now() + 8000,
      },
    }),
    false,
    'one request per nonce',
  );
  assert.equal(
    bridge.update({
      sample_request: {
        nonce: 'nonce-456',
        client_id: 'client-123',
        expires_at: Date.now() + 8000,
      },
    }),
    true,
    'a newer request replaces an unanswered nonce',
  );
  activePort.onMessage.emit({
    type: 'observation',
    nonce: 'nonce-123',
    observation: {
      kind: 'approved_study_context',
      origin: 'https://leetcode.com',
      title: 'Two Sum',
    },
  });
  assert.equal(observed.length, 0, 'a stale response cannot accumulate or be delivered');
  activePort.onMessage.emit({
    type: 'observation',
    nonce: 'nonce-456',
    observation: {
      kind: 'approved_study_context',
      origin: 'https://leetcode.com',
      title: 'Two Sum',
    },
  });
  assert.equal(observed.length, 1);
  activePort.onMessage.emit({
    type: 'observation',
    nonce: 'nonce-456',
    observation: {
      kind: 'approved_study_context',
      origin: 'https://leetcode.com',
      title: 'Two Sum',
    },
  });
  assert.equal(observed.length, 1, 'duplicate observation dropped');
  activePort.onDisconnect.emit();
  assert.deepEqual(statuses.at(-1), [false, 'extension_disconnected']);
  assert.equal(
    JSON.stringify(
      await bridge.connect(
        'bad',
        'client-123',
        () => {},
        () => {},
      ),
    ),
    JSON.stringify({ ok: false, reason: 'invalid_connection' }),
  );
  const ready = await bridge.check('a'.repeat(32));
  assert.equal(ready.ok, true);
  assert.equal(activePort.posted.length, 0, 'readiness check requests no browsing samples');
  granted = false;
  const blocked = await bridge.connect(
    'a'.repeat(32),
    'client-123',
    () => {},
    () => {},
  );
  assert.equal(
    blocked.reason,
    'browser_permission_required',
    'old per-site grants do not authorize broad sharing',
  );
  assert.equal(activePort.posted.length, 0);
  assert.equal(
    bridge.update({
      sample_request: {
        nonce: 'nonce-999',
        client_id: 'client-123',
        expires_at: Date.now() + 8000,
      },
    }),
    false,
  );
}
Promise.all([backgroundChecks, portChecks, externalChecks, firstInstallChecks, bridgeChecks()])
  .then(() => process.stdout.write('activity extension and bridge checks passed\n'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
