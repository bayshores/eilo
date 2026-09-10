import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskEditOperations, goalActionOperations, undoGoalOperations } from './editor.js';
const task = {
  id: 'one',
  title: 'Practice',
  status: 'open',
  due_text: 'Tomorrow',
  target_count: 5,
  completed_count: 3,
  unit: 'problems',
};
const values = { ...task };
test('edit preserves timing wording and combines quantity corrections in a safe order', () => {
  const down = taskEditOperations(task, { ...values, target_count: '2', completed_count: '1' });
  assert.deepEqual(
    down.map((item) => item.op),
    ['progress', 'edit'],
  );
  const up = taskEditOperations(task, {
    ...values,
    target_count: '8',
    completed_count: '6',
    due_text: 'After class',
  });
  assert.deepEqual(
    up.map((item) => item.op),
    ['edit', 'progress'],
  );
  assert.equal(up[0].due_text, 'After class');
  assert.deepEqual(taskEditOperations(task, values), []);
  assert.deepEqual(taskEditOperations(task, { ...values, target_count: '', unit: 'ignored' }), [
    { op: 'edit', task_id: 'one', target_count: null, unit: null },
  ]);
});
test('invalid or fractional quantities cannot silently coerce into progress', () => {
  for (const invalid of [
    { title: '' },
    { target_count: '2', completed_count: '3' },
    { target_count: '0' },
    { completed_count: '1.5' },
    { target_count: '3e2' },
  ])
    assert.throws(() => taskEditOperations(task, { ...values, ...invalid }));
  assert.throws(() => taskEditOperations({ ...task, status: 'deleted' }, values));
});
test('new goals and lifecycle operations have explicit bounded intent', () => {
  assert.deepEqual(
    taskEditOperations(null, { title: ' New goal ', due_text: '', target_count: '', unit: '' }),
    [
      {
        op: 'add',
        temp_id: 'new_manual',
        title: 'New goal',
        due_text: null,
        target_count: null,
        unit: null,
      },
    ],
  );
  assert.deepEqual(goalActionOperations(task, 'focus', 'one'), [{ op: 'focus', task_id: null }]);
  assert.deepEqual(undoGoalOperations(task, 'delete', 'one'), [
    { op: 'restore', task_id: 'one' },
    { op: 'focus', task_id: 'one' },
  ]);
  assert.deepEqual(undoGoalOperations(task, 'complete', 'one'), [
    { op: 'reopen', task_id: 'one' },
    { op: 'progress', task_id: 'one', completed_count: 3 },
    { op: 'focus', task_id: 'one' },
  ]);
});
