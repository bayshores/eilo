import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG,
  MODES,
  createDefaultState,
  fitWithinHome,
  normalizeState,
  projectLayout,
  resizeWithinHome,
  updateLayout,
  withConversationDock,
} from './layout.js';

const rectsOverlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const byId = (state, mode = 'wide') => new Map(projectLayout(state, mode).map(item => [item.id, item]));
const visibleIds = (state, mode = 'wide', rows = 4) => projectLayout(state, mode)
  .filter(item => item.y + item.h <= rows).map(item => item.id).sort();

function assertVisibleHomeIsUsable(state, expectedIds, mode = 'wide', rows = 4) {
  const visible = projectLayout(state, mode).filter(item => expectedIds.includes(item.id));
  assert.deepEqual(visible.map(item => item.id).sort(), [...expectedIds].sort());
  for (const item of visible) {
    assert.ok(item.x >= 0 && item.y >= 0, `${item.id} starts in Home`);
    assert.ok(item.x + item.w <= MODES[mode], `${item.id} stays inside the mode width`);
    assert.ok(item.y + item.h <= rows, `${item.id} stays inside Home`);
  }
  for (let index = 0; index < visible.length; index++) {
    for (let peer = index + 1; peer < visible.length; peer++) {
      assert.equal(rectsOverlap(visible[index], visible[peer]), false, `${visible[index].id} and ${visible[peer].id} do not overlap`);
    }
  }
}

function dockedDefault() {
  return withConversationDock(createDefaultState());
}

test('resizeWithinHome grows Today elastically while retaining the docked default Home', () => {
  const before = dockedDefault();
  const originalIds = visibleIds(before);
  const next = resizeWithinHome(before, { id: 'today-1', w: 7, h: 4 });
  const layout = byId(next);

  assert.deepEqual([layout.get('today-1').x, layout.get('today-1').y, layout.get('today-1').w, layout.get('today-1').h], [0, 0, 7, 4]);
  assert.deepEqual([layout.get('goals-1').x, layout.get('goals-1').y, layout.get('goals-1').w, layout.get('goals-1').h], [7, 0, 5, 2]);
  assert.deepEqual([layout.get('progress-1').x, layout.get('progress-1').y, layout.get('progress-1').w, layout.get('progress-1').h], [7, 2, 5, 2]);
  assertVisibleHomeIsUsable(next, originalIds);
  assert.deepEqual(before, dockedDefault());
});

test('resizeWithinHome caps growth at readable peer widths and reverses shared-edge shrinkage', () => {
  const before = dockedDefault();
  const grown = resizeWithinHome(before, { id: 'today-1', w: 12, h: 4 });
  const capped = byId(grown);
  assert.deepEqual([capped.get('today-1').x, capped.get('today-1').w], [0, 8]);
  assert.deepEqual([capped.get('goals-1').x, capped.get('goals-1').w], [8, CATALOG.goals.sizes.small.w]);
  assert.deepEqual([capped.get('progress-1').x, capped.get('progress-1').w], [8, CATALOG.progress.sizes.medium.w]);
  assertVisibleHomeIsUsable(grown, visibleIds(before));

  const sevenWide = resizeWithinHome(before, { id: 'today-1', w: 7, h: 4 });
  const restored = resizeWithinHome(sevenWide, { id: 'today-1', w: 4, h: 4 });
  const layout = byId(restored);
  assert.deepEqual([layout.get('today-1').x, layout.get('today-1').w], [0, 4]);
  assert.deepEqual([layout.get('goals-1').x, layout.get('goals-1').w], [4, 8]);
  assert.deepEqual([layout.get('progress-1').x, layout.get('progress-1').w], [4, 8]);
  assertVisibleHomeIsUsable(restored, visibleIds(before));
});

test('resizeWithinHome preserves omitted height, anchors the target, and leaves responsive modes alone', () => {
  let before = dockedDefault();
  before = updateLayout(before, { type: 'resizeTo', id: 'today-1', w: 3, h: 2, mode: 'compact' });
  before = updateLayout(before, { type: 'resizeTo', id: 'today-1', w: 1, h: 5, mode: 'stacked' });
  const snapshot = JSON.parse(JSON.stringify(before));
  const next = resizeWithinHome(before, { id: 'today-1', w: 7 });
  const layout = byId(next);

  assert.deepEqual([layout.get('today-1').x, layout.get('today-1').y, layout.get('today-1').w, layout.get('today-1').h], [0, 0, 7, 4]);
  assert.deepEqual(next.positions.compact, snapshot.positions.compact);
  assert.deepEqual(next.positions.stacked, snapshot.positions.stacked);
  assert.deepEqual(next.widgets.find(widget => widget.id === 'today-1').footprints.compact, { w: 3, h: 2 });
  assert.deepEqual(next.widgets.find(widget => widget.id === 'today-1').footprints.stacked, { w: 1, h: 5 });
  assert.deepEqual(before, snapshot);
});

