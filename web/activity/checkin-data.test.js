import test from 'node:test';
import assert from 'node:assert/strict';
import { checkinView, groupedCheckinHistory, observedContext } from './checkin-data.js';
const view = (patch = {}, connection = 'connected') => ({
  connection,
  snapshot: {
    accountability: {
      check_ins: {
        version: 1,
        enabled: true,
        phase: 'eligible',
        evaluated_at: 100,
        history: [],
        ...patch,
      },
    },
  },
});
test('unknown or disconnected state never presents saved activity as running', () => {
  for (const item of [
    view({}, 'offline'),
    view({ version: 2 }),
    view({ phase: 'invented' }),
    view({ enabled: 'yes' }),
    {},
  ]) {
    const result = checkinView(item);
    assert.equal(result.supported, false);
    assert.notEqual(result.tone, 'active');
    assert.deepEqual(result.history, []);
  }
});
test('permission and activation are distinct and the user sees the current blocker', () => {
  const waiting = checkinView(view({ phase: 'activity_off' }));
  assert.equal(waiting.enabled, true);
  assert.equal(waiting.title, 'Waiting for activity');
  assert.match(waiting.description, /sharing is off/);
  assert.equal(checkinView(view({ enabled: false, phase: 'off' })).chip, 'Check-ins off');
  assert.match(checkinView(view({ phase: 'on_break' })).description, /break/);
  assert.match(checkinView(view({ phase: 'deciding' })).description, /may stay quiet/i);
});
test('history contains actual validated outcomes in newest-first order with optional completion', () => {
  const result = checkinView(
    view({
      history: [
        { created_at: 30, outcome: 'quiet', fingerprint: 'private' },
        { created_at: 50, outcome: 'delivered', finished_at: 60 },
        { created_at: 40, outcome: 'imaginary' },
        { created_at: 0, outcome: 'running' },
      ],
    }),
  );
  assert.deepEqual(
    result.history.map((i) => i.outcome),
    ['delivered', 'quiet'],
  );
  assert.equal(result.history[1].finishedAt, null);
  assert.equal(result.history[0].finishedAt, 60);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.match(result.history[0].description, /does not confirm/);
});
test('observation has an actual time and does not turn unshared context into observed work', () => {
  assert.equal(
    checkinView(view({ last_observation: { kind: 'approved_study_context' } })).observation,
    null,
  );
  const result = checkinView(
    view({ last_observation: { kind: 'activity_unshared', at: 100, title: 'private' } }),
  );
  assert.equal(observedContext(result.observation), 'Activity details not shared');
  assert.ok(!JSON.stringify(result.observation).includes('private'));
});
test('earliest reevaluation time is optional, finite, and never a promised message', () => {
  assert.equal(checkinView(view({ phase: 'cooldown', eligible_at: 500 })).eligibleAt, 500);
  for (const t of [0, -1, NaN, Infinity, '500'])
    assert.equal(checkinView(view({ eligible_at: t })).eligibleAt, null);
  assert.match(checkinView(view({ phase: 'eligible' })).description, /may prompt/);
});

test('repeated current failures are grouped without deleting their audit entries', () => {
  const history = [
    { outcome: 'failed_quiet', createdAt: 50 },
    { outcome: 'failed_quiet', createdAt: 40 },
    { outcome: 'quiet', createdAt: 30 },
  ];
  const grouped = groupedCheckinHistory(history);
  assert.equal(grouped.summary.count, 2);
  assert.deepEqual(grouped.failed, history.slice(0, 2));
  assert.deepEqual(grouped.entries, history.slice(2));
  assert.equal(groupedCheckinHistory(history.slice(1)).summary, null);
});
