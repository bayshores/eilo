import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRecordedTime,
  recordingControlState,
  selectBrowserUsage,
  selectDesktopUsage,
  selectTracking,
} from './tracking-data.js';
import { homeAttentionLens } from './attention-lens.js';

const base = (extra = {}) => ({
  connection: 'connected',
  snapshot: {
    accountability: {
      activity: { helper_available: true, state: 'off', chrome_available: false },
      observed_activity: {},
    },
    integrations: { google_calendar: {}, briefing_sources: {} },
  },
  ...extra,
});

test('tracking distinguishes browser sharing and never surfaces an origin while inactive', () => {
  const active = base();
  active.snapshot.accountability.activity = {
    helper_available: true,
    state: 'active',
    chrome_available: true,
  };
  active.snapshot.accountability.observed_activity.active_session = {
    origin: 'https://any-new-site.example',
  };
  assert.deepEqual(selectTracking(active).rows[0], {
    id: 'browser',
    name: 'Browser',
    status: 'Sharing',
    detail: 'any-new-site.example',
    tone: 'active',
  });
  active.snapshot.accountability.activity.state = 'paused';
  assert.deepEqual(selectTracking(active).rows[0], {
    id: 'browser',
    name: 'Browser',
    status: 'Paused',
    detail: '',
    tone: 'muted',
  });
  active.snapshot.accountability.activity.state = 'active';
  active.snapshot.accountability.activity.chrome_available = false;
  assert.equal(selectTracking(active).rows[0].status, 'Waiting for a page');
});

test('tracking reports calendar and Gmail permission states without labels or stale offline claims', () => {
  const view = base();
  view.snapshot.integrations.google_calendar = {
    state: 'connected',
    selected_ids: ['primary', 'school'],
  };
  view.snapshot.integrations.briefing_sources = {
    calendar: { enabled: true, available: true, selected_count: 2 },
    accounts: [
      { enabled: true, state: 'connected', label: 'private@example.test' },
      { enabled: false, state: 'paused', label: 'school@example.test' },
    ],
  };
  const rows = selectTracking(view).rows;
  assert.deepEqual(
    rows.map(({ id, status, detail }) => ({ id, status, detail })),
    [
      { id: 'browser', status: 'Off', detail: '' },
      { id: 'calendar', status: 'In answers', detail: '' },
      { id: 'gmail', status: 'In answers', detail: '1 connected' },
    ],
  );
  view.snapshot.integrations.briefing_sources.calendar.enabled = false;
  assert.equal(selectTracking(view).rows[1].status, 'On device');
  view.snapshot.integrations.google_calendar.state = 'reauth_required';
  assert.equal(selectTracking(view).rows[1].status, 'Reconnect');
  view.snapshot.integrations.briefing_sources.accounts = [
    { enabled: true, state: 'reauth_required' },
  ];
  assert.equal(selectTracking(view).rows[2].status, 'Reconnect');
  view.snapshot.integrations.briefing_sources.accounts = [{ enabled: false, state: 'paused' }];
  assert.equal(selectTracking(view).rows[2].status, 'Paused');
  const offline = selectTracking({ ...view, connection: 'offline' });
  assert.ok(offline.rows.every((item) => item.status === 'Unavailable' && item.detail === ''));
});

test('tracking prefers adaptive desktop and browser health without claiming that analysis sent data', () => {
  const now = Date.now() / 1000;
  const view = base({
    snapshot: {
      adaptive: {
        policy: { ai_enabled: true },
        capture_status: {
          desktop: { enabled: true, status: 'sampling', last_event_at: now - 10 },
          browser: { enabled: true, status: 'connected', last_event_at: now - 30 },
        },
      },
      integrations: { google_calendar: {}, briefing_sources: {} },
    },
  });
  const rows = selectTracking(view).rows;
  assert.deepEqual(
    rows.slice(0, 2).map(({ name, status, detail }) => ({ name, status, detail })),
    [
      { name: 'Desktop', status: 'Collecting', detail: 'Analysis enabled' },
      { name: 'Browser', status: 'On device', detail: 'Analysis enabled' },
    ],
  );
  view.snapshot.adaptive.capture_status.browser = {
    enabled: true,
    status: 'permission_required',
    last_event_at: null,
  };
  assert.equal(selectTracking(view).rows[1].status, 'Permission needed');
  view.snapshot.adaptive.capture_status.browser.status = 'registration_required';
  assert.equal(selectTracking(view).rows[1].status, 'Set up Chrome');
  assert.equal(selectTracking(view).rows[1].tone, 'attention');
  assert.ok(
    selectTracking({ ...view, connection: 'offline' }).rows.every(
      (item) => item.status === 'Unavailable',
    ),
  );
});