test('resizeWithinHome grows and shrinks a vertical shared edge while retaining every visible peer', () => {
  const before = normalizeState({ version: 1, widgets: [
    { id: 'top', type: 'progress', size: 'medium', footprints: { wide: { w: 6, h: 2 } } },
    { id: 'bottom', type: 'progress', size: 'medium', footprints: { wide: { w: 6, h: 2 } } },
  ], positions: { wide: [{ id: 'top', x: 0, y: 0 }, { id: 'bottom', x: 0, y: 2 }] } });
  const grown = resizeWithinHome(before, { id: 'top', w: 6, h: 3, rows: 5 });
  const grownLayout = byId(grown);
  assert.deepEqual([grownLayout.get('top').x, grownLayout.get('top').y, grownLayout.get('top').w, grownLayout.get('top').h], [0, 0, 6, 3]);
  assert.deepEqual([grownLayout.get('bottom').x, grownLayout.get('bottom').y, grownLayout.get('bottom').w, grownLayout.get('bottom').h], [0, 3, 6, 2]);
  assertVisibleHomeIsUsable(grown, ['top', 'bottom'], 'wide', 5);

  const restored = resizeWithinHome(grown, { id: 'top', w: 6, h: 2, rows: 5 });
  assert.deepEqual([byId(restored).get('bottom').x, byId(restored).get('bottom').y], [0, 2]);
});

test('resizeWithinHome supports compact and stacked constraints without moving absent modes', () => {
  const compact = resizeWithinHome(dockedDefault(), { id: 'today-1', w: 6, h: 2, mode: 'compact', rows: 4 });
  const compactToday = byId(compact, 'compact').get('today-1');
  assert.equal(compactToday.w, 6, 'the compact Home can reflow its peers below a full-width Today');
  assert.ok(compactToday.w >= 3);

  const stacked = resizeWithinHome(dockedDefault(), { id: 'today-1', w: 99, h: 3, mode: 'stacked', rows: 4 });
  const stackedToday = byId(stacked, 'stacked').get('today-1');
  assert.deepEqual([stackedToday.x, stackedToday.w, stackedToday.h], [0, 1, 2]);
  assertVisibleHomeIsUsable(stacked, visibleIds(dockedDefault(), 'stacked', 4), 'stacked', 4);
});

test('resizeWithinHome keeps an offset target anchored and respects the far Home edge', () => {
  const before = normalizeState({ version: 1, widgets: [
    { id: 'today', type: 'today', size: 'large', footprints: { wide: { w: 4, h: 4 } } },
    { id: 'goals', type: 'goals', size: 'large', footprints: { wide: { w: 5, h: 2 } } },
    { id: 'progress', type: 'progress', size: 'medium', footprints: { wide: { w: 5, h: 2 } } },
  ], positions: { wide: [
    { id: 'today', x: 3, y: 0 }, { id: 'goals', x: 7, y: 0 }, { id: 'progress', x: 7, y: 2 },
  ] } });
  const next = resizeWithinHome(before, { id: 'today', w: 12, h: 4 });
  const layout = byId(next);
  assert.deepEqual([layout.get('today').x, layout.get('today').y, layout.get('today').w, layout.get('today').h], [3, 0, 5, 4]);
  assert.deepEqual([layout.get('goals').x, layout.get('goals').w], [8, 4]);
  assert.deepEqual([layout.get('progress').x, layout.get('progress').w], [8, 4]);
  assertVisibleHomeIsUsable(next, ['today', 'goals', 'progress']);
});

test('resizeWithinHome returns its exact input for invalid, unchanged, or infeasible visible requests', () => {
  const defaultState = dockedDefault();
  assert.strictEqual(resizeWithinHome(defaultState, { id: 'missing', w: 7, h: 4 }), defaultState);
  assert.strictEqual(resizeWithinHome(defaultState, { id: 'today-1', w: 4, h: 4 }), defaultState);

  const dense = normalizeState({ version: 1, widgets: [
    { id: 'a', type: 'progress', size: 'small' }, { id: 'b', type: 'progress', size: 'small' },
    { id: 'c', type: 'progress', size: 'small' }, { id: 'd', type: 'progress', size: 'small' },
  ], positions: { wide: [
    { id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 0 }, { id: 'c', x: 6, y: 0 }, { id: 'd', x: 9, y: 0 },
  ] } });
  assert.strictEqual(resizeWithinHome(dense, { id: 'a', w: 4, h: 2, rows: 2 }), dense);
});

