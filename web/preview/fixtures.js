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
