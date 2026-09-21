import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityRows, isCapabilitiesSnapshot } from './manager.js';

const snapshot = {
  version: 1,
  revision: 3,
  chat_id: 'chat-one',
  chat_name: 'Focus',
  connectors: [
    {
      id: 'gmail',
      name: 'Gmail',
      description: 'Mail',
      scope: 'this Mac',
      available: true,
      globally_enabled: true,
      supported: true,
      enabled: true,
    },
  ],
  skills: [
    {
      id: 'focus',
      name: 'Focus',
      description: 'Stay on task',
      scope: 'built in',
      available: true,
      globally_enabled: true,
      supported: true,
      enabled: false,
    },
  ],
  mcps: [],
  plugins: [],
};

test('capability snapshots keep availability separate from per-chat state', () => {
  assert.equal(isCapabilitiesSnapshot(snapshot), true);
  assert.equal(
    isCapabilitiesSnapshot({
      ...snapshot,
      connectors: [{ ...snapshot.connectors[0], available: 'yes' }],
    }),
    false,
  );
});

test('capability rows filter by type and visible text', () => {
  assert.deepEqual(
    capabilityRows(snapshot, 'skill').map(({ id, kind }) => [id, kind]),
    [['focus', 'skill']],
  );
  assert.deepEqual(
    capabilityRows(snapshot, 'all', 'mail').map(({ id }) => id),
    ['gmail'],
  );
  assert.deepEqual(capabilityRows(snapshot, 'plugin'), []);
});