test('fitWithinHome recovers the old resizeTo overflow without resetting Today width', () => {
  const before = withConversationDock(createDefaultState());
  const broken = updateLayout(before, { type: 'resizeTo', id: 'today-1', w: 7, h: 4, mode: 'wide' });
  assert.ok(visibleIds(broken).length < 3, 'the legacy generic settle puts a default peer into More');
  const snapshot = JSON.parse(JSON.stringify(broken));
  const fixed = fitWithinHome(broken);
  const layout = byId(fixed);

  assert.equal(layout.get('today-1').w, 7);
  assertVisibleHomeIsUsable(fixed, ['today-1', 'goals-1', 'progress-1']);
  assert.deepEqual(broken, snapshot);
  assert.deepEqual(normalizeState(JSON.parse(JSON.stringify(fixed))), fixed);
});

test('fitWithinHome is pure, does not touch other modes or hidden widgets, and no-ops by identity', () => {
  let state = dockedDefault();
  state = updateLayout(state, { type: 'add', id: 'clock-hidden', widgetType: 'clock', size: 'small', mode: 'wide' });
  state = updateLayout(state, { type: 'move', id: 'clock-hidden', x: 0, y: 8, mode: 'wide' });
  state = updateLayout(state, { type: 'resizeTo', id: 'clock-hidden', w: 3, h: 2, mode: 'compact' });
  const before = JSON.parse(JSON.stringify(state));
  const fixed = fitWithinHome(state, { mode: 'wide', rows: 4 });

  assert.deepEqual(state, before);
  assert.deepEqual(fixed.positions.compact, before.positions.compact);
  assert.deepEqual(fixed.widgets.find(widget => widget.id === 'clock-hidden').footprints.compact, { w: 3, h: 2 });
  assert.ok(projectLayout(fixed).some(item => item.id === 'clock-hidden'));
  assert.strictEqual(fitWithinHome(fixed, { mode: 'wide', rows: 4 }), fixed);
});

test('resizeWithinHome preserves Home invariants across deterministic mixed widget layouts', () => {
  let seed = 0x5eed1234;
  const random = limit => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % limit;
  };
  const types = Object.keys(CATALOG);
  const modes = Object.keys(MODES);

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const mode = modes[caseIndex % modes.length];
    const rows = 6 + (caseIndex % 3);
    let before = withConversationDock(normalizeState(createDefaultState()));
    const additions = random(6);
    for (let index = 0; index < additions; index++) {
      const type = types[random(types.length)];
      const sizes = Object.keys(CATALOG[type].sizes);
      before = updateLayout(before, {
        type: 'add', id: `generated-${caseIndex}-${index}`, widgetType: type,
        size: sizes[random(sizes.length)], mode,
      });
    }

    const beforeLayout = projectLayout(before, mode);
    const originalVisible = beforeLayout.filter(item => item.y + item.h <= rows);
    assert.ok(originalVisible.length >= 1, `case ${caseIndex} has a resize target`);
    const target = originalVisible[random(originalVisible.length)];
    const snapshot = JSON.parse(JSON.stringify(before));
    const next = resizeWithinHome(before, {
      id: target.id,
      w: target.w + random(7) - 3,
      h: target.h + random(5) - 2,
      mode,
      rows,
    });

    assert.deepEqual(before, snapshot, `case ${caseIndex} does not mutate input`);
    const layout = projectLayout(next, mode);
    const afterById = new Map(layout.map(item => [item.id, item]));
    for (const item of originalVisible) {
      const after = afterById.get(item.id);
      assert.ok(after && after.y + after.h <= rows, `case ${caseIndex} retains ${item.id} in Home`);
    }
    const afterTarget = afterById.get(target.id);
    assert.deepEqual([afterTarget.x, afterTarget.y], [target.x, target.y], `case ${caseIndex} retains target anchor`);
    for (const item of layout) {
      const minimum = mode === 'wide' ? CATALOG[item.type].sizes.small.w : mode === 'compact' ? 3 : 1;
      assert.ok(item.x >= 0 && item.y >= 0 && item.x + item.w <= MODES[mode] && item.y + item.h <= 192,
        `case ${caseIndex} keeps ${item.id} bounded`);
      assert.ok(item.w >= minimum && item.h >= 2, `case ${caseIndex} keeps ${item.id} readable`);
    }
    for (let index = 0; index < layout.length; index++) for (let peer = index + 1; peer < layout.length; peer++) {
      assert.equal(rectsOverlap(layout[index], layout[peer]), false, `case ${caseIndex} has no overlaps`);
    }
    for (const otherMode of modes.filter(candidate => candidate !== mode)) {
      assert.deepEqual(next.positions[otherMode], before.positions[otherMode], `case ${caseIndex} does not write ${otherMode} metadata`);
      assert.deepEqual(projectLayout(next, otherMode), projectLayout(before, otherMode), `case ${caseIndex} preserves ${otherMode} layout`);
    }
  }
});
