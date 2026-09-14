import { appendProvenance } from '../chat/provenance.js';
import {
  recordedEpisodeRows,
  formatRecordedTime,
  formatSeenRange,
  websiteLabel,
} from '../activity/day-map-data.js';
import {
  selectGoals,
  relatedSessions,
  deliveredCheckIns,
  observedSessions,
} from '../goals/data.js';
import { progressText } from '../home/data.js';
import { createItemControls } from './item-controls.js';
import { mountCheckinCenter, renderAgentLog } from '../activity/checkins.js';
import { checkinView } from '../activity/checkin-data.js';
import { createActivityDayMap } from '../activity/day-map.js';
import { renderUsageWidget } from '../home/context-widgets.js';
import { selectBrowserUsage, selectTracking } from '../home/tracking-data.js';

const el = (tag, cls, text) => {
  const item = document.createElement(tag);
  if (cls) item.className = cls;
  if (text !== undefined) item.textContent = text;
  return item;
};
const button = (text, click, cls = 'text-button') => {
  const item = el('button', cls, text);
  item.type = 'button';
  item.addEventListener('click', click);
  return item;
};
const statusLabel = (status) =>
  ({ open: 'Active', completed: 'Completed', cancelled: 'Cancelled', deleted: 'In Trash' })[
    status
  ] || '';
const duration = (seconds) =>
  seconds >= 60
    ? `${Math.floor(seconds / 60)} min observed`
    : `${Math.floor(seconds)} sec observed`;
const when = (seconds) =>
  new Date(seconds * 1000).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const activitySummary = (records) => {
  const total = records.reduce((seconds, record) => {
    const recorded = record.kind === 'episode' ? record.recordedSeconds : record.observed_seconds;
    return seconds + (Number.isFinite(recorded) && recorded >= 0 ? recorded : 0);
  }, 0);
  const count = records.length;
  return `${count} ${count === 1 ? 'activity record' : 'activity records'}${
    total ? ` · ${formatRecordedTime(total)} recorded` : ''
  }`;
};

