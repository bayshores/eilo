import test from 'node:test';
import assert from 'node:assert/strict';
import { createInlineDialog } from './inline-dialog.js';

function harness(t) {
  const previousDocument = globalThis.document;
  const previousObserver = globalThis.MutationObserver;
  const workspace = { dataset: { page: 'activity' } };
  const host = {
    append(dialog) {
      dialog.parentElement = this;
    },
  };
  const heading = {
    focus() {
      this.focused = true;
    },
  };
  const dialog = new EventTarget();
  Object.assign(dialog, {
    classList: { add() {} },
    querySelector: () => heading,
    show() {
      this.open = true;
    },
    close() {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    },
  });
  let observer;
  globalThis.document = {
    body: host,
    querySelector: (selector) => (selector === '.workspace' ? workspace : host),
  };
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      observer = this;
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.MutationObserver = previousObserver;
  });
  const open = createInlineDialog(dialog);
  const escape = () => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: 'Escape' });
    dialog.dispatchEvent(event);
    return event;
  };
  return { dialog, host, heading, workspace, open, escape, observer: () => observer };
}

test('inline views open in the active page and Escape closes through the normal lifecycle', (t) => {
  const h = harness(t);
  h.open();
  assert.equal(h.dialog.parentElement, h.host);
  assert.equal(h.dialog.open, true);
  assert.equal(h.heading.focused, true);
  assert.equal(h.escape().defaultPrevented, true);
  assert.equal(h.dialog.open, false);
  assert.equal(h.observer().connected, false);
});

test('page navigation dismisses inline views using the owners cancel handler', (t) => {
  const h = harness(t);
  let canceled = 0;
  h.dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    canceled += 1;
    h.dialog.close();
  });
  h.open();
  h.workspace.dataset.page = 'goals';
  h.observer().callback();
  assert.equal(canceled, 1);
  assert.equal(h.dialog.open, false);
  h.open();
  h.escape();
  assert.equal(canceled, 2);
});

test('owners can prevent cancellation and handled Escape does not dismiss twice', (t) => {
  const h = harness(t);
  h.dialog.addEventListener('cancel', (event) => event.preventDefault());
  h.open();
  h.escape();
  assert.equal(h.dialog.open, true);
  const handled = new Event('keydown', { cancelable: true });
  Object.defineProperty(handled, 'key', { value: 'Escape' });
  handled.preventDefault();
  h.dialog.dispatchEvent(handled);
  assert.equal(h.dialog.open, true);
  h.dialog.close();
});

test('a Talk-owned view stays in the visible conversation and closes when leaving Talk', (t) => {
  const h = harness(t);
  let talking = true;
  const talkHost = {
    append(dialog) {
      dialog.parentElement = this;
    },
  };
  h.workspace.classList = { contains: () => talking };
  const query = document.querySelector;
  document.querySelector = (selector) =>
    selector === '.conversation-dock' ? talkHost : query(selector);
  h.open();
  assert.equal(h.dialog.parentElement, talkHost);
  talking = false;
  h.observer().callback();
  assert.equal(h.dialog.open, false);
});
