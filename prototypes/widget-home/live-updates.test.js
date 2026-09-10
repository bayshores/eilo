import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveUpdates } from './live-updates.js';

// Minimal host adapter: exercise actual queue/DOM event wiring without capturing
// media, starting a server, or introducing a browser dependency into unit tests.
test('opening conversation preserves the next update and pauses dismissal while covered', () => {
  const original = Object.fromEntries(['document', 'window', 'localStorage', 'MutationObserver', 'setTimeout', 'clearTimeout'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  class Element {
    constructor() { this.children = []; this.listeners = new Map(); this.parts = new Map(); this.hidden = false; this.classList = { toggle() {} }; }
    setAttribute() {}
    append(child) { this.children.push(child); child.parent = this; }
    querySelector(selector) { if (!this.parts.has(selector)) { const child = new Element(); this.parts.set(selector, child); this.append(child); } return this.parts.get(selector); }
    addEventListener(name, fn) { const list = this.listeners.get(name) || []; list.push(fn); this.listeners.set(name, list); }
    fire(name) { for (const fn of this.listeners.get(name) || []) fn({}); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  }
  const app = new Element(), body = new Element(), dialog = new Element(), storage = new Map(), timers = new Map();
  dialog.open = false;
  const document = new Element();
  document.body = body; document.visibilityState = 'visible'; document.activeElement = body;
  document.createElement = () => new Element();
  document.querySelector = selector => selector === '.app-window' ? app : selector === 'dialog[open]' && dialog.open ? dialog : null;
  document.querySelectorAll = selector => selector === 'dialog' ? [dialog] : [];
  let changed, timerId = 0;
  Object.assign(globalThis, {
    document, window: new Element(),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { constructor(callback) { changed = callback; } observe() {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
  });
  try {
    const updates = createLiveUpdates({ openConversation: () => { dialog.open = true; } });
    const state = { snapshot: { conversation_id: 'test-conversation', messages: [], accountability: {} } };
    updates.update(state);
    state.snapshot.messages = [1, 2].map(number => ({ id: `native-${number}`, event_id: `check-${number}`, role: 'assistant', origin: 'check_in', text: `Update ${number}` }));
    updates.update(state);
    const panel = app.children[0], seen = () => JSON.parse([...storage.values()][0]);
    assert.equal(panel.querySelector('.live-update-text').textContent, 'Update 1');
    assert.ok(seen().includes('event:check-1'));
    assert.ok(!seen().includes('event:check-2'));
    assert.equal(timers.size, 1);

    panel.querySelector('.live-update-open').fire('click');
    assert.equal(dialog.open, true);
    assert.equal(panel.hidden, true);
    assert.ok(!seen().includes('event:check-2'), 'covered successor must not be marked displayed');
    assert.equal(timers.size, 0);
    changed();
    assert.ok(!seen().includes('event:check-2'));

    dialog.open = false; changed();
    assert.equal(panel.hidden, false);
    assert.equal(panel.querySelector('.live-update-text').textContent, 'Update 2');
    assert.ok(seen().includes('event:check-2'));
    assert.equal(timers.size, 1);

    dialog.open = true; changed();
    assert.equal(timers.size, 0, 'opening any dialog pauses an existing dismissal timer');
    dialog.open = false; changed();
    assert.equal(timers.size, 1, 'uncovering the completed update resumes dismissal');
  } finally {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