export function createWorkspaceViews({
  container,
  pageHeader,
  onDiscuss,
  onConnections,
  onActivity,
  onReply,
  onManage,
  onRecord,
  onCheckinToggle,
  onActivitySetup,
  onContextCommand,
  canManage = () => false,
}) {
  let current = null,
    page = 'home',
    filter = 'open',
    query = '',
    selectedId = null,
    expandedId = null,
    activityFilter = 'recorded',
    selectedActivityDay = '',
    selectedActivityId = '',
    focusActivityId = '';
  let activityDays = [];
  let listKey = '',
    detailKey = '',
    activityKey = '',
    controls;
  const refresh = () => {
    detailKey = '';
    activityKey = '';
    renderGoals();
    renderActivity();
  };
  const goals = el('section', 'goals-workspace');
  goals.setAttribute('aria-label', 'Goals workspace');
  goals.hidden = true;
  const index = el('div', 'goals-index');
  const indexHeader = el('div', 'goals-index-header');
  indexHeader.append(button('Add goal', () => controls.beginEdit(), 'goal-add'));
  const searchLabel = el('label', 'goal-search');
  const searchText = el('span', 'sr-only', 'Find a goal');
  const search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a goal';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Find a goal');
  searchLabel.append(searchText, search);
  const filters = el('div', 'goal-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filter goals');
  const filterButtons = new Map();
  for (const [key, name] of [
    ['open', 'Active'],
    ['completed', 'Completed'],
    ['all', 'All'],
  ]) {
    const item = button(
      '',
      () => {
        controls.select();
        filter = key;
        list.scrollTop = 0;
        renderGoals();
      },
      'goal-filter',
    );
    item.dataset.filter = key;
    item.append(el('span', '', name), el('span', 'goal-filter-count'));
    filters.append(item);
    filterButtons.set(key, item);
  }
  const list = el('div', 'goals-list');
  list.setAttribute('role', 'region');
  list.setAttribute('aria-label', 'Saved goals');
  list.tabIndex = 0;
  const detail = el('article', 'goal-detail');
  detail.setAttribute('aria-label', 'Selected goal');
  detail.id = 'expanded-goal-detail';
  const trash = button(
    '',
    () => {
      controls.select();
      filter = 'deleted';
      query = '';
      search.value = '';
      list.scrollTop = 0;
      renderGoals();
    },
    'goal-filter goal-trash-toggle',
  );
  trash.append(el('span', '', 'Recently deleted'), el('span', 'goal-filter-count'));
  trash.setAttribute('aria-pressed', 'false');
  indexHeader.prepend(searchLabel);
  filters.append(trash);
  index.append(indexHeader, filters, list);
  index.append(detail);
  goals.append(index);
  container.append(goals);
  controls = createItemControls({
    container,
    detail,
    snapshot: () => current?.snapshot,
    canManage,
    onManage,
    onRecord,
    onRefresh: refresh,
    onSelect: (id) => {
      selectedId = id || null;
      expandedId = selectedId;
      query = '';
      search.value = '';
      const saved = current?.snapshot?.tasks?.tasks.find((task) => task.id === id);
      if (saved && filter !== 'all' && filter !== saved.status)
        filter = saved.status === 'cancelled' ? 'all' : saved.status;
    },
  });
  controls.managed(indexHeader.querySelector('button'));
  search.addEventListener('input', () => {
    query = search.value;
    list.scrollTop = 0;
    renderGoals();
  });
  list.addEventListener('keydown', (event) => {
    if (
      !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
      !event.target.closest('.goal-option')
    )
      return;
    const options = [...list.querySelectorAll('.goal-option')],
      at = options.indexOf(event.target.closest('.goal-option'));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : Math.max(0, Math.min(options.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault();
    controls.select();
    selectedId = options[next].dataset.goalId;
    expandedId = selectedId;
    renderGoals();
    [...list.querySelectorAll('.goal-option')]
      .find((item) => item.dataset.goalId === selectedId)
      ?.focus();
  });
  goals.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !expandedId || controls.editingKey()) return;
    if (!detail.contains(event.target)) return;
    event.preventDefault();
    const id = expandedId;
    expandedId = null;
    controls.closeMenus();
    renderGoals();
    [...list.querySelectorAll('.goal-option')].find((item) => item.dataset.goalId === id)?.focus();
  });
  function renderGoals() {
    const snapshot = current?.snapshot;
    const result = selectGoals(snapshot, { filter, query, selectedId });
    selectedId = result.selected?.id || null;
    trash.querySelector('.goal-filter-count').textContent = result.counts.deleted;
    trash.setAttribute('aria-pressed', String(filter === 'deleted'));
    trash.hidden = !result.counts.deleted && filter !== 'deleted';
    filters.hidden =
      filter === 'open' && result.counts.all === result.counts.open && !result.counts.deleted;
    controls.sync();
    for (const [key, item] of filterButtons) {
      item.setAttribute('aria-pressed', String(key === filter));
      item.querySelector('.goal-filter-count').textContent = result.counts[key];
      item.hidden =
        key !== filter &&
        (key === 'completed'
          ? !result.counts.completed
          : key === 'all' && result.counts.all === result.counts.open);
    }
    const nextList = JSON.stringify([
      result.items,
      selectedId,
      expandedId,
      snapshot?.tasks?.focus_id,
      result.supported,
      filter,
      query,
    ]);
    const detailFocus = detail.contains(document.activeElement) ? document.activeElement : null;
    if (nextList !== listKey) {
      listKey = nextList;
      const focusId = document.activeElement.closest?.('.goal-option')?.dataset.goalId,
        scroll = list.scrollTop;
      list.replaceChildren();
      if (!result.supported)
        list.append(el('p', 'workspace-empty', 'Connecting to your saved goals…'));
      else if (!result.items.length)
        list.append(
          el(
            'p',
            'workspace-empty',
            query
              ? 'No goals match your search.'
              : filter === 'deleted'
                ? 'Trash is empty.'
                : filter === 'completed'
                  ? 'No completed goals yet.'
                  : 'No goals here yet.',
          ),
        );
      for (const task of result.items) {
        const item = button(
          '',
          () => {
            const editing = controls.editingKey();
            controls.select();
            expandedId = expandedId === task.id && !editing ? null : task.id;
            selectedId = task.id;
            renderGoals();
          },
          'goal-option',
        );
        item.dataset.goalId = task.id;
        item.setAttribute('aria-expanded', String(task.id === expandedId));
        if (task.id === expandedId) item.setAttribute('aria-controls', detail.id);
        item.append(el('strong', 'goal-option-title', task.title));
        const meta = [
          task.status !== 'open'
            ? statusLabel(task.status)
            : task.id === snapshot?.tasks?.focus_id
              ? 'Current focus'
              : null,
          progressText(task) || null,
          task.due_text || null,
        ].filter(Boolean);
        if (meta.length) item.append(el('span', 'goal-option-meta', meta.join(' · ')));
        item.append(
          el(
            'span',
            'goal-option-disclosure',
            task.id === expandedId ? 'Close details' : 'Details',
          ),
        );
        list.append(item);
      }
      list.scrollTop = scroll;
      if (focusId) {
        const next =
          [...list.querySelectorAll('.goal-option')].find(
            (item) => item.dataset.goalId === focusId,
          ) || list.querySelector('.goal-option');
        next?.focus({ preventScroll: true });
      }
    }
    const editingKey = controls.editingKey();
    const anchor = [...list.querySelectorAll('.goal-option')].find(
      (item) => item.dataset.goalId === (editingKey || expandedId),
    );
    detail.hidden = !editingKey && result.items.length > 0 && !anchor;
    if (editingKey === 'new') {
      if (indexHeader.nextElementSibling !== detail) indexHeader.after(detail);
    } else if (anchor) {
      if (anchor.nextElementSibling !== detail) anchor.after(detail);
    } else if (detail.parentNode !== index) index.append(detail);
    if (detailFocus?.isConnected && !detail.hidden) detailFocus.focus({ preventScroll: true });
    if (controls.renderEditor()) return;
    const task = result.selected,
      sessions = task ? relatedSessions(snapshot, task.id) : [];
    const nextDetail = JSON.stringify([
      task,
      sessions,
      result.onBreak,
      snapshot?.tasks?.focus_id,
      result.supported,
      filter,
      query,
      canManage(),
    ]);
    if (nextDetail === detailKey) return;
    detailKey = nextDetail;
    const focusedAction =
        document.activeElement.closest?.('[data-goal-action]')?.dataset.goalAction,
      oldScroll = detail.querySelector('.goal-detail-body')?.scrollTop || 0;
    controls.closeMenus();
    detail.replaceChildren();
    if (!task) {
      detail.setAttribute('aria-label', 'Goal details');
      const empty = el('div', 'goal-empty');
      empty.append(
        el(
          'h2',
          '',
          !result.supported
            ? 'Connecting to your workspace…'
            : query
              ? 'Nothing matching yet.'
              : filter === 'deleted'
                ? 'Trash is empty.'
                : result.counts.all
                  ? 'Choose a goal to explore.'
                  : 'What are you working toward?',
        ),
      );
      empty.append(
        button(
          query ? 'Clear search' : 'Start a conversation',
          () => {
            if (query) {
              query = '';
              search.value = '';
              renderGoals();
              search.focus();
            } else onDiscuss('');
          },
          'button',
        ),
      );
      detail.append(empty);
      return;
    }
    const body = el('div', 'goal-detail-body');
    body.tabIndex = 0;
    const status = el('div', 'goal-status-row');
    status.append(el('span', `goal-status goal-status-${task.status}`, statusLabel(task.status)));
    if (task.id === snapshot.tasks.focus_id && task.status === 'open')
      status.append(el('span', 'goal-focus', 'Current focus'));
    status.append(controls.goalOptions(task));
    detail.setAttribute('aria-label', task.title + ' details');
    body.append(status);
    if (task.status === 'deleted')
      body.append(
        el(
          'p',
          'goal-break',
          'This goal is out of your active workspace. Restoring it keeps its previous details and progress.',
        ),
      );
    const facts = el('div', 'goal-facts');
    body.append(facts);
    if (task.due_text) {
      const due = el('div', 'goal-due');
      due.append(el('span', '', 'Timing'), el('strong', '', task.due_text));
      facts.append(due);
    }
    if (progressText(task)) {
      const progress = el('section', 'goal-progress');
      progress.setAttribute('aria-label', 'Recorded progress');
      const amount = el('p', 'goal-amount');
      amount.append(
        el('strong', '', String(task.completed_count)),
        el('span', '', `of ${task.target_count}${task.unit ? ' ' + task.unit : ''}`),
      );
      const meter = el('progress', 'goal-meter');
      meter.max = task.target_count;
      meter.value = task.completed_count;
      meter.setAttribute('aria-label', progressText(task));
      progress.append(amount, meter);
      facts.prepend(progress);
    }
    if (result.onBreak && task.status === 'open')
      body.append(el('p', 'goal-break', 'You’re on a break. Your commitments are kept.'));
    if (sessions.length) {
      const related = el('section', 'goal-related');
      related.append(
        el('h3', '', 'Related activity'),
        el('p', 'muted', 'May relate to this goal; it does not count as completion.'),
      );
      for (const session of sessions.slice(0, 1)) {
        const item = el('div', 'goal-session');
        item.append(
          el('strong', '', new URL(session.origin).hostname),
          el('span', '', `${duration(session.observed_seconds)} · ${when(session.start)}`),
        );
        related.append(item);
      }
      body.append(related);
    }
    const footer = el('div', 'goal-detail-actions');
    const discuss = button(
      'Talk about this goal',
      () => onDiscuss(`About my goal “${task.title}”: `),
      'button',
    );
    discuss.dataset.goalAction = 'discuss';
    footer.append(controls.goalPrimary(task));
    if (task.status !== 'deleted') footer.append(controls.goalEdit(task));
    const focus = controls.goalFocus(task);
    if (focus) footer.append(focus);
    if (task.status !== 'deleted') footer.append(discuss);
    if (sessions.length) {
      const inspect = button('See activity', onActivity);
      inspect.dataset.goalAction = 'activity';
      footer.append(inspect);
    }
    detail.append(body, footer);
    body.scrollTop = oldScroll;
    if (focusedAction)
      detail.querySelector(`[data-goal-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  }

  const activity = el('section', 'activity-workspace');
  activity.setAttribute('aria-label', 'Activity workspace');
  activity.hidden = true;
  const toolbar = el('div', 'activity-toolbar');
  const headerControls = el('div', 'activity-header-controls');
  headerControls.hidden = true;
  pageHeader.append(headerControls);
  const checkinHost = el('div', 'activity-checkin-control');
  headerControls.append(
    checkinHost,
    button('Manage activity', onConnections, 'text-button activity-manage'),
  );
  const choices = el('div', 'goal-filters');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Activity type');
  const activityButtons = new Map();
  for (const [key, title] of [
    ['recorded', 'Recorded activity'],
    ['ai', 'AI activity'],
  ]) {
    const item = button(
      title,
      () => {
        controls.closeMenus();
        activityFilter = key;
        selectedActivityId = '';
        activityKey = '';
        renderActivity();
      },
      'goal-filter',
    );
    choices.append(item);
    activityButtons.set(key, item);
  }
  const activityDay = el('div', 'activity-day');
  const olderActivityDay = button('‹', () => changeActivityDay(1), 'activity-day-button');
  olderActivityDay.setAttribute('aria-label', 'Show older recorded activity');
  const activityDayLabel = el('span', 'activity-day-label');
  activityDayLabel.setAttribute('aria-live', 'polite');
  const newerActivityDay = button('›', () => changeActivityDay(-1), 'activity-day-button');
  newerActivityDay.setAttribute('aria-label', 'Show newer recorded activity');
  activityDay.append(olderActivityDay, activityDayLabel, newerActivityDay);
  toolbar.append(choices, activityDay);
  const feed = el('div', 'activity-feed');
  feed.setAttribute('role', 'region');
  feed.setAttribute('aria-label', 'Activity records');
  feed.tabIndex = 0;
  const activityDetail = el('aside', 'activity-record-detail');
  activityDetail.id = 'activity-record-detail';
  activityDetail.hidden = true;
  activityDetail.tabIndex = -1;
  const activityContent = el('div', 'activity-content');
  activityContent.append(feed, activityDetail);
  activity.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !selectedActivityId) return;
    event.preventDefault();
    focusActivityId = selectedActivityId;
    selectedActivityId = '';
    activityKey = '';
    renderActivity();
  });
  const overview = el('div', 'activity-overview');
  overview.tabIndex = 0;
  const firstActivity = el('section', 'activity-first-use');
  const firstTitle = el('h2');
  const firstAction = button(
    'Connect Chrome',
    () => (onActivitySetup || onConnections)(),
    'button primary',
  );
  firstActivity.append(firstTitle, firstAction);
  const adaptiveTimeline = el('section', 'activity-visuals');
  adaptiveTimeline.setAttribute('aria-label', 'Recorded usage and activity');
  const usageCard = el('article', 'home-widget activity-usage-card');
  const usageContent = el('div', 'widget-content');
  usageCard.append(usageContent);
  const mapHost = el('section');
  mapHost.tabIndex = -1;
  const dayMap = createActivityDayMap(mapHost, {
    onForget: (id) => onContextCommand?.('forget', { ids: [id] }),
    reducedMotion: () =>
      document.body.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  adaptiveTimeline.append(usageCard, mapHost);
  const showActivityFilter = (key) => {
    activityFilter = key;
    selectedActivityId = '';
    activityKey = '';
    renderActivity();
    (activityButtons.get(key) || feed).focus({ preventScroll: true });
  };
  const checkinCenter = mountCheckinCenter(checkinHost, {
    onToggle: onCheckinToggle,
    onConnect: onActivitySetup || onConnections,
    onDiscuss,
  });
  overview.append(firstActivity);
  activity.append(toolbar, overview, activityContent);
  container.append(activity);
  function renderAdaptiveTimeline(snapshot) {
    const hasEpisodes = Boolean(snapshot?.adaptive?.episodes?.length);
    const hasUsage = selectBrowserUsage(current).hasData;
    const active = hasEpisodes || hasUsage;
    const observed = observedSessions(snapshot).length;
    firstActivity.hidden = active || observed > 0;
    const browser = selectTracking(current).rows.find((row) => row.id === 'browser');
    const ready = ['Sharing', 'Collecting', 'On device'].includes(browser?.status);
    const online = current?.connection === 'connected';
    firstTitle.textContent = !online ? 'Activity unavailable' : 'No recorded activity';
    firstAction.hidden = !online || ready;
    usageCard.hidden = !hasUsage;
    mapHost.hidden = !hasEpisodes;
    adaptiveTimeline.hidden = !active;
    if (!active) return false;
    if (hasUsage)
      renderUsageWidget(
        usageContent,
        current,
        () => {
          mapHost.scrollIntoView({ block: 'nearest' });
          mapHost.focus({ preventScroll: true });
        },
        onActivitySetup || onConnections,
      );
    if (hasEpisodes) dayMap.update(current);
    return true;
  }
  function changeActivityDay(offset) {
    const next = activityDays[activityDays.indexOf(selectedActivityDay) + offset];
    if (!next) return;
    selectedActivityDay = next;
    selectedActivityId = '';
    activityKey = '';
    renderActivity();
  }
  function activityRecordTitle(record) {
    return record.kind === 'episode'
      ? record.title
      : record.origin
        ? websiteLabel(record.origin)
        : 'Activity observation';
  }
  function activityRecordSource(record) {
    if (record.kind !== 'episode') return record.origin ? websiteLabel(record.origin) : '';
    return [record.appName, record.origin ? websiteLabel(record.origin) : '']
      .filter(Boolean)
      .join(' · ');
  }
  function relatedGoalNames(record, snapshot) {
    if (record.related_task_revision !== snapshot?.tasks?.revision) return [];
    return (Array.isArray(record.related_task_ids) ? record.related_task_ids : [])
      .map((id) => snapshot.tasks.tasks.find((task) => task.id === id)?.title)
      .filter(Boolean);
  }
  function selectActivityRecord(id) {
    selectedActivityId = selectedActivityId === id ? '' : id;
    focusActivityId = id;
    activityKey = '';
    renderActivity();
  }
  function renderActivityDetail(record, snapshot) {
    activityDetail.replaceChildren();
    activityDetail.hidden = !record;
    activityContent.classList.toggle('has-detail', Boolean(record));
    if (!record) return;
    const title = activityRecordTitle(record);
    const heading = el('div', 'activity-detail-heading');
    const close = button(
      'Close',
      () => {
        selectedActivityId = '';
        focusActivityId = record.id;
        activityKey = '';
        renderActivity();
      },
      'text-button activity-detail-close',
    );
    heading.append(el('h2', '', title), close);
    const facts = el('dl', 'activity-detail-facts');
    const addFact = (label, value) => {
      if (!value) return;
      const fact = el('div', 'activity-detail-fact');
      fact.append(el('dt', '', label), el('dd', '', value));
      facts.append(fact);
    };
    const source = activityRecordSource(record);
    addFact(
      'When',
      record.kind === 'episode'
        ? formatSeenRange(record.startedAt, record.endedAt)
        : when(record.start),
    );
    addFact(
      record.kind === 'episode' ? 'Recorded' : 'Observed',
      record.kind === 'episode'
        ? `${formatRecordedTime(record.recordedSeconds)} recorded`
        : duration(record.observed_seconds),
    );
    addFact('Source', source);
    const related = relatedGoalNames(record, snapshot);
    const actions = el('div', 'activity-detail-actions');
    if (record.kind === 'episode') {
      const confirm = el('div', 'activity-forget-confirm');
      confirm.hidden = true;
      const notice = el('p', 'activity-detail-note');
      notice.setAttribute('role', 'status');
      const forget = controls.managed(
        button(
          'Forget this activity',
          () => {
            confirm.hidden = false;
            forget.hidden = true;
            confirm.querySelector('button')?.focus();
          },
          'button is-danger',
        ),
      );
      confirm.append(
        el('p', '', 'Forget this activity and its derived context? Saved conversations stay.'),
        el('p', 'activity-detail-note', 'This does not pause recording or mark a goal complete.'),
        controls.managed(
          button(
            'Confirm forget',
            async () => {
              const activeButton = confirm.querySelector('button');
              activeButton.disabled = true;
              try {
                await onContextCommand?.('forget', { ids: [record.id] });
              } catch (error) {
                notice.textContent = error.message || 'Could not forget this activity.';
                activeButton.disabled = false;
              }
            },
            'button is-danger',
          ),
        ),
        button('Cancel', () => {
          confirm.hidden = true;
          forget.hidden = false;
          forget.focus();
        }),
      );
      actions.append(forget, confirm, notice);
    } else if (activityFilter === 'trash') {
      actions.append(controls.recordAction(record, 'restore', 'Restore activity', 'button'));
    } else {
      if (related.length)
        actions.append(controls.recordAction(record, 'unlink', 'Remove goal link', 'text-button'));
      actions.append(controls.recordAction(record, 'trash', 'Move to Trash', 'button is-danger'));
    }
    activityDetail.append(heading, facts);
    if (related.length)
      activityDetail.append(el('p', 'activity-relation', `May relate to ${related.join(', ')}`));
    if (actions.childElementCount) activityDetail.append(actions);
  }
  function appendActivityRecord(record) {
    const selected = record.id === selectedActivityId;
    const item = el('article', 'activity-record activity-observation');
    item.dataset.activityRecordId = record.id;
    item.classList.toggle('is-selected', selected);
    const select = button('', () => selectActivityRecord(record.id), 'activity-record-select');
    select.dataset.activityRecordId = record.id;
    select.setAttribute('aria-controls', activityDetail.id);
    select.setAttribute('aria-expanded', String(selected));
    select.setAttribute(
      'aria-label',
      `${selected ? 'Hide' : 'Show'} details for ${activityRecordTitle(record)}`,
    );
    const copy = el('span', 'activity-record-copy');
    const timing =
      record.kind === 'episode'
        ? formatSeenRange(record.startedAt, record.endedAt)
        : `${when(record.start)}${record.end === null ? ' · ongoing' : ''}`;
    const source = record.kind === 'episode' ? activityRecordSource(record) : '';
    copy.append(
      el('strong', '', activityRecordTitle(record)),
      el('span', 'activity-record-time', [timing, source].filter(Boolean).join(' · ')),
    );
    select.append(
      copy,
      el(
        'span',
        'activity-duration',
        record.kind === 'episode'
          ? `${formatRecordedTime(record.recordedSeconds)} recorded`
          : duration(record.observed_seconds),
      ),
    );
    item.append(select);
    feed.append(item);
  }
  function renderActivity() {
    const snapshot = current?.snapshot;
    const hasTrash = observedSessions(snapshot, { trash: true }).length > 0;
    const hasHistory = checkinView(current).history.length > 0;
    if (activityFilter === 'trash' && !hasTrash) activityFilter = 'recorded';
    choices.hidden = activityFilter === 'trash';
    toolbar.hidden = false;
    checkinCenter.update(current);
    const legacyRecords = observedSessions(snapshot, { trash: activityFilter === 'trash' });
    const allRows =
      activityFilter === 'trash'
        ? legacyRecords.map((session) => ({
            kind: 'legacy',
            ...session,
            day: '',
            stamp: session.start,
          }))
        : recordedEpisodeRows(snapshot?.adaptive?.episodes, legacyRecords);
    activityDays = [...new Set(allRows.map((item) => item.day).filter(Boolean))];
    if (!activityDays.includes(selectedActivityDay)) selectedActivityDay = activityDays[0] || '';
    const dayIndex = activityDays.indexOf(selectedActivityDay);
    activityDay.hidden = activityFilter !== 'recorded' || !activityDays.length;
    activityDayLabel.textContent = selectedActivityDay
      ? new Date(selectedActivityDay + 'T12:00:00').toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })
      : '';
    olderActivityDay.disabled = dayIndex < 0 || dayIndex === activityDays.length - 1;
    newerActivityDay.disabled = dayIndex <= 0;
    const records =
      activityFilter === 'recorded'
        ? allRows.filter((item) => item.day === selectedActivityDay)
        : allRows;
    if (!records.some((record) => record.id === selectedActivityId)) selectedActivityId = '';
    const selectedRecord = records.find((record) => record.id === selectedActivityId) || null;
    for (const [key, item] of activityButtons)
      item.setAttribute('aria-pressed', String(key === activityFilter));
    overview.hidden = true;
    feed.hidden = false;
    const nextKey = JSON.stringify([
      activityFilter,
      selectedActivityDay,
      selectedActivityId,
      records,
      snapshot?.messages,
      snapshot?.adaptive?.episodes,
      snapshot?.adaptive?.usage,
      snapshot?.adaptive?.policy,
      checkinView(current).history,
      snapshot?.accountability?.activity?.state,
      snapshot?.accountability?.check_ins,
      snapshot?.tasks,
      canManage(),
    ]);
    if (nextKey === activityKey) return;
    activityKey = nextKey;
    const scroll = feed.scrollTop;
    feed.replaceChildren();
    controls.sync();
    renderActivityDetail(activityFilter === 'ai' ? null : selectedRecord, snapshot);
    if (activityFilter === 'ai') {
      feed.append(el('h2', 'activity-feed-title', 'AI activity'));
      const checkins = deliveredCheckIns(snapshot);
      const replies = (snapshot?.messages || [])
        .filter((message) => message.role === 'assistant' && message.origin !== 'check_in')
        .slice(-30)
        .reverse();
      if (!checkins.length && !hasHistory && !replies.length) {
        const empty = el('div', 'workspace-empty-state');
        empty.append(
          el('h2', '', 'No AI activity yet.'),
          el('p', '', 'Check-ins and their recorded outcomes will appear here.'),
        );
        feed.append(empty);
      }
      if (checkins.length) {
        feed.append(el('h3', 'activity-section-title', 'Check-ins'));
        for (const message of checkins) {
          const item = el('article', 'activity-record');
          item.append(
            el('p', 'check-in-copy', message.text),
            button('Reply', () => onReply(message)),
          );
          appendProvenance(item, message);
          feed.append(item);
        }
      }
      if (replies.length) {
        feed.append(el('h3', 'activity-section-title', 'Conversation replies'));
        for (const message of replies) {
          const item = el('article', 'activity-record');
          item.append(
            el('p', 'check-in-copy', message.text),
            button('Discuss', () => onDiscuss('About your reply: ' + message.text.slice(0, 200))),
          );
          appendProvenance(item, message);
          feed.append(item);
        }
      }
      if (hasHistory) {
        feed.append(el('h3', 'activity-section-title', 'Check-in record'));
        renderAgentLog(feed, current, { onCheckIns: () => showActivityFilter('ai') });
      }
    } else {
      if (activityFilter === 'recorded') renderAdaptiveTimeline(snapshot);
      if (activityFilter === 'trash') {
        const heading = el('div', 'activity-feed-heading');
        heading.append(
          el('h2', 'activity-feed-title', 'Recently deleted'),
          button('Back to recorded activity', () => showActivityFilter('recorded'), 'text-button'),
        );
        feed.append(
          heading,
          el('p', 'activity-summary', 'Restore observations within seven days.'),
        );
      } else if (records.length) {
        const summary = el('div', 'activity-feed-summary');
        summary.append(el('p', 'activity-summary', activitySummary(records)));
        if (hasTrash)
          summary.append(
            button(
              'Recently deleted',
              () => showActivityFilter('trash'),
              'text-button activity-trash-link',
            ),
          );
        feed.append(summary);
      }
      if (!records.length) {
        const empty = el('div', 'workspace-empty-state');
        empty.append(
          el('h2', '', activityFilter === 'trash' ? 'Trash is empty.' : 'No activity shared yet.'),
          el(
            'p',
            '',
            activityFilter === 'trash'
              ? 'Removed activity records will appear here.'
              : 'Connect a source when you’re ready.',
          ),
          ...(activityFilter === 'trash'
            ? []
            : [button('Open permissions', onConnections, 'button')]),
        );
        feed.append(empty);
      }
      for (const record of records) appendActivityRecord(record);
    }
    feed.scrollTop = scroll;
    if (focusActivityId) {
      [...feed.querySelectorAll('.activity-record-select')]
        .find((item) => item.dataset.activityRecordId === focusActivityId)
        ?.focus({ preventScroll: true });
      focusActivityId = '';
    }
  }
  return {
    show(nextPage, { goalFilter, activityTab } = {}) {
      controls.closeMenus();
      if (page !== nextPage) controls.clearNotice();
      page = nextPage;
      goals.hidden = page !== 'goals';
      activity.hidden = page !== 'activity';
      headerControls.hidden = page !== 'activity';
      if (page !== 'activity') checkinCenter.close();
      if (goalFilter) {
        filter = goalFilter;
        query = '';
        search.value = '';
      }
      if (['recorded', 'ai', 'trash'].includes(activityTab)) {
        activityFilter = activityTab;
        selectedActivityId = '';
        activityKey = '';
      }
      if (page === 'goals') renderGoals();
      if (page === 'activity') renderActivity();
    },
    update(view) {
      current = view;
      if (page === 'goals') renderGoals();
      if (page === 'activity') renderActivity();
    },
  };
}
