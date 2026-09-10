import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeClient } from './home-client.js';

const ID = 'request_workspace_123';
const snapshot = (chatId, sessionId = null, overrides = {}) => ({
  schema_version: 2, revision: `state:${chatId}:${sessionId || 'new'}`, conversation_id: sessionId,
  status: 'ready', can_send: true, tasks: { revision: 0, tasks: [] }, messages: [], accepted_request_ids: [], pending_message: null,
  workspace: { revision: 4, active_chat_id: chatId, projects: [], chats: [] }, ...overrides,
});
const response = body => ({ ok: true, json: async () => body });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const memory = () => { const values = new Map(); return { getItem:k => values.get(k) || null, setItem:(k,v) => values.set(k,v), removeItem:k => values.delete(k) }; };
function harness(storage = memory()) {
  const calls = [], replies = [], timers = new Map(); let nextTimer = 0;
  const client = createHomeClient({ storage, requestId: () => ID,
    fetcher: (path, options) => { calls.push({ path, ...options }); return Promise.resolve(replies.shift()); },
    schedule: fn => { timers.set(++nextTimer, fn); return nextTimer; }, unschedule: id => timers.delete(id) });
  return { client, calls, replies, storage, ready: async value => { replies.push(response(value)); await client.start(); } };
}

test('workspace drafts survive chat switches and reload keyed by catalog chat id', async () => {
  const storage = memory(), h = harness(storage);
  await h.ready(snapshot('chat-a'));
  h.client.setDraft('Draft for A');
  h.client.acceptWorkspace(snapshot('chat-b'));
  h.client.setDraft('Draft for B');
  h.client.acceptWorkspace(snapshot('chat-a'));
  assert.equal(h.client.view.draft, 'Draft for A');
  h.client.stop();

  const reloaded = harness(storage);
  await reloaded.ready(snapshot('chat-a', 'native-a'));
  assert.equal(reloaded.client.view.draft, 'Draft for A');
  reloaded.client.acceptWorkspace(snapshot('chat-b', 'native-b'));
  assert.equal(reloaded.client.view.draft, 'Draft for B');
});

test('a first native session id keeps the catalog chat draft and sends its chat id', async () => {
  const h = harness();
  await h.ready(snapshot('chat-first'));
  h.client.setDraft('Keep this through native creation');
  h.client.acceptWorkspace(snapshot('chat-first', 'native-first'));
  assert.equal(h.client.view.draft, 'Keep this through native creation');
  h.replies.push(response(snapshot('chat-first', 'native-first', { accepted_request_ids: [ID] })));
  await h.client.send();
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), { text: 'Keep this through native creation', request_id: ID, chat_id: 'chat-first' });
  assert.equal(h.client.view.draft, '');
});

test('a v1 outbox migrates into its matching first catalog chat and catalog controls use catalog revision', async () => {
  const storage = memory();
  storage.setItem('eilo:home:conversation-draft:v1', JSON.stringify({ conversationId: 'native-old', draft: 'Old draft', pending: null }));
  const h = harness(storage);
  await h.ready(snapshot('chat-old', 'native-old'));
  assert.equal(h.client.view.draft, 'Old draft');
  h.replies.push(response(snapshot('chat-old', 'native-old', { workspace: { revision: 7, active_chat_id: 'chat-old', projects: [], chats: [] } })));
  await h.client.controlCatalog('pin_chat', { chat_id: 'chat-old', pinned: true });
  assert.deepEqual(JSON.parse(h.calls.at(-1).body), { action: 'pin_chat', chat_id: 'chat-old', pinned: true, based_on_revision: 4 });
});

test('a completed send from an earlier chat cannot replace the selected chat', async () => {
  const h = harness();
  await h.ready(snapshot('chat-a'));
  h.client.setDraft('Message for A');
  const pending = deferred(); h.replies.push(pending.promise);
  const sent = h.client.send();
  h.client.acceptWorkspace(snapshot('chat-b'));
  h.client.setDraft('Draft for B');
  pending.resolve(response(snapshot('chat-a', 'native-a', { accepted_request_ids: [ID] })));
  await sent;
  assert.equal(h.client.view.snapshot.workspace.active_chat_id, 'chat-b');
  assert.equal(h.client.view.draft, 'Draft for B');
});
