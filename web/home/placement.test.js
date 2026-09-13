import test from 'node:test';
import assert from 'node:assert/strict';
import { previewWidgetAddition, paginateHomeLayout } from './layout.js';

const before = {
  version: 1,
  widgets: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    type: 'notes',
    size: 'small',
    footprints: { wide: { w: 6, h: 2 } },
  })),
  positions: {
    wide: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 6, y: 0 },
      { id: 'c', x: 0, y: 2 },
      { id: 'd', x: 6, y: 2 },
    ],
  },
};
const widget = { id: 'new', type: 'clock', size: 'small' };
const visible = (state) => paginateHomeLayout(state, 'wide', 4)[0];

test('placement previews preserve the original and identify different displaced cards as position and size change', () => {
  const original = structuredClone(before);
  const left = previewWidgetAddition(before, widget, { x: 0, y: 0, w: 6, h: 2 });
  const right = previewWidgetAddition(before, widget, { x: 6, y: 2, w: 6, h: 2 });
  assert.deepEqual(before, original);
  assert.deepEqual(
    visible(left)
      .map((x) => x.id)
      .sort(),
    ['b', 'c', 'd', 'new'],
  );
  assert.deepEqual(
    visible(right)
      .map((x) => x.id)
      .sort(),
    ['a', 'b', 'c', 'new'],
  );
  const large = previewWidgetAddition(before, widget, { x: 0, y: 0, w: 12, h: 2 });
  assert.deepEqual(
    visible(large)
      .map((x) => x.id)
      .sort(),
    ['c', 'd', 'new'],
  );
  assert.deepEqual(previewWidgetAddition(before, widget, { x: 0, y: 0, w: 6, h: 2 }), left);
  for (const result of [left, right, large]) {
    assert.equal(result.widgets.length, 5);
    const pages = paginateHomeLayout(result, 'wide', 4);
    assert.equal(new Set(pages.flat().map((x) => x.id)).size, 5);
    for (const page of pages)
      for (const a of page)
        for (const b of page) {
          if (a === b) continue;
          assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
        }
  }
});

test('placement uses a free slot first and supports an empty or narrow Home', () => {
  const partial = {
    ...before,
    widgets: before.widgets.slice(1),
    positions: { wide: before.positions.wide.slice(1) },
  };
  const result = previewWidgetAddition(partial, widget, {});
  assert.equal(paginateHomeLayout(result, 'wide', 4).length, 1);
  for (const mode of ['wide', 'compact', 'stacked']) {
    const empty = { version: 1, widgets: [], positions: {} };
    const placed = previewWidgetAddition(empty, widget, { mode, rows: 2 });
    assert.equal(paginateHomeLayout(placed, mode, 2)[0][0].id, 'new');
  }
});

test('adding on a later page leaves the earlier page intact', () => {
  const baseline = {
    ...before,
    widgets: [
      ...before.widgets,
      { id: 'e', type: 'notes', size: 'small', footprints: { wide: { w: 6, h: 2 } } },
    ],
    positions: { wide: [...before.positions.wide, { id: 'e', x: 0, y: 4 }] },
  };
  const result = previewWidgetAddition(baseline, widget, { page: 1, x: 6, y: 0, w: 3, h: 2 });
  const pages = paginateHomeLayout(result, 'wide', 4);
  assert.deepEqual(pages[0].map((x) => x.id).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pages[1].map((x) => x.id).sort(), ['e', 'new']);
});
