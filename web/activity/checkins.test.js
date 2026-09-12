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
  globalThis.document = { createElement: (tag) => new Element(tag) };
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
  const label = host.all().find((node) => node.textContent === 'Turn off check-ins');
  assert.ok(label);
  assert.equal(toggle['aria-checked'], 'true');
  toggle.checked = false;
  const pause = toggle.listeners.change();
  assert.equal(
    host.all().find((node) => node.textContent === 'Turning off check-ins…'),
    label,
  );
  center.update(view(true));
  assert.equal(toggle.checked, false);
  assert.equal(toggle['aria-checked'], 'false');
  requests[0].reject(new Error('No connection'));
  await pause;
  assert.equal(toggle.checked, true);
  assert.equal(toggle['aria-checked'], 'true');
  assert.equal(
    host.all().find((node) => node.textContent === 'Turn off check-ins'),
    label,
  );
  center.update(view(false));
  assert.ok(host.all().find((node) => node.textContent === 'Turn on check-ins'));
  assert.equal(toggle['aria-checked'], 'false');
  toggle.checked = true;
  const resume = toggle.listeners.change();
  assert.ok(host.all().find((node) => node.textContent === 'Turning on check-ins…'));
  center.update(view(false));
  assert.equal(toggle.checked, true);
  assert.equal(toggle['aria-checked'], 'true');
  requests[1].resolve();
  center.update(view(true));
  await resume;
  assert.ok(host.all().find((node) => node.textContent === 'Turn off check-ins'));
});
