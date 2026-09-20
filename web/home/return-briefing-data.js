import { calendarAgenda, calendarTime } from '../calendar/agenda.js';
import { homeData } from './data.js';

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function localDateLabel(now) {
  return now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

// Due text is primarily the person's wording. Only an exact ISO date earns an overdue claim.
function dueDate(value) {
  const match =
    typeof value === 'string' && value.trim().match(/^(?:due|by)\s+(\d{4})-(\d{2})-(\d{2})$/i);
  const exact =
    match || (typeof value === 'string' && value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/));
  if (!exact) return null;
  const [, year, month, day] = exact;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : null;
}

function calendarData(calendar, now) {
  if (calendar?.state === 'paused')
    return { event: null, eventLabel: '', calendarState: 'Calendar paused' };
  if (calendar?.state === 'reauth_required')
    return { event: null, eventLabel: '', calendarState: 'Reconnect Calendar' };
  if (calendar?.state !== 'connected')
    return { event: null, eventLabel: '', calendarState: 'Connect Calendar' };
  const synced = Date.parse(calendar.last_synced_at);
  if (
    !Number.isFinite(synced) ||
    synced > now.getTime() ||
    now.getTime() - synced >= FIFTEEN_MINUTES
  )
    return { event: null, eventLabel: '', calendarState: 'Refresh Calendar' };
  const event = calendarAgenda(calendar, now)[0] || null;
  return {
    event,
    eventLabel: event
      ? event.all_day
        ? 'Today · All day'
        : `Today · ${calendarTime(event)}–${new Date(event.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : '',
    calendarState: event ? 'Calendar up to date' : 'No more events today',
  };
}

/**
 * Produce a display-only briefing. It never turns vague goal wording into a deadline.
 * @param {{ snapshot?: unknown } | null | undefined} view
 * @param {Date} [now]
 */
export function returnBriefingData(view, now = new Date()) {
  const snapshot = view?.snapshot;
  if (!snapshot || ['draft', 'proposed'].includes(snapshot.onboarding?.status)) return null;
  const goals = homeData(snapshot);
  if (!goals.supported) return null;
  const task = goals.focus || (goals.open.length === 1 ? goals.open[0] : null);
  const due = dueDate(task?.due_text);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let status = goals.onBreak ? 'on-break' : task ? 'current' : 'choose-focus';
  let prompt = goals.onBreak
    ? 'You are on a break. Come back when you are ready to choose what is next.'
    : task
      ? `What is one small next step for ${task.title}?`
      : 'Choose one thing to focus on, and eïlo can help make the first step smaller.';
  if (!goals.onBreak && task && due && due < today) {
    status = 'deadline-passed';
    prompt = `The deadline for “${task.title}” has passed. What would you like to do with it?`;
  } else if (!goals.onBreak && task?.due_text && !due) {
    status = 'deadline-needs-review';
    prompt = `${task.title} still has “${task.due_text}” as its deadline. Is that still current?`;
  }
  return {
    task,
    onBreak: goals.onBreak,
    dateLabel: localDateLabel(now),
    goalLabel:
      status === 'deadline-passed' || status === 'deadline-needs-review' ? 'Needs your update' : '',
    dueLabel: due
      ? `Due ${due.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
      : task?.due_text || '',
    status,
    prompt,
    ...calendarData(snapshot.integrations?.google_calendar, now),
  };
}

/** Return guidance is for a new day only and never interrupts a draft, busy state, break, or onboarding. */
export function shouldOfferReturn({
  day,
  lastDay,
  hasDraft,
  busy,
  onBreak,
  guidance,
  onboarding,
} = {}) {
  return Boolean(
    guidance &&
    typeof day === 'string' &&
    day &&
    day !== lastDay &&
    !hasDraft &&
    !busy &&
    !onBreak &&
    !['draft', 'proposed'].includes(onboarding?.status || onboarding),
  );
}
