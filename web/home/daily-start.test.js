import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyStartData, localDay } from './daily-start.js';

const now = new Date('2026-09-12T17:00:00Z');
const task = (id, title, status = 'open') => ({ id, title, status });
const view = (snapshot) => ({ connection: 'connected', snapshot });
const snapshot = (extra = {}) => ({
  schema_version: 2,
  workspace: { active_chat_id: 'chat-a' },
  tasks: { tasks: [task('one', 'Write report')], focus_id: 'one', break_active: false },
  ...extra,
});

test('daily start uses only an explicit return point for its selected goal', () => {
  const explicit = dailyStartData(
    view(
      snapshot({
        adaptive: {
          current_work_context: {
            confidence: 'explicit',
            task_ids: ['one'],
            return_point: 'Open the outline and write the first paragraph.',
          },
        },
      }),
    ),
    now,
  );
  assert.equal(explicit.task.id, 'one');
  assert.equal(explicit.nextStep, 'Open the outline and write the first paragraph.');
  assert.equal(explicit.detail, explicit.nextStep);
  for (const context of [
    { confidence: 'observed', task_ids: ['one'], return_point: 'Invented from activity' },
    { confidence: 'explicit', task_ids: ['other'], return_point: 'Unrelated task' },
  ])
    assert.equal(
      dailyStartData(view(snapshot({ adaptive: { current_work_context: context } })), now).nextStep,
      '',
    );
});

test('daily start does not choose an arbitrary goal', () => {
  const data = dailyStartData(
    view(snapshot({ tasks: { tasks: [task('one', 'First'), task('two', 'Second')] } })),
    now,
  );
  assert.equal(data.task, null);
  assert.equal(data.detail, 'Tell eïlo what you want to get started on.');
});

test('daily start is unavailable during onboarding or while offline', () => {
  assert.equal(dailyStartData({ connection: 'offline', snapshot: snapshot() }, now), null);
  for (const status of ['draft', 'proposed'])
    assert.equal(dailyStartData(view(snapshot({ onboarding: { status } })), now), null);
});

test('daily start shows only a fresh connected timed event that is still today', () => {
  const calendar = {
    account: { id: 'primary' },
    state: 'connected',
    last_synced_at: new Date(now.getTime() - 14 * 60 * 1000).toISOString(),
    events: [
      { start: '2026-09-12T18:00:00Z', end: '2026-09-12T19:00:00Z', title: 'Review' },
      { start: '2026-09-13T18:00:00Z', end: '2026-09-13T19:00:00Z', title: 'Tomorrow' },
    ],
  };
  assert.ok(
    dailyStartData(
      view(snapshot({ integrations: { google_calendar: calendar } })),
      now,
    ).commitment.includes('Review'),
  );
  for (const changed of [
    { state: 'paused' },
    { last_synced_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString() },
    { last_synced_at: new Date(now.getTime() + 1).toISOString() },
  ]) {
    const data = dailyStartData(
      view(snapshot({ integrations: { google_calendar: { ...calendar, ...changed } } })),
      now,
    );
    assert.equal(data.commitment, '');
  }
});

test('local day uses the browser calendar day at midnight', () => {
  assert.equal(localDay(new Date(2026, 8, 12, 23, 59)), '2026-09-12');
  assert.equal(localDay(new Date(2026, 8, 13, 0, 0)), '2026-09-13');
});
