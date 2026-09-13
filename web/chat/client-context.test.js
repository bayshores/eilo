import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeClient } from './client.js';

const requestId = 'context_compress_test_123';
const snapshot = (overrides = {}) => ({
  schema_version: 2,
  revision: 'instance:1',
  conversation_id: 'chat-one',
  status: 'ready',
  can_send: true,
  tasks: { revision: 0, focus_id: null, break_active: false, tasks: [] },
  messages: [],
  accepted_request_ids: [],
  pending_message: null,
  ...overrides,
});
const response = (body, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});
function harness() {
  const calls = [],
    replies = [],
    timers = new Map();
  let timer = 0;
  const client = createHomeClient({
    requestId: () => requestId,
    fetcher: (path, options) => {
      calls.push({ path, ...options });
      const next = replies.shift();
      assert.ok(next, 'Unexpected request');
      return Promise.resolve(next);
    },
    schedule: (callback) => {
      timers.set(++timer, callback);
      return timer;
    },
    unschedule: (id) => timers.delete(id),
  });
  return {
    client,
    calls,
    replies,
    ready: async (state = snapshot()) => {
      replies.push(response(state));
      await client.start();
    },
  };
}

test('compression uses the active conversation revision and keeps the user draft', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Keep this thought.');
  h.replies.push(response(snapshot({ revision: 'instance:2' })));
  await h.client.compressContext();

  const request = h.calls.at(-1);
  assert.equal(request.path, '/api/chat/context');
  assert.deepEqual(JSON.parse(request.body), {
    action: 'compress',
    request_id: requestId,
    conversation_id: 'chat-one',
    based_on_revision: 'instance:1',
  });
  assert.equal(h.client.view.draft, 'Keep this thought.');
  assert.equal(h.calls.filter((call) => call.path === '/api/message').length, 0);
});

test('a failed compression request is not replayed and preserves the draft', async () => {
  const h = harness();
  await h.ready();
  h.client.setDraft('Still mine.');
  h.replies.push(Promise.reject(new TypeError('Network lost')));

  await assert.rejects(h.client.compressContext(), /could not be confirmed/);
  assert.equal(h.client.view.draft, 'Still mine.');
  assert.equal(h.calls.filter((call) => call.path === '/api/chat/context').length, 1);
  assert.equal(h.calls.filter((call) => call.path === '/api/message').length, 0);
});
