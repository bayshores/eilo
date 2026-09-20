import assert from 'node:assert/strict';
import test from 'node:test';
import { consecutiveFailedCheckins, homeHealth } from './health-data.js';

const view = (patch = {}) => ({
  connection: 'connected',
  snapshot: {
    accountability: {
      activity: { helper_available: true, state: 'off', chrome_available: false },
      observed_activity: {},
      check_ins: { version: 1, enabled: true, phase: 'eligible', history: [] },
    },
    integrations: { google_calendar: {}, briefing_sources: {} },
    ...patch,
  },
});

test('Home health surfaces only actionable source and current check-in problems', () => {
  const current = view({
    integrations: {
      google_calendar: { state: 'reauth_required' },
      briefing_sources: {},
    },
    accountability: {
      activity: { helper_available: true, state: 'off', chrome_available: false },
      observed_activity: {},
      check_ins: {
        version: 1,
        enabled: true,
        phase: 'eligible',
        history: [
          { created_at: 40, outcome: 'failed_quiet' },
          { created_at: 30, outcome: 'failed_quiet' },
        ],
      },
    },
  });
  const result = homeHealth(current);
  assert.deepEqual(
    result.items.map(({ id, action }) => ({ id, action })),
    [
      { id: 'calendar', action: 'Review Calendar' },
      { id: 'checkins', action: 'Review check-ins' },
    ],
  );
  assert.equal(result.title, '2 things need attention');
});

test('a later successful check-in resolves the failure callout and paused sources stay quiet', () => {
  const current = view({
    integrations: { google_calendar: { state: 'paused' }, briefing_sources: {} },
    accountability: {
      activity: { helper_available: true, state: 'paused', chrome_available: false },
      observed_activity: {},
      check_ins: {
        version: 1,
        enabled: true,
        phase: 'eligible',
        history: [
          { created_at: 50, outcome: 'delivered' },
          { created_at: 40, outcome: 'failed_quiet' },
        ],
      },
    },
  });
  assert.deepEqual(homeHealth(current).items, []);
  assert.equal(
    consecutiveFailedCheckins([
      { outcome: 'failed_quiet' },
      { outcome: 'failed_quiet' },
      { outcome: 'quiet' },
    ]),
    2,
  );
});
