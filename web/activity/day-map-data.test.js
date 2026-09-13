import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableDays,
  daySegments,
  formatRecordedTime,
  groupLanes,
  normalizeEpisodes,
  packLane,
  projectSegments,
  recordedEpisodeRows,
  visibleTimeWindow,
  visibleLanes,
  windowTicks,
} from './day-map-data.js';

const stamp = (value) => Date.parse(value) / 1000;
const localStamp = (year, month, day, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime() / 1000;

test('splits one seen span across local days without deriving recorded time from the span', () => {
  const start = localStamp(2026, 9, 10, 23, 50);
  const episodes = normalizeEpisodes([
    {
      id: 'crossing',
      title: 'Review notes',
      source_id: 'browser',
      started_at: start,
      ended_at: start + 20 * 60,
      duration_seconds: 73,
    },
  ]);
  assert.deepEqual(availableDays(episodes), ['2026-09-11', '2026-09-10']);
  const first = daySegments(episodes, '2026-09-10')[0];
  const second = daySegments(episodes, '2026-09-11')[0];
  assert.ok(Math.abs(first.width - (100 * (10 * 60)) / 86400) < 1e-9);
  assert.ok(Math.abs(second.width - (100 * (10 * 60)) / 86400) < 1e-9);
  assert.equal(first.recordedSeconds, 73);
  assert.equal(formatRecordedTime(first.recordedSeconds), '1m');
});

test('uses a bounded morning window and preserves a whole-day span', () => {
  const morningStart = localStamp(2026, 9, 11, 8);
  const morning = daySegments(
    normalizeEpisodes([
      {
        id: 'morning',
        source_id: 'browser',
        started_at: morningStart,
        ended_at: morningStart + 60 * 60,
        duration_seconds: 11,
      },
    ]),
    '2026-09-11',
  );
  const window = visibleTimeWindow(morning);
  assert.equal(window.end - window.start, 4 * 60 * 60);
  assert.deepEqual(
    windowTicks(window).map((tick) => tick.label),
    ['07:00', '08:00', '09:00', '10:00', '11:00'],
  );
  const [projected] = projectSegments(morning, window);
  assert.equal(projected.displayLeft, 25);
  assert.equal(projected.displayWidth, 25);
  const wholeDay = visibleTimeWindow([{ startOffset: 0, endOffset: 86400 }]);
  assert.deepEqual(wholeDay, { start: 0, end: 86400 });
});

test('keeps a zero point at the right edge selectable without painting extra time', () => {
  const segment = { id: 'edge', displayLeft: 99.9, displayWidth: 0, left: 99.9, width: 0 };
  const [row] = packLane([segment]);
  const [packed] = row.segments;
  assert.equal(packed.hitWidth, 2.5);
  assert.equal(packed.hitLeft, 97.5);
  assert.equal(packed.displayWidth, 0);
});

test('assigns visible Chrome, Pages, and Figma lanes distinct stable tones', () => {
  const source = ['Chrome', 'Pages', 'Figma'].map((appName, index) => ({
    id: `app-${index}`,
    sourceId: 'desktop',
    appName,
    origin: '',
    startedAt: index,
    displayLeft: index * 10,
    displayWidth: 5,
  }));
  const first = groupLanes(source);
  const second = groupLanes([...source].reverse());
  assert.equal(new Set(first.map((lane) => lane.tone)).size, 3);
  assert.deepEqual(
    first.map((lane) => [lane.id, lane.tone]).sort(),
    second.map((lane) => [lane.id, lane.tone]).sort(),
  );
});

test('separates authoritative browser websites by canonical origin, including ports', () => {
  const at = stamp('2026-09-11T09:00:00Z');
  const episodes = normalizeEpisodes([
    {
      id: 'docs',
      source_id: 'browser',
      app_name: 'Chrome',
      origin: 'https://docs.google.com',
      started_at: at,
      ended_at: at + 60,
      duration_seconds: 5,
    },
    {
      id: 'figma',
      source_id: 'browser',
      app_name: 'Chrome',
      origin: 'https://figma.com',
      started_at: at + 70,
      ended_at: at + 80,
      duration_seconds: 5,
    },
    {
      id: 'github-https',
      source_id: 'browser',
      app_name: 'Chrome',
      origin: 'https://github.com',
      started_at: at + 90,
      ended_at: at + 100,
      duration_seconds: 5,
    },
    {
      id: 'github-port',
      source_id: 'browser',
      app_name: 'Chrome',
      origin: 'https://github.com:8443',
      started_at: at + 110,
      ended_at: at + 120,
      duration_seconds: 5,
    },
    {
      id: 'missing',
      source_id: 'browser',
      app_name: 'Chrome',
      origin: 'not an origin',
      started_at: at + 130,
      ended_at: at + 140,
      duration_seconds: 5,
    },
  ]);
  const lanes = groupLanes(
    episodes.map((episode) => ({ ...episode, displayLeft: 0, displayWidth: 5 })),
  );
  assert.deepEqual(
    new Set(lanes.map((lane) => lane.label)),
    new Set([
      'Website unavailable',
      'docs.google.com',
      'figma.com',
      'github.com',
      'github.com:8443',
    ]),
  );
  assert.equal(episodes.find((episode) => episode.id === 'missing').origin, null);
  assert.notEqual(
    lanes.find((lane) => lane.label === 'github.com').id,
    lanes.find((lane) => lane.label === 'github.com:8443').id,
  );
});

test('requires a literal canonical origin and keeps a reordered selected lane visible', () => {
  const at = stamp('2026-09-11T09:00:00Z');
  const episodes = normalizeEpisodes(
    [
      'https://example.test/path',
      'https://example.test/?q=x',
      'https://example.test/#hash',
      'https://user:pass@example.test',
      'https://example.test/',
    ].map((origin, index) => ({
      id: `invalid-origin-${index}`,
      source_id: 'browser',
      origin,
      started_at: at,
      ended_at: at + 1,
      duration_seconds: 0,
    })),
  );
  assert.ok(episodes.every((episode) => episode.origin === null));
  const lanes = Array.from({ length: 7 }, (_, index) => ({
    id: `lane-${index}`,
    segments: [{ id: `episode-${index}` }],
  }));
  assert.deepEqual(
    visibleLanes(lanes, 'episode-6').map((lane) => lane.id),
    ['lane-0', 'lane-1', 'lane-2', 'lane-3', 'lane-4', 'lane-6'],
  );
});

test('includes bounded intermediate local days and treats a midnight endpoint as exclusive unless it is a point', () => {
  const start = localStamp(2026, 9, 1, 12);
  const midnight = localStamp(2026, 9, 3);
  const [point, span] = normalizeEpisodes([
    {
      id: 'span',
      source_id: 'desktop',
      started_at: start,
      ended_at: midnight,
      duration_seconds: 4,
    },
    {
      id: 'point',
      source_id: 'desktop',
      started_at: midnight,
      ended_at: midnight,
      duration_seconds: 0,
    },
  ]).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(availableDays([span]), ['2026-09-02', '2026-09-01']);
  assert.deepEqual(availableDays([span, point]), ['2026-09-03', '2026-09-02', '2026-09-01']);
  assert.equal(daySegments([span], '2026-09-03').length, 0);
  assert.equal(daySegments([point], '2026-09-03')[0].isPoint, true);
  assert.deepEqual(daySegments([span], '2026-02-30'), []);
  const lengthy = normalizeEpisodes([
    {
      id: 'long',
      source_id: 'desktop',
      started_at: start,
      ended_at: localStamp(2026, 12, 1, 12),
      duration_seconds: 4,
    },
  ]);
  assert.equal(availableDays(lengthy).length, 31);
});

test('keeps zero-length observations as points with a separate hit area', () => {
  const at = localStamp(2026, 9, 11, 12);
  const [episode] = normalizeEpisodes([
    { id: 'point', source_id: 'desktop', started_at: at, ended_at: at, duration_seconds: 0 },
  ]);
  const [segment] = daySegments([episode], '2026-09-11');
  assert.equal(segment.width, 0);
  assert.equal(segment.isPoint, true);
  assert.equal(segment.left, 50);
});

test('rejects malformed identifiers, timestamps, and negative recorded duration', () => {
  const valid = {
    id: 'kept',
    source_id: 'browser',
    started_at: stamp('2026-09-11T08:00:00Z'),
    ended_at: stamp('2026-09-11T09:00:00Z'),
    duration_seconds: 42,
  };
  const episodes = normalizeEpisodes([
    valid,
    { ...valid, id: 'backward', ended_at: valid.started_at - 1 },
    { ...valid, id: '' },
    { ...valid, id: 'space id' },
    { ...valid, id: 'bad-time', started_at: 'nope' },
    { ...valid, id: 'huge-time', started_at: 8.64e12 + 1 },
    { ...valid, id: 'negative-duration', duration_seconds: -42 },
  ]);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].recordedSeconds, 42);
  assert.ok(Math.abs(daySegments(episodes, '2026-09-11')[0].width - 100 / 24) < 1e-9);
});

test('lists modern episodes first-class without duplicating a matching legacy bridge id', () => {
  const at = localStamp(2026, 9, 11, 9);
  const rows = recordedEpisodeRows(
    [
      {
        id: 'modern',
        title: 'Draft',
        source_id: 'desktop',
        started_at: at,
        ended_at: at + 60,
        duration_seconds: 12,
      },
    ],
    [
      { id: 'modern', start: at + 120, observed_seconds: 99 },
      { id: 'legacy', start: at - 60, observed_seconds: 8 },
    ],
  );
  assert.deepEqual(
    rows.map((row) => [row.id, row.kind]),
    [
      ['modern', 'episode'],
      ['legacy', 'legacy'],
    ],
  );
  assert.equal(rows[0].day, '2026-09-11');
});
