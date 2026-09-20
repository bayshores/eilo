import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeClient } from './client.js';
import { homeData, conversationEntries, progressText } from '../home/data.js';

const ID = 'request_home_test_123';
const snapshot = (overrides) => ({
  schema_version: 2,
  revision: 'instance:1',
  conversation_id: 'one',
  status: 'ready',
  can_send: true,
  tasks: { revision: 0, focus_id: null, break_active: false, tasks: [] },
  messages: [],
  accepted_request_ids: [],
  pending_message: null,
  ...overrides,
});
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const defer = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const memory = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
function harness(storage = memory()) {
  const calls = [],
    replies = [],
    timers = new Map();
  let timer = 0;
  const client = createHomeClient({
    storage,
    requestId: () => ID,
    fetcher: (path, options) => {
      calls.push({ path, ...options });
      const next = replies.shift();
      assert.ok(next, 'Unexpected request');
      return Promise.resolve(next);
    },
    schedule: (fn) => {
      timers.set(++timer, fn);
      return timer;
    },
    unschedule: (id) => timers.delete(id),
  });
  return {
    client,
    calls,
    replies,
    timers,
    storage,
    ready: async (value) => {
      replies.push(response(value || snapshot()));
      await client.start();
    },
  };
}

test('initial state is read only and uses the required header', async () => {
  const h = harness();
  await h.ready();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].headers['X-Eilo-Client'], 'local-chat');
  assert.equal(h.client.view.connection, 'connected');
});
test('outgoing message appears before acceptance, then reconciles without duplication', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Practice three problems.');
  const pending = defer();
  h.replies.push(pending.promise);
  const send = h.client.send();
  assert.equal(conversationEntries(h.client.view.snapshot, h.client.view.localPending).length, 1);
  assert.equal(h.client.view.localPending.status, 'sending');
  pending.resolve(
    response(
      snapshot({
        revision: 'instance:2',
        status: 'busy',
        can_send: false,
        accepted_request_ids: [ID],
        pending_message: { request_id: ID, text: 'Practice three problems.', status: 'accepted' },
      }),
    ),
  );
  await send;
  assert.equal(h.client.view.draft, '');
  assert.equal(h.client.view.localPending, null);
  assert.equal(conversationEntries(h.client.view.snapshot, null).length, 1);
  h.replies.push(
    response(
      snapshot({
        revision: 'instance:3',
        accepted_request_ids: [ID],
        messages: [
          { id: 'native1', role: 'user', text: 'Practice three problems.' },
          { id: 'native2', role: 'assistant', text: 'Saved.' },
        ],
      }),
    ),
  );
  await h.client.refresh();
  assert.equal(conversationEntries(h.client.view.snapshot, null).length, 2);
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 1);
});
test('stale long poll cannot overwrite an accepted response', async () => {
  const h = harness();
  await h.ready();
  const old = defer();
  h.replies.push(old.promise);
  const poll = h.client.refresh();
  h.client.setDraft('Read chapter two.');
  h.replies.push(
    response(
      snapshot({
        revision: 'instance:9',
        status: 'busy',
        can_send: false,
        accepted_request_ids: [ID],
        pending_message: { request_id: ID, text: 'Read chapter two.', status: 'accepted' },
      }),
    ),
  );
  await h.client.send();
  old.resolve(response(snapshot()));
  await poll;
  assert.equal(h.client.view.snapshot.revision, 'instance:9');
  assert.equal(h.client.view.snapshot.status, 'busy');
});
test('unknown acceptance is not replayed and must be reconciled', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Finish the draft.');
  h.replies.push(Promise.reject(new Error('Network lost')));
  await h.client.send();
  assert.equal(h.client.view.localPending.status, 'unconfirmed');
  assert.equal(h.client.canSend(), false);
  await h.client.send();
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 1);
  h.replies.push(
    response(
      snapshot({
        revision: 'instance:2',
        accepted_request_ids: [ID],
        messages: [{ id: 'n1', role: 'user', text: 'Finish the draft.' }],
      }),
    ),
  );
  await h.client.refresh();
  assert.equal(h.client.view.localPending, null);
  assert.equal(h.client.view.draft, '');
  assert.equal(h.calls.filter((call) => call.method === 'POST').length, 1);
});
test('reload restores an uncertain outbox, then accepted receipt clears it', async () => {
  const storage = memory(),
    h = harness(storage);
  await h.ready();
  h.client.setDraft('Read something.');
  h.replies.push(Promise.reject(new Error('Disconnected')));
  await h.client.send();
  h.client.stop();
  const second = harness(storage);
  assert.equal(second.client.view.localPending.status, 'unconfirmed');
  await second.ready(
    snapshot({
      accepted_request_ids: [ID],
      pending_message: { request_id: ID, text: 'Read something.', status: 'accepted' },
      status: 'busy',
      can_send: false,
    }),
  );
  assert.equal(second.client.view.localPending, null);
  assert.equal(second.client.view.draft, '');
  assert.equal(
    second.calls.every((call) => call.method === 'GET'),
    true,
  );
});
test('outbox and draft never migrate to a different native conversation', async () => {
  const storage = memory(),
    h = harness(storage);
  await h.ready();
  h.client.setDraft('Private draft for one.');
  h.client.stop();
  const second = harness(storage);
  await second.ready(snapshot({ conversation_id: 'two' }));
  assert.equal(second.client.view.draft, '');
  assert.equal(second.client.view.localPending, null);
});
test('typing another draft while a message sends preserves the newer text', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('First message.');
  const pending = defer();
  h.replies.push(pending.promise);
  const send = h.client.send();
  h.client.setDraft('Next thought.');
  pending.resolve(response(snapshot({ accepted_request_ids: [ID] })));
  await send;
  assert.equal(h.client.view.draft, 'Next thought.');
});
test('connection failure keeps last known data but disables sending', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Still here.');
  h.replies.push(Promise.reject(new Error('Offline')));
  await h.client.refresh();
  assert.equal(h.client.view.snapshot.revision, 'instance:1');
  assert.equal(h.client.view.draft, 'Still here.');
  assert.equal(h.client.canSend(), false);
  assert.equal(h.client.view.connection, 'offline');
});
test('invalid service schema never falls through to samples or enables send', async () => {
  const h = harness();
  await h.ready(snapshot({ schema_version: 99 }));
  h.client.setDraft('Try');
  assert.equal(h.client.view.snapshot, null);
  assert.equal(h.client.view.connection, 'offline');
  assert.equal(h.client.canSend(), false);
});
test('automatic return requests do not take over the composer and carry a draft opt-out', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Keep this thought.');
  h.replies.push(
    response(snapshot({ revision: 'instance:return', return_briefing: { phase: 'idle' } })),
  );
  await h.client.requestReturn('daily', '2026-09-19');
  assert.equal(h.calls.at(-1).path, '/api/return/briefing');
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), {
    request_id: ID,
    reason: 'daily',
    local_day: '2026-09-19',
    draft_present: true,
  });
  assert.equal(h.client.view.draft, 'Keep this thought.');
  const count = h.calls.length;
  await h.client.requestReturn('unsupported', '2026-09-19');
  assert.equal(h.calls.length, count);
});

