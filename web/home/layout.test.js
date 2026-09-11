import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  MODES,
  createDefaultState,
  normalizeState,
  previewMove,
  projectLayout,
  updateLayout,
  withConversationDock,
  withTrackingWidgets,
} from './layout.js';

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const assertUsable = (state, mode) => {
  const layout = projectLayout(state, mode);
  for (const item of layout) {
    assert.ok(item.x >= 0 && item.y >= 0);
    assert.ok(item.x + item.w <= MODES[mode]);
    assert.ok(item.y + item.h <= 192);
  }
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++) assert.equal(overlaps(layout[i], layout[j]), false);
};

test('catalog and defaults are stable and match the intended wide arrangement', () => {
  assert.deepEqual(Object.keys(CATALOG), [
    'today',
    'goals',
    'progress',
    'conversation',
    'clock',
    'notes',
    'tracking',
    'usage',
  ]);
  const layout = projectLayout(createDefaultState());
  assert.deepEqual(
    layout.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
    [
      { id: 'today-1', x: 0, y: 0, w: 4, h: 4 },
      { id: 'goals-1', x: 4, y: 0, w: 8, h: 2 },
      { id: 'progress-1', x: 4, y: 2, w: 3, h: 2 },
      { id: 'conversation-1', x: 7, y: 2, w: 5, h: 2 },
    ],
  );
});

test('tracking widgets fit an untouched live Home and never reset a custom arrangement', () => {
  const previous = withConversationDock(createDefaultState());
  const original = structuredClone(previous);
  const next = withTrackingWidgets(previous);
  assert.deepEqual(
    next.widgets.map((widget) => widget.type),
    ['today', 'goals', 'tracking', 'progress', 'usage'],
  );
  assertUsable(next, 'wide');
  assert.ok(projectLayout(next, 'wide').every((widget) => widget.y + widget.h <= 4));
  assert.deepEqual(previous, original);
  assert.deepEqual(withTrackingWidgets(next), next);
  const removed = updateLayout(next, { type: 'remove', id: 'tracking-1' });
  assert.deepEqual(withTrackingWidgets(removed), removed, 'a removed widget is not re-added');
  const custom = updateLayout(previous, {
    type: 'add',
    widgetType: 'clock',
    size: 'small',
    id: 'custom-clock',
  });
  assert.deepEqual(withTrackingWidgets(custom), custom);
  const empty = { version: 1, widgets: [], positions: {} };
  assert.deepEqual(withTrackingWidgets(empty), empty);
});

test('withConversationDock removes only Conversation metadata and fills the untouched default slot', () => {
  const standalone = createDefaultState();
  const docked = withConversationDock(standalone);
  assert.deepEqual(standalone, createDefaultState());
  assert.equal(
    docked.widgets.some((widget) => widget.type === 'conversation'),
    false,
  );
  assert.equal(
    docked.positions.wide.some((position) => position.id === 'conversation-1'),
    false,
  );
  const progress = projectLayout(docked, 'wide').find((widget) => widget.id === 'progress-1');
  assert.deepEqual([progress.x, progress.y, progress.w, progress.h], [4, 2, 8, 2]);
  assert.deepEqual(createDefaultState(), standalone);
});

test('withConversationDock preserves custom arrangements, footprints, and every non-Conversation ID', () => {
  let state = updateLayout(createDefaultState(), {
    type: 'resizeTo',
    id: 'progress-1',
    w: 6,
    h: 5,
    mode: 'wide',
  });
  state = updateLayout(state, { type: 'move', id: 'progress-1', x: 0, y: 8, mode: 'wide' });
  state = updateLayout(state, {
    type: 'add',
    id: 'notes-1',
    widgetType: 'notes',
    size: 'medium',
    mode: 'compact',
  });
  const before = JSON.parse(JSON.stringify(state));
  const docked = withConversationDock(state);
  assert.equal(JSON.stringify(state), JSON.stringify(before));
  assert.equal(
    docked.widgets.some((widget) => widget.id === 'conversation-1'),
    false,
  );
  assert.deepEqual(docked.widgets.find((widget) => widget.id === 'progress-1').footprints.wide, {
    w: 6,
    h: 5,
  });
  assert.deepEqual(
    docked.positions.wide.find((position) => position.id === 'progress-1'),
    before.positions.wide.find((position) => position.id === 'progress-1'),
  );
  assert.ok(docked.widgets.some((widget) => widget.id === 'notes-1'));
});

