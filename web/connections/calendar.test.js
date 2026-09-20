import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSnapshot, formatWhen, isSnapshot } from './calendar.js';

const base = {
  schema_version: 1,
  revision: 4,
  state: 'disconnected',
  configured: true,
  available: true,
  account: null,
  calendars: [],
  selected_ids: [],
  last_synced_at: null,
  error: null,
  events: [],
};

test('recognizes only contract snapshots and known states', () => {
  assert.equal(isSnapshot(base), true);
  assert.equal(isSnapshot({ ...base, state: 'invented' }), false);
  assert.equal(isSnapshot({ ...base, revision: '4' }), false);
});

test('unavailable builds and recovery states give honest useful descriptions', () => {
  assert.equal(
    describeSnapshot({ ...base, configured: false, state: 'disconnected' }),
    'Calendar is not available in this build.',
  );
  assert.equal(
    describeSnapshot({ ...base, state: 'reauth_required' }),
    'Google Calendar access needs attention.',
  );
  assert.equal(
    describeSnapshot({
      ...base,
      state: 'reauth_required',
      error: { message: 'Google no longer accepts this permission.' },
    }),
    'Google no longer accepts this permission.',
  );
  assert.equal(
    describeSnapshot({ ...base, state: 'error', error: { message: 'Connection expired.' } }),
    'Connection expired.',
  );
});

test('sync time is safe for invalid server values', () => {
  assert.equal(formatWhen('not a timestamp'), 'recently');
  assert.match(formatWhen('2026-09-09T20:30:00.000Z'), /2026/);
});
