const finiteNonnegative = (value) => Number.isFinite(value) && value >= 0;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EPSILON = 0.001;

function canonicalOrigin(value) {
  if (typeof value !== 'string' || value.length > 280) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && value === url.origin ? url : null;
  } catch {
    return null;
  }
}

function online(view) {
  return view?.connection === 'connected';
}

function row(id, name, status, detail, tone) {
  return { id, name, status, detail, tone };
}

function adaptiveRows(snapshot, now = Date.now() / 1000) {
  const adaptive = snapshot?.adaptive;
  if (!adaptive || typeof adaptive !== 'object' || !adaptive.capture_status) return null;
  const policy = adaptive.policy || {};
  const sourceRow = (source, name) => {
    const health = adaptive.capture_status?.[source] || {};
    const enabled = health.enabled === true;
    const fresh =
      health.status === 'sampling' &&
      Number.isFinite(health.last_event_at) &&
      now - health.last_event_at <= 15;
    const detail = policy.ai_enabled === true ? 'Analysis enabled' : '';
    if (!enabled) {
      // An installed native host does not turn off an existing browser lease.
      if (source === 'browser' && snapshot?.accountability?.activity?.state === 'active')
        return browserRow(snapshot);
      if (policy.enabled === false && policy[`${source}_enabled`] === true)
        return row(source, name, 'Paused', detail, 'muted');
      return row(source, name, 'Off', '', 'muted');
    }
    if (fresh) return row(source, name, 'Collecting', detail, 'active');
    if (health.status === 'registration_required')
      return row(source, name, 'Set up Chrome', '', 'attention');
    if (health.status === 'permission_required')
      return row(source, name, 'Permission needed', '', 'attention');
    if (health.status === 'disconnected') return row(source, name, 'Disconnected', '', 'attention');
    if (health.status === 'waiting') return row(source, name, 'Waiting', detail, 'muted');
    if (
      health.status === 'configured' ||
      health.status === 'connected' ||
      health.status === 'ready'
    )
      return row(source, name, 'On device', detail, 'muted');
    return row(
      source,
      name,
      health.status === 'error' ? 'Unavailable' : 'Waiting',
      detail,
      health.status === 'error' ? 'attention' : 'muted',
    );
  };
  return [sourceRow('desktop', 'Desktop'), sourceRow('browser', 'Browser')];
}

function browserRow(snapshot) {
  const activity = snapshot?.accountability?.activity;
  if (!activity || typeof activity !== 'object' || activity.helper_available === false)
    return row('browser', 'Browser', 'Unavailable', '', 'attention');
  const state = activity.state;
  if (state === 'active') {
    if (activity.chrome_available !== true)
      return row('browser', 'Browser', 'Waiting for a page', '', 'muted');
    const active = snapshot?.accountability?.observed_activity?.active_session;
    const url = canonicalOrigin(active?.origin);
    return row('browser', 'Browser', 'Sharing', url?.hostname || '', 'active');
  }
  if (state === 'paused') return row('browser', 'Browser', 'Paused', '', 'muted');
  if (state === 'off') return row('browser', 'Browser', 'Off', '', 'muted');
  return row('browser', 'Browser', 'Unavailable', '', 'attention');
}

function calendarRow(snapshot) {
  const calendar = snapshot?.integrations?.google_calendar;
  const sharing = snapshot?.integrations?.briefing_sources?.calendar;
  if (!calendar || typeof calendar !== 'object')
    return row('calendar', 'Calendar', 'Not connected', '', 'muted');
  if (calendar.state === 'paused') return row('calendar', 'Calendar', 'Paused', '', 'muted');
  if (calendar.state === 'reauth_required')
    return row('calendar', 'Calendar', 'Reconnect', '', 'attention');
  const selected =
    (Array.isArray(calendar.selected_ids) && calendar.selected_ids.length > 0) ||
    (Number.isInteger(sharing?.selected_count) && sharing.selected_count > 0);
  const connected = calendar.state === 'connected' && selected;
  if (connected && sharing?.available === true && sharing.enabled === true)
    return row('calendar', 'Calendar', 'In answers', '', 'active');
  if (connected) return row('calendar', 'Calendar', 'On device', '', 'muted');
  return row('calendar', 'Calendar', 'Not connected', '', 'muted');
}