test('recovery uses saved publication endpoint, never resends a message', async () => {
  const h = harness();
  await h.ready(snapshot({ recovery_pending: true, can_send: false }));
  h.replies.push(response(snapshot({ recovery_pending: false })));
  await h.client.recover();
  assert.equal(h.calls.at(-1).path, '/api/recover');
  assert.equal(h.calls.at(-1).body, '{}');
  assert.equal(h.calls.filter((call) => call.path === '/api/message').length, 0);
});
test('several commitments, corrected progress and breaks remain distinct', () => {
  const tasks = [
    {
      id: 'a',
      title: 'Practice',
      status: 'open',
      target_count: 3,
      completed_count: 1,
      unit: 'problems',
    },
    { id: 'b', title: 'Application', status: 'open', target_count: null, completed_count: 0 },
    {
      id: 'c',
      title: 'Read',
      status: 'completed',
      target_count: 20,
      completed_count: 20,
      unit: 'pages',
    },
  ];
  const state = snapshot({ tasks: { revision: 2, focus_id: 'b', break_active: true, tasks } }),
    value = homeData(state);
  assert.equal(value.open.length, 2);
  assert.equal(value.completed.length, 1);
  assert.equal(value.focus.id, 'b');
  assert.equal(value.onBreak, true);
  assert.equal(progressText(tasks[0]), '1 of 3 problems');
  assert.equal(progressText(tasks[1]), '');
  assert.equal(progressText(tasks[2]), '20 of 20 pages');
  assert.equal('edges' in value, false);
  assert.equal('streak' in value, false);
});
test('unsupported or hidden operational transcript entries never appear', () => {
  assert.deepEqual(
    conversationEntries(
      snapshot({
        messages: [
          { role: 'tool', text: 'internal' },
          { role: 'assistant', text: { bad: 'shape' } },
          { role: 'user', text: 'Hello' },
        ],
      }),
      null,
    ).map((entry) => entry.text),
    ['Hello'],
  );
});

