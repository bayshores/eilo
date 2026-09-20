import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateQueue } from './update-queue.js';

const checkIn = (id, text = 'Check in', event_id) => ({
  id,
  role: 'assistant',
  origin: 'check_in',
  text,
  ...(event_id ? { event_id } : {}),
});
const stream = (id, text = 'Writing', status = 'writing', extra = {}) => ({
  id,
  text,
  status,
  ...extra,
});
function memory() {
  const values = new Map();
  return {
    loadSeen: (id) => (values.has(id) ? values.get(id) : null),
    saveSeen: (id, seen) => values.set(id, seen),
    values,
  };
}

test('duplicate polls show one active update only', () => {
  const store = memory(),
    queue = createUpdateQueue(store),
    input = { conversationId: 'one', messages: [], stream: stream('s1'), visible: true };
  assert.equal(queue.reconcile(input).active.text, 'Writing');
  assert.equal(queue.reconcile(input).queued.length, 0);
});
test('new direct assistant replies surface after existing history has been seeded', () => {
  const queue = createUpdateQueue(memory());
  const old = { id: 'old', role: 'assistant', text: 'Earlier reply' };
  queue.reconcile({ conversationId: 'one', messages: [old], visible: true });
  assert.equal(queue.snapshot().active, null);
  const next = queue.reconcile({
    conversationId: 'one',
    messages: [old, { id: 'new', role: 'assistant', text: 'New reply' }],
    visible: true,
  });
  assert.deepEqual(next.active, {
    id: 'message:new',
    text: 'New reply',
    status: 'complete',
    kind: 'reply',
  });
});
test('direct replies already seen in open chat do not replay as an overlay later', () => {
  const queue = createUpdateQueue(memory());
  const reply = { id: 'seen-in-chat', role: 'assistant', text: 'Already visible' };
  queue.reconcile({ conversationId: 'one', messages: [], visible: false, suppressReplies: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [reply],
    visible: false,
    suppressReplies: true,
  });
  assert.equal(queue.snapshot().active, null);
  const later = queue.reconcile({ conversationId: 'one', messages: [reply], visible: true });
  assert.equal(later.active, null);
});
test('a reply arriving while the dock is still streaming stays eligible if it closes before settlement', () => {
  const store = memory(),
    queue = createUpdateQueue(store),
    reply = { id: 'streamed-reply', role: 'assistant', text: 'Finished after the dock closed.' };
  queue.reconcile({ conversationId: 'one', messages: [], visible: false, suppressReplies: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [reply],
    visible: false,
    suppressReplies: true,
    deferReplies: true,
  });
  assert.equal(queue.snapshot().active, null);
  assert.deepEqual(queue.snapshot().queued, [
    {
      id: 'message:streamed-reply',
      text: 'Finished after the dock closed.',
      status: 'complete',
      kind: 'reply',
    },
  ]);
  const uncovered = queue.reconcile({
    conversationId: 'one',
    messages: [reply],
    visible: true,
    suppressReplies: false,
  });
  assert.equal(uncovered.active?.id, 'message:streamed-reply');
  assert.equal(uncovered.active?.text, 'Finished after the dock closed.');
  queue.markDisplayed(uncovered.active.id);
  assert.deepEqual(store.values.get('one'), ['message:streamed-reply']);
});

