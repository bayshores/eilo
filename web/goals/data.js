import { homeData } from '../home/data.js';

const FILTERS = new Set(['open', 'completed', 'all', 'deleted']);
function browserOrigin(value) {
  if (typeof value !== 'string' || value.length > 280) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && value === url.origin;
  } catch {
    return false;
  }
}
const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0;

export function selectGoals(snapshot, { filter = 'open', query = '', selectedId = null } = {}) {
  const data = homeData(snapshot);
  if (!data.supported)
    return {
      supported: false,
      items: [],
      selected: null,
      counts: { open: 0, completed: 0, cancelled: 0, all: 0, deleted: 0 },
      onBreak: false,
    };
  const activeFilter = FILTERS.has(filter) ? filter : 'open';
  const needle = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
  const counts = {
    open: data.tasks.filter((task) => task.status === 'open').length,
    completed: data.tasks.filter((task) => task.status === 'completed').length,
    cancelled: data.tasks.filter((task) => task.status === 'cancelled').length,
    all: data.tasks.length,
    deleted: data.trash.length,
  };
  const matches = (task) =>
    !needle ||
    [task.title, task.due_text, task.due_on].some(
      (value) => typeof value === 'string' && value.toLocaleLowerCase().includes(needle),
    );
  const items = (activeFilter === 'deleted' ? data.trash : data.tasks)
    .filter((task) => (activeFilter === 'all' || task.status === activeFilter) && matches(task))
    .sort(
      (left, right) => Number(right.id === data.focus?.id) - Number(left.id === data.focus?.id),
    );
  const selected = items.find((task) => task.id === selectedId) || items[0] || null;
  return { supported: true, items, selected, counts, onBreak: data.onBreak };
}

export function observedSessions(snapshot, { trash = false } = {}) {
  const sessions =
    snapshot?.accountability?.observed_activity?.[trash ? 'trash_sessions' : 'recent_sessions'];
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter(
      (session) =>
        session &&
        browserOrigin(session.origin) &&
        finiteNonnegative(session.start) &&
        finiteNonnegative(session.last_seen) &&
        session.last_seen >= session.start &&
        finiteNonnegative(session.observed_seconds) &&
        session.observed_seconds <= session.last_seen - session.start + 0.001,
    )
    .slice()
    .sort((left, right) => right.last_seen - left.last_seen);
}

export function relatedSessions(snapshot, taskId) {
  if (typeof taskId !== 'string' || !Object.hasOwn(snapshot?.tasks || {}, 'revision')) return [];
  return observedSessions(snapshot).filter(
    (session) =>
      Array.isArray(session.related_task_ids) &&
      session.related_task_ids.includes(taskId) &&
      session.related_task_revision === snapshot.tasks.revision,
  );
}

export function deliveredCheckIns(snapshot) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
  return messages
    .slice()
    .reverse()
    .filter(
      (message) =>
        message?.role === 'assistant' &&
        message?.origin === 'check_in' &&
        typeof message.id === 'string' &&
        message.id &&
        typeof message.text === 'string' &&
        message.text,
    );
}