test('withConversationDock is idempotent and standalone defaults remain unchanged', () => {
  const once = withConversationDock(createDefaultState());
  const twice = withConversationDock(once);
  assert.deepEqual(twice, once);
  assert.deepEqual(createDefaultState(), {
    version: 1,
    widgets: [
      { id: 'today-1', type: 'today', size: 'large' },
      { id: 'goals-1', type: 'goals', size: 'large' },
      { id: 'progress-1', type: 'progress', size: 'small' },
      { id: 'conversation-1', type: 'conversation', size: 'medium' },
    ],
    positions: {
      wide: [
        { id: 'today-1', x: 0, y: 0 },
        { id: 'goals-1', x: 4, y: 0 },
        { id: 'progress-1', x: 4, y: 2 },
        { id: 'conversation-1', x: 7, y: 2 },
      ],
    },
  });
});

test('add, move, and resize always produce bounded non-overlapping layouts', () => {
  let state = createDefaultState();
  state = updateLayout(state, {
    type: 'add',
    id: 'notes-1',
    widgetType: 'notes',
    size: 'large',
    mode: 'wide',
  });
  state = updateLayout(state, { type: 'move', id: 'notes-1', x: 0, y: 0, mode: 'wide' });
  state = updateLayout(state, { type: 'resize', id: 'today-1', size: 'small', mode: 'wide' });
  for (const mode of Object.keys(MODES)) assertUsable(state, mode);
});

test('a non-colliding move preserves unaffected saved positions', () => {
  const state = createDefaultState();
  const next = updateLayout(state, { type: 'move', id: 'progress-1', x: 0, y: 5, mode: 'wide' });
  const before = new Map(projectLayout(state).map((item) => [item.id, [item.x, item.y]]));
  const after = new Map(projectLayout(next).map((item) => [item.id, [item.x, item.y]]));
  assert.deepEqual(after.get('today-1'), before.get('today-1'));
  assert.deepEqual(after.get('goals-1'), before.get('goals-1'));
  assert.deepEqual(after.get('conversation-1'), before.get('conversation-1'));
});

test('removing a widget changes only view metadata and leaves unknown domain data absent', () => {
  const state = createDefaultState();
  const next = updateLayout(state, { type: 'remove', id: 'goals-1' });
  assert.equal(
    next.widgets.some((widget) => widget.id === 'goals-1'),
    false,
  );
  assert.equal(
    projectLayout(next).some((widget) => widget.id === 'goals-1'),
    false,
  );
  assert.deepEqual(Object.keys(next).sort(), ['positions', 'version', 'widgets']);
  assert.strictEqual(updateLayout(state, { type: 'remove', id: 'missing' }), state);
});

test('normalization survives corrupt storage while preserving an intentional empty layout', () => {
  assert.deepEqual(normalizeState(null), createDefaultState());
  assert.deepEqual(normalizeState({ version: 2, widgets: [] }), createDefaultState());
  const empty = normalizeState({
    version: 1,
    widgets: [],
    positions: { wide: [{ id: 'nope', x: 0, y: 0 }] },
  });
  assert.deepEqual(empty, { version: 1, widgets: [], positions: { wide: [] } });
  const clean = normalizeState({
    version: 1,
    widgets: [
      { id: 'a', type: 'clock', size: 'small' },
      { id: 'a', type: 'notes', size: 'large' },
      { id: 'bad', type: 'bad', size: 'small' },
    ],
    positions: {
      wide: [
        { id: 'a', x: -3, y: 2.8 },
        { id: 'a', x: 4, y: 4 },
      ],
    },
  });
  assert.deepEqual(clean.positions.wide, [{ id: 'a', x: 0, y: 2 }]);
});

test('JSON round trip retains metadata and projection never mutates stored layouts', () => {
  let state = updateLayout(createDefaultState(), {
    type: 'add',
    id: 'clock-1',
    widgetType: 'clock',
    size: 'medium',
    mode: 'compact',
  });
  state = updateLayout(state, { type: 'move', id: 'clock-1', x: 4, y: 20, mode: 'compact' });
  const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded, state);
  const saved = JSON.stringify(reloaded.positions);
  projectLayout(reloaded, 'compact');
  projectLayout(reloaded, 'stacked');
  assert.equal(JSON.stringify(reloaded.positions), saved);
  assertUsable(reloaded, 'compact');
  assertUsable(reloaded, 'stacked');
});

