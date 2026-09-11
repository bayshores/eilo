import test from 'node:test';
import assert from 'node:assert/strict';
import { componentPatchPolicy, keyedMovePlan, shouldPreserveNoteDraft } from './renderer.js';

test('keyed patch policy preserves a card only when its component identity and composition kind agree', () => {
  assert.equal(componentPatchPolicy(null, { id: 'a', kind: 'note' }), 'create');
  assert.equal(componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'a', kind: 'note' }), 'patch');
  assert.equal(
    componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'a', kind: 'outline' }),
    'replace',
  );
  assert.equal(
    componentPatchPolicy({ id: 'a', kind: 'note' }, { id: 'b', kind: 'note' }),
    'replace',
  );
});

test('keyed moves leave an already ordered surface alone and defer the focused card', () => {
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['a', 'b', 'c']), []);
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['b', 'a', 'c']), [{ id: 'b', before: 'a' }]);
  assert.deepEqual(keyedMovePlan(['a', 'c'], ['a', 'b', 'c']), [{ id: 'b', before: 'c' }]);
  assert.deepEqual(keyedMovePlan(['a', 'b', 'c'], ['b', 'a', 'c'], 'b'), []);
});

test('a local note draft persists across blur-driven refreshes until its source text changes', () => {
  const draft = { sourceText: 'Known thought', value: 'My edited thought' };
  assert.equal(shouldPreserveNoteDraft(draft, 'Known thought'), true);
  assert.equal(shouldPreserveNoteDraft(draft, 'Acknowledged thought'), false);
});
