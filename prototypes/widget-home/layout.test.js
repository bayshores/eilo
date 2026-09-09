import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, MODES, createDefaultState, normalizeState, projectLayout, updateLayout } from './layout.js';

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const assertUsable = (state, mode) => {
  const layout = projectLayout(state, mode);
  for (const item of layout) { assert.ok(item.x >= 0 && item.y >= 0); assert.ok(item.x + item.w <= MODES[mode]); assert.ok(item.y + item.h <= 192); }
  for (let i = 0; i < layout.length; i++) for (let j = i + 1; j < layout.length; j++) assert.equal(overlaps(layout[i], layout[j]), false);
};

test('catalog and defaults are stable and match the intended wide arrangement', () => {
  assert.deepEqual(Object.keys(CATALOG), ['today', 'goals', 'progress', 'conversation', 'clock', 'notes']);
  const layout = projectLayout(createDefaultState());
  assert.deepEqual(layout.map(({ id, x, y, w, h }) => ({ id, x, y, w, h })), [
    { id: 'today-1', x: 0, y: 0, w: 4, h: 4 }, { id: 'goals-1', x: 4, y: 0, w: 8, h: 2 },
    { id: 'progress-1', x: 4, y: 2, w: 3, h: 2 }, { id: 'conversation-1', x: 7, y: 2, w: 5, h: 2 },
  ]);
});

test('add, move, and resize always produce bounded non-overlapping layouts', () => {
  let state = createDefaultState();
  state = updateLayout(state, { type: 'add', id: 'notes-1', widgetType: 'notes', size: 'large', mode: 'wide' });
  state = updateLayout(state, { type: 'move', id: 'notes-1', x: 0, y: 0, mode: 'wide' });
  state = updateLayout(state, { type: 'resize', id: 'today-1', size: 'small', mode: 'wide' });
  for (const mode of Object.keys(MODES)) assertUsable(state, mode);
});

test('a non-colliding move preserves unaffected saved positions', () => {
  const state = createDefaultState();
  const next = updateLayout(state, { type: 'move', id: 'progress-1', x: 0, y: 5, mode: 'wide' });
  const before = new Map(projectLayout(state).map(item => [item.id, [item.x, item.y]]));
  const after = new Map(projectLayout(next).map(item => [item.id, [item.x, item.y]]));
  assert.deepEqual(after.get('today-1'), before.get('today-1'));
  assert.deepEqual(after.get('goals-1'), before.get('goals-1'));
  assert.deepEqual(after.get('conversation-1'), before.get('conversation-1'));
});

test('removing a widget changes only view metadata and leaves unknown domain data absent', () => {
  const state = createDefaultState();
  const next = updateLayout(state, { type: 'remove', id: 'goals-1' });
  assert.equal(next.widgets.some(widget => widget.id === 'goals-1'), false);
  assert.equal(projectLayout(next).some(widget => widget.id === 'goals-1'), false);
  assert.deepEqual(Object.keys(next).sort(), ['positions', 'version', 'widgets']);
  assert.strictEqual(updateLayout(state, { type: 'remove', id: 'missing' }), state);
});

test('normalization survives corrupt storage while preserving an intentional empty layout', () => {
  assert.deepEqual(normalizeState(null), createDefaultState());
  assert.deepEqual(normalizeState({ version: 2, widgets: [] }), createDefaultState());
  const empty = normalizeState({ version: 1, widgets: [], positions: { wide: [{ id: 'nope', x: 0, y: 0 }] } });
  assert.deepEqual(empty, { version: 1, widgets: [], positions: { wide: [] } });
  const clean = normalizeState({ version: 1, widgets: [{ id: 'a', type: 'clock', size: 'small' }, { id: 'a', type: 'notes', size: 'large' }, { id: 'bad', type: 'bad', size: 'small' }], positions: { wide: [{ id: 'a', x: -3, y: 2.8 }, { id: 'a', x: 4, y: 4 }] } });
  assert.deepEqual(clean.positions.wide, [{ id: 'a', x: 0, y: 2 }]);
});

