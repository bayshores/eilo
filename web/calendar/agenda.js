/** @typedef {{ all_day?: boolean, start: string, end: string }} CalendarEvent */
/** @typedef {{ account?: unknown, events?: CalendarEvent[], state?: string }} CalendarSource */
const DISPLAYABLE_STATES = new Set(['connected', 'paused', 'reauth_required', 'choosing']);

// Calendar events are their own read-only source; they never become goal completion.
/** @param {CalendarSource | null | undefined} calendar @param {Date} [now] */
export function calendarAgenda(calendar, now = new Date()) {
  if (
    !calendar?.account ||
    !Array.isArray(calendar.events) ||
    typeof calendar.state !== 'string' ||
    !DISPLAYABLE_STATES.has(calendar.state)
  )
    return [];
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  return calendar.events
    .filter((/** @type {CalendarEvent} */ event) => {
      const start = new Date(event.all_day ? event.start + 'T00:00:00' : event.start);
      const finish = new Date(event.all_day ? event.end + 'T00:00:00' : event.end);
      return start < end && finish > now;
    })
    .sort(
      (/** @type {CalendarEvent} */ a, /** @type {CalendarEvent} */ b) =>
        Number(b.all_day) - Number(a.all_day) || a.start.localeCompare(b.start),
    );
}
/** @param {CalendarEvent} event */
export function calendarTime(event) {
  return event.all_day
    ? 'All day'
    : new Date(event.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
