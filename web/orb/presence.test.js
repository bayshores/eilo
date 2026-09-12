import assert from 'node:assert/strict';
import test from 'node:test';
import { mountOrb, orbState } from './presence.js';

test('orb reflects actual capture and service state without implying recording from inference', () => {
  const connected = { connection: 'connected', snapshot: { status: 'idle' } };
  assert.equal(orbState(connected), 'idle');
  assert.equal(orbState({ ...connected, sending: true }), 'thinking');
  assert.equal(orbState({ ...connected, snapshot: { status: 'busy' } }), 'thinking');
  assert.equal(orbState(connected, 'recording'), 'listening');
  assert.equal(orbState(connected, 'transcribing'), 'processing');
  assert.equal(orbState(connected, 'requesting'), 'processing');
  assert.equal(orbState({ connection: 'offline' }), 'offline');
  assert.equal(orbState({ connection: 'loading' }), 'connecting');
  assert.equal(orbState({ ...connected, snapshot: { recovery_pending: true } }), 'attention');
  assert.equal(orbState({ ...connected, snapshot: { status: 'error' } }), 'attention');
  assert.equal(orbState({ connection: 'offline' }, 'recording'), 'listening');
});

function installOrbDom() {
  const observers = [];
  let color = '#fac399';
  class Element {
    constructor() {
      this.children = [];
      this.dataset = {};
      this.listeners = new Map();
      this.classList = { add() {}, contains: () => false };
    }
    append(child) {
      child.parentNode = this;
      this.children.push(child);
    }
    remove() {
      this.parentNode?.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    setAttribute() {}
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    removeEventListener(name) {
      this.listeners.delete(name);
    }
  }
  const body = new Element();
  const document = {
    body,
    documentElement: new Element(),
    visibilityState: 'visible',
    createElement: () => new Element(),
    addEventListener() {},
    removeEventListener() {},
  };
  const media = {
    matches: false,
    listener: null,
    addEventListener(_name, listener) {
      this.listener = listener;
    },
    removeEventListener() {},
  };
  const old = {
    document: globalThis.document,
    window: globalThis.window,
    IntersectionObserver: globalThis.IntersectionObserver,
    MutationObserver: globalThis.MutationObserver,
    getComputedStyle: globalThis.getComputedStyle,
  };
  globalThis.document = document;
  globalThis.window = { matchMedia: () => media };
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe() {}
    disconnect() {}
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => color });
  return {
    container: new Element(),
    media,
    setColor(value) {
      color = value;
    },
    show(visible) {
      observers[0].callback([
        {
          isIntersecting: visible,
          intersectionRect: { width: visible ? 40 : 0, height: visible ? 40 : 0 },
        },
      ]);
    },
    restore() {
      Object.assign(globalThis, old);
    },
  };
}

const flush = () => new Promise((resolve) => queueMicrotask(resolve));

test('mountOrb lazily creates its renderer only when its container becomes visible', async () => {
  const dom = installOrbDom();
  try {
    let loads = 0;
    const updates = [];
    const controller = mountOrb(dom.container, {
      loadRenderer: async () => {
        loads++;
        return { createVoiceOrb: () => ({ update: (value) => updates.push(value), destroy() {} }) };
      },
    });
    assert.equal(loads, 0);
    dom.show(true);
    await flush();
    await flush();
    assert.equal(loads, 1);
    assert.equal(dom.container.dataset.orbRenderer, 'webgl');
    assert.equal(updates.at(-1).paused, false);
    controller.destroy();
  } finally {
    dom.restore();
  }
});

test('mountOrb forwards visibility, pause, reduced-motion, and color changes without reloading', async () => {
  const dom = installOrbDom();
  try {
    let loads = 0;
    const updates = [];
    const controller = mountOrb(dom.container, {
      loadRenderer: async () => {
        loads++;
        return { createVoiceOrb: () => ({ update: (value) => updates.push(value), destroy() {} }) };
      },
    });
    dom.show(true);
    await flush();
    await flush();
    controller.pause(true);
    assert.equal(updates.at(-1).paused, true);
    controller.pause(false);
    dom.media.matches = true;
    dom.setColor('#e7a07a');
    dom.media.listener();
    assert.deepEqual(updates.at(-1), {
      color: '#e7a07a',
      reducedMotion: true,
      paused: false,
      amplitude: 0,
      busy: false,
    });
    dom.show(false);
    assert.equal(updates.at(-1).paused, true);
    assert.equal(loads, 1);
    controller.destroy();
  } finally {
    dom.restore();
  }
});

test('mountOrb ignores a renderer that resolves after destruction', async () => {
  const dom = installOrbDom();
  try {
    let resolveRenderer,
      created = 0;
    const controller = mountOrb(dom.container, {
      loadRenderer: () => new Promise((resolve) => (resolveRenderer = resolve)),
    });
    dom.show(true);
    controller.destroy();
    resolveRenderer({ createVoiceOrb: () => (created++, { update() {}, destroy() {} }) });
    await flush();
    await flush();
    assert.equal(created, 0);
    assert.equal(dom.container.children.length, 0);
  } finally {
    dom.restore();
  }
});

test('mountOrb keeps its fallback when lazy renderer loading rejects', async () => {
  const dom = installOrbDom();
  try {
    let loads = 0;
    const controller = mountOrb(dom.container, {
      loadRenderer: async () => {
        loads++;
        throw new Error('WebGL unavailable');
      },
    });
    dom.show(true);
    await flush();
    await flush();
    assert.equal(dom.container.dataset.orbRenderer, 'fallback');
    controller.update({ state: 'thinking' });
    assert.equal(loads, 1);
    controller.destroy();
  } finally {
    dom.restore();
  }
});