test('adversarial identical huge saved positions are bounded and repacked without overlap', () => {
  const widgets = Array.from({ length: 24 }, (_, index) => ({
    id: `today-${index}`,
    type: 'today',
    size: 'large',
  }));
  const positions = Object.fromEntries(
    Object.keys(MODES).map((mode) => [
      mode,
      widgets.map((widget) => ({ id: widget.id, x: 9999, y: 9999 })),
    ]),
  );
  const state = normalizeState({ version: 1, widgets, positions });
  for (const mode of Object.keys(MODES)) {
    assert.ok(state.positions[mode].every((position) => position.y <= 80));
    assertUsable(state, mode);
    assert.ok(Math.max(...projectLayout(state, mode).map((item) => item.y)) <= 192);
  }
});

test('resizeTo stores independent responsive footprints and target wins collisions', () => {
  let state = createDefaultState();
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 12, h: 8, mode: 'wide' });
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 99, h: 1, mode: 'compact' });
  const widget = state.widgets.find((item) => item.id === 'today-1');
  assert.deepEqual(widget.footprints, { wide: { w: 12, h: 8 }, compact: { w: 6, h: 2 } });
  assert.deepEqual(projectLayout(state, 'wide').find((item) => item.id === 'today-1').w, 12);
  assert.deepEqual(projectLayout(state, 'compact').find((item) => item.id === 'today-1').w, 6);
  assertUsable(state, 'wide');
  assertUsable(state, 'compact');
});

test('resizeTo keeps non-colliding widgets fixed and keeps its target anchored when it displaces one', () => {
  const before = createDefaultState();
  const gentle = updateLayout(before, {
    type: 'resizeTo',
    id: 'progress-1',
    w: 3,
    h: 3,
    mode: 'wide',
  });
  const old = new Map(projectLayout(before).map((item) => [item.id, [item.x, item.y]]));
  const gentleLayout = new Map(projectLayout(gentle).map((item) => [item.id, [item.x, item.y]]));
  assert.deepEqual(gentleLayout.get('today-1'), old.get('today-1'));
  assert.deepEqual(gentleLayout.get('goals-1'), old.get('goals-1'));
  const displaced = updateLayout(before, {
    type: 'resizeTo',
    id: 'progress-1',
    w: 6,
    h: 8,
    mode: 'wide',
  });
  const target = projectLayout(displaced).find((item) => item.id === 'progress-1');
  assert.deepEqual([target.x, target.y], old.get('progress-1'));
  assertUsable(displaced, 'wide');
});

test('resizeTo clamps stacked footprints, preserves JSON metadata, and preset resize clears them', () => {
  let state = updateLayout(createDefaultState(), {
    type: 'resizeTo',
    id: 'progress-1',
    w: 0,
    h: 99,
    mode: 'stacked',
  });
  let widget = state.widgets.find((item) => item.id === 'progress-1');
  assert.deepEqual(widget.footprints.stacked, { w: 1, h: 8 });
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  state = updateLayout(state, {
    type: 'resize',
    id: 'progress-1',
    size: 'medium',
    mode: 'stacked',
  });
  widget = state.widgets.find((item) => item.id === 'progress-1');
  assert.equal(widget.footprints, undefined);
  assert.deepEqual(projectLayout(state, 'stacked').find((item) => item.id === 'progress-1').h, 2);
});

test('24 custom height-eight widgets remain bounded and non-overlapping in every mode', () => {
  const widgets = Array.from({ length: 24 }, (_, index) => ({
    id: `clock-${index}`,
    type: 'clock',
    size: 'small',
    footprints: { wide: { w: 12, h: 8 }, compact: { w: 6, h: 8 }, stacked: { w: 1, h: 8 } },
  }));
  const positions = Object.fromEntries(
    Object.keys(MODES).map((mode) => [
      mode,
      widgets.map((widget) => ({ id: widget.id, x: 999, y: 999 })),
    ]),
  );
  const state = normalizeState({ version: 1, widgets, positions });
  for (const mode of Object.keys(MODES)) assertUsable(state, mode);
});