test('only one update is active and dismiss advances once', () => {
  const queue = createUpdateQueue(memory());
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('a'), checkIn('b', 'Second')],
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Check in');
  assert.equal(queue.snapshot().queued.length, 1);
  queue.dismiss();
  assert.equal(queue.snapshot().active.text, 'Second');
  assert.equal(queue.snapshot().queued.length, 0);
});
test('event stream and final native message share one identity', () => {
  const queue = createUpdateQueue(memory());
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [],
    stream: stream('draft', 'Half', 'writing', { event_id: 'e1' }),
    visible: true,
  });
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final', 'e1')],
    stream: stream('draft', 'Final', 'complete', { event_id: 'e1', message_id: 'native' }),
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Final');
  assert.equal(queue.snapshot().queued.length, 0);
  queue.dismiss();
  assert.equal(queue.snapshot().active, null);
});
test('initial native history is seeded instead of replayed, while a live stream resumes', () => {
  const queue = createUpdateQueue(memory());
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('old')],
    stream: stream('live'),
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Writing');
  queue.dismiss();
  assert.equal(queue.snapshot().active, null);
});
test('a saved empty initialization record lets check-ins received while Home was closed arrive after reload', () => {
  const store = memory(),
    first = createUpdateQueue(store);
  first.reconcile({ conversationId: 'one', messages: [], visible: true });
  assert.deepEqual(store.values.get('one'), []);
  const reloaded = createUpdateQueue(store);
  reloaded.reconcile({ conversationId: 'one', messages: [checkIn('while-closed')], visible: true });
  assert.equal(reloaded.snapshot().active.id, 'message:while-closed');
});
test('a displayed writing stream resumes after reload but its completion does not replay', () => {
  const store = memory(),
    first = createUpdateQueue(store),
    draft = stream('draft', 'Still writing', 'writing', { event_id: 'e1' });
  first.reconcile({ conversationId: 'one', messages: [], stream: draft, visible: true });
  first.markDisplayed('event:e1');
  const reloaded = createUpdateQueue(store);
  reloaded.reconcile({ conversationId: 'one', messages: [], stream: draft, visible: true });
  assert.equal(reloaded.snapshot().active.id, 'event:e1');
  reloaded.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Finished', 'e1')],
    stream: stream('draft', 'Finished', 'complete', { event_id: 'e1', message_id: 'native' }),
    visible: true,
  });
  reloaded.dismiss();
  const settled = createUpdateQueue(store);
  settled.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Finished', 'e1')],
    visible: true,
  });
  assert.equal(settled.snapshot().active, null);
});
test('dismissing a writing update suppresses later chunks, final history, and reload while advancing its successor', () => {
  const store = memory(),
    queue = createUpdateQueue(store);
  queue.reconcile({
    conversationId: 'one',
    messages: [],
    stream: stream('draft', 'First', 'writing', { event_id: 'e1' }),
    visible: true,
  });
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('other', 'Second', 'e2')],
    stream: stream('draft', 'First', 'writing', { event_id: 'e1' }),
    visible: true,
  });
  queue.dismiss();
  assert.equal(queue.snapshot().active.text, 'Second');
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final first', 'e1'), checkIn('other', 'Second', 'e2')],
    stream: stream('draft', 'Later chunk', 'writing', { event_id: 'e1', message_id: 'native' }),
    visible: true,
  });
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final first', 'e1'), checkIn('other', 'Second', 'e2')],
    stream: stream('draft', 'Repeated stale chunk', 'writing', {
      event_id: 'e1',
      message_id: 'native',
    }),
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Second');
  assert.equal(queue.snapshot().queued.length, 0);
  const reloaded = createUpdateQueue(store);
  reloaded.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final first', 'e1'), checkIn('other', 'Second', 'e2')],
    visible: true,
  });
  assert.equal(reloaded.snapshot().active.id, 'event:e2');
});
test('hidden arrivals wait for visible markDisplayed acknowledgement', () => {
  const store = memory(),
    queue = createUpdateQueue(store);
  queue.reconcile({ conversationId: 'one', messages: [], visible: false });
  queue.reconcile({ conversationId: 'one', messages: [checkIn('new')], visible: false });
  assert.equal(queue.snapshot().active, null);
  assert.deepEqual(store.values.get('one'), []);
  queue.reconcile({ conversationId: 'one', messages: [checkIn('new')], visible: true });
  assert.equal(queue.snapshot().active.id, 'message:new');
  queue.markDisplayed('message:new');
  assert.deepEqual(store.values.get('one'), ['message:new']);
});
test('conversation switching uses separate seen stores', () => {
  const store = memory(),
    queue = createUpdateQueue(store);
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  queue.reconcile({ conversationId: 'one', messages: [checkIn('a')], visible: true });
  queue.markDisplayed('message:a');
  queue.reconcile({ conversationId: 'two', messages: [checkIn('a')], visible: true });
  assert.equal(queue.snapshot().active, null);
  queue.reconcile({ conversationId: 'one', messages: [checkIn('a')], visible: true });
  assert.equal(queue.snapshot().active, null);
});
test('newly saved seen IDs from another tab remove an unclaimed complete update', () => {
  const store = memory(),
    queue = createUpdateQueue(store);
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  queue.reconcile({ conversationId: 'one', messages: [checkIn('a'), checkIn('b')], visible: true });
  store.values.set('one', ['message:b']);
  queue.reconcile({ conversationId: 'one', messages: [checkIn('a'), checkIn('b')], visible: true });
  assert.equal(queue.snapshot().active.id, 'message:a');
  assert.equal(queue.snapshot().queued.length, 0);
});
test('native final history completes its matching writing item when polling skips the stream final frame', () => {
  const queue = createUpdateQueue(memory());
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [],
    stream: stream('draft', 'Partial', 'writing', { event_id: 'e1' }),
    visible: true,
  });
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final text', 'e1')],
    stream: stream('next', 'Different update', 'writing', { event_id: 'e2' }),
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Final text');
  assert.equal(queue.snapshot().active.status, 'complete');
  queue.reconcile({
    conversationId: 'one',
    messages: [checkIn('native', 'Final text', 'e1')],
    stream: stream('draft', 'Stale partial', 'writing', { event_id: 'e1' }),
    visible: true,
  });
  assert.equal(queue.snapshot().active.text, 'Final text');
  assert.equal(queue.snapshot().active.status, 'complete');
});
test('interrupted stream is removed and cannot replay after reload', () => {
  const store = memory(),
    queue = createUpdateQueue(store);
  queue.reconcile({ conversationId: 'one', messages: [], stream: stream('s1'), visible: true });
  queue.reconcile({
    conversationId: 'one',
    messages: [],
    stream: stream('s1', 'Stopped', 'interrupted'),
    visible: true,
  });
  assert.equal(queue.snapshot().active, null);
  const again = createUpdateQueue(store);
  again.reconcile({
    conversationId: 'one',
    messages: [],
    stream: stream('s1', 'Stopped', 'interrupted'),
    visible: true,
  });
  assert.equal(again.snapshot().active, null);
});
test('queue and seen history are bounded; storage failure is harmless', () => {
  const queue = createUpdateQueue({
    loadSeen: () => {
      throw Error('no storage');
    },
    saveSeen: () => {
      throw Error('no storage');
    },
    queueCap: 2,
    seenCap: 2,
  });
  queue.reconcile({ conversationId: 'one', messages: [], visible: true });
  for (const id of ['a', 'b', 'c', 'd'])
    queue.reconcile({ conversationId: 'one', messages: [checkIn(id)], visible: true });
  assert.equal(queue.snapshot().active.id, 'message:a');
  assert.deepEqual(
    queue.snapshot().queued.map((item) => item.id),
    ['message:c', 'message:d'],
  );
  assert.doesNotThrow(() => queue.dismiss());
});
