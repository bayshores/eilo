import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorkflowDismissals, rememberWorkflowDismissal } from './workflow-progress.js';

function storage(seed = null, throws = false) {
  let value = seed;
  return {
    getItem() {
      if (throws) throw new Error('blocked');
      return value;
    },
    setItem(_key, next) {
      if (throws) throw new Error('blocked');
      value = next;
    },
    value: () => value,
  };
}

test('workflow dismissal receipts are bounded, deduplicated, and survive a local reload', () => {
  const local = storage(JSON.stringify(['old-run', 'old-run', '', 5]));
  let dismissed = loadWorkflowDismissals(local);
  assert.deepEqual(dismissed, ['old-run']);
  dismissed = rememberWorkflowDismissal(local, dismissed, 'finished-run');
  assert.deepEqual(dismissed, ['old-run', 'finished-run']);
  assert.deepEqual(loadWorkflowDismissals(local), ['old-run', 'finished-run']);
  dismissed = rememberWorkflowDismissal(local, dismissed, 'old-run');
  assert.deepEqual(dismissed, ['finished-run', 'old-run']);
});

test('blocked or malformed dismissal storage leaves the current session usable', () => {
  const local = storage('{not json');
  assert.deepEqual(loadWorkflowDismissals(local), []);
  assert.deepEqual(rememberWorkflowDismissal(storage(null, true), [], 'finished-run'), [
    'finished-run',
  ]);
});
