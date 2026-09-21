import { selectBrowserUsage, selectDesktopUsage, selectTracking } from './tracking-data.js';
import { checkinView } from '../activity/checkin-data.js';

export const ANALYTIC_WINDOWS = {
  day: { label: '1D', days: 1 },
  week: { label: '7D', days: 7 },
  month: { label: '31D', days: 31 },
};

function periodFor(days, windowId) {
  const requested = ANALYTIC_WINDOWS[windowId] || ANALYTIC_WINDOWS.week;
  const available = days.length;
  const supported = requested.days <= available;
  const shown = supported ? days.slice(-requested.days) : days;
  return {
    id:
      requested === ANALYTIC_WINDOWS.day
        ? 'day'
        : requested === ANALYTIC_WINDOWS.month
          ? 'month'
          : 'week',
    label: requested.label,
    requestedDays: requested.days,
    supported,
    days: shown,
    // The aggregate contract has a seven-day ranking, not per-day app/site totals.
    hasBreakdown: shown.length === available && available > 0,
  };
}

/** Render only validated, retained aggregates; never infer focus or completion. */
export function homeAttentionLens(view, windowId = 'week') {
  const desktop = selectDesktopUsage(view);
  const browser = selectBrowserUsage(view);
  const source = desktop.hasData ? 'desktop' : 'browser';
  const usage = source === 'desktop' ? desktop : browser;
  const period = periodFor(usage.days, windowId);
  const totalSeconds = period.days.reduce((total, day) => total + day.seconds, 0);
  const peakSeconds = Math.max(1, ...period.days.map((day) => day.seconds));
  const entries = period.hasBreakdown
    ? (source === 'desktop' ? desktop.apps : browser.sites).slice(0, 3).map((entry) => ({
        name: source === 'desktop' ? entry.name : entry.host,
        seconds: entry.seconds,
      }))
    : [];
  return {
    usage,
    source,
    period,
    totalSeconds,
    peakSeconds,
    entries,
    sources: selectTracking(view).rows,
    checkins: checkinView(view),
  };
}