function gmailRow(snapshot) {
  const accounts = snapshot?.integrations?.briefing_sources?.accounts;
  if (!Array.isArray(accounts)) return row('gmail', 'Gmail', 'Not connected', '', 'muted');
  const valid = accounts.filter((account) => account && typeof account === 'object');
  const ready = valid.filter(
    (account) => account.enabled === true && account.state === 'connected',
  ).length;
  const connected = valid.filter((account) => account.state === 'connected').length;
  const paused = valid.filter((account) => account.state === 'paused').length;
  const reauth = valid.filter((account) => account.state === 'reauth_required').length;
  if (ready) return row('gmail', 'Gmail', 'In answers', `${ready} connected`, 'active');
  if (connected) return row('gmail', 'Gmail', 'Connected', `${connected} connected`, 'muted');
  if (paused) return row('gmail', 'Gmail', 'Paused', `${paused} paused`, 'muted');
  if (reauth) return row('gmail', 'Gmail', 'Reconnect', `${reauth} needs attention`, 'attention');
  return row('gmail', 'Gmail', 'Not connected', '', 'muted');
}

/** A compact, live-only view of the data sources felis may use. */
export function selectTracking(view) {
  const isOnline = online(view);
  if (!isOnline)
    return {
      online: false,
      rows: [
        row('browser', 'Browser', 'Unavailable', '', 'attention'),
        row('calendar', 'Calendar', 'Unavailable', '', 'attention'),
        row('gmail', 'Gmail', 'Unavailable', '', 'attention'),
      ],
    };
  const snapshot = view?.snapshot;
  const native = adaptiveRows(snapshot);
  return {
    online: true,
    rows: [...(native || [browserRow(snapshot)]), calendarRow(snapshot), gmailRow(snapshot)],
  };
}

function validUsage(usage, key = 'origin', validKey = canonicalOrigin) {
  if (
    !usage ||
    usage.timezone !== 'UTC' ||
    usage.scope !== 'retained_sessions' ||
    !finiteNonnegative(usage.total_observed_seconds) ||
    !Array.isArray(usage.days) ||
    usage.days.length !== 7 ||
    !Array.isArray(usage.sites) ||
    usage.sites.length > 10000
  )
    return false;
  const dates = new Set();
  let previousStamp = null;
  let daysTotal = 0;
  for (const day of usage.days) {
    const stamp = Date.parse(`${day?.date}T00:00:00.000Z`);
    if (
      !day ||
      !DATE.test(day.date) ||
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== day.date ||
      !finiteNonnegative(day.observed_seconds) ||
      dates.has(day.date) ||
      (previousStamp !== null && stamp - previousStamp !== 24 * 60 * 60 * 1000)
    )
      return false;
    dates.add(day.date);
    previousStamp = stamp;
    daysTotal += day.observed_seconds;
  }
  let previousSeconds = Infinity;
  let sitesTotal = 0;
  const origins = new Set();
  for (const site of usage.sites) {
    if (
      !site ||
      !validKey(site[key]) ||
      !finiteNonnegative(site.observed_seconds) ||
      site.observed_seconds > previousSeconds ||
      origins.has(site[key])
    )
      return false;
    previousSeconds = site.observed_seconds;
    origins.add(site[key]);
    sitesTotal += site.observed_seconds;
  }
  return (
    Math.abs(daysTotal - usage.total_observed_seconds) <= EPSILON &&
    Math.abs(sitesTotal - usage.total_observed_seconds) <= EPSILON
  );
}

const emptyUsage = (isOnline) => ({
  available: false,
  online: isOnline,
  totalSeconds: 0,
  days: [],
  sites: [],
  hasData: false,
  timezone: 'UTC',
  scope: 'retained_sessions',
});

/**
 * Usage is intentionally accepted only from the aggregate, retained-session
 * contract. It never estimates time from session start/end timestamps.
 */
