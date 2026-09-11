import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionFolder, mountChromeSetup } from './setup.js';

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
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
  addEventListener(name, callback) {
    this.listeners[name] = callback;
  }
  querySelectorAll(tag) {
    return this.children.flatMap((child) => [
      ...(child.tag === tag ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }
  async click() {
    if (!this.disabled) await this.listeners.click?.({ currentTarget: this });
  }
  querySelector(tag) {
    return this.querySelectorAll(tag)[0];
  }
  focus() {}
}

const identity = { app: 'eilo', protocol: 1, workspace: '/example/My eilo' };
function harness(options = {}) {
  globalThis.document = { createElement: (tag) => new Node(tag) };
  const host = new Node('div');
  const requests = [],
    copied = [],
    opened = [],
    controls = [];
  const nativeControls = [];
  const guide = mountChromeSetup(host, {
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => identity };
    },
    clipboard: {
      writeText: async (value) => {
        copied.push(value);
      },
    },
    openChrome: async (...args) => {
      opened.push(args);
      return true;
    },
    onControl: async (action) => {
      controls.push(action);
    },
    onNativeControl: async (action) => {
      nativeControls.push(action);
    },
    ...options,
  });
  return {
    host,
    guide,
    requests,
    copied,
    opened,
    controls,
    nativeControls,
    button: (name) => host.querySelectorAll('button').find((item) => item.textContent === name),
  };
}

test('folder guidance comes only from the expected service identity and an absolute path', () => {
  assert.equal(extensionFolder(identity), '/example/My eilo/activity/extension');
  assert.equal(
    extensionFolder({ ...identity, workspace: 'C:\\Work\\eilo\\' }),
    'C:\\Work\\eilo\\activity\\extension',
  );
  for (const value of [
    null,
    { ...identity, app: 'other' },
    { ...identity, protocol: 2 },
    { ...identity, workspace: '../eilo' },
    { ...identity, workspace: '/eilo\nother' },
  ])
    assert.equal(extensionFolder(value), null);
});

test('opening the guide is read-only and copying uses the exact current folder', async () => {
  const h = harness();
  await h.guide.ready;
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/desktop');
  assert.equal(h.requests[0].options.headers['X-Eilo-Client'], 'local-chat');
  assert.equal(h.requests[0].options.method, undefined);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.controls, []);
  await h.button('Copy folder path').click();
  assert.deepEqual(h.copied, ['/example/My eilo/activity/extension']);
  await h.button('Open in Chrome').click();
  assert.deepEqual(h.opened, [[]]);
  assert.deepEqual(h.controls, []);
  h.guide.destroy();
});

test('failed folder lookup has an explicit retry and cannot copy a guessed path', async () => {
  let attempts = 0;
  const h = harness({
    fetcher: async () => ({ ok: true, json: async () => (++attempts === 1 ? {} : identity) }),
  });
  await h.guide.ready;
  assert.equal(h.button('Copy folder path').disabled, true);
  assert.equal(h.button('Retry folder lookup').hidden, false);
  await h.button('Retry folder lookup').click();
  assert.equal(h.button('Copy folder path').disabled, false);
  assert.equal(h.button('Retry folder lookup').hidden, true);
  h.guide.destroy();
});

test('sharing controls follow confirmed state and require an explicit action', async () => {
  const h = harness();
  await h.guide.ready;
  const view = (connection, state) => ({
    connection,
    snapshot: { accountability: { activity: { state } } },
  });
  h.guide.update(view('connected', 'off'));
  assert.equal(h.button('Pause sharing').hidden, true);
  h.guide.update(view('connected', 'active'));
  assert.equal(h.button('Pause sharing').hidden, false);
  assert.deepEqual(h.controls, []);
  await h.button('Pause sharing').click();
  assert.deepEqual(h.controls, ['pause']);
  h.guide.update(view('offline', 'active'));
  assert.equal(h.button('Pause sharing').hidden, true);
  assert.equal(h.button('Turn off sharing').hidden, true);
  h.guide.destroy();
});

test('a connected native Chrome transport uses one explicit connect or pause action', async () => {
  const h = harness();
  await h.guide.ready;
  const native = (enabled, browserEnabled, status = 'connected') => ({
    connection: 'connected',
    snapshot: {
      adaptive: {
        policy: {
          enabled,
          browser_enabled: browserEnabled,
          text_enabled: false,
          ai_enabled: false,
        },
        capture_status: { browser: { connected: true, status } },
      },
    },
  });
  h.guide.update(native(false, false));
  assert.equal(h.host.querySelector('h2').textContent, 'Chrome is ready');
  await h.button('Connect Chrome').click();
  assert.deepEqual(h.nativeControls, ['connect']);
  h.guide.update(native(true, true));
  assert.equal(h.host.querySelector('h2').textContent, 'Chrome connected');
  await h.button('Pause').click();
  assert.deepEqual(h.nativeControls, ['connect', 'pause']);
  h.guide.update(native(true, true, 'paused'));
  assert.equal(h.host.querySelector('h2').textContent, 'Chrome is paused');
  h.guide.destroy();
});

test('the guide shows only one installation step at a time and supports going back', async () => {
  const h = harness();
  await h.guide.ready;
  const visible = () => h.host.querySelectorAll('li').filter((item) => !item.hidden);
  assert.equal(visible().length, 1);
  assert.equal(visible()[0].querySelector('h3').textContent, 'Open Chrome’s extensions');
  assert.equal(h.button('Back').hidden, true);
  await h.button('Next').click();
  assert.equal(visible().length, 1);
  assert.equal(visible()[0].querySelector('h3').textContent, 'Load eïlo');
  await h.button('Back').click();
  assert.equal(visible()[0].querySelector('h3').textContent, 'Open Chrome’s extensions');
  await h.button('Extension already installed').click();
  assert.equal(visible().length, 1);
  assert.equal(visible()[0].querySelector('h3').textContent, 'Connect your browser');
  assert.equal(h.button('Next').hidden, true);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.controls, []);
  h.guide.destroy();
});
