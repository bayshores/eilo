import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAccount } from './account.js';

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.textContent = '';
    this.hidden = false;
    this.classList = { add() {} };
  }
  append(...children) {
    this.children.push(...children);
    for (const child of children) child.parentElement = this;
  }
  replaceChildren(...children) {
    this.children = children;
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }
  show() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.listeners.close?.();
  }
  remove() {
    this.removed = true;
  }
  focus() {
    document.activeElement = this;
  }
  async click() {
    if (!this.disabled) await this.listeners.click?.();
    await new Promise(setImmediate);
  }
  querySelector(selector) {
    return this.all().find((node) => node.tag === selector) || null;
  }
  all() {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
}

function harness(t) {
  const body = new Element('body');
  const input = new Element('textarea');
  const previous = globalThis.document;
  globalThis.document = {
    body,
    activeElement: body,
    createElement: (tag) => new Element(tag),
    querySelector: (selector) => (selector === '#live-message-input' ? input : null),
  };
  const host = new Element('div');
  const commands = [];
  let listener;
  let rejected = false;
  const client = {
    view: { snapshot: { account: { state: 'needs_sign_in', revision: 1 } } },
    subscribe(fn) {
      listener = fn;
      return () => {
        listener = null;
      };
    },
    async refresh() {
      listener?.(client.view);
    },
  };
  function update(state, fields = {}) {
    client.view = {
      snapshot: {
        account: { state, revision: client.view.snapshot.account.revision + 1, ...fields },
      },
    };
    listener?.(client.view);
  }
  const account = mountAccount(host, {
    client,
    fetcher: async (url, options) => {
      assert.equal(url, '/api/account/commands');
      assert.equal(options.headers['X-Eilo-Client'], 'local-chat');
      const command = JSON.parse(options.body);
      assert.equal(command.based_on_revision, client.view.snapshot.account.revision);
      assert.match(command.request_id, /^[a-f0-9-]{36}$/);
      commands.push(command.action);
      if (rejected) return { ok: false };
      update(command.action === 'cancel' ? 'needs_sign_in' : 'starting');
      return { ok: true };
    },
  });
  const dialog = body.children[0];
  const find = (label) => dialog.all().find((element) => element.textContent === label);
  t.after(() => {
    account.destroy();
    globalThis.document = previous;
  });
  return {
    host,
    trigger: host.children[0],
    dialog,
    find,
    commands,
    update,
    input,
    reject(value) {
      rejected = value;
    },
  };
}

test('sign-in starts explicitly, can be reopened without a new code, and cancels with current revision', async (t) => {
  const h = harness(t);
  assert.deepEqual(h.commands, []);
  assert.equal(h.host.hidden, false);
  await h.trigger.click();
  assert.equal(h.dialog.open, true);
  assert.deepEqual(h.commands, ['start']);
  h.update('awaiting_sign_in', { user_code: 'DEMO-1234' });
  assert.equal(h.find('DEMO-1234').hidden, false);
  assert.equal(h.find('Continue in browser').hidden, false);
  h.dialog.close();
  assert.equal(document.activeElement, h.trigger);
  assert.equal(h.trigger.textContent, 'Finish sign-in');
  await h.trigger.click();
  assert.deepEqual(h.commands, ['start']);
  assert.equal(h.find('DEMO-1234').hidden, false);
  await h.find('Cancel sign-in').click();
  assert.deepEqual(h.commands, ['start', 'cancel']);
  assert.equal(h.dialog.open, false);
  assert.equal(h.trigger.textContent, 'Connect ChatGPT');
  assert.equal(h.dialog.all().find((element) => element.tag === 'code').textContent, '');
});

test('failed requests and expired sign-in stay recoverable without opening a browser automatically', async (t) => {
  const h = harness(t);
  const previous = globalThis.open;
  const opened = [];
  globalThis.open = (...args) => opened.push(args);
  t.after(() => {
    globalThis.open = previous;
  });
  h.reject(true);
  await h.trigger.click();
  assert.ok(h.find('Could not start sign-in. Try again.'));
  assert.equal(h.find('Try again').hidden, false);
  assert.deepEqual(opened, []);
  h.reject(false);
  await h.find('Try again').click();
  h.update('awaiting_sign_in', { user_code: 'DEMO-1234' });
  await h.find('Continue in browser').click();
  assert.deepEqual(opened, [['https://auth.openai.com/codex/device', '_blank', 'noopener']]);
  h.update('unavailable');
  assert.equal(h.find('Try again').hidden, false);
  assert.equal(h.find('Continue in browser').hidden, true);
  assert.equal(h.dialog.all().find((element) => element.tag === 'code').textContent, '');
});

test('successful sign-in closes the panel and returns focus to the composer', async (t) => {
  const h = harness(t);
  await h.trigger.click();
  h.update('awaiting_sign_in', { user_code: 'DEMO-1234' });
  h.update('connected');
  assert.equal(h.host.hidden, true);
  assert.equal(h.dialog.open, false);
  assert.equal(h.trigger['aria-expanded'], 'false');
  assert.equal(document.activeElement, h.input);
});