test('paused configured sources stay visible in tracking', () => {
  const view = base({
    snapshot: {
      adaptive: {
        policy: { enabled: false, desktop_enabled: true, browser_enabled: true },
        capture_status: {
          desktop: { enabled: false, status: 'waiting' },
          browser: { enabled: false, status: 'waiting' },
        },
      },
      integrations: { google_calendar: {}, briefing_sources: {} },
    },
  });
  assert.deepEqual(
    selectTracking(view)
      .rows.slice(0, 2)
      .map(({ status }) => status),
    ['Paused', 'Paused'],
  );
});

test('usage accepts only a complete aggregate contract and supports arbitrary HTTP origins', () => {
  const usage = {
    timezone: 'UTC',
    scope: 'retained_sessions',
    total_observed_seconds: 4320,
    days: [
      { date: '2026-09-04', observed_seconds: 0 },
      { date: '2026-09-05', observed_seconds: 0 },
      { date: '2026-09-06', observed_seconds: 0 },
      { date: '2026-09-07', observed_seconds: 0 },
      { date: '2026-09-08', observed_seconds: 0 },
      { date: '2026-09-09', observed_seconds: 3600 },
      { date: '2026-09-10', observed_seconds: 720 },
    ],
    sites: [
      { origin: 'http://localhost:3000', observed_seconds: 3600 },
      { origin: 'https://somewhere-new.example', observed_seconds: 720 },
    ],
  };
  const view = base({
    snapshot: { accountability: { observed_activity: { usage, recent_sessions: [{ start: 0 }] } } },
  });
  const result = selectBrowserUsage(view);
  assert.deepEqual(result.sites, [
    { origin: 'http://localhost:3000', host: 'localhost:3000', seconds: 3600 },
    { origin: 'https://somewhere-new.example', host: 'somewhere-new.example', seconds: 720 },
  ]);
  assert.equal(result.totalSeconds, 4320);
  assert.equal(result.hasData, true);
  assert.deepEqual(selectBrowserUsage(base()).totalSeconds, 0);
  assert.equal(selectBrowserUsage(base()).available, false);
  const bad = structuredClone(view);
  bad.snapshot.accountability.observed_activity.usage.sites[0].origin = 'https://example.test/path';
  assert.equal(selectBrowserUsage(bad).available, false);
  const skippedDay = structuredClone(view);
  skippedDay.snapshot.accountability.observed_activity.usage.days[1].date = '2026-09-06';
  assert.equal(selectBrowserUsage(skippedDay).available, false);
  const empty = structuredClone(view);
  empty.snapshot.accountability.observed_activity.usage.total_observed_seconds = 0;
  empty.snapshot.accountability.observed_activity.usage.sites = [];
  assert.equal(selectBrowserUsage(empty).hasData, false);
  assert.equal(selectBrowserUsage({ ...view, connection: 'offline' }).online, false);
});

test('recorded-time labels are compact and never invent duration from invalid input', () => {
  assert.deepEqual([0, 1, 59, 60, 719, 720, 3600, 4320, Infinity].map(formatRecordedTime), [
    '0m',
    '<1m',
    '<1m',
    '1m',
    '11m',
    '12m',
    '1h',
    '1h 12m',
    '0m',
  ]);
});

test('recording summary does not turn missing grants or failed transport into ready state', async () => {
  const { recordingSummary } = await import('./tracking-data.js');
  const snapshot = {
    adaptive: {
      policy: { enabled: true, desktop_enabled: true },
      capture_status: { desktop: { enabled: true, status: 'permission_required' } },
    },
  };
  assert.equal(
    recordingSummary({ connection: 'connected', snapshot }),
    'Recording needs attention',
  );
  snapshot.adaptive.capture_status.desktop.status = 'disconnected';
  assert.equal(
    recordingSummary({ connection: 'connected', snapshot }),
    'Recording needs attention',
  );
  snapshot.adaptive.capture_status.desktop.status = 'sampling';
  snapshot.adaptive.capture_status.desktop.last_event_at = Date.now() / 1000;
  assert.equal(recordingSummary({ connection: 'connected', snapshot }), 'Recording: Desktop');
  snapshot.adaptive.policy.enabled = false;
  assert.equal(recordingSummary({ connection: 'connected', snapshot }), 'Recording paused');
  assert.equal(
    recordingSummary({ connection: 'offline', snapshot }),
    'Recording status unavailable',
  );
});

