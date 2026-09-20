'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotificationPolicy, GENERIC_BODY, MAX_SEEN_KEYS } = require('./notifications.cjs');

function message(id, eventId, text = 'How is the task going?') {
  return { id, event_id: eventId, role: 'assistant', origin: 'check_in', text };
}
function snapshot(conversationId, messages) {
  return { conversation_id: conversationId, messages };
}
function notificationSnapshot(conversationId, messages, eventIds) {
  return {
    ...snapshot(conversationId, messages),
    accountability: { check_ins: { notification_event_ids: eventIds } },
  };
}
function memoryStore(initial = null) {
  let value = initial;
  return {
    load: () => value,
    save: (next) => {
      value = next;
    },
    value: () => value,
  };
}

test('is opt-in and baselines existing messages when first enabled', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  const current = snapshot('c1', [message('m1', 'e1')]);
  policy.inspect(current, { foreground: false });
  assert.equal(shown.length, 0);
  policy.setEnabled(true);
  policy.inspect(current, { foreground: false });
  assert.equal(shown.length, 0);
  policy.inspect(snapshot('c1', [message('m1', 'e1'), message('m2', 'e2')]), { foreground: false });
  assert.deepEqual(shown, [
    { conversationId: 'c1', eventId: 'e2', messageId: 'm2', body: GENERIC_BODY },
  ]);
});

test('an always-on overlay delivery can use fresh eligible text without persisting it', () => {
  const store = memoryStore();
  const shown = [];
  const policy = createNotificationPolicy({
    ...store,
    defaultEnabled: true,
    includeText: true,
    requireEligibility: true,
    show: (record) => shown.push(record),
  });
  policy.inspect(notificationSnapshot('c1', [], []), { foreground: false });
  policy.inspect(notificationSnapshot('c1', [message('m1', 'e1', 'A small check-in.')], ['e1']), {
    foreground: false,
  });
  assert.deepEqual(shown, [
    {
      conversationId: 'c1',
      eventId: 'e1',
      messageId: 'm1',
      body: GENERIC_BODY,
      text: 'A small check-in.',
    },
  ]);
  assert.equal(Object.hasOwn(store.value(), 'text'), false);
});

test('foreground messages are marked seen without an OS notification', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(snapshot('c1', []), { foreground: false });
  const next = snapshot('c1', [message('m1', 'e1')]);
  policy.inspect(next, { foreground: true });
  policy.inspect(next, { foreground: false });
  assert.equal(shown.length, 0);
});

test('deduplicates by conversation and event and emits only the latest new check-in', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(snapshot('c1', []), { foreground: false });
  policy.inspect(snapshot('c1', [message('m1', 'e1'), message('m2', 'e2')]), { foreground: false });
  policy.inspect(snapshot('c1', [message('m1b', 'e1'), message('m2', 'e2')]), {
    foreground: false,
  });
  assert.deepEqual(shown, [
    { conversationId: 'c1', eventId: 'e2', messageId: 'm2', body: GENERIC_BODY },
  ]);
});

test('an explicit empty eligibility list suppresses a check-in and never replays it later', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(notificationSnapshot('c1', [], []), { foreground: false });
  const suppressed = notificationSnapshot('c1', [message('m1', 'e1')], []);
  policy.inspect(suppressed, { foreground: false });
  policy.inspect(notificationSnapshot('c1', [message('m1', 'e1')], ['e1']), {
    foreground: false,
  });
  assert.equal(shown.length, 0);
});

test('selects the newest fresh check-in that remains eligible while recording all fresh IDs', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(notificationSnapshot('c1', [], []), { foreground: false });
  const messages = [message('m1', 'e1'), message('m2', 'e2'), message('m3', 'e3')];
  policy.inspect(notificationSnapshot('c1', messages, ['e1', 'e3']), { foreground: false });
  policy.inspect(notificationSnapshot('c1', messages, ['e2']), { foreground: false });
  assert.deepEqual(shown, [
    { conversationId: 'c1', eventId: 'e3', messageId: 'm3', body: GENERIC_BODY },
  ]);
});

test('a malformed eligibility field fails closed without clearing the baseline', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(notificationSnapshot('c1', [message('m1', 'e1')], ['bad event id']), {
    foreground: false,
  });
  assert.equal(policy.status().needsBaseline, true);
  policy.inspect(notificationSnapshot('c1', [message('m1', 'e1')], ['e1']), {
    foreground: false,
  });
  assert.equal(shown.length, 0);
});

