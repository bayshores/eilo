// Domain examples are independent of widget layout and never removed with a view.
export const SAMPLE = Object.freeze({
  day: 'Mon, Apr 28',
  agenda: Object.freeze([
    Object.freeze({ time: '3:00 PM', title: 'Study group' }),
    Object.freeze({ time: 'Before 6 PM', title: 'Collect parcel' }),
    Object.freeze({ time: 'Tomorrow', title: 'Assignment due' }),
  ]),
  goal: Object.freeze({
    id: 'internship',
    title: 'Internship search',
    context: 'Preparing your application',
    current: 'Review résumé',
    next: 'Application draft',
  }),
  week: Object.freeze([true, true, true, false, false, false, false]),
  message: 'Want to make room for the assignment outline after practice?',
});

// Used only by the sample Home and isolated visual review, never by live rendering.
const sampleEnd = new Date();
const sampleDays = [420, 1200, 900, 1560, 0, 2100, 1020].map((seconds, index) => {
  const date = new Date(
    Date.UTC(
      sampleEnd.getUTCFullYear(),
      sampleEnd.getUTCMonth(),
      sampleEnd.getUTCDate() - 6 + index,
    ),
  );
  return { date: date.toISOString().slice(0, 10), observed_seconds: seconds };
});
export const SOURCE_WIDGET_SAMPLE = Object.freeze({
  connection: 'connected',
  snapshot: {
    accountability: {
      activity: { state: 'active', helper_available: true, chrome_available: true },
      observed_activity: {
        active_session: { origin: 'https://github.com' },
        usage: {
          timezone: 'UTC',
          scope: 'retained_sessions',
          total_observed_seconds: 7200,
          days: sampleDays,
          sites: [
            { origin: 'https://github.com', observed_seconds: 3600 },
            { origin: 'https://docs.python.org', observed_seconds: 2400 },
            { origin: 'https://figma.com', observed_seconds: 1200 },
          ],
        },
      },
    },
    integrations: {
      google_calendar: { state: 'connected', available: true, selected_ids: ['sample-calendar'] },
      briefing_sources: {
        calendar: { available: true, enabled: false, selected_count: 1 },
        accounts: [{ state: 'connected', enabled: true }],
      },
    },
  },
});
