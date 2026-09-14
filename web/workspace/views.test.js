import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary } from './views.js';

test('summarizes mixed recorded activity without inventing a duration', () => {
  assert.equal(
    activitySummary([
      { kind: 'episode', recordedSeconds: 90 },
      { kind: 'legacy', observed_seconds: 30 },
      { kind: 'episode', recordedSeconds: 0 },
    ]),
    '3 activity records · 2m recorded',
  );
  assert.equal(activitySummary([{ kind: 'legacy', observed_seconds: 0 }]), '1 activity record');
});
