import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultState, normalizeState, projectLayout, updateLayout } from './layout.js';
import { contextWidgetId, syncContextWidgets } from './context-layout.js';

const components = [
  { id: 'resume-work', emphasis: 'primary' },
  { id: 'next-step', emphasis: 'normal' },
];

test('context widgets preserve manual cards and their saved geometry', () => {
  let state = updateLayout(createDefaultState(), {
    type: 'move',
    id: 'today-1',
    x: 3,
    y: 5,
  });
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 7, h: 3 });
  const before = projectLayout(state).find((item) => item.id === 'today-1');
  const synced = syncContextWidgets(state, { components });
  const after = projectLayout(synced).find((item) => item.id === 'today-1');
  assert.deepEqual(after, before);
  assert.deepEqual(
    synced.widgets.filter((widget) => widget.type === 'context'),
    [
      {
        id: contextWidgetId('resume-work'),
        type: 'context',
        size: 'medium',
        componentId: 'resume-work',
      },
      {
        id: contextWidgetId('next-step'),
        type: 'context',
        size: 'small',
        componentId: 'next-step',
      },
    ],
  );
  assert.strictEqual(syncContextWidgets(synced, { components }), synced);
});

test('dismissal blocks new cards but never removes an existing restored card', () => {
  const restored = syncContextWidgets(createDefaultState(), { components: [components[0]] });
  assert.strictEqual(
    syncContextWidgets(restored, { components: [components[0]], dismissed: ['resume-work'] }),
    restored,
  );
  const removed = updateLayout(restored, { type: 'remove', id: contextWidgetId('resume-work') });
  assert.equal(
    syncContextWidgets(removed, {
      components: [components[0]],
      dismissed: ['resume-work'],
    }).widgets.some((widget) => widget.type === 'context'),
    false,
  );
});

test('disabled context does not add cards and stale component references are removed', () => {
  const state = syncContextWidgets(createDefaultState(), { components });
  const untouched = createDefaultState();
  assert.strictEqual(syncContextWidgets(untouched, { components, enabled: false }), untouched);
  const next = syncContextWidgets(state, { components: [components[0]] });
  assert.equal(
    next.widgets.some((widget) => widget.componentId === 'next-step'),
    false,
  );
  assert.ok(next.widgets.some((widget) => widget.componentId === 'resume-work'));
});

test('manual source widgets suppress only their matching automatic cards', () => {
  let state = updateLayout(createDefaultState(), {
    type: 'add',
    id: 'manual-tracking',
    widgetType: 'tracking',
    size: 'small',
  });
  state = updateLayout(state, {
    type: 'add',
    id: 'manual-usage',
    widgetType: 'usage',
    size: 'medium',
  });
  state = updateLayout(state, { type: 'move', id: 'manual-usage', x: 4, y: 7 });
  const components = [
    { id: 'usage-context', kind: 'usage', emphasis: 'quiet' },
    { id: 'tracking-context', kind: 'connections', emphasis: 'quiet' },
    { id: 'work-timeline', kind: 'timeline', emphasis: 'normal' },
  ];
  const synced = syncContextWidgets(state, { components });

  assert.deepEqual(
    synced.widgets
      .filter((widget) => widget.type === 'context')
      .map((widget) => widget.componentId),
    ['work-timeline'],
    'a contextual timeline is not the commitments-based Today card',
  );
  assert.deepEqual(
    projectLayout(synced).find((widget) => widget.id === 'manual-usage'),
    projectLayout(state).find((widget) => widget.id === 'manual-usage'),
  );

  const stale = updateLayout(synced, {
    type: 'add',
    id: contextWidgetId('usage-context'),
    widgetType: 'context',
    size: 'small',
    componentId: 'usage-context',
  });
  const reconciled = syncContextWidgets(stale, { components });
  assert.equal(
    reconciled.widgets.some((widget) => widget.componentId === 'usage-context'),
    false,
  );
  assert.equal(syncContextWidgets(reconciled, { components }), reconciled);
});

test('normalization fails closed for malformed context references and never retains source content', () => {
  const state = normalizeState({
    version: 1,
    widgets: [
      { id: 'manual', type: 'notes', size: 'small' },
      { id: 'bad', type: 'context', size: 'small', componentId: '<script>', title: 'secret' },
      { id: 'safe', type: 'context', size: 'small', componentId: 'trusted.1', text: 'secret' },
    ],
    positions: {},
  });
  assert.deepEqual(state.widgets, [
    { id: 'manual', type: 'notes', size: 'small' },
    { id: 'safe', type: 'context', size: 'small', componentId: 'trusted.1' },
  ]);
});