test('recording control distinguishes reversible collection state from transport health', () => {
  const snapshot = {
    adaptive: {
      policy: { enabled: true, desktop_enabled: true },
      capture_status: { desktop: { enabled: true, status: 'permission_required' } },
    },
  };
  assert.deepEqual(recordingControlState({ connection: 'connected', snapshot }), {
    available: true,
    active: true,
    label: 'Pause recording',
    status: 'Recording on',
  });
  snapshot.adaptive.policy.enabled = false;
  assert.deepEqual(recordingControlState({ connection: 'connected', snapshot }), {
    available: true,
    active: false,
    label: 'Resume recording',
    status: 'Recording paused',
  });
  assert.equal(recordingControlState({ connection: 'offline', snapshot }).available, false);
});

test('Home analytics keeps aggregate-history limits visible instead of inventing site detail', () => {
  const usage = {
    timezone: 'UTC',
    scope: 'retained_sessions',
    total_observed_seconds: 420,
    days: [
      { date: '2026-09-04', observed_seconds: 0 },
      { date: '2026-09-05', observed_seconds: 0 },
      { date: '2026-09-06', observed_seconds: 0 },
      { date: '2026-09-07', observed_seconds: 0 },
      { date: '2026-09-08', observed_seconds: 0 },
      { date: '2026-09-09', observed_seconds: 180 },
      { date: '2026-09-10', observed_seconds: 240 },
    ],
    sites: [{ origin: 'https://neetcode.io', observed_seconds: 420 }],
  };
  const view = base({
    snapshot: {
      accountability: {
        activity: { helper_available: true, state: 'active', chrome_available: true },
        observed_activity: { usage, recent_sessions: [{ start: 0 }] },
        check_ins: { version: 1, enabled: true, phase: 'unchanged', history: [] },
      },
      integrations: { google_calendar: {}, briefing_sources: {} },
    },
  });
  const day = homeAttentionLens(view, 'day');
  assert.equal(day.totalSeconds, 240);
  assert.equal(day.entries.length, 0);
  assert.equal(day.period.hasBreakdown, false);
  const week = homeAttentionLens(view, 'week');
  assert.equal(week.totalSeconds, 420);
  assert.deepEqual(
    week.entries.map((entry) => entry.name),
    ['neetcode.io'],
  );
  const month = homeAttentionLens(view, 'month');
  assert.equal(month.period.supported, false);
  assert.equal(month.period.requestedDays, 31);
});

test('desktop app rankings use validated retained data without inventing one-day app totals', () => {
  const view = base();
  view.snapshot.adaptive = {
    policy: { desktop_enabled: true },
    usage: {
      desktop: {
        timezone: 'UTC',
        scope: 'retained_sessions',
        total_observed_seconds: 420,
        days: [
          { date: '2026-09-04', observed_seconds: 0 },
          { date: '2026-09-05', observed_seconds: 0 },
          { date: '2026-09-06', observed_seconds: 0 },
          { date: '2026-09-07', observed_seconds: 0 },
          { date: '2026-09-08', observed_seconds: 0 },
          { date: '2026-09-09', observed_seconds: 180 },
          { date: '2026-09-10', observed_seconds: 240 },
        ],
        sites: [
          { app_name: 'Visual Studio Code', observed_seconds: 300 },
          { app_name: 'Chrome', observed_seconds: 120 },
        ],
      },
    },
  };
  assert.deepEqual(selectDesktopUsage(view).apps, [
    { name: 'Visual Studio Code', seconds: 300 },
    { name: 'Chrome', seconds: 120 },
  ]);
  const week = homeAttentionLens(view, 'week');
  assert.equal(week.source, 'desktop');
  assert.deepEqual(
    week.entries.map((entry) => entry.name),
    ['Visual Studio Code', 'Chrome'],
  );
  assert.equal(homeAttentionLens(view, 'day').entries.length, 0);
  const malformed = structuredClone(view);
  malformed.snapshot.adaptive.usage.desktop.sites[0].app_name = ' ';
  assert.equal(selectDesktopUsage(malformed).available, false);
  assert.equal(selectDesktopUsage({ ...view, connection: 'offline' }).online, false);
});