test('previewMove swaps a displaced card into the vacated source slot without mutating input', () => {
  const state = normalizeState({
      version: 1,
      widgets: [
        { id: 'a', type: 'progress', size: 'small' },
        { id: 'b', type: 'progress', size: 'small' },
      ],
      positions: {
        wide: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 3, y: 0 },
        ],
      },
    }),
    frozen = JSON.stringify(state);
  const preview = previewMove(state, { id: 'a', x: 3, y: 0, mode: 'wide', rows: 2 });
  const layout = new Map(projectLayout(preview).map((item) => [item.id, item]));
  assert.equal(JSON.stringify(state), frozen);
  assert.deepEqual([layout.get('a').x, layout.get('a').y], [3, 0]);
  assert.deepEqual([layout.get('b').x, layout.get('b').y], [0, 0]);
  assertUsable(preview, 'wide');
});

test('previewMove preserves heterogeneous footprints and unaffected anchors when possible', () => {
  let state = createDefaultState();
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 4, h: 4, mode: 'wide' });
  const preview = previewMove(state, { id: 'progress-1', x: 0, y: 4, mode: 'wide', rows: 6 });
  const before = new Map(
    projectLayout(state).map((item) => [item.id, [item.x, item.y, item.w, item.h]]),
  );
  const after = new Map(
    projectLayout(preview).map((item) => [item.id, [item.x, item.y, item.w, item.h]]),
  );
  assert.deepEqual(after.get('today-1'), before.get('today-1'));
  assert.deepEqual(after.get('goals-1'), before.get('goals-1'));
  assert.deepEqual(after.get('progress-1').slice(2), before.get('progress-1').slice(2));
  assertUsable(preview, 'wide');
});

test('previewMove returns the original for origin, invalid requests, and impossible visible placement', () => {
  const state = createDefaultState();
  assert.strictEqual(
    previewMove(state, { id: 'today-1', x: 0, y: 0, mode: 'wide', rows: 4 }),
    state,
  );
  assert.strictEqual(
    previewMove(state, { id: 'missing', x: 1, y: 1, mode: 'wide', rows: 4 }),
    state,
  );
  assert.strictEqual(
    previewMove(state, { id: 'today-1', x: NaN, y: 1, mode: 'wide', rows: 4 }),
    state,
  );
  assert.strictEqual(
    previewMove(state, { id: 'today-1', x: 1, y: 1, mode: 'wide', rows: 3 }),
    state,
  );
});

test('previewMove reserves boundary-straddling hidden cards and leaves other modes untouched', () => {
  const state = normalizeState({
    version: 1,
    widgets: [
      { id: 'a', type: 'progress', size: 'small' },
      { id: 'hidden', type: 'notes', size: 'small' },
    ],
    positions: {
      wide: [
        { id: 'a', x: 0, y: 0 },
        { id: 'hidden', x: 3, y: 3 },
      ],
      compact: [{ id: 'a', x: 0, y: 0 }],
    },
  });
  const first = previewMove(state, { id: 'a', x: 3, y: 2, mode: 'wide', rows: 4 });
  const second = previewMove(state, { id: 'a', x: 3, y: 2, mode: 'wide', rows: 4 });
  assert.deepEqual(first, second);
  assert.deepEqual(first.positions.compact, state.positions.compact);
  assert.deepEqual(
    first.positions.wide.find((item) => item.id === 'hidden'),
    { id: 'hidden', x: 3, y: 3 },
  );
  assert.deepEqual(
    [
      projectLayout(first, 'wide').find((item) => item.id === 'a').x,
      projectLayout(first, 'wide').find((item) => item.id === 'a').y,
    ],
    [3, 1],
  );
  assert.deepEqual(
    [
      projectLayout(first, 'wide').find((item) => item.id === 'hidden').x,
      projectLayout(first, 'wide').find((item) => item.id === 'hidden').y,
    ],
    [3, 3],
  );
  assertUsable(first, 'wide');
});