test('JSON round trip retains metadata and projection never mutates stored layouts', () => {
  let state = updateLayout(createDefaultState(), { type: 'add', id: 'clock-1', widgetType: 'clock', size: 'medium', mode: 'compact' });
  state = updateLayout(state, { type: 'move', id: 'clock-1', x: 4, y: 20, mode: 'compact' });
  const reloaded = normalizeState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(reloaded, state);
  const saved = JSON.stringify(reloaded.positions);
  projectLayout(reloaded, 'compact'); projectLayout(reloaded, 'stacked');
  assert.equal(JSON.stringify(reloaded.positions), saved);
  assertUsable(reloaded, 'compact'); assertUsable(reloaded, 'stacked');
});

test('adversarial identical huge saved positions are bounded and repacked without overlap', () => {
  const widgets = Array.from({ length: 24 }, (_, index) => ({ id: `today-${index}`, type: 'today', size: 'large' }));
  const positions = Object.fromEntries(Object.keys(MODES).map(mode => [mode, widgets.map(widget => ({ id: widget.id, x: 9999, y: 9999 }))]));
  const state = normalizeState({ version: 1, widgets, positions });
  for (const mode of Object.keys(MODES)) {
    assert.ok(state.positions[mode].every(position => position.y <= 80));
    assertUsable(state, mode);
    assert.ok(Math.max(...projectLayout(state, mode).map(item => item.y)) <= 192);
  }
});

test('resizeTo stores independent responsive footprints and target wins collisions', () => {
  let state = createDefaultState();
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 12, h: 8, mode: 'wide' });
  state = updateLayout(state, { type: 'resizeTo', id: 'today-1', w: 99, h: 1, mode: 'compact' });
  const widget = state.widgets.find(item => item.id === 'today-1');
  assert.deepEqual(widget.footprints, { wide: { w: 12, h: 8 }, compact: { w: 6, h: 2 } });
  assert.deepEqual(projectLayout(state, 'wide').find(item => item.id === 'today-1').w, 12);
  assert.deepEqual(projectLayout(state, 'compact').find(item => item.id === 'today-1').w, 6);
  assertUsable(state, 'wide'); assertUsable(state, 'compact');
});

test('resizeTo keeps non-colliding widgets fixed and keeps its target anchored when it displaces one', () => {
  const before = createDefaultState();
  const gentle = updateLayout(before, { type: 'resizeTo', id: 'progress-1', w: 3, h: 3, mode: 'wide' });
  const old = new Map(projectLayout(before).map(item => [item.id, [item.x, item.y]]));
  const gentleLayout = new Map(projectLayout(gentle).map(item => [item.id, [item.x, item.y]]));
  assert.deepEqual(gentleLayout.get('today-1'), old.get('today-1'));
  assert.deepEqual(gentleLayout.get('goals-1'), old.get('goals-1'));
  const displaced = updateLayout(before, { type: 'resizeTo', id: 'progress-1', w: 6, h: 8, mode: 'wide' });
  const target = projectLayout(displaced).find(item => item.id === 'progress-1');
  assert.deepEqual([target.x, target.y], old.get('progress-1'));
  assertUsable(displaced, 'wide');
});

test('resizeTo clamps stacked footprints, preserves JSON metadata, and preset resize clears them', () => {
  let state = updateLayout(createDefaultState(), { type: 'resizeTo', id: 'progress-1', w: 0, h: 99, mode: 'stacked' });
  let widget = state.widgets.find(item => item.id === 'progress-1');
  assert.deepEqual(widget.footprints.stacked, { w: 1, h: 8 });
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(state))), state);
  state = updateLayout(state, { type: 'resize', id: 'progress-1', size: 'medium', mode: 'stacked' });
  widget = state.widgets.find(item => item.id === 'progress-1');
  assert.equal(widget.footprints, undefined);
  assert.deepEqual(projectLayout(state, 'stacked').find(item => item.id === 'progress-1').h, 2);
});

test('24 custom height-eight widgets remain bounded and non-overlapping in every mode', () => {
  const widgets = Array.from({ length: 24 }, (_, index) => ({ id: `clock-${index}`, type: 'clock', size: 'small', footprints: { wide: { w: 12, h: 8 }, compact: { w: 6, h: 8 }, stacked: { w: 1, h: 8 } } }));
  const positions = Object.fromEntries(Object.keys(MODES).map(mode => [mode, widgets.map(widget => ({ id: widget.id, x: 999, y: 999 }))]));
  const state = normalizeState({ version: 1, widgets, positions });
  for (const mode of Object.keys(MODES)) assertUsable(state, mode);
});