test('direct task controls preserve the conversation draft and exclude concurrent writes', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Keep my unsent message');
  const pending = defer();
  h.replies.push(pending.promise);
  const operation = [{ op: 'delete', task_id: 'goal_one' }];
  const save = h.client.controlTasks(operation, 0, 'one');
  assert.equal(h.client.view.changing, true);
  assert.equal(h.client.canSend(), false);
  assert.equal(h.client.canManage(), false);
  await assert.rejects(h.client.controlTasks(operation, 0, 'one'));
  pending.resolve(
    response(
      snapshot({
        revision: 'instance:2',
        tasks: { revision: 1, tasks: [], focus_id: null, break_active: false },
      }),
    ),
  );
  await save;
  assert.deepEqual(JSON.parse(h.calls[1].body), {
    operations: operation,
    based_on_revision: 0,
    request_id: ID,
    conversation_id: 'one',
  });
  assert.equal(h.client.view.draft, 'Keep my unsent message');
  assert.equal(h.client.view.localPending, null);
  assert.equal(h.calls.filter((call) => call.path === '/api/message').length, 0);
});
test('failed controls retain the draft and throw the conflict to the inline editor', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Unsent');
  h.replies.push(response({ error: 'Goals changed.' }, 409));
  await assert.rejects(
    h.client.controlTasks([{ op: 'delete', task_id: 'one' }], 0, 'one'),
    (error) => error.status === 409,
  );
  assert.equal(h.client.view.draft, 'Unsent');
  assert.equal(h.client.view.changing, false);
  assert.equal(h.client.view.localPending, null);
});
test('activity record controls use their own revision and conversation context', async () => {
  const h = harness();
  await h.ready();
  h.replies.push(response(snapshot()));
  await h.client.controlRecord('trash', 'record_one', 7, 'one');
  assert.equal(h.calls.at(-1).path, '/api/activity/records');
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), {
    action: 'trash',
    session_id: 'record_one',
    based_on_revision: 7,
    request_id: ID,
    conversation_id: 'one',
  });
});

test('first setup can be skipped before sign-in without sending or losing a draft', async () => {
  const store = memory();
  const h = harness(store);
  const initial = snapshot({
    can_send: false,
    account: { state: 'disconnected' },
    onboarding: { status: 'draft', revision: 0 },
    workspace: { active_chat_id: 'first-chat' },
  });
  await h.ready(initial);
  h.client.setDraft('Finish my portfolio before recruiting.');
  h.replies.push(
    response({
      ...initial,
      revision: 'instance:2',
      onboarding: { status: 'skipped', revision: 1 },
    }),
  );
  await h.client.onboardingCommand('skip');
  const post = h.calls.at(-1);
  assert.equal(post.path, '/api/onboarding/commands');
  assert.equal(post.headers['X-Eilo-Client'], 'local-chat');
  assert.deepEqual(JSON.parse(post.body), { action: 'skip', request_id: ID, based_on_revision: 0 });
  assert.equal(h.client.view.draft, 'Finish my portfolio before recruiting.');
  h.client.stop();
  const reopened = harness(store);
  await reopened.ready(initial);
  assert.equal(reopened.client.view.draft, 'Finish my portfolio before recruiting.');
  assert.equal(reopened.calls.filter((call) => call.method === 'POST').length, 0);
});

test('onboarding approval keeps its request identity after an uncertain response', async () => {
  const h = harness();
  const proposed = snapshot({ onboarding: { status: 'proposed', revision: 4 } });
  await h.ready(proposed);
  h.client.setDraft('An unsent correction');
  const delivery = defer();
  h.replies.push(delivery.promise);
  const attempt = h.client.onboardingCommand('accept', 'workspace-approval-123', 4);
  delivery.reject(new TypeError('Connection lost'));
  await assert.rejects(attempt, /could not be confirmed/);
  assert.equal(h.client.view.snapshot.onboarding.status, 'proposed');
  assert.equal(h.client.view.draft, 'An unsent correction');
  h.replies.push(
    response(
      snapshot({
        revision: 'instance:2',
        onboarding: { status: 'complete', revision: 5, acceptance_id: 'workspace-approval-123' },
      }),
    ),
  );
  await h.client.onboardingCommand('accept', 'workspace-approval-123', 4);
  const requests = h.calls.filter((call) => call.method === 'POST');
  assert.equal(requests[0].body, requests[1].body);
  assert.equal(h.client.view.snapshot.onboarding.status, 'complete');
  assert.equal(h.client.view.draft, 'An unsent correction');
});
