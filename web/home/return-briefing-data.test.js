import assert from 'node:assert/strict';
import test from 'node:test';
import { returnBriefingData, shouldOfferReturn } from './return-briefing-data.js';

const now = new Date(2026, 8, 19, 12);
const task = (id, title, due_text = null, due_on = null) => ({
  id,
  title,
  status: 'open',
  due_text,
  due_on,
});
const snapshot = (tasks = [task('focus', 'Study')], extra = {}) => ({
  schema_version: 2,
  tasks: { tasks, focus_id: 'focus', break_active: false },
  ...extra,
});
const view = (value) => ({ snapshot: value });

test('briefing selects focus or a sole open goal, never an arbitrary goal', () => {
  assert.equal(returnBriefingData(view(snapshot()), now).task.id, 'focus');
  const tasks = [task('one', 'One'), task('two', 'Two')];
  const multiple = returnBriefingData(
    view(snapshot(tasks, { tasks: { tasks, break_active: false } })),
    now,
  );
  assert.equal(multiple.task, null);
  assert.ok(multiple.prompt.includes('Choose one thing'));
});

test('briefing rejects missing, unsupported, and unfinished onboarding snapshots', () => {
  assert.equal(returnBriefingData(null, now), null);
  assert.equal(returnBriefingData(view({ schema_version: 3, tasks: { tasks: [] } }), now), null);
  for (const status of ['draft', 'proposed'])
    assert.equal(returnBriefingData(view(snapshot([], { onboarding: { status } })), now), null);
});

test('only valid exact local ISO dates can be called overdue', () => {
  const expired = returnBriefingData(
    view(snapshot([task('focus', 'Report', 'Due 2026-09-18')])),
    now,
  );
  assert.equal(expired.status, 'deadline-passed');
  assert.ok(expired.prompt.includes('has passed'));
  for (const due of ['by 12am', 'yesterday', '2026-02-30', 'Due 2026-9-18']) {
    const data = returnBriefingData(view(snapshot([task('focus', 'Report', due)])), now);
    assert.equal(data.status, 'deadline-needs-review');
    assert.equal(data.prompt.includes('has passed'), false);
  }
});

test('a selected due date outranks a loose timing note without overwriting it', () => {
  const data = returnBriefingData(
    view(snapshot([task('focus', 'Report', 'after the review', '2026-09-18')])),
    now,
  );
  assert.equal(data.status, 'deadline-passed');
  assert.equal(data.dueLabel, 'Due Sep 18');
});

test('calendar events require a fresh approved connected snapshot and stay within today', () => {
  const calendar = {
    account: { id: 'primary' },
    state: 'connected',
    last_synced_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    events: [
      { start: '2026-09-19T13:00:00', end: '2026-09-19T14:00:00', title: 'Review' },
      { start: '2026-09-20T13:00:00', end: '2026-09-20T14:00:00', title: 'Tomorrow' },
    ],
  };
  const current = returnBriefingData(
    view(snapshot([], { integrations: { google_calendar: calendar } })),
    now,
  );
  assert.equal(current.event.title, 'Review');
  assert.ok(current.eventLabel.includes('Today'));
  for (const changed of [
    { last_synced_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString() },
    { last_synced_at: new Date(now.getTime() + 1).toISOString() },
    { state: 'paused' },
    { state: 'reauth_required' },
  ]) {
    const value = returnBriefingData(
      view(snapshot([], { integrations: { google_calendar: { ...calendar, ...changed } } })),
      now,
    );
    assert.equal(value.event, null);
  }
  const paused = returnBriefingData(
    view(snapshot([], { integrations: { google_calendar: { ...calendar, state: 'paused' } } })),
    now,
  );
  assert.equal(paused.calendarState, 'Calendar paused');
});

test('return guidance waits for a new day and respects interruption states', () => {
  assert.equal(shouldOfferReturn({ day: '2026-09-19', guidance: true }), true);
  for (const options of [
    { lastDay: '2026-09-19' },
    { hasDraft: true },
    { busy: true },
    { onBreak: true },
    { onboarding: { status: 'draft' } },
    { guidance: false },
  ])
    assert.equal(shouldOfferReturn({ day: '2026-09-19', guidance: true, ...options }), false);
  assert.equal(
    shouldOfferReturn({
      day: '2026-09-19',
      lastDay: '2026-09-19',
      guidance: true,
      now: 8 * 60 * 60 * 1000,
      lastActiveAt: 3 * 60 * 60 * 1000,
      absenceMs: 4 * 60 * 60 * 1000,
    }),
    true,
  );
  assert.equal(
    shouldOfferReturn({
      day: '2026-09-19',
      lastDay: '2026-09-19',
      guidance: true,
      now: 6 * 60 * 60 * 1000,
      lastActiveAt: 3 * 60 * 60 * 1000,
      absenceMs: 4 * 60 * 60 * 1000,
    }),
    false,
  );
});

test('today and future exact deadlines stay current, while a break overrides goal prompts', () => {
  for (const due of ['2026-09-19', '2026-09-20']) {
    const result = returnBriefingData(view(snapshot([task('focus', 'Study', due)])), now);
    assert.equal(result.status, 'current');
    assert.equal(result.goalLabel, '');
  }
  const result = returnBriefingData(
    view(
      snapshot([], {
        tasks: {
          tasks: [task('focus', 'Study', '2026-09-18')],
          focus_id: 'focus',
          break_active: true,
        },
      }),
    ),
    now,
  );
  assert.equal(result.status, 'on-break');
  assert.match(result.prompt, /on a break/);
});
