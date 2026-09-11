import test from 'node:test';
import assert from 'node:assert/strict';
import { composeLayout } from './layout.js';

const components = [
  { id: 'pinned', emphasis: 'primary' },
  { id: 'normal-a', emphasis: 'normal' },
  { id: 'normal-b', emphasis: 'normal' },
];
test('pinned layout retains its prior anchor and moves below manual reserved cells when needed', () => {
  const result = composeLayout(components, {
    columns: 12,
    rows: 4,
    pins: ['pinned'],
    previous: [{ id: 'pinned', x: 0, y: 0, w: 6, h: 2 }],
    reserved: [{ id: 'manual', x: 0, y: 0, w: 6, h: 2 }],
  });
  const pinned = result.placed.find((item) => item.id === 'pinned');
  assert.deepEqual(
    { x: pinned.x, y: pinned.y, w: pinned.w, h: pinned.h },
    { x: 0, y: 4, w: 6, h: 2 },
  );
  assert.equal(result.overflow.includes('pinned'), false);
});
test('compact layouts keep pinned content and prune optional cards into overflow', () => {
  const result = composeLayout(components, {
    columns: 1,
    rows: 2,
    pins: ['pinned'],
    previous: [{ id: 'pinned', x: 0, y: 0, w: 1, h: 2 }],
  });
  assert.deepEqual(
    result.placed.map((item) => item.id),
    ['pinned'],
  );
  assert.deepEqual(result.overflow, ['normal-a', 'normal-b']);
});
