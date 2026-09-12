import { browserSetupState, desktopSetupState } from '../activity/setup-state.js';
import { checkinView } from '../activity/checkin-data.js';

const SOURCES = new Set(['browser', 'desktop', 'calendar']);

const adaptive = (view) => view?.snapshot?.adaptive;
const policy = (view) => adaptive(view)?.policy || {};

export function browserReady(view) {
  const health = adaptive(view)?.capture_status?.browser || {};
  const currentPolicy = policy(view);
  return (
    browserSetupState({
      online: view?.connection === 'connected',
      current: adaptive(view),
      extension: null,
    }).id === 'connected' &&
    health.connected === true &&
    health.setup_verified === true &&
    health.grant_verified === true &&
    currentPolicy.enabled === true &&
    currentPolicy.browser_enabled === true
  );
}

export function desktopReady(view) {
  return (
    desktopSetupState(adaptive(view), { text: false }).id === 'connected' &&
    view?.connection === 'connected' &&
    policy(view).enabled === true &&
    policy(view).desktop_enabled === true
  );
}

export function calendarReady(view) {
  const calendar = view?.snapshot?.integrations?.google_calendar;
  return (
    view?.connection === 'connected' &&
    calendar?.state === 'connected' &&
    Array.isArray(calendar.selected_ids) &&
    calendar.selected_ids.length > 0
  );
}

export function calendarSharingReady(view) {
  const calendar = view?.snapshot?.integrations?.briefing_sources?.calendar;
  return (
    view?.connection === 'connected' &&
    calendarReady(view) &&
    calendar?.available === true &&
    calendar?.enabled === true &&
    Number.isInteger(calendar?.selected_count) &&
    calendar.selected_count > 0
  );
}

export const sourceReady = (view, source) =>
  source === 'browser'
    ? browserReady(view)
    : source === 'desktop'
      ? desktopReady(view)
      : source === 'calendar'
        ? calendarReady(view)
        : false;

export function supportState(view, source = null) {
  const currentAdaptive = adaptive(view);
  const checkins = checkinView(view);
  return {
    source: SOURCES.has(source) ? source : null,
    sourceReady: sourceReady(view, source),
    browser: browserSetupState({
      online: view?.connection === 'connected',
      current: currentAdaptive,
      extension: null,
    }),
    desktop: desktopSetupState(currentAdaptive, { text: false }),
    calendarReady: calendarReady(view),
    calendarSharingReady: calendarSharingReady(view),
    sharingReady:
      source === 'calendar' ? calendarSharingReady(view) : policy(view).ai_enabled === true,
    checkinsReady: checkins.supported && checkins.enabled,
  };
}
