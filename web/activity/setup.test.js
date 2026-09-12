import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionFolder, mountChromeSetup } from './setup.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.textContent = '';
    this.classList = { contains: () => false };
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(key, value) {
    this[key] = value;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  querySelectorAll(tag) {
    return this.children.flatMap((child) => [
      ...(child.tag === tag ? [child] : []),
      ...child.querySelectorAll(tag),
    ]);
  }
  querySelector(tag) {
    return this.querySelectorAll(tag)[0];
  }
  async click() {
    if (!this.disabled) await this.listeners.click?.();
    await new Promise(setImmediate);
  }
  focus() {}
}
const identity = { app: 'eilo', protocol: 1, workspace: '/example/My eilo' };
const current = (flags = {}, health = {}) => ({
  connection: 'connected',
  snapshot: {
    adaptive: {
      policy: {
        enabled: false,
        browser_enabled: false,
        text_enabled: false,
        ai_enabled: false,
        ...flags,
      },
      capture_status: { browser: { registration: 'ready', ...health } },
    },
  },
});
const verified = {
  connected: true,
  setup_verified: true,
  grant_verified: true,
  last_verified_at: 20,
};
function harness(t, options = {}) {
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element('body') };
  const host = new Element('div');
  const requests = [],
    copied = [],
    opened = [],
    controls = [];
  const guide = mountChromeSetup(host, {
    fetcher: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => identity };
    },
    clipboard: {
      writeText: async (value) => {
        copied.push(value);
      },
    },
    storage: { getItem: () => null, setItem() {} },
    openChrome: async () => {
      opened.push('chrome');
      return true;
    },
    bridge: { available: false, probe: async () => null, open: async () => false },
    onNativeControl: async (value) => {
      controls.push(value);
    },
    ...options,
  });
  guide.update(current());
  t.after(() => guide.destroy());
  return {
    host,
    guide,
    requests,
    copied,
    opened,
    controls,
    button: (text) => host.querySelectorAll('button').find((node) => node.textContent === text),
    heading: () => host.querySelector('h2').textContent,
  };
}
test('folder is derived only from a validated desktop identity', () => {
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
test('opening setup is read-only; only an explicit handoff changes browser intent', async (t) => {
  const h = harness(t);
  await h.guide.ready;
  assert.deepEqual(h.controls, []);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.requests, []);
  await h.button('Open Chrome setup').click();
  assert.deepEqual(h.controls, ['connect']);
  assert.deepEqual(h.opened, ['chrome']);
});
test('install uses the current folder and a failed lookup cannot copy a guessed path', async (t) => {
  let calls = 0;
  const h = harness(t, {
    bridge: { available: true, probe: async () => null, open: async () => false },
    fetcher: async () => ({ ok: true, json: async () => (++calls === 1 ? {} : identity) }),
  });
  await h.button('Copy extensions address').click();
  assert.equal(h.heading(), 'Add the eïlo extension');
  await h.button('Copy extension folder').click();
  assert.deepEqual(h.copied, ['chrome://extensions/']);
  await h.button('Copy extension folder').click();
  assert.deepEqual(h.copied, ['chrome://extensions/', '/example/My eilo/activity/extension']);
  assert.deepEqual(h.controls, []);
});
test('verified setup remains separate from enabled capture and an actual website receipt', async (t) => {
  const h = harness(t);
  h.guide.update(current({}, verified));
  assert.equal(h.heading(), 'Chrome is ready');
  await h.button('Connect Chrome').click();
  assert.deepEqual(h.controls, ['connect']);
  h.guide.update(current({ enabled: true, browser_enabled: true }, verified));
  assert.equal(h.heading(), 'Chrome connected');
  assert.ok(
    h.host
      .querySelectorAll('p')
      .some(
        (node) =>
          node.textContent === 'Visit a regular website. Its session will appear in Activity.',
      ),
  );
  h.guide.update(
    current({ enabled: true, browser_enabled: true }, { ...verified, last_event_at: 22 }),
  );
  assert.ok(
    h.host.querySelectorAll('p').some((node) => node.textContent === 'Website activity received'),
  );
  await h.button('Pause Chrome').click();
  assert.deepEqual(h.controls, ['connect', 'pause']);
});
test('a socket attachment and a stale offline snapshot cannot complete setup', (t) => {
  const h = harness(t);
  h.guide.update(current({ enabled: true, browser_enabled: true }, { connected: true }));
  assert.notEqual(h.heading(), 'Chrome connected');
  h.guide.update({
    ...current({ enabled: true, browser_enabled: true }, verified),
    connection: 'offline',
  });
  assert.notEqual(h.heading(), 'Chrome connected');
});
test('snapshot updates keep the card and controls stable and never perform new actions', (t) => {
  const h = harness(t);
  const card = h.host.children[0],
    heading = h.host.querySelector('h2'),
    buttons = h.host.querySelectorAll('button');
  for (let count = 0; count < 50; count++)
    h.guide.update(
      current({ enabled: true, browser_enabled: true }, { ...verified, last_event_at: count + 21 }),
    );
  assert.equal(h.host.children[0], card);
  assert.equal(h.host.querySelector('h2'), heading);
  assert.deepEqual(h.host.querySelectorAll('button'), buttons);
  assert.deepEqual(h.controls, []);
});

test('a non-Chrome fallback preserves the connection guide instead of guessing extension state', async (t) => {
  const h = harness(t, {
    openChrome: undefined,
    bridge: {
      available: false,
      probe: async () => null,
      open: async () => false,
      setupURL: 'chrome-extension://' + 'a'.repeat(32) + '/popup.html',
    },
  });
  await h.button('Open Chrome setup').click();
  assert.deepEqual(h.copied, ['http://127.0.0.1:8765/activity-connect?client=desktop']);
  assert.deepEqual(h.opened, []);
  h.guide.update(current({ browser_enabled: true }));
  assert.notEqual(h.heading(), 'Chrome connected');
});

test('already allowed Chrome retries without another permission page or source change', async (t) => {
  let probes = 0;
  const h = harness(t, {
    bridge: {
      available: true,
      probe: async () => {
        probes++;
        return { installed: true, granted: true, setup_protocol: 2 };
      },
      open: async () => {
        throw new Error('permission handoff must not run');
      },
    },
  });
  h.guide.update(current({ enabled: true, browser_enabled: true }));
  await new Promise(setImmediate);
  const initial = probes;
  await h.button('Retry connection').click();
  assert.ok(probes > initial);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.controls, []);
});

test('desktop handoff completes without a browser Home or activity navigation', (t) => {
  const h = harness(t, { returnToDesktop: true });
  h.guide.update(current({ enabled: true, browser_enabled: true }, verified));
  assert.equal(h.heading(), 'Chrome connected');
  assert.equal(h.button('View activity').hidden, true);
  assert.equal(h.button('Not now').hidden, true);
  assert.ok(
    h.host
      .querySelectorAll('p')
      .some((node) => node.textContent.includes('Return to the eïlo desktop app')),
  );
});

test('an old extension gets a truthful reload step when Chrome settings must be opened manually', async (t) => {
  const h = harness(t, {
    bridge: {
      available: true,
      probe: async () => ({ installed: true, granted: true }),
      open: async () => false,
    },
  });
  await new Promise(setImmediate);
  assert.equal(h.heading(), 'Reload the eïlo extension once');
  assert.ok(h.host.querySelectorAll('p').some((node) => node.textContent === 'Update connection'));
  await h.button('Copy extensions address').click();
  assert.deepEqual(h.copied, ['chrome://extensions/']);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(h.controls, []);
  assert.equal(h.heading(), 'Reload the eïlo extension once');
});
