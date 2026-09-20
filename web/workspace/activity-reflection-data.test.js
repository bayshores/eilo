import assert from 'node:assert/strict';
import test from 'node:test';
import { activityReflection } from './activity-reflection-data.js';

test('self-observations do not masquerade as useful work context', () => {
  const result = activityReflection([
    { kind: 'episode', appName: 'eïlo', title: 'Home', recordedSeconds: 30 },
    { kind: 'episode', appName: 'eilo Service', recordedSeconds: 60 },
  ]);
  assert.equal(result.kind, 'setup');
  assert.equal(result.otherCount, 0);
  assert.equal(result.seconds, 90);
});

test('a short mixed log stays modest while a fuller record remains an observation', () => {
  assert.equal(
    activityReflection([{ kind: 'episode', appName: 'Safari', recordedSeconds: 30 }]).kind,
    'snapshot',
  );
  const result = activityReflection([
    { kind: 'episode', appName: 'Safari', recordedSeconds: 30 },
    { kind: 'episode', appName: 'Notes', recordedSeconds: 40 },
    { kind: 'legacy', appName: 'Mail', observed_seconds: 50 },
  ]);
  assert.equal(result.kind, 'activity');
  assert.ok(result.detail.includes('never proof'));
  assert.equal(result.seconds, 120);
});
