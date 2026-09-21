import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceRouter } from './router.js';

function harness(hash = '') {
  const listeners = new Map();
  const location = { pathname: '/home/', search: '?demo=1', hash };
  const windowRef = {
    location,
    history: {
      pushes: [],
      pushState(_state, _title, route) {
        this.pushes.push(route);
        const hashIndex = route.indexOf('#');
        location.hash = hashIndex < 0 ? '' : route.slice(hashIndex);
      },
    },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
  };
  const documentRef = { title: '', querySelector: () => null, querySelectorAll: () => [] };
  return { windowRef, documentRef, listeners };
}

test('restores only recognized hashes without adding a history entry', () => {
  const h = harness('#connections'),
    rendered = [];
  const router = createWorkspaceRouter({ ...h, renderPage: (page) => rendered.push(page) });
  router.start();
  assert.deepEqual(rendered, ['connections']);
  assert.deepEqual(h.windowRef.history.pushes, []);
});

test('navigation preserves search, pushes once, and applies route changes from browser history', () => {
  const h = harness(),
    rendered = [];
  const router = createWorkspaceRouter({ ...h, renderPage: (page) => rendered.push(page) });
  router.start();
  router.showPage('goals');
  router.showPage('goals');
  assert.deepEqual(h.windowRef.history.pushes, ['/home/?demo=1#goals']);
  h.windowRef.location.hash = '#activity';
  h.listeners.get('hashchange')();
  assert.deepEqual(rendered, ['home', 'goals', 'goals', 'activity']);
});

test('dispose unregisters history listeners and start can mount them again after a page restore', () => {
  const h = harness(),
    router = createWorkspaceRouter({ ...h });
  router.start();
  assert.equal(h.listeners.size, 2);
  router.dispose();
  assert.equal(h.listeners.size, 0);
  router.start();
  assert.equal(h.listeners.size, 2);
});

test('Settings is a restorable destination without introducing Home layout controls', () => {
  const h = harness('#settings');
  const elements = new Map(
    ['.home-header h1', '.home-context', '.home-header p'].map((key) => [
      key,
      {
        hidden: false,
        textContent: key === '.home-header p' ? 'Connected' : '',
        focus() {},
        toggleAttribute(_name, hidden) {
          this.hidden = hidden;
        },
      },
    ]),
  );
  h.documentRef.querySelector = (key) => elements.get(key) || null;
  const rendered = [];
  const router = createWorkspaceRouter({ ...h, renderPage: (page) => rendered.push(page) });
  router.start();
  assert.deepEqual(rendered, ['settings']);
  assert.equal(h.documentRef.title, 'felis — Settings');
  router.showPage('home');
  assert.equal(elements.get('.home-context').hidden, false);
  assert.equal(elements.get('.home-header h1').textContent, 'Home');
});

test('Home hides empty status chrome and shows a current status only on Home', () => {
  const h = harness();
  const elements = new Map(
    ['.home-header p', '.home-context'].map((key) => [
      key,
      {
        hidden: false,
        textContent: '',
        toggleAttribute(_name, hidden) {
          this.hidden = hidden;
        },
      },
    ]),
  );
  h.documentRef.querySelector = (key) => elements.get(key) || null;
  const router = createWorkspaceRouter({ ...h });

  router.showPage('home', { focus: false });
  assert.equal(elements.get('.home-header p').hidden, true);
  assert.equal(elements.get('.home-context').hidden, true);

  elements.get('.home-header p').textContent = 'Reconnecting…';
  router.showPage('home', { focus: false });
  assert.equal(elements.get('.home-header p').hidden, false);
  assert.equal(elements.get('.home-context').hidden, false);

  router.showPage('goals', { focus: false });
  assert.equal(elements.get('.home-header p').hidden, true);
  assert.equal(elements.get('.home-context').hidden, true);
});

test('Settings focuses the shared heading while Connections uses its manager heading', () => {
  const h = harness();
  const headings = new Map(
    ['.home-header h1', '.connections-manager h2'].map((key) => [
      key,
      {
        focusCalls: 0,
        focusOptions: null,
        focus(options) {
          this.focusCalls += 1;
          this.focusOptions = options;
        },
      },
    ]),
  );
  h.documentRef.querySelector = (key) => headings.get(key) || null;
  const router = createWorkspaceRouter({ ...h });

  router.showPage('settings');
  assert.equal(headings.get('.home-header h1').textContent, 'Settings');
  assert.equal(headings.get('.home-header h1').focusCalls, 1);

  router.showPage('connections');
  assert.equal(headings.get('.connections-manager h2').focusCalls, 1);
  assert.deepEqual(headings.get('.connections-manager h2').focusOptions, { preventScroll: true });
});

test('Talk changes shared chrome without losing the workspace route', () => {
  const h = harness();
  const heading = { textContent: '', focus() {} };
  h.documentRef.querySelector = (key) => (key === '.home-header h1' ? heading : null);
  const router = createWorkspaceRouter({ ...h });
  router.showPage('goals');
  router.updateNavigation('goals', { talking: true });
  assert.equal(h.documentRef.title, 'felis — Talk');
  assert.equal(h.windowRef.location.hash, '#goals');
  assert.deepEqual(h.windowRef.history.pushes, ['/home/?demo=1#goals']);
  assert.equal(heading.textContent, 'Talk');
  router.updateNavigation('goals');
  assert.equal(heading.textContent, 'Goals');
});