test('previewMove snaps a heterogeneous collision near its target while retaining untouched peers', () => {
  const state = normalizeState({
    version: 1,
    widgets: [
      { id: 'target', type: 'progress', size: 'small' },
      { id: 'large', type: 'goals', size: 'large' },
      { id: 'fixed', type: 'progress', size: 'small' },
    ],
    positions: {
      wide: [
        { id: 'target', x: 0, y: 2 },
        { id: 'large', x: 3, y: 0 },
        { id: 'fixed', x: 0, y: 0 },
      ],
    },
  });
  const preview = previewMove(state, { id: 'target', x: 3, y: 1, mode: 'wide', rows: 4 });
  const layout = new Map(projectLayout(preview).map((item) => [item.id, item]));
  assert.deepEqual([layout.get('target').x, layout.get('target').y], [3, 2]);
  assert.deepEqual([layout.get('large').x, layout.get('large').y], [3, 0]);
  assert.deepEqual([layout.get('fixed').x, layout.get('fixed').y], [0, 0]);
  assertUsable(preview, 'wide');
});

test('previewMove remains bounded on a dense visible fixture', () => {
  const widgets = Array.from({ length: 12 }, (_, index) => ({
    id: `p-${index}`,
    type: 'progress',
    size: 'small',
  }));
  const positions = widgets.map((widget, index) => ({
    id: widget.id,
    x: (index % 4) * 3,
    y: Math.floor(index / 4) * 2,
  }));
  const state = normalizeState({ version: 1, widgets, positions: { wide: positions } });
  const preview = previewMove(state, { id: 'p-0', x: 9, y: 4, mode: 'wide', rows: 6 });
  assertUsable(preview, 'wide');
  assert.ok(projectLayout(preview).every((item) => item.y + item.h <= 6));
});

test('previewMove bounded fallback keeps an exact dense progress target instead of returning origin', () => {
  const preview = previewMove(createDefaultState(), {
    id: 'progress-1',
    x: 0,
    y: 2,
    mode: 'wide',
    rows: 4,
  });
  const layout = new Map(projectLayout(preview).map((item) => [item.id, item]));
  assert.deepEqual([layout.get('goals-1').x, layout.get('goals-1').y], [0, 0]);
  assert.deepEqual([layout.get('today-1').x, layout.get('today-1').y], [8, 0]);
  assert.deepEqual([layout.get('progress-1').x, layout.get('progress-1').y], [0, 2]);
  assert.deepEqual([layout.get('conversation-1').x, layout.get('conversation-1').y], [3, 2]);
  assertUsable(preview, 'wide');
});

test('previewMove bounded fallback keeps an exact dense conversation target', () => {
  const preview = previewMove(createDefaultState(), {
    id: 'conversation-1',
    x: 0,
    y: 2,
    mode: 'wide',
    rows: 4,
  });
  const layout = new Map(projectLayout(preview).map((item) => [item.id, item]));
  assert.deepEqual([layout.get('goals-1').x, layout.get('goals-1').y], [0, 0]);
  assert.deepEqual([layout.get('today-1').x, layout.get('today-1').y], [8, 0]);
  assert.deepEqual([layout.get('conversation-1').x, layout.get('conversation-1').y], [0, 2]);
  assert.deepEqual([layout.get('progress-1').x, layout.get('progress-1').y], [5, 2]);
  assertUsable(preview, 'wide');
});

test('layout transfer carries normalized view metadata and presentation preferences only', async () => {
  const { layoutTransferHash, readLayoutTransfer } = await import('./layout.js');
  const original = createDefaultState();
  original.messages = ['private'];
  original.widgets[0].content = 'private note';
  const result = readLayoutTransfer(
    layoutTransferHash(original, { pin: true, reducedMotion: true, name: 'private name' }),
  );
  assert.deepEqual(result.layout, createDefaultState());
  assert.deepEqual(result.preferences, { pin: true, reducedMotion: true });
  assert.equal(JSON.stringify(result).includes('private'), false);
});
test('malformed or oversized layout transfer leaves stored preferences alone', async () => {
  const { readLayoutTransfer } = await import('./layout.js');
  for (const value of [
    '',
    '#other=value',
    '#home-layout=%xx',
    '#home-layout=' + encodeURIComponent('{}'),
    '#home-layout=' + 'a'.repeat(33000),
  ])
    assert.equal(readLayoutTransfer(value), null);
});
