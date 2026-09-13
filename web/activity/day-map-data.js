const DAY_SECONDS = 24 * 60 * 60;
const MAX_TIMESTAMP = Date.parse('9999-12-31T23:59:59.999Z') / 1000;
const MAX_DAYS_PER_EPISODE = 31;
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const MIN_WINDOW_SECONDS = 4 * 60 * 60;
const WINDOW_PADDING_SECONDS = 60 * 60;
// Reuse the formatter across dense maps instead of constructing one for every span.
const timeLabel = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export const isTimestamp = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_TIMESTAMP;

export const dayKey = (stamp) => {
  if (!isTimestamp(stamp)) return null;
  const date = new Date(stamp * 1000);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
};

export function parseDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  const [year, month, date] = day.split('-').map(Number);
  const local = new Date(year, month - 1, date);
  if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== date)
    return null;
  return local.getTime() / 1000;
}

const nextDay = (stamp) => {
  const date = new Date(stamp * 1000);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() / 1000;
};

export function canonicalOrigin(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 280) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || value !== url.origin) return null;
    return value;
  } catch {
    return null;
  }
}

export const websiteLabel = (origin) => {
  if (!origin) return 'Website unavailable';
  const url = new URL(origin);
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
};

export function formatRecordedTime(seconds) {
  if (!(typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)) return '—';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const minutes = Math.floor(rounded / 60);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
}

export function formatSeenRange(startedAt, endedAt) {
  if (!isTimestamp(startedAt) || !isTimestamp(endedAt) || endedAt < startedAt) return 'Unavailable';
  const start = timeLabel.format(new Date(startedAt * 1000));
  const end = timeLabel.format(new Date(endedAt * 1000));
  return start === end ? start : start + '  – ' + end;
}

/** Validate only fields the map can truthfully display; retained time stays independent. */
export function normalizeEpisodes(episodes) {
  if (!Array.isArray(episodes)) return [];
  const seen = new Set();
  return episodes
    .filter((episode) => {
      if (
        !episode ||
        typeof episode.id !== 'string' ||
        !SAFE_ID.test(episode.id) ||
        seen.has(episode.id)
      )
        return false;
      if (!isTimestamp(episode.started_at) || !isTimestamp(episode.ended_at)) return false;
      if (episode.ended_at < episode.started_at) return false;
      if (!(
        typeof episode.duration_seconds === 'number' &&
        Number.isFinite(episode.duration_seconds) &&
        episode.duration_seconds >= 0
      ))
        return false;
      seen.add(episode.id);
      return true;
    })
    .map((episode) => ({
      id: episode.id,
      title:
        typeof episode.title === 'string' && episode.title.trim()
          ? episode.title.trim()
          : 'Recorded session',
      sourceId:
        typeof episode.source_id === 'string' && episode.source_id.trim()
          ? episode.source_id.trim()
          : 'Unknown source',
      appName: typeof episode.app_name === 'string' ? episode.app_name.trim() : '',
      origin: canonicalOrigin(episode.origin),
      startedAt: episode.started_at,
      endedAt: episode.ended_at,
      recordedSeconds: episode.duration_seconds,
    }))
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
    .slice(0, 50);
}

/** A shared, local-day ordered projection for the Activity list and its map. */
export function recordedEpisodeRows(episodes, legacySessions = []) {
  const modern = normalizeEpisodes(episodes);
  const modernIds = new Set(modern.map((episode) => episode.id));
  const legacy = Array.isArray(legacySessions)
    ? legacySessions.filter(
        (session) =>
          session &&
          typeof session.id === 'string' &&
          !modernIds.has(session.id) &&
          isTimestamp(session.start) &&
          typeof session.observed_seconds === 'number' &&
          Number.isFinite(session.observed_seconds) &&
          session.observed_seconds >= 0,
      )
    : [];
  return [
    ...modern.map((episode) => ({ kind: 'episode', ...episode, stamp: episode.startedAt })),
    ...legacy.map((session) => ({ kind: 'legacy', ...session, stamp: session.start })),
  ]
    .sort((left, right) => right.stamp - left.stamp || left.id.localeCompare(right.id))
    .map((item) => ({ ...item, day: dayKey(item.stamp) }));
}

export function availableDays(episodes) {
  const days = new Set();
  for (const episode of episodes) {
    const first = dayKey(episode.startedAt);
    if (!first) continue;
    const point = episode.startedAt === episode.endedAt;
    const lastStamp = point ? episode.endedAt : episode.endedAt - 0.001;
    const last = dayKey(lastStamp);
    if (!last) continue;
    let cursor = parseDay(first);
    const stop = parseDay(last);
    for (
      let count = 0;
      cursor !== null && stop !== null && cursor <= stop && count < MAX_DAYS_PER_EPISODE;
      count++
    ) {
      days.add(dayKey(cursor));
      cursor = nextDay(cursor);
    }
  }
  return [...days].sort().reverse();
}

/** Portions shown on one local day. The width describes a seen span, never recorded time. */
export function daySegments(episodes, day) {
  const start = parseDay(day);
  if (start === null) return [];
  const end = nextDay(start);
  const span = end - start;
  return episodes
    .filter((episode) =>
      episode.startedAt === episode.endedAt
        ? episode.startedAt >= start && episode.startedAt < end
        : episode.endedAt > start && episode.startedAt < end,
    )
    .map((episode) => {
      const clippedStart = Math.max(start, episode.startedAt);
      const clippedEnd = Math.min(end, episode.endedAt);
      const left = ((clippedStart - start) / span) * 100;
      const width = ((clippedEnd - clippedStart) / span) * 100;
      return {
        ...episode,
        startOffset: clippedStart - start,
        endOffset: clippedEnd - start,
        left: Math.max(0, Math.min(100, left)),
        width: Math.max(0, Math.min(100 - left, width)),
        isPoint: clippedEnd === clippedStart,
      };
    });
}

