'use strict';

const MAX_SEEN_KEYS = 256;
const GENERIC_BODY = 'eïlo has a check-in for you.';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function createNotificationPolicy({
  load = () => null,
  save = () => {},
  show = () => {},
  onError = () => {},
} = {}) {
  let enabled = false;
  let seen = [];
  let needsBaseline = true;
  let currentConversationId = null;

  function report(error) {
    try {
      onError(error);
    } catch (_) {
      // Error reporting must not change notification behavior.
    }
  }

  try {
    const persisted = load();
    if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
      enabled = persisted.enabled === true;
      if (Array.isArray(persisted.seen)) {
        seen = persisted.seen.filter((key) => typeof key === 'string' && key.length > 0).slice(-MAX_SEEN_KEYS);
      }
    }
  } catch (error) {
    enabled = false;
    seen = [];
    report(error);
  }

  function persist() {
    try {
      save({ enabled, seen: seen.slice(-MAX_SEEN_KEYS) });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  function markSeen(keys) {
    const existing = new Set(seen);
    for (const key of keys) {
      if (!existing.has(key)) {
        existing.add(key);
        seen.push(key);
      }
    }
    if (seen.length > MAX_SEEN_KEYS) seen = seen.slice(-MAX_SEEN_KEYS);
  }

  function checkInsFrom(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const conversationId = snapshot.conversation_id;
    if (typeof conversationId !== 'string' || !ID_PATTERN.test(conversationId) || !Array.isArray(snapshot.messages)) return null;

    return snapshot.messages.flatMap((message) => {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
      const { id: messageId, event_id: eventId, role, origin, text } = message;
      if (
        typeof messageId !== 'string' || !ID_PATTERN.test(messageId) ||
        typeof eventId !== 'string' || !ID_PATTERN.test(eventId) ||
        role !== 'assistant' || origin !== 'check_in' ||
        typeof text !== 'string' || text.trim() === ''
      ) return [];
      return [{ conversationId, eventId, messageId, key: `${conversationId}\u0000${eventId}` }];
    }).slice(-MAX_SEEN_KEYS);
  }

  function setEnabled(value) {
    enabled = value === true;
    needsBaseline = true;
    persist();
    return status();
  }

  function inspect(snapshot, { foreground = false } = {}) {
    if (!enabled) return status();

    const checkIns = checkInsFrom(snapshot);
    if (checkIns === null) return status();

    const conversationId = snapshot.conversation_id;
    if (needsBaseline || currentConversationId !== conversationId) {
      markSeen(checkIns.map(({ key }) => key));
      needsBaseline = false;
      currentConversationId = conversationId;
      persist();
      return status();
    }

    const known = new Set(seen);
    const fresh = checkIns.filter(({ key }) => !known.has(key));
    if (fresh.length === 0) return status();

    // Persist every fresh key before display: prior check-ins are deliberately
    // absorbed and only the newest can produce a notification this poll.
    markSeen(fresh.map(({ key }) => key));
    if (!persist()) return status();

    if (!foreground) {
      const latest = fresh[fresh.length - 1];
      try {
        show({
          conversationId: latest.conversationId,
          eventId: latest.eventId,
          messageId: latest.messageId,
          body: GENERIC_BODY,
        });
      } catch (error) {
        report(error);
      }
    }
    return status();
  }

  function status() {
    return { enabled, seenCount: seen.length, needsBaseline, currentConversationId };
  }

  return { setEnabled, inspect, status };
}

module.exports = { createNotificationPolicy, GENERIC_BODY, MAX_SEEN_KEYS };