export function selectBrowserUsage(view) {
  const isOnline = online(view);
  if (!isOnline) return emptyUsage(false);
  const usage = view?.snapshot?.adaptive?.policy?.browser_enabled
    ? view.snapshot.adaptive.usage?.browser
    : view?.snapshot?.accountability?.observed_activity?.usage;
  if (!validUsage(usage)) return emptyUsage(true);
  const days = usage.days.map((day) => ({ date: day.date, seconds: day.observed_seconds }));
  const sites = usage.sites.map((site) => ({
    origin: site.origin,
    host: canonicalOrigin(site.origin).host,
    seconds: site.observed_seconds,
  }));
  return {
    available: true,
    online: true,
    totalSeconds: usage.total_observed_seconds,
    days,
    sites,
    hasData: usage.total_observed_seconds > 0,
    timezone: 'UTC',
    scope: 'retained_sessions',
  };
}

const validAppName = (name) =>
  typeof name === 'string' && name.length > 0 && name.length <= 180 && name.trim() === name;

/** Retained desktop aggregates use the same seven-day contract as browser usage. */
export function selectDesktopUsage(view) {
  const isOnline = online(view);
  if (!isOnline) return { ...emptyUsage(false), apps: [] };
  const usage = view?.snapshot?.adaptive?.policy?.desktop_enabled
    ? view.snapshot.adaptive.usage?.desktop
    : null;
  if (!validUsage(usage, 'app_name', validAppName)) return { ...emptyUsage(true), apps: [] };
  return {
    available: true,
    online: true,
    totalSeconds: usage.total_observed_seconds,
    days: usage.days.map((day) => ({ date: day.date, seconds: day.observed_seconds })),
    apps: usage.sites.map((app) => ({ name: app.app_name, seconds: app.observed_seconds })),
    hasData: usage.total_observed_seconds > 0,
    timezone: 'UTC',
    scope: 'retained_sessions',
  };
}

export function formatRecordedTime(seconds) {
  if (!finiteNonnegative(seconds)) return '0m';
  if (seconds < 60 && seconds > 0) return '<1m';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

/**
 * The visible recording control is derived from the same policy and legacy
 * activity state as the collector. It describes whether a person can pause or
 * resume collection; it never implies that a source is producing useful context.
 */
export function recordingControlState(view) {
  const policy = view?.snapshot?.adaptive?.policy;
  const adaptiveConfigured = Boolean(policy?.desktop_enabled || policy?.browser_enabled);
  const legacyState = view?.snapshot?.accountability?.activity?.state;
  const legacyConfigured = ['active', 'paused'].includes(legacyState);
  const available = view?.connection === 'connected' && (adaptiveConfigured || legacyConfigured);
  const active = available && (policy?.enabled === true || legacyState === 'active');
  return {
    available,
    active,
    label: active ? 'Pause recording' : 'Resume recording',
    status: active ? 'Recording on' : 'Recording paused',
  };
}

/** Status describes observed transport health, never just a saved permission. */
export function recordingSummary(view) {
  const tracking = selectTracking(view);
  if (!tracking.online) return 'Recording status unavailable';
  const policy = view?.snapshot?.adaptive?.policy;
  const legacy = view?.snapshot?.accountability?.activity?.state === 'active';
  const enabledSources = ['desktop', 'browser'].filter(
    (source) => policy?.enabled && policy[source + '_enabled'],
  );
  const rows = tracking.rows.filter(
    (row) => enabledSources.includes(row.id) || (row.id === 'browser' && legacy),
  );
  if (!rows.length)
    return policy && !policy.enabled && (policy.desktop_enabled || policy.browser_enabled)
      ? 'Recording paused'
      : 'Recording off';
  const active = rows.filter((row) => ['Collecting', 'Sharing'].includes(row.status));
  const failed = rows.filter((row) => row.tone === 'attention');
  if (active.length)
    return (
      'Recording: ' +
      active.map((row) => row.name).join(' + ') +
      (failed.length ? ' · Needs attention' : '')
    );
  if (failed.length) return 'Recording needs attention';
  return 'Waiting for activity';
}
