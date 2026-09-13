import test from 'node:test';
import assert from 'node:assert/strict';
import { provenanceRows } from './provenance.js';
test('source outcomes are categorical and never infer unavailable input was used', () => {
  assert.deepEqual(
    provenanceRows({
      version: 1,
      task_revision: 0,
      sources: [{ source: 'calendar', status: 'unavailable' }],
    }),
    [{ name: 'Calendar', status: 'Unavailable' }],
  );
  assert.equal(provenanceRows(null), null);
  assert.equal(
    provenanceRows({
      version: 1,
      task_revision: 0,
      sources: [{ source: 'invented', status: 'used' }],
    }),
    null,
  );
  assert.equal(provenanceRows({ version: 1, task_revision: -1, sources: [] }), null);
  assert.equal(
    provenanceRows({
      version: 1,
      task_revision: 0,
      sources: [{ source: 'mail', status: 'maybe' }],
    }),
    null,
  );
});
