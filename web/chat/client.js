import { homeData } from '../home/data.js';

const HEADERS = { 'X-Eilo-Client': 'local-chat' };
const OUTBOX = 'eilo:home:conversation-draft:v1';

const savedEntry = (value) =>
  value && typeof value === 'object' && typeof value.draft === 'string'
    ? {
        draft: value.draft.slice(0, 12000),
        pending:
          value.pending &&
          typeof value.pending.text === 'string' &&
          /^[A-Za-z0-9_-]{12,80}$/.test(value.pending.request_id)
            ? {
                text: value.pending.text.slice(0, 12000),
                request_id: value.pending.request_id,
                status: 'unconfirmed',
              }
            : null,
      }
    : { draft: '', pending: null };

export function createHomeClient({
  fetcher = globalThis.fetch.bind(globalThis),
  storage = null,
  schedule = globalThis.setTimeout,
  unschedule = globalThis.clearTimeout,
  requestId = () => crypto.randomUUID(),
} = {}) {
  let saved = null;
  try {
    saved = JSON.parse(storage?.getItem(OUTBOX) || 'null');
  } catch {
    /* Private browsing can disallow storage. */
  }
  let snapshot = null,
    connection = 'loading',
    error = '',
    sending = false,
    changing = false,
    stopped = false;
  // Version two owns only local composer state. Catalog chat ids, rather than
  // native session ids, are the durable keys: a new chat starts with null and
  // receives its native id only after its first message.
  const outboxes =
    saved?.version === 2 && saved.chats && typeof saved.chats === 'object'
      ? Object.fromEntries(
          Object.entries(saved.chats).map(([key, value]) => [key, savedEntry(value)]),
        )
      : {};
  let legacy = saved?.version === 2 ? null : savedEntry(saved);
  let draft = legacy?.draft || '';
  let localPending = legacy?.pending || null;
  let activeChatId = null;
  let conversationId = typeof saved?.conversationId === 'string' ? saved.conversationId : null;
  let timer,
    controller,
    generation = 0,
    failureDelay = 1000;
  const listeners = new Set();
  let adaptiveQueue = Promise.resolve();
  const view = () => ({ snapshot, connection, error, sending, changing, draft, localPending });
  const emit = () => listeners.forEach((listener) => listener(view()));
  const workspaceChatId = (value) =>
    typeof value?.workspace?.active_chat_id === 'string' ? value.workspace.active_chat_id : null;
  function saveActive() {
    if (activeChatId) outboxes[activeChatId] = { draft, pending: localPending };
  }
  function restoreChat(chatId) {
    const value = outboxes[chatId] || { draft: '', pending: null };
    draft = value.draft;
    localPending = value.pending;
    activeChatId = chatId;
  }
  function persist() {
    try {
      saveActive();
      const chats = Object.fromEntries(
        Object.entries(outboxes).filter(([, value]) => value.draft || value.pending),
      );
      if (activeChatId || Object.keys(outboxes).length) {
        if (!Object.keys(chats).length) storage?.removeItem(OUTBOX);
        else storage?.setItem(OUTBOX, JSON.stringify({ version: 2, chats }));
      } else if (!draft && !localPending) storage?.removeItem(OUTBOX);
      else
        storage?.setItem(OUTBOX, JSON.stringify({ conversationId, draft, pending: localPending }));
    } catch {
      /* The in-page draft remains usable without browser storage. */
    }
  }
  function reconcile(next, chatId = activeChatId) {
    const entry = chatId
      ? outboxes[chatId] || { draft: '', pending: null }
      : { draft, pending: localPending };
    if (
      entry.pending &&
      (next.accepted_request_ids?.includes(entry.pending.request_id) ||
        next.pending_message?.request_id === entry.pending.request_id)
    ) {
      if (entry.draft === entry.pending.text) entry.draft = '';
      entry.pending = null;
    }
    if (chatId) outboxes[chatId] = entry;
    if (chatId === activeChatId || !chatId) {
      draft = entry.draft;
      localPending = entry.pending;
    }
  }
  function accept(next) {
    if (!homeData(next).supported || typeof next.revision !== 'string')
      throw new Error(
        'Home needs an updated local service. Your saved conversation has not been changed.',
      );
    const chatId = workspaceChatId(next);
    if (chatId) {
      if (activeChatId !== chatId) {
        saveActive();
        // A v1 outbox belonged to the sole pre-catalog conversation. Carry it
        // into the first catalog chat only when the native session still fits.
        if (
          legacy &&
          (!conversationId || !next.conversation_id || conversationId === next.conversation_id)
        ) {
          outboxes[chatId] = legacy;
          legacy = null;
        }
        restoreChat(chatId);
      }
      conversationId = next.conversation_id;
      reconcile(next, chatId);
    } else {
      if (activeChatId) {
        saveActive();
        activeChatId = null;
      }
      if (conversationId && conversationId !== next.conversation_id) {
        draft = '';
        localPending = null;
      }
      conversationId = next.conversation_id;
      reconcile(next, null);
    }
    snapshot = next;
    connection = 'connected';
    error = '';
    persist();
    emit();
  }
  async function request(path, { body, signal } = {}) {
    const response = await fetcher(path, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      signal,
      headers: body === undefined ? HEADERS : { ...HEADERS, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) {
      const fault = new Error(value?.error || `Local service returned ${response.status}.`);
      fault.status = response.status;
      throw fault;
    }
    return value;
  }
  function abortPoll() {
    unschedule(timer);
    generation++;
    controller?.abort();
    controller = null;
  }
  function queue(delay = 0, force = false) {
    unschedule(timer);
    if (!stopped) timer = schedule(() => poll(force), delay);
  }
  async function poll(force = false) {
    if (stopped || sending || changing) return;
    const current = ++generation,
      pending = new AbortController();
    controller = pending;
    try {
      const after = !force && snapshot ? `?after=${encodeURIComponent(snapshot.revision)}` : '';
      const next = await request('/api/state' + after, { signal: pending.signal });
      if (current !== generation || stopped) return;
      controller = null;
      accept(next);
      failureDelay = 1000;
      queue();
    } catch (fault) {
      if (current !== generation || stopped || fault.name === 'AbortError') return;
      controller = null;
      connection = 'offline';
      error = fault.message || 'The local service is unavailable.';
      emit();
      queue(failureDelay, true);
      failureDelay = Math.min(15000, failureDelay * 2);
    }
  }
  const canSend = () =>
    connection === 'connected' &&
    homeData(snapshot).supported &&
    snapshot.can_send === true &&
    snapshot.status !== 'busy' &&
    !sending &&
    !changing &&
    localPending?.status !== 'unconfirmed' &&
    draft.trim().length > 0;
  async function mutate(path, body, targetChatId = activeChatId) {
    abortPoll();
    sending = true;
    emit();
    const pending = new AbortController();
    const deadline = schedule(() => pending.abort(), 30000);
    try {
      const next = await request(path, { body, signal: pending.signal });
      if (targetChatId === activeChatId) accept(next);
      else {
        reconcile(next, targetChatId);
        persist();
        emit();
      }
    } catch (fault) {
      const entry = targetChatId ? outboxes[targetChatId] : { draft, pending: localPending };
      if (entry?.pending)
        entry.pending.status = [400, 403, 409, 415, 503].includes(fault.status)
          ? 'rejected'
          : 'unconfirmed';
      if (targetChatId) outboxes[targetChatId] = entry;
      if (targetChatId === activeChatId || !targetChatId) localPending = entry?.pending || null;
      if (targetChatId === activeChatId || !targetChatId) {
        error =
          entry?.pending?.status === 'unconfirmed'
            ? 'Delivery could not be confirmed. Check the conversation before sending again.'
            : fault.message || 'The local service could not accept that request.';
      }
      persist();
      emit();
    } finally {
      unschedule(deadline);
      sending = false;
      emit();
      queue(0, true);
    }
  }
  const canManage = () =>
    connection === 'connected' &&
    homeData(snapshot).supported &&
    snapshot.can_send === true &&
    snapshot.status !== 'busy' &&
    !snapshot.recovery_pending &&
    !sending &&
    !changing &&
    !localPending;
  async function control(path, body) {
    // Setup remains available when the model account needs attention.
    const canSetup =
      path === '/api/onboarding/commands' &&
      connection === 'connected' &&
      !sending &&
      !changing &&
      snapshot?.status !== 'busy' &&
      !snapshot?.recovery_pending;
    if (!canManage() && !canSetup)
      throw new Error('Wait for the current message or connection before changing this item.');
    abortPoll();
    changing = true;
    emit();
    const pending = new AbortController();
    const deadline = schedule(() => pending.abort(), 15000);
    try {
      const next = await request(path, { body, signal: pending.signal });
      accept(next);
      return next;
    } catch (fault) {
      if (!fault.status)
        fault.message =
          'The change could not be confirmed. Check the refreshed list before trying again.';
      throw fault;
    } finally {
      unschedule(deadline);
      changing = false;
      emit();
      queue(0, true);
    }
  }
  return {
    canManage,
    onboardingCommand(action, request = requestId(), revision = snapshot?.onboarding?.revision) {
      return control('/api/onboarding/commands', {
        action,
        request_id: request,
        based_on_revision: revision,
      });
    },
    homeCommand(action, fields = {}, revision) {
      return adaptiveControl('/api/home/commands', action, fields, revision);
    },
    contextCommand(action, fields = {}, revision) {
      return adaptiveControl('/api/context/commands', action, fields, revision);
    },
    controlTasks(
      operations,
      revision = snapshot?.tasks?.revision,
      context = snapshot?.conversation_id,
    ) {
      return control('/api/tasks', {
        operations,
        based_on_revision: revision,
        request_id: requestId(),
        conversation_id: context,
      });
    },
    controlRecord(
      action,
      sessionId,
      revision = snapshot?.accountability?.observed_activity?.revision,
      context = snapshot?.conversation_id,
    ) {
      return control('/api/activity/records', {
        action,
        session_id: sessionId,
        based_on_revision: revision,
        request_id: requestId(),
        conversation_id: context,
      });
    },
    controlCatalog(action, fields = {}) {
      return control('/api/workspace/catalog', {
        action,
        ...fields,
        based_on_revision: snapshot?.workspace?.revision,
      });
    },
    get view() {
      return view();
    },
    canSend,
    subscribe(listener) {
      listeners.add(listener);
      listener(view());
      return () => listeners.delete(listener);
    },
    start() {
      stopped = false;
      abortPoll();
      return poll(true);
    },
    stop() {
      stopped = true;
      abortPoll();
      persist();
    },
    refresh() {
      if (!sending && !changing) {
        abortPoll();
        return poll(true);
      }
    },
    setDraft(text) {
      draft = text.slice(0, 12000);
      if (localPending?.status === 'rejected') localPending = null;
      persist();
      emit();
    },
    send() {
      if (!canSend()) return Promise.resolve(false);
      const chatId = activeChatId;
      localPending = { text: draft, request_id: requestId(), status: 'sending' };
      persist();
      return mutate(
        '/api/message',
        {
          text: localPending.text,
          request_id: localPending.request_id,
          ...(chatId ? { chat_id: chatId } : {}),
        },
        chatId,
      );
    },
    recover() {
      if (
        connection === 'connected' &&
        snapshot?.recovery_pending &&
        snapshot.status !== 'busy' &&
        !sending
      )
        return mutate('/api/recover', {});
    },
    async activityControl(action, clientId) {
      // Activity consent is a separate user action; it never changes the message outbox.
      if (sending || changing)
        throw new Error('Wait until the current change is saved before changing the connection.');
      abortPoll();
      try {
        accept(await request('/api/activity', { body: { action, client_id: clientId } }));
      } finally {
        queue(0, true);
      }
    },
    returnToDraft() {
      if (
        localPending?.status !== 'unconfirmed' ||
        connection !== 'connected' ||
        snapshot?.status === 'busy' ||
        sending
      )
        return;
      draft = localPending.text;
      localPending = null;
      error = '';
      persist();
      emit();
    },
    acceptWorkspace(next) {
      abortPoll();
      accept(next);
      queue();
    },
  };

  function adaptiveControl(path, action, fields, revision) {
    // Presentation/capture revisions are independent of the conversation lane.
    // A permission can be revoked even while a human reply is in progress.
    const pending = adaptiveQueue.then(async () => {
      if (connection !== 'connected' || !snapshot?.adaptive)
        throw new Error('Connect to eïlo to change context settings.');
      abortPoll();
      try {
        const next = await request(path, {
          body: {
            action,
            ...fields,
            request_id: requestId(),
            based_on_revision: revision ?? snapshot.adaptive.revision,
          },
        });
        accept(next);
        return next;
      } finally {
        queue(0, true);
      }
    });
    adaptiveQueue = pending.catch(() => {});
    return pending;
  }
}
