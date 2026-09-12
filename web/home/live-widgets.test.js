import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveWidgetRenderer, isLiveWidget, widgetFingerprint } from './live-widgets.js';

test('source widgets use the same live-refresh eligibility as their renderer', () => {
  assert.equal(isLiveWidget('tracking'), true);
  assert.equal(isLiveWidget('usage'), true);
  assert.equal(isLiveWidget('notes'), false);
});
test('source and permission changes invalidate live widgets even when tasks are unchanged', () => {
  const view = {
    connection: 'connected',
    snapshot: {
      tasks: { revision: 1 },
      integrations: {
        briefing_sources: { calendar: { available: true, enabled: false }, accounts: [] },
      },
      accountability: {
        activity: { state: 'active', helper_available: true, chrome_available: false },
        observed_activity: { usage: { total_observed_seconds: 0 } },
      },
    },
  };
  const before = widgetFingerprint(view);
  const calendar = structuredClone(view);
  calendar.snapshot.integrations.briefing_sources.calendar.enabled = true;
  assert.notEqual(widgetFingerprint(calendar), before);
  const gmail = structuredClone(view);
  gmail.snapshot.integrations.briefing_sources.accounts = [{ enabled: true, state: 'connected' }];
  assert.notEqual(widgetFingerprint(gmail), before);
  const browser = structuredClone(view);
  browser.snapshot.accountability.activity.chrome_available = true;
  assert.notEqual(widgetFingerprint(browser), before);
  const usage = structuredClone(view);
  usage.snapshot.accountability.observed_activity.usage.total_observed_seconds = 5;
  assert.notEqual(widgetFingerprint(usage), before);
  assert.notEqual(widgetFingerprint({ ...view, connection: 'loading' }), before);
  assert.equal(widgetFingerprint(structuredClone(view)), before);
});

function fakeElement(tag) {
  return {
    tag,
    attributes: {},
    children: [],
    className: '',
    classList: { add() {} },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    addEventListener() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function renderedProgress(data) {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: fakeElement };
  try {
    const container = fakeElement('section');
    createLiveWidgetRenderer({
      getCurrent: () => ({ connection: 'connected', snapshot: {} }),
      getData: () => data,
      talk() {},
      openDetail() {},
    }).renderBody({ type: 'progress' }, container);
    return container;
  } finally {
    globalThis.document = originalDocument;
  }
}

test('progress prioritizes the focused quantitative goal over completed commitments', () => {
  const container = renderedProgress({
    supported: true,
    open: [
      { id: 'other', title: 'Read notes', target_count: 5, completed_count: 2, unit: 'pages' },
      {
        id: 'focus',
        title: 'Read chapters',
        target_count: 100,
        completed_count: 15,
        unit: 'pages',
      },
    ],
    focus: { id: 'focus' },
    completed: [{}, {}, {}],
  });
  const count = container.children.find((child) => child.className === 'practice-count');
  const meter = container.children.find((child) => child.tag === 'progress');

  assert.equal(count.children[0].textContent, '15');
  assert.equal(count.children[1].textContent, 'of 100 pages');
  assert.equal(meter.max, 100);
  assert.equal(meter.value, 15);
  assert.equal(meter.attributes['aria-label'], 'Read chapters: 15 of 100 pages');
});

test('progress falls back to completed commitments when no open goal is tracked', () => {
  const container = renderedProgress({
    supported: true,
    open: [{ id: 'open', title: 'Plan week' }],
    focus: null,
    completed: [{}, {}],
  });
  const count = container.children.find((child) => child.className === 'practice-count');

  assert.equal(count.children[0].textContent, '2');
  assert.equal(count.children[1].textContent, 'commitments completed');
  assert.equal(
    container.children.some((child) => child.tag === 'progress'),
    false,
  );
});
