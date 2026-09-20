// Pure state for one-at-a-time assistant updates. The host owns streaming,
// persistence, visibility events, timers, and every DOM acknowledgement.
const DEFAULT_SEEN_CAP = 200;
const DEFAULT_QUEUE_CAP = 20;
const DISMISSED = 'dismissed:';

const text = (value) => (typeof value === 'string' && value.trim() ? value : null);
const assistantUpdate = (message) =>
  message?.role === 'assistant' && text(message.id) && text(message.text) && !message.display_kind;
const updateKind = (message) => (message?.origin === 'check_in' ? 'check-in' : 'reply');
const update = (stream) =>
  stream &&
  text(stream.id) &&
  text(stream.text) &&
  ['writing', 'complete', 'interrupted'].includes(stream.status);
const messageKey = (message) =>
  message.event_id ? `event:${message.event_id}` : `message:${message.id}`;
const streamKey = (stream) =>
  stream.event_id
    ? `event:${stream.event_id}`
    : stream.message_id
      ? `message:${stream.message_id}`
      : `stream:${stream.id}`;

export function createUpdateQueue({
  loadSeen = () => [],
  saveSeen = () => {},
  seenCap = DEFAULT_SEEN_CAP,
  queueCap = DEFAULT_QUEUE_CAP,
} = {}) {
  let conversationId = null;
  let seen = new Set(),
    dismissed = new Set(),
    aliases = new Map(),
    active = null,
    queued = [];

  // An event is provisional; its native message id is the durable alias once it arrives.
  // Both keys resolve to the same canonical id so polling never displays it twice.
  function resolve(key) {
    let current = key,
      parent = aliases.get(current);
    while (parent && parent !== current) {
      current = parent;
      parent = aliases.get(current);
    }
    if (current !== key) aliases.set(key, current);
    return current;
  }
  function join(...keys) {
    const valid = keys.filter(Boolean).map(resolve);
    const canonical = valid.find((key) => key.startsWith('event:')) || valid[0];
    // Preserve acknowledgement/tombstone state when a draft stream gains its native id.
    if (valid.some((key) => seen.has(key))) seen.add(canonical);
    if (valid.some((key) => dismissed.has(key))) dismissed.add(canonical);
    valid.forEach((key) => {
      if (key !== canonical) {
        seen.delete(key);
        dismissed.delete(key);
      }
    });
    valid.forEach((key) => {
      if (key !== canonical) aliases.set(key, canonical);
    });
    return canonical;
  }
  function stored() {
    try {
      const value = loadSeen(conversationId);
      return Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }
  function persist() {
    try {
      saveSeen(
        conversationId,
        [...seen]
          .slice(-seenCap)
          .concat([...dismissed].slice(-seenCap).map((key) => DISMISSED + key)),
      );
    } catch {
      /* Storage is optional. */
    }
  }
  function mark(key) {
    seen.add(resolve(key));
    while (seen.size > seenCap) seen.delete(seen.values().next().value);
    persist();
  }
  function tombstone(key) {
    const canonical = resolve(key);
    seen.add(canonical);
    dismissed.add(canonical);
    while (dismissed.size > seenCap) dismissed.delete(dismissed.values().next().value);
    persist();
  }
  function forget(key) {
    const canonical = resolve(key);
    if (active?.id === canonical) active = null;
    queued = queued.filter((item) => item.id !== canonical);
  }
  function enqueue(item, { allowSeen = false } = {}) {
    const canonical = join(item.id, ...(item.aliases || []));
    if (
      dismissed.has(canonical) ||
      (!allowSeen && seen.has(canonical)) ||
      active?.id === canonical ||
      queued.some((next) => next.id === canonical)
    )
      return;
    queued.push({
      id: canonical,
      text: item.text,
      status: item.status,
      kind: item.kind || 'reply',
    });
    if (queued.length > queueCap) queued.shift();
  }
  function activate(visible) {
    if (visible && !active) active = queued.shift() || null;
  }
  function switchConversation(nextId, messages, stream) {
    conversationId = nextId;
    aliases = new Map();
    active = null;
    queued = [];
    const saved = stored();
    const firstPresentation = saved === null;
    seen = new Set(
      (saved || []).filter((value) => text(value) && !value.startsWith(DISMISSED)).slice(-seenCap),
    );
    dismissed = new Set(
      (saved || [])
        .filter((value) => text(value) && value.startsWith(DISMISSED))
        .map((value) => value.slice(DISMISSED.length))
        .slice(-seenCap),
    );
    // Mounting an existing conversation must not turn its old replies into alerts.
    if (firstPresentation)
      for (const message of messages) if (assistantUpdate(message)) seen.add(messageKey(message));
    // Persist even an empty marker: null means first presentation, [] means later arrivals matter.
    if (firstPresentation) persist();
    // A live draft is intentionally handled after history seeding so it can resume.
    if (update(stream) && stream.status === 'writing')
      enqueue(
        {
          id: streamKey(stream),
          text: stream.text,
          status: stream.status,
          kind: 'check-in',
          aliases: stream.message_id ? [`message:${stream.message_id}`] : [],
        },
        { allowSeen: true },
      );
    return firstPresentation;
  }
  function synchronizeSeen() {
    const saved = stored();
    if (!saved) return;
    const external = saved
      .filter((value) => text(value) && !value.startsWith(DISMISSED))
      .map(resolve)
      .filter((key) => !seen.has(key));
    if (!external.length) return;
    external.forEach((key) => seen.add(key));
    queued = queued.filter((item) => !external.includes(item.id));
    // A writing item belongs to this visible stream and may continue after another tab records it.
    if (active && active.status !== 'writing' && external.includes(active.id)) active = null;
  }
  function reconcile({
    conversationId: nextConversationId,
    messages = [],
    stream = null,
    visible = false,
    suppressReplies = false,
  } = {}) {
    if (!text(nextConversationId)) return snapshot();
    const safeMessages = Array.isArray(messages) ? messages : [];
    const firstPresentation =
      nextConversationId !== conversationId
        ? switchConversation(nextConversationId, safeMessages, stream)
        : false;
    if (!firstPresentation && nextConversationId === conversationId) synchronizeSeen();

    for (const message of safeMessages) {
      if (!assistantUpdate(message)) continue;
      const key = messageKey(message);
      const canonical = join(key, message.event_id ? `message:${message.id}` : null);
      if (firstPresentation) continue;
      const kind = updateKind(message);
      if (kind === 'reply' && suppressReplies) {
        mark(canonical);
        forget(canonical);
        continue;
      }
      const existing =
        active?.id === canonical ? active : queued.find((item) => item.id === canonical);
      // Polling can skip the stream's complete frame; native history is authoritative.
      if (existing) {
        existing.text = message.text;
        existing.status = 'complete';
        existing.kind = kind;
      } else
        enqueue({
          id: canonical,
          text: message.text,
          status: 'complete',
          kind,
          aliases: [key, `message:${message.id}`],
        });
    }
    if (update(stream)) {
      const key = streamKey(stream);
      const canonical = join(
        key,
        `stream:${stream.id}`,
        stream.message_id ? `message:${stream.message_id}` : null,
      );
      if (stream.status === 'interrupted') {
        mark(canonical);
        forget(canonical);
      } else {
        const existing =
          active?.id === canonical ? active : queued.find((item) => item.id === canonical);
        // A late writing frame must never undo final native conversation history.
        if (existing && !(existing.status === 'complete' && stream.status === 'writing')) {
          existing.text = stream.text;
          existing.status = stream.status;
        } else
          enqueue(
            { id: canonical, text: stream.text, status: stream.status, kind: 'check-in' },
            { allowSeen: stream.status === 'writing' },
          );
      }
    }
    activate(visible);
    return snapshot();
  }
  function markDisplayed(id) {
    if (!active || resolve(id) !== active.id) return snapshot();
    mark(active.id);
    return snapshot();
  }
  function dismiss() {
    if (!active) return snapshot();
    if (active.status === 'writing') tombstone(active.id);
    else mark(active.id);
    active = null;
    activate(true);
    return snapshot();
  }
  function snapshot() {
    const copy = (item) => item && { ...item };
    return { conversationId, active: copy(active), queued: queued.map(copy) };
  }
  return { reconcile, markDisplayed, dismiss, snapshot };
}