/** A compact UTC frame around the day's seen spans; it never changes recorded duration. */
export function visibleTimeWindow(segments) {
  if (!segments.length) return { start: 0, end: DAY_SECONDS };
  const earliest = Math.min(...segments.map((segment) => segment.startOffset));
  const latest = Math.max(...segments.map((segment) => segment.endOffset));
  let start = Math.max(0, Math.floor(earliest / 3600) * 3600 - WINDOW_PADDING_SECONDS);
  let end = Math.min(DAY_SECONDS, Math.ceil(latest / 3600) * 3600 + WINDOW_PADDING_SECONDS);
  if (end - start < MIN_WINDOW_SECONDS) {
    end = Math.min(DAY_SECONDS, start + MIN_WINDOW_SECONDS);
    start = Math.max(0, end - MIN_WINDOW_SECONDS);
  }
  return { start, end };
}

export function projectSegments(segments, window) {
  const duration = window?.end - window?.start;
  if (!(Number.isFinite(duration) && duration > 0)) return [];
  return segments.map((segment) => ({
    ...segment,
    displayLeft: ((segment.startOffset - window.start) / duration) * 100,
    displayWidth: ((segment.endOffset - segment.startOffset) / duration) * 100,
  }));
}

export function windowTicks(window) {
  const duration = window?.end - window?.start;
  if (!(Number.isFinite(duration) && duration > 0)) return [];
  const values = new Set([window.start, window.end]);
  const step = duration > 12 * 3600 ? 3 * 3600 : duration > 8 * 3600 ? 2 * 3600 : 3600;
  for (let tick = Math.ceil(window.start / step) * step; tick < window.end; tick += step)
    values.add(tick);
  return [...values]
    .sort((a, b) => a - b)
    .map((offset) => ({
      offset,
      left: ((offset - window.start) / duration) * 100,
      label: `${String(Math.floor(offset / 3600)).padStart(2, '0')}:${String(
        Math.floor((offset % 3600) / 60),
      ).padStart(2, '0')}`,
    }));
}

export function laneKey(episode) {
  if (episode.sourceId === 'browser') return `browser\u0000${episode.origin || 'unavailable'}`;
  return `${episode.sourceId}\u0000${episode.appName || episode.sourceId}`;
}

export function groupLanes(segments) {
  const lanes = new Map();
  for (const segment of segments) {
    const key = laneKey(segment);
    const lane = lanes.get(key) || {
      id: key,
      label:
        segment.sourceId === 'browser'
          ? websiteLabel(segment.origin)
          : segment.appName || segment.sourceId,
      source: segment.sourceId,
      segments: [],
    };
    lane.segments.push(segment);
    lanes.set(key, lane);
  }
  const sourceLabel = (source) =>
    source === 'browser' ? 'Browser' : source === 'desktop' ? 'Mac app' : source;
  const output = [...lanes.values()]
    .map((lane) => ({
      ...lane,
      label:
        lane.source === 'browser'
          ? lane.label
          : lane.label === lane.source
            ? sourceLabel(lane.source)
            : lane.label.charAt(0).toUpperCase() + lane.label.slice(1),
      source: sourceLabel(lane.source),
      segments: lane.segments.sort((a, b) => a.startedAt - b.startedAt),
    }))
    .sort((a, b) => b.segments.length - a.segments.length || a.label.localeCompare(b.label));
  const occupied = new Set();
  for (const lane of [...output].sort((a, b) => a.id.localeCompare(b.id))) {
    let tone = [...lane.id].reduce((value, char) => (value * 31 + char.charCodeAt(0)) % 4, 0);
    while (occupied.has(tone) && occupied.size < 4) tone = (tone + 1) % 4;
    lane.tone = tone;
    occupied.add(tone);
  }
  return output;
}

/** Keep a selected or focused session reachable when changing data reorders source lanes. */
export function visibleLanes(lanes, episodeId, limit = 6) {
  if (lanes.length <= limit || !episodeId) return lanes.slice(0, limit);
  const selectedLane = lanes.find((lane) =>
    lane.segments.some((segment) => segment.id === episodeId),
  );
  if (!selectedLane || lanes.indexOf(selectedLane) < limit) return lanes.slice(0, limit);
  return [...lanes.slice(0, Math.max(0, limit - 1)), selectedLane];
}

/** Assign overlap rows so controls retain a usable hit area instead of covering one another. */
export function packLane(segments) {
  const rows = [];
  for (const segment of [...segments].sort(
    (a, b) => a.displayLeft - b.displayLeft || a.displayWidth - b.displayWidth,
  )) {
    const hitWidth = Math.min(100, Math.max(segment.displayWidth, 2.5));
    const hitLeft = Math.max(0, Math.min(segment.displayLeft, 100 - hitWidth));
    let index = rows.findIndex((row) => row.end <= hitLeft);
    if (index === -1) {
      index = rows.length;
      rows.push({ end: 0, segments: [] });
    }
    rows[index].end = hitLeft + hitWidth;
    rows[index].segments.push({ ...segment, hitLeft, hitWidth, row: index });
  }
  return rows;
}
