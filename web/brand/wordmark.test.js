import assert from 'node:assert/strict';
import test from 'node:test';
import { stepWordmark } from './wordmark.js';
test('pointer entry and exit ease without restarting the light', () => {
  const entered = stepWordmark({ phase: 12, x: 0, y: 0 }, { x: 1, y: -1 }, 1 / 30);
  assert.ok(entered.phase > 12);
  assert.ok(entered.x > 0 && entered.x < 0.2);
  const left = stepWordmark(entered, { x: 0, y: 0 }, 1 / 30);
  assert.ok(left.phase > entered.phase);
  assert.ok(left.x > 0 && left.x < entered.x);
});
test('long suspended frames are bounded and paused phase is frozen', () => {
  const state = { phase: 5, x: 0.5, y: -0.5 };
  assert.equal(stepWordmark(state, { x: 0, y: 0 }, 300).phase, 5.05);
  assert.equal(stepWordmark(state, { x: 1, y: 1 }, 1 / 30, false).phase, 5);
});
