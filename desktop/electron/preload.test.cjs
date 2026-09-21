const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, 'preload.cjs'), 'utf8');
function load(location) {
  let bridge;
  const listeners = new Map();
  const sent = [],
    invoked = [];
  vm.runInNewContext(source, {
    location,
    require: (name) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (key, value) => {
            assert.equal(key, 'eiloDesktop');
            bridge = value;
          },
        },
        ipcRenderer: {
          on: (channel, fn) => listeners.set(channel, fn),
          send: (channel) => sent.push(channel),
          invoke: (channel, ...args) => {
            invoked.push([channel, ...args]);
            return Promise.resolve({ enabled: false, supported: true, error: false });
          },
          removeListener: (channel) => listeners.delete(channel),
        },
      };
    },
  });
  return {
    get bridge() {
      return bridge;
    },
    deliver: (channel, value) => listeners.get(channel)?.({ privateNativeObject: true }, value),
    sent,
    invoked,
  };
}
test('only Home receives a narrow subscription; native event and extra payload do not cross the bridge', () => {
  const host = load({ origin: 'http://127.0.0.1:8765', pathname: '/home/' }),
    received = [];
  assert.deepEqual(Object.keys(host.bridge), [
    'openActivityConnection',
    'openChromeSetup',
    'openChromeExtensions',
    'revealChromeExtension',
    'openAccountAuthorization',
    'openContextSource',
    'openContextPermission',
    'openGoogleAuthorization',
    'openBriefingAuthorization',
    'openBriefingSource',
    'getCheckInNotifications',
    'setCheckInNotifications',
    'onWindowShown',
    'onOpenCheckIn',
  ]);
  const unsubscribe = host.bridge.onOpenCheckIn((target) => received.push(target));
  assert.deepEqual(host.sent, ['eilo:home-ready']);
  host.deliver('eilo:open-check-in', {
    conversationId: 'one',
    eventId: 'two',
    messageId: '3',
    command: 'ignored',
  });
  assert.equal(
    JSON.stringify(received),
    JSON.stringify([{ conversationId: 'one', messageId: '3', eventId: 'two' }]),
  );
  host.deliver('eilo:open-check-in', {
    conversationId: 'one',
    eventId: 'file:///etc',
    messageId: '3',
  });
  assert.equal(received.length, 1);
  unsubscribe();
  host.deliver('eilo:open-check-in', {
    conversationId: 'one',
    eventId: 'four',
    messageId: '5',
  });
  assert.equal(received.length, 1);
});
test('native window visibility has one narrow removable signal', () => {
  const host = load({ origin: 'http://127.0.0.1:8765', pathname: '/home/' });
  let shown = 0;
  const unsubscribe = host.bridge.onWindowShown(() => (shown += 1));
  assert.deepEqual(host.sent, ['eilo:window-show-ready']);
  host.deliver('eilo:window-shown');
  assert.equal(shown, 1);
  unsubscribe();
  host.deliver('eilo:window-shown');
  assert.equal(shown, 1);
});
test('notification status bridge permits only booleans for the mutating channel', async () => {
  const host = load({ origin: 'http://127.0.0.1:8765', pathname: '/home/' });
  assert.deepEqual(await host.bridge.getCheckInNotifications(), {
    enabled: false,
    supported: true,
    error: false,
  });
  assert.deepEqual(await host.bridge.setCheckInNotifications(true), {
    enabled: false,
    supported: true,
    error: false,
  });
  assert.deepEqual(await host.bridge.setCheckInNotifications('true'), {
    enabled: false,
    supported: true,
    error: false,
  });
  assert.deepEqual(host.invoked, [
    ['eilo:check-in-notification-status'],
    ['eilo:set-check-in-notifications', true],
    ['eilo:check-in-notification-status'],
  ]);
});
test('other origins and local setup pages have no privileged bridge', () => {
  assert.equal(load({ origin: 'https://example.test', pathname: '/home/' }).bridge, undefined);
  assert.equal(
    load({ origin: 'http://127.0.0.1:8765', pathname: '/activity-setup.html' }).bridge,
    undefined,
  );
});

test('Chrome handoff carries no renderer-supplied URL or command', async () => {
  const host = load({ origin: 'http://127.0.0.1:8765', pathname: '/home/' });
  await host.bridge.openActivityConnection('https://example.test', '--anything');
  assert.deepEqual(host.invoked, [['eilo:open-activity-connection']]);
});

test('Chrome setup actions carry no renderer-supplied path, URL, or command', async () => {
  const host = load({ origin: 'http://127.0.0.1:8765', pathname: '/home/' });
  await host.bridge.openChromeSetup('https://example.test', '--anything');
  await host.bridge.openChromeExtensions('https://example.test', '--anything');
  await host.bridge.revealChromeExtension('/private/example');
  assert.deepEqual(host.invoked, [
    ['eilo:open-chrome-setup'],
    ['eilo:open-chrome-extensions'],
    ['eilo:reveal-chrome-extension'],
  ]);
});
