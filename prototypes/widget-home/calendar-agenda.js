// Calendar events are their own read-only source; they never become goal completion.
export function calendarAgenda(calendar, now = new Date()) {
  if (!calendar?.account || !Array.isArray(calendar.events) || !['connected','paused','reauth_required','choosing'].includes(calendar.state)) return [];
  const end = new Date(now); end.setHours(24,0,0,0);
  return calendar.events.filter(event => {
    const start = new Date(event.all_day ? event.start+'T00:00:00' : event.start);
    const finish = new Date(event.all_day ? event.end+'T00:00:00' : event.end);
    return start < end && finish > now;
  }).sort((a,b) => Number(b.all_day)-Number(a.all_day) || a.start.localeCompare(b.start));
}
export function calendarTime(event) {
  return event.all_day ? 'All day' : new Date(event.start).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
}
