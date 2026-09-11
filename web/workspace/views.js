import {
  selectGoals,
  relatedSessions,
  deliveredCheckIns,
  observedSessions,
} from '../goals/data.js';
import { progressText } from '../home/data.js';
import { createItemControls } from './item-controls.js';
import { mountCheckinCenter, renderAgentLog } from '../activity/checkins.js';
import { createActivityDayMap } from '../activity/day-map.js';
import { renderUsageWidget } from '../home/context-widgets.js';

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

export function createWorkspaceViews({
  container,
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
    activityFilter = 'overview';
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
  indexHeader.append(button('+', () => controls.beginEdit(), 'goal-add'));
  indexHeader.querySelector('button').setAttribute('aria-label', 'Add a goal');
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
  const trash = button(
    'Trash',
    () => {
      controls.select();
      filter = 'deleted';
      query = '';
      search.value = '';
      list.scrollTop = 0;
      renderGoals();
    },
    'goal-trash-toggle',
  );
  trash.setAttribute('aria-pressed', 'false');
  indexHeader.prepend(searchLabel);
  index.append(indexHeader, filters, list, trash);
  goals.append(index, detail);
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
    renderGoals();
    [...list.querySelectorAll('.goal-option')]
      .find((item) => item.dataset.goalId === selectedId)
      ?.focus();
  });
  function renderGoals() {
    const snapshot = current?.snapshot;
    const result = selectGoals(snapshot, { filter, query, selectedId });
    selectedId = result.selected?.id || null;
    trash.textContent = `Trash${result.counts.deleted ? ' · ' + result.counts.deleted : ''}`;
    trash.setAttribute('aria-pressed', String(filter === 'deleted'));
    controls.sync();
    for (const [key, item] of filterButtons) {
      item.setAttribute('aria-pressed', String(key === filter));
      item.querySelector('.goal-filter-count').textContent = result.counts[key];
    }
    const nextList = JSON.stringify([
      result.items,
      selectedId,
      snapshot?.tasks?.focus_id,
      result.supported,
      filter,
      query,
    ]);
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
            controls.select();
            selectedId = task.id;
            renderGoals();
          },
          'goal-option',
        );
        item.dataset.goalId = task.id;
        item.setAttribute('aria-pressed', String(task.id === selectedId));
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
        el(
          'p',
          '',
          !result.supported
            ? 'Your saved goals will appear when the connection is ready.'
            : query
              ? 'Try a shorter name or change the filter.'
              : filter === 'deleted'
                ? 'Deleted goals can be restored here.'
                : result.counts.all
                  ? 'Your active and completed commitments stay available here.'
                  : 'Tell eïlo in the bar below. It will keep the details here.',
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
    body.append(status, el('h2', 'goal-title', task.title));
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
  const choices = el('div', 'goal-filters');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', 'Activity type');
  const activityButtons = new Map();
  for (const [key, title] of [
    ['overview', 'Overview'],
    ['agent', 'Agent log'],
    ['observed', 'Observed'],
    ['checkins', 'Check-ins'],
    ['trash', 'Trash'],
  ]) {
    const item = button(
      title,
      () => {
        controls.closeMenus();
        activityFilter = key;
        renderActivity();
      },
      'goal-filter',
    );
    choices.append(item);
    activityButtons.set(key, item);
  }
  toolbar.append(choices, button('Connections', onConnections, 'button'));
  const feed = el('div', 'activity-feed');
  feed.setAttribute('role', 'region');
  feed.setAttribute('aria-label', 'Activity records');
  feed.tabIndex = 0;
  const overview = el('div', 'activity-overview');
  overview.tabIndex = 0;
  const adaptiveTimeline = el('section', 'activity-visuals');
  adaptiveTimeline.setAttribute('aria-label', 'Recorded usage and activity');
  const usageCard = el('article', 'home-widget activity-usage-card');
  const usageContent = el('div', 'widget-content');
  usageCard.append(usageContent);
  const mapHost = el('section');
  mapHost.tabIndex = -1;
  const dayMap = createActivityDayMap(mapHost, {
    onForget: (id) => onContextCommand?.('forget', { ids: [id] }),
    onManageSources: onConnections,
    reducedMotion: () =>
      document.body.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  adaptiveTimeline.append(usageCard, mapHost);
  const showActivityFilter = (key) => {
    activityFilter = key;
    renderActivity();
    activityButtons.get(key)?.focus();
  };
  const checkinCenter = mountCheckinCenter(overview, {
    onToggle: onCheckinToggle,
    onConnect: onActivitySetup || onConnections,
    onDiscuss,
    onLog: () => showActivityFilter('agent'),
    onCheckIns: () => showActivityFilter('checkins'),
    onObserved: () => showActivityFilter('observed'),
  });
  overview.insertBefore(adaptiveTimeline, overview.firstChild);
  activity.append(toolbar, overview, feed);
  container.append(activity);
  function renderAdaptiveTimeline(snapshot) {
    const active = Array.isArray(snapshot?.adaptive?.episodes);
    adaptiveTimeline.hidden = !active;
    for (const child of [...overview.children])
      if (child !== adaptiveTimeline) child.hidden = active;
    if (!active) return false;
    renderUsageWidget(
      usageContent,
      current,
      () => {
        mapHost.scrollIntoView({ block: 'nearest' });
        mapHost.focus({ preventScroll: true });
      },
      onActivitySetup || onConnections,
    );
    dayMap.update(current);
    return true;
  }
  function renderActivity() {
    const snapshot = current?.snapshot,
      records =
        activityFilter === 'checkins'
          ? deliveredCheckIns(snapshot)
          : observedSessions(snapshot, { trash: activityFilter === 'trash' });
    for (const [key, item] of activityButtons)
      item.setAttribute('aria-pressed', String(key === activityFilter));
    overview.hidden = activityFilter !== 'overview';
    feed.hidden = activityFilter === 'overview';
    if (activityFilter === 'overview') {
      if (renderAdaptiveTimeline(snapshot)) return;
      checkinCenter.update(current);
      return;
    }
    const nextKey = JSON.stringify([
      activityFilter,
      records,
      snapshot?.accountability?.activity?.state,
      snapshot?.accountability?.check_ins,
      snapshot?.tasks,
      canManage(),
    ]);
    if (nextKey === activityKey) return;
    activityKey = nextKey;
    const scroll = feed.scrollTop;
    const infoOpen = !!feed.querySelector('.activity-info')?.open;
    feed.replaceChildren();
    controls.sync();
    if (activityFilter === 'agent') {
      renderAgentLog(feed, current, { onCheckIns: () => showActivityFilter('checkins') });
    } else if (activityFilter !== 'checkins') {
      if (records.length) {
        const info = el('details', 'activity-info activity-explanation');
        info.open = infoOpen;
        info.append(
          el('summary', '', activityFilter === 'trash' ? 'About Trash' : 'About observed activity'),
          el(
            'p',
            '',
            activityFilter === 'trash'
              ? 'Restore observations within their seven-day retention period. Conversation messages are separate.'
              : 'Deleting an observation does not stop sharing or mark a task complete. Pause sharing in Connections.',
          ),
        );
        feed.append(info);
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
            : [button('Open connections', onConnections, 'button')]),
        );
        feed.append(empty);
      }
      for (const session of records) {
        const item = el('article', 'activity-record');
        const name = el('div', 'activity-record-heading');
        name.append(
          el('h2', '', new URL(session.origin).hostname),
          el('span', 'activity-duration', duration(session.observed_seconds)),
          controls.recordOptions(session, { trash: activityFilter === 'trash' }),
        );
        item.append(name);
        item.append(
          el(
            'p',
            'activity-record-time',
            `${when(session.start)}${session.end === null ? ' · ongoing' : ''}`,
          ),
        );
        if (session.related_task_revision === snapshot?.tasks?.revision) {
          const names = (Array.isArray(session.related_task_ids) ? session.related_task_ids : [])
            .map((id) => snapshot.tasks.tasks.find((task) => task.id === id)?.title)
            .filter(Boolean);
          if (names.length)
            item.append(el('p', 'activity-relation', `May relate to ${names.join(', ')}`));
        }
        feed.append(item);
      }
    } else {
      feed.append(
        el('p', 'activity-explanation', 'Check-ins saved in your conversation, newest first.'),
      );
      if (!records.length) {
        const empty = el('div', 'workspace-empty-state');
        empty.append(
          el('h2', '', 'No check-ins yet.'),
          el('p', '', 'When eïlo checks in, its message will stay here.'),
        );
        feed.append(empty);
      }
      for (const message of records) {
        const item = el('article', 'activity-record');
        item.append(
          el('p', 'check-in-copy', message.text),
          button('Reply', () => onReply(message)),
        );
        feed.append(item);
      }
    }
    feed.scrollTop = scroll;
  }
  return {
    show(nextPage, { goalFilter, activityTab } = {}) {
      controls.closeMenus();
      page = nextPage;
      goals.hidden = page !== 'goals';
      activity.hidden = page !== 'activity';
      if (goalFilter) {
        filter = goalFilter;
        query = '';
        search.value = '';
      }
      if (activityButtons.has(activityTab)) activityFilter = activityTab;
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
