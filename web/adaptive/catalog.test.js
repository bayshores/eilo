import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTIVE_LIMITS, normalizeComposition, validateComposition } from './catalog.js';

const valid = () => ({
  schema_version: 1,
  id: 'writing',
  context_id: 'ctx',
  revision: 2,
  title: 'Draft the essay',
  components: [
    {
      id: 'start',
      kind: 'intention',
      title: 'Start here',
      emphasis: 'primary',
      items: [
        'Open the draft',
        { id: 'read', label: 'Read aloud', detail: 'First paragraph', value: '2 min' },
      ],
    },
  ],
});

test('normalizes display content while retaining only the supported data contract', () => {
  const input = valid();
  input.components[0].unexpected = '<script>';
  const composition = normalizeComposition(input);
  assert.deepEqual(composition.components[0].items[0], { id: 'item-1', label: 'Open the draft' });
  assert.equal('unexpected' in composition.components[0], false);
});
test('rejects malformed composition identity, unknown kinds, and duplicate component ids', () => {
  assert.equal(normalizeComposition({}), null);
  const unknown = valid();
  unknown.components[0].kind = 'button';
  assert.equal(validateComposition(unknown).ok, false);
  const duplicate = valid();
  duplicate.components.push({ ...duplicate.components[0] });
  assert.equal(normalizeComposition(duplicate), null);
});
test('bounds item and text payloads without creating semantic values', () => {
  const input = valid();
  input.components[0].text = 'x'.repeat(3000);
  input.components[0].items = Array.from(
    { length: ADAPTIVE_LIMITS.items + 5 },
    (_, index) => `row ${index}`,
  );
  const result = normalizeComposition(input).components[0];
  assert.equal(result.text.length, ADAPTIVE_LIMITS.text);
  assert.equal(result.items.length, ADAPTIVE_LIMITS.items);
  assert.equal(
    result.items.some((item) => item.value),
    false,
  );
});
test('accepts backend-shaped numeric identifiers and string bindings, while rejecting executable fields', () => {
  const input = valid();
  input.id = '2026-work';
  input.context_id = '42';
  input.components[0].binding = '007-source';
  const normalized = normalizeComposition(input);
  assert.deepEqual(normalized.components[0].binding, { id: '007-source' });
  input.components[0].action = 'send';
  assert.equal(normalizeComposition(input), null);
});
