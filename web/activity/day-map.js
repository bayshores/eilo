import {
  availableDays,
  daySegments,
  formatRecordedTime,
  formatSeenRange,
  groupLanes,
  normalizeEpisodes,
  packLane,
  projectSegments,
  visibleTimeWindow,
  visibleLanes,
  websiteLabel,
  windowTicks,
} from './day-map-data.js';

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const makeButton = (label, className) => {
  const element = make('button', className, label);
  element.type = 'button';
  return element;
};
const dayLabel = new Intl.DateTimeFormat(undefined, {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const dateLabel = (day) => dayLabel.format(new Date(`${day}T00:00:00Z`));

/**
 * A small presentation-only map of admitted episodes. It deliberately draws seen spans
 * separately from the ledger's recorded duration so gaps do not become invented usage.
 */
export function createActivityDayMap(
  host,
  { onForget = () => {}, onManageSources = () => {}, reducedMotion = () => false } = {},
) {
  let current = null;
  let episodes = [];
  let days = [];
  let selectedDay = null;
  let selectedId = null;
  let confirmingId = null;
  let showAll = false;
  let signature = '';

  host.classList.add('activity-day-map');
  host.setAttribute('aria-label', 'Recorded activity day map');
  const header = make('header', 'activity-day-map__header');
  const heading = make('div');
  const statusNote = make('p', '', 'Session spans · gaps may be unrecorded');
  heading.append(make('h2', '', 'Recorded activity'), statusNote);
  const manage = makeButton('Manage sources', 'text-button activity-day-map__manage');
  manage.addEventListener('click', () => onManageSources());
  header.append(heading, manage);
  const chooser = make('div', 'activity-day-map__chooser');
  chooser.setAttribute('aria-label', 'Recorded day');
  chooser.append(make('span', 'activity-day-map__timezone', 'UTC'));
  const chips = make('div', 'activity-day-map__chips');
  const select = make('select', 'activity-day-map__select');
  select.dataset.focusKey = 'day-select';
  select.setAttribute('aria-label', 'Choose a recorded day in UTC');
  select.addEventListener('change', () => {
    selectedDay = select.value;
    selectedId = null;
    confirmingId = null;
    showAll = false;
    render();
  });
  chooser.append(chips, select);
  const map = make('section', 'activity-day-map__surface');
  map.setAttribute('aria-label', 'Seen activity spans');
  const details = make('section', 'activity-day-map__details');
  details.setAttribute('aria-live', 'polite');
  host.append(header, chooser, map, details);

  function selectEpisode(id) {
    selectedId = selectedId === id ? null : id;
    confirmingId = null;
    render();
  }
  function drawAxis(target, window, quiet = false) {
    const axis = make('div', `activity-day-map__axis${quiet ? ' is-quiet' : ''}`);
    const ticks = windowTicks(window);
    for (const [index, tick] of ticks.entries()) {
      const label = make(
        'span',
        `activity-day-map__axis-label${index === 0 ? ' is-first' : index === ticks.length - 1 ? ' is-last' : ''}`,
        tick.label,
      );
      label.style.left = `${tick.left}%`;
      axis.append(label);
    }
    target.append(axis);
  }
  function drawMap(focusedId = null) {
    map.replaceChildren();
    const segments = daySegments(episodes, selectedDay);
    if (!segments.length) {
      const empty = make('div', 'activity-day-map__empty');
      empty.append(make('p', '', emptyCopy()), make('div', 'activity-day-map__empty-axis'));
      drawAxis(empty, { start: 0, end: 86400 }, true);
      map.append(empty);
      return;
    }
    const window = visibleTimeWindow(segments);
    drawAxis(map, window);
    const lanes = groupLanes(projectSegments(segments, window));
    const visible = showAll ? lanes : visibleLanes(lanes, selectedId || focusedId);
    const tracks = make('div', 'activity-day-map__tracks');
    for (const lane of visible) {
      const laneElement = make('section', 'activity-day-map__lane');
      laneElement.dataset.tone = String(lane.tone);
      const label = make('div', 'activity-day-map__lane-label');
      label.append(make('strong', '', lane.label), make('span', '', lane.source));
      const rowArea = make('div', 'activity-day-map__lane-rows');
      const rows = packLane(lane.segments);
      for (const row of rows) {
        const rowElement = make('div', 'activity-day-map__lane-row');
        for (const segment of row.segments) {
          const session = makeButton(segment.title, 'activity-day-map__session');
          session.dataset.episodeId = segment.id;
          session.dataset.focusKey = `episode:${segment.id}`;
          session.dataset.selected = String(segment.id === selectedId);
          session.style.left = `${segment.hitLeft}%`;
          session.style.width = `${segment.hitWidth}%`;
          session.setAttribute(
            'aria-label',
            `${segment.title}. ${formatSeenRange(segment.startedAt, segment.endedAt)}. Recorded ${formatRecordedTime(segment.recordedSeconds)}.`,
          );
          session.setAttribute('aria-pressed', String(segment.id === selectedId));
          session.title = `${segment.title} · ${formatSeenRange(segment.startedAt, segment.endedAt)}`;
          session.addEventListener('click', () => selectEpisode(segment.id));
          const mark = make(
            'span',
            segment.isPoint ? 'activity-day-map__point' : 'activity-day-map__span',
          );
          mark.style.left = `${((segment.displayLeft - segment.hitLeft) / segment.hitWidth) * 100}%`;
          if (!segment.isPoint)
            mark.style.width = `${(segment.displayWidth / segment.hitWidth) * 100}%`;
          mark.setAttribute('aria-hidden', 'true');
          if (!segment.isPoint && segment.displayWidth >= 12) {
            const title = make('span', 'activity-day-map__session-title', segment.title);
            title.setAttribute('aria-hidden', 'true');
            mark.append(title);
          }
          session.append(mark);
          rowElement.append(session);
        }
        rowArea.append(rowElement);
      }
      laneElement.append(label, rowArea);
      tracks.append(laneElement);
    }
    map.append(tracks);
    if (lanes.length > 6) {
      const more = makeButton(
        showAll ? 'Show fewer sources' : `Show ${lanes.length - 6} more sources`,
        'text-button activity-day-map__more',
      );
      more.dataset.focusKey = 'more';
      more.addEventListener('click', () => {
        showAll = !showAll;
        render();
      });
      map.append(more);
    }
  }
  function emptyCopy() {
    if (current?.connection === 'offline')
      return 'Activity status is offline. No saved sessions are available for this day.';
    if (current?.connection === 'loading') return 'Waiting for recorded activity.';
    return 'No recorded activity for this day yet.';
  }
  function drawDetails() {
    details.replaceChildren();
    const selected = episodes.find((episode) => episode.id === selectedId);
    if (!selected) {
      details.hidden = true;
      return;
    }
    details.hidden = false;
    details.append(make('p', 'activity-day-map__detail-label', 'Selected session'));
    const copy = make('div', 'activity-day-map__detail-copy');
    copy.append(make('h3', '', selected.title));
    const facts = make('dl', 'activity-day-map__facts');
    const sourceFacts =
      selected.sourceId === 'browser'
        ? [
            ['Website', websiteLabel(selected.origin)],
            ['App', selected.appName || 'Browser'],
          ]
        : [
            [
              'Source',
              selected.appName || (selected.sourceId === 'desktop' ? 'Mac app' : selected.sourceId),
            ],
          ];
    for (const [label, value] of [
      ...sourceFacts,
      ['Seen', formatSeenRange(selected.startedAt, selected.endedAt)],
      ['Recorded time', formatRecordedTime(selected.recordedSeconds)],
    ]) {
      const fact = make('div');
      fact.append(make('dt', '', label), make('dd', '', value));
      facts.append(fact);
    }
    const context = current?.snapshot?.adaptive?.current_work_context;
    if (
      context?.episode_ids?.includes(selected.id) &&
      typeof context.return_point === 'string' &&
      context.return_point.trim()
    ) {
      const returnPoint = make('p', 'activity-day-map__return-point');
      returnPoint.append(
        make('span', '', 'Return point'),
        document.createTextNode(context.return_point.trim()),
      );
      copy.append(returnPoint);
    }
    copy.append(facts);
    const forget = makeButton(
      confirmingId === selected.id ? 'Confirm forget' : 'Forget',
      confirmingId === selected.id
        ? 'button activity-day-map__forget-confirm'
        : 'text-button activity-day-map__forget',
    );
    forget.dataset.focusKey = 'forget';
    forget.addEventListener('click', () => {
      if (confirmingId !== selected.id) {
        confirmingId = selected.id;
        render();
        return;
      }
      confirmingId = null;
      onForget(selected.id);
    });
    if (confirmingId === selected.id)
      copy.append(
        make('p', 'activity-day-map__forget-copy', 'This removes this recorded context.'),
      );
    details.append(copy, forget);
  }
  function drawChooser() {
    chips.replaceChildren();
    select.replaceChildren();
    const chipDays = days.slice(0, 4);
    for (const day of days) {
      const option = make('option', '', dateLabel(day));
      option.value = day;
      option.selected = day === selectedDay;
      select.append(option);
    }
    select.hidden = days.length <= chipDays.length;
    for (const day of chipDays) {
      const chip = makeButton(dateLabel(day), 'activity-day-map__day');
      chip.dataset.focusKey = `day:${day}`;
      chip.dataset.selected = String(day === selectedDay);
      chip.setAttribute('aria-pressed', String(day === selectedDay));
      chip.addEventListener('click', () => {
        selectedDay = day;
        selectedId = null;
        confirmingId = null;
        showAll = false;
        render();
      });
      chips.append(chip);
    }
    chooser.hidden = !days.length;
  }
  function render() {
    const focusKey = document.activeElement?.closest?.('[data-focus-key]')?.dataset.focusKey;
    drawChooser();
    drawMap(focusKey?.startsWith('episode:') ? focusKey.slice('episode:'.length) : null);
    drawDetails();
    host.classList.toggle('reduce-motion', Boolean(reducedMotion()));
    if (focusKey)
      [...host.querySelectorAll('[data-focus-key]')]
        .find((element) => element.dataset.focusKey === focusKey)
        ?.focus({ preventScroll: true });
  }
  function update(view) {
    host.classList.toggle('reduce-motion', Boolean(reducedMotion()));
    const nextEpisodes = normalizeEpisodes(view?.snapshot?.adaptive?.episodes);
    const nextDays = availableDays(nextEpisodes);
    const context = view?.snapshot?.adaptive?.current_work_context;
    const nextSignature = JSON.stringify([
      view?.connection,
      nextEpisodes,
      context?.episode_ids,
      context?.return_point,
    ]);
    current = view;
    if (signature === nextSignature) return;
    signature = nextSignature;
    episodes = nextEpisodes;
    days = nextDays;
    statusNote.textContent =
      view?.connection === 'offline' && episodes.length
        ? 'Last saved session spans · status offline'
        : 'Session spans · gaps may be unrecorded';
    if (!days.includes(selectedDay)) selectedDay = days[0] || null;
    const selectedStillExists = episodes.some((episode) => episode.id === selectedId);
    if (!selectedStillExists) {
      selectedId = daySegments(episodes, selectedDay)[0]?.id || null;
      confirmingId = null;
    }
    render();
  }
  function destroy() {
    host.replaceChildren();
    host.classList.remove('activity-day-map', 'reduce-motion');
  }
  return { update, destroy };
}
