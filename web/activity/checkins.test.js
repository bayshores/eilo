import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCheckinCenter } from './checkins.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.listeners = {};
    this.classList = { add() {} };
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
  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  all() {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
}

const view = (enabled) => ({
  connection: 'connected',
  snapshot: {
    accountability: {
      check_ins: { version: 1, enabled, phase: enabled ? 'eligible' : 'off', history: [] },
    },
    tasks: { tasks: [] },
  },
});

const deferred = () => {
  let resolve, reject;
  return {
    promise: new Promise((next, fail) => {
      resolve = next;
      reject = fail;
    }),
    resolve,
    reject,
  };
};

test('check-in switch keeps the requested transition visible and restores confirmed state after failure', async (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = { createElement: (tag) => new Element(tag), body: new Element('body') };
  globalThis.window = {};
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });
  const host = new Element('div');
  const requests = [];
  const center = mountCheckinCenter(host, {
    onToggle: (enabled) => {
      const request = deferred();
      requests.push({ enabled, ...request });
      return request.promise;
    },
    onConnect() {},
    onDiscuss() {},
    onLog() {},
    onCheckIns() {},
    onObserved() {},
  });
  center.update(view(true));
  const toggle = host.all().find((node) => node.tag === 'input');
  const label = host.all().find((node) => node.textContent === 'Check-ins');
  assert.ok(label);
  assert.equal(toggle['aria-checked'], 'true');
  toggle.checked = false;
  const pause = toggle.listeners.change();
  assert.equal(toggle['aria-label'], 'Turning off check-ins…');
  assert.equal(label.textContent, 'Check-ins');
  center.update(view(true));
  assert.equal(toggle.checked, false);
  assert.equal(toggle['aria-checked'], 'false');
  requests[0].reject(new Error('No connection'));
  await pause;
  assert.equal(toggle.checked, true);
  assert.equal(toggle['aria-checked'], 'true');
  assert.equal(toggle['aria-label'], 'Turn off check-ins');
  assert.equal(label.textContent, 'Check-ins');
  const dialog = document.body.children.find((node) => node.tag === 'dialog');
  assert.equal(dialog.open, true);
  assert.equal(dialog.all().find((node) => node['role'] === 'alert').textContent, 'No connection');
  center.close();
  assert.equal(dialog.open, false);
  center.update(view(false));
  assert.equal(toggle['aria-label'], 'Turn on check-ins');
  assert.equal(toggle['aria-checked'], 'false');
  toggle.checked = true;
  const resume = toggle.listeners.change();
  assert.equal(toggle['aria-label'], 'Turning on check-ins…');
  center.update(view(false));
  assert.equal(toggle.checked, true);
  assert.equal(toggle['aria-checked'], 'true');
  requests[1].resolve();
  center.update(view(true));
  await resume;
  assert.equal(toggle['aria-label'], 'Turn off check-ins');
  assert.equal(label.textContent, 'Check-ins');
  assert.equal(dialog.open, false);
  assert.equal(dialog.all().find((node) => node['role'] === 'alert').hidden, true);
});

test('setup phases keep the header stable and show details only on request', async (t) => {
  const previousDocument = globalThis.document,
    previousWindow = globalThis.window;
  const body = new Element('body');
  globalThis.document = { createElement: (tag) => new Element(tag), body };
  let reads = 0,
    grants = 0;
  globalThis.window = {
    eiloDesktop: {
      getCheckInNotifications: async () => {
        reads++;
        return { supported: true, enabled: false };
      },
      setCheckInNotifications: async () => {
        grants++;
        return { supported: true, enabled: true };
      },
    },
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  });
  const host = new Element('div');
  const center = mountCheckinCenter(host, { onToggle() {}, onConnect() {}, onDiscuss() {} });
  const toggle = host.all().find((node) => node.tag === 'input');
  const label = host.all().find((node) => node.textContent === 'Check-ins');
  const dialog = body.children[0];
  for (const phase of [
    'off',
    'no_conversation',
    'no_goals',
    'awaiting_observation',
    'eligible',
    'unavailable',
  ]) {
    const next = view(phase !== 'off');
    next.snapshot.accountability.check_ins.phase = phase;
    center.update(next);
    assert.equal(
      host.all().find((node) => node.tag === 'input'),
      toggle,
    );
    assert.equal(label.textContent, 'Check-ins');
    assert.equal(
      host.all().some((node) => ['h2', 'p'].includes(node.tag)),
      false,
    );
    assert.ok(!dialog.open, phase);
  }
  assert.equal(reads, 0);
  assert.equal(grants, 0);
  center.update(view(true));
  host
    .all()
    .find((node) => node['aria-label'] === 'Check-in settings')
    .listeners.click();
  await Promise.resolve();
  assert.equal(dialog.open, true);
  assert.equal(reads, 1);
  assert.equal(grants, 0);
  center.close();
});
