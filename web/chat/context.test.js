import test from 'node:test';
import assert from 'node:assert/strict';
import { contextPresentation } from './context.js';

const estimate = (extra = {}) => ({
  window_tokens: 1000,
  used_tokens: 10,
  remaining_tokens: 990,
  measurement: 'estimate',
  threshold_tokens: 750,
  usage: { input_tokens: 10, output_tokens: 2 },
  can_compress: true,
  status: 'idle',
  ...extra,
});

test('context presentation uses a real zero without confusing it with unknown', () => {
  const view = contextPresentation(estimate({ used_tokens: 0, remaining_tokens: 1000 }));
  assert.equal(view.known, true);
  assert.equal(view.percentText, '0%');
  assert.equal(view.used, '0');
});
test('context presentation hides absent, unsafe, and offline measurements', () => {
  for (const context of [null, estimate({ used_tokens: -1 }), estimate({ used_tokens: Infinity })])
    assert.equal(contextPresentation(context).percentText, '—');
  assert.equal(contextPresentation(estimate({ threshold_tokens: NaN })).threshold, '—');
  assert.equal(contextPresentation(estimate(), { connected: false }).remaining, '—');
});
test('context presentation retains a safe estimate while compression is busy', () => {
  const view = contextPresentation(estimate({ status: 'compressing' }));
  assert.equal(view.percentText, '1%');
  assert.equal(view.status, 'compressing');
  assert.equal(view.canCompress, true);
});

test('context presentation preserves summary state when occupancy is unavailable', () => {
  const view = contextPresentation(
    estimate({ used_tokens: NaN, status: 'compressed', can_compress: true }),
  );
  assert.equal(view.percentText, '—');
  assert.equal(view.total, '1,000');
  assert.equal(view.status, 'compressed');
  assert.equal(view.canCompress, true);
});
test('context presentation caps an overfull meter and reports no remaining space', () => {
  const view = contextPresentation(estimate({ used_tokens: 1100, remaining_tokens: 0 }));
  assert.equal(view.percentText, '100%');
  assert.equal(view.remaining, '0');
  assert.equal(view.progress, 100);
});