test('snapshots without notification eligibility preserve the legacy latest-check-in behavior', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(snapshot('c1', []), { foreground: false });
  policy.inspect(snapshot('c1', [message('m1', 'e1'), message('m2', 'e2')]), { foreground: false });
  assert.deepEqual(shown, [
    { conversationId: 'c1', eventId: 'e2', messageId: 'm2', body: GENERIC_BODY },
  ]);
});

test('restart and changed conversations baseline imported history before a later new check-in', () => {
  const store = memoryStore({ enabled: true, seen: ['old\u0000event'] });
  const shown = [];
  const first = createNotificationPolicy({ ...store, show: (record) => shown.push(record) });
  first.inspect(snapshot('c1', [message('m1', 'e1')]), { foreground: false });
  const second = createNotificationPolicy({ ...store, show: (record) => shown.push(record) });
  second.inspect(snapshot('c2', [message('m2', 'e2')]), { foreground: false });
  assert.equal(shown.length, 0);
  second.inspect(snapshot('c2', [message('m2', 'e2'), message('m3', 'e3')]), { foreground: false });
  assert.deepEqual(shown.at(-1), {
    conversationId: 'c2',
    eventId: 'e3',
    messageId: 'm3',
    body: GENERIC_BODY,
  });
});

test('disabled policy does not display and malformed messages cannot qualify', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.inspect(snapshot('c1', [message('m1', 'e1')]), { foreground: false });
  policy.setEnabled(true);
  policy.inspect(
    {
      conversation_id: 'c1',
      messages: [
        { id: 'm1', event_id: 'e1', role: 'assistant', origin: 'check_in', text: '' },
        null,
      ],
    },
    { foreground: false },
  );
  policy.inspect(
    snapshot('c1', [{ id: 'm2', event_id: 'e2', role: 'user', origin: 'check_in', text: 'No' }]),
    { foreground: false },
  );
  assert.equal(shown.length, 0);
});

test('a failed local read safely defaults to disabled', () => {
  const errors = [];
  const shown = [];
  const policy = createNotificationPolicy({
    load: () => {
      throw new Error('unreadable store');
    },
    show: (record) => shown.push(record),
    onError: (error) => errors.push(error.message),
  });
  policy.inspect(snapshot('c1', [message('m1', 'e1')]), { foreground: false });
  assert.equal(policy.status().enabled, false);
  assert.deepEqual(errors, ['unreadable store']);
  assert.equal(shown.length, 0);
});

test('malformed first snapshot leaves the required baseline pending', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect({ conversation_id: 'c1', messages: null }, { foreground: false });
  assert.equal(policy.status().needsBaseline, true);
  policy.inspect(snapshot('c1', [message('m1', 'e1')]), { foreground: false });
  assert.equal(shown.length, 0);
});

test('repeating a history longer than the seen bound cannot cycle old events into notifications', () => {
  const shown = [];
  const policy = createNotificationPolicy({ show: (record) => shown.push(record) });
  policy.setEnabled(true);
  policy.inspect(snapshot('c1', []), { foreground: false });
  const history = Array.from({ length: MAX_SEEN_KEYS + 44 }, (_, i) => message(`m${i}`, `e${i}`));
  policy.inspect(snapshot('c1', history), { foreground: false });
  policy.inspect(snapshot('c1', history), { foreground: false });
  assert.equal(shown.length, 1);
  assert.deepEqual(shown[0], {
    conversationId: 'c1',
    eventId: 'e299',
    messageId: 'm299',
    body: GENERIC_BODY,
  });
});

test('persists before show, reports display errors, and bounds stored identifiers', () => {
  const store = memoryStore();
  const errors = [];
  let savedBeforeShow = false;
  const policy = createNotificationPolicy({
    ...store,
    show: () => {
      savedBeforeShow = store.value().seen.length > 0;
      throw new Error('display unavailable');
    },
    onError: (error) => errors.push(error.message),
  });
  policy.setEnabled(true);
  policy.inspect(snapshot('c1', []), { foreground: false });
  const messages = Array.from({ length: MAX_SEEN_KEYS + 10 }, (_, i) => message(`m${i}`, `e${i}`));
  policy.inspect(snapshot('c1', messages), { foreground: false });
  assert.equal(errors[0], 'display unavailable');
  assert.equal(savedBeforeShow, true);
  assert.equal(store.value().seen.length, MAX_SEEN_KEYS);
  assert.equal(Object.hasOwn(store.value(), 'text'), false);
});
