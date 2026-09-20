import { selectTracking } from './tracking-data.js';

const sourceDetail = {
  browser: 'Open Permissions to repair browser activity access.',
  calendar: 'Reconnect Calendar before eïlo can use its current calendar cache.',
  desktop: 'Open Permissions to repair desktop activity access.',
  gmail: 'Reconnect Gmail before eïlo can use that account again.',
};

export function consecutiveFailedCheckins(history) {
  let count = 0;
  for (const item of history || []) {
    if (item?.outcome !== 'failed_quiet') break;
    count += 1;
  }
  return count;
}

function sourceIssue(row) {
  return {
    id: row.id,
    title: `${row.name}: ${row.status}`,
    detail: sourceDetail[row.id] || 'Open Permissions to review this connection.',
    action: row.id === 'calendar' ? 'Review Calendar' : 'Open Permissions',
  };
}

function checkinState(view) {
  const state = view?.snapshot?.accountability?.check_ins;
  if (
    view?.connection !== 'connected' ||
    state?.version !== 1 ||
    typeof state.enabled !== 'boolean'
  )
    return { enabled: false, phase: '', history: [] };
  const history = Array.isArray(state.history)
    ? state.history
        .filter(
          (item) =>
            item &&
            Number.isFinite(item.created_at) &&
            item.created_at > 0 &&
            ['delivered', 'quiet', 'stale', 'failed_quiet', 'running'].includes(item.outcome),
        )
        .sort((left, right) => right.created_at - left.created_at)
    : [];
  return { enabled: state.enabled, phase: state.phase, history };
}

export function homeHealth(view) {
  const tracking = selectTracking(view);
  if (!tracking.online) return { items: [], title: '', detail: '' };
  const items = tracking.rows.filter((row) => row.tone === 'attention').map(sourceIssue);
  const checkins = checkinState(view);
  const failed = consecutiveFailedCheckins(checkins.history);
  if (checkins.enabled && failed) {
    items.push({
      id: 'checkins',
      title:
        failed === 1 ? 'A recent check-in could not finish' : 'Recent check-ins could not finish',
      detail: 'No check-in was sent. Review the recorded attempts before changing anything.',
      action: 'Review check-ins',
    });
  } else if (checkins.enabled && checkins.phase === 'unavailable') {
    items.push({
      id: 'checkins',
      title: 'Check-ins need attention',
      detail: 'Reconnect the conversation to restore check-ins.',
      action: 'Review check-ins',
    });
  }
  return {
    items,
    title:
      items.length === 1
        ? items[0].title
        : items.length
          ? `${items.length} things need attention`
          : '',
    detail: items.length === 1 ? items[0].detail : 'Review the items that need attention.',
  };
}
