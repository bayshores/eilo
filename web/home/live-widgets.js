import { calendarAgenda, calendarTime } from '../calendar/agenda.js';
import { conversationEntries, deliveryLabel, progressText } from './data.js';
import { renderTrackingWidget, renderUsageWidget } from './context-widgets.js';

const LIVE_TYPES = new Set(['today', 'goals', 'progress', 'conversation', 'tracking', 'usage']);
export const isLiveWidget = (type) => LIVE_TYPES.has(type);

export function widgetFingerprint(view) {
  const activity = view.snapshot?.accountability?.activity;
  return JSON.stringify([
    view.snapshot?.tasks,
    view.snapshot?.messages,
    view.snapshot?.pending_message,
    view.snapshot?.integrations?.google_calendar,
    view.snapshot?.integrations?.briefing_sources,
    view.snapshot?.accountability?.observed_activity,
    view.snapshot?.adaptive?.capture_status,
    view.snapshot?.adaptive?.policy,
    view.snapshot?.adaptive?.usage,
    activity?.state,
    activity?.helper_available,
    activity?.chrome_available,
    view.snapshot?.workflow_run,
    view.localPending,
    view.connection,
  ]);
}
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const action = (label, handler, className = 'text-button') => {
  const button = node('button', className, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
};

/** Renders live Home cards from the current client view; lifecycle and drafts remain with the workspace. */
export function createLiveWidgetRenderer({ getCurrent, getData, talk, openDetail }) {
  const empty = (container, heading, description) => {
    container.append(
      node('h2', '', heading),
      node('p', 'live-empty', description),
      action('Talk to eïlo', () => talk(), 'button live-bottom'),
    );
  };
  const taskRow = (task, { due = false, focus = false } = {}) => {
    const row = node('div', 'live-task');
    if (due) row.append(node('span', 'live-due', task.due_text || 'Flexible'));
    const copy = node('div', 'live-task-copy');
    copy.append(node('strong', '', task.title));
    const label = [
      focus
        ? 'Current focus'
        : task.status === 'completed'
          ? 'Completed'
          : task.status === 'cancelled'
            ? 'Cancelled'
            : '',
      progressText(task),
      !due && task.due_text,
    ]
      .filter(Boolean)
      .join(' · ');
    if (label) copy.append(node('span', 'live-task-meta', label));
    row.append(copy);
    return row;
  };
  const miniMessage = (entry) => {
    const row = node(
      'div',
      `live-snippet live-snippet-${entry.role}${entry.preview ? ' live-writing-preview' : ''}`,
    );
    if (entry.preview) row.setAttribute('aria-live', 'off');
    if (entry.id) row.dataset.messageId = entry.id;
    row.append(
      node(
        'span',
        entry.origin === 'check_in' ? 'live-speaker' : 'live-speaker sr-only',
        entry.role === 'user' ? 'You' : entry.origin === 'check_in' ? 'eïlo check-in' : 'eïlo',
      ),
      node('p', '', entry.text),
    );
    if (entry.delivery) row.append(node('span', 'live-delivery', deliveryLabel(entry.delivery)));
    return row;
  };
  function renderBody(widget, container) {
    if (!isLiveWidget(widget.type)) return false;
    container.classList.add('live-content');
    const current = getCurrent(),
      { snapshot, connection } = current,
      value = getData();
    if (widget.type === 'tracking') {
      renderTrackingWidget(container, current, () => openDetail('connections'));
      return true;
    }
    if (widget.type === 'usage') {
      renderUsageWidget(
        container,
        current,
        () => openDetail('activity'),
        () => openDetail('browser-setup'),
      );
      return true;
    }
    container.replaceChildren();
    if (!value.supported) {
      empty(
        container,
        widget.type === 'conversation'
          ? 'eïlo'
          : { today: 'Today', goals: 'Your goals', progress: 'Progress' }[widget.type],
        connection === 'loading'
          ? 'Connecting to your workspace…'
          : 'The local workspace is unavailable. Your saved information is kept.',
      );
      return true;
    }
    if (widget.type === 'today') {
      container.classList.add('home-launcher');
      const calendar = snapshot.integrations?.google_calendar;
      const agenda = calendarAgenda(calendar);
      container.append(node('h2', '', 'What’s next?'));
      const actions = node('div', 'launcher-actions');
      for (const [label, tone, handler] of [
        [
          'Start focus',
          'sand',
          () =>
            talk(
              value.focus
                ? `Help me focus on ${value.focus.title}.`
                : 'Help me start a focus session.',
            ),
        ],
        ['Continue goal', 'lavender', () => openDetail('goals')],
        ['Add commitment', 'blue', () => talk('I want to add a commitment.')],
        ['Talk to eïlo', 'mint', () => talk()],
      ])
        actions.append(action(label, handler, `launcher-action launcher-action--${tone}`));
      const today = action(
        '',
        () => openDetail(agenda.length ? 'calendar-day' : 'today'),
        'launcher-today',
      );
      const nextTask = value.focus || value.open[0];
      const todayCopy = agenda.length
        ? `${calendarTime(agenda[0])} · ${agenda[0].title}`
        : nextTask?.title || 'No commitments yet';
      today.append(
        node('span', 'launcher-today__label', 'Today'),
        node('span', 'launcher-today__copy', todayCopy),
        node('span', 'launcher-today__arrow', '→'),
      );
      today.setAttribute('aria-label', `View today: ${todayCopy}`);
      container.append(actions, today);
    } else if (widget.type === 'goals') {
      if (!value.open.length) {
        empty(
          container,
          'Your goals',
          'A place for the things you want to move forward. Start with a conversation.',
        );
        return true;
      }
      container.append(node('h2', '', 'Your goals'));
      if (value.onBreak) container.append(node('p', 'widget-subtitle', 'On a break'));
      const group = node('div', 'live-goals');
      const shown = value.focus
        ? [value.focus, ...value.open.filter((task) => task !== value.focus)].slice(0, 2)
        : value.open.slice(0, 2);
      shown.forEach((task) => group.append(taskRow(task, { focus: task === value.focus })));
      container.append(
        group,
        action(
          `See ${value.open.length === 1 ? 'goal' : `all ${value.open.length} goals`}`,
          () => openDetail('goals'),
          'text-button live-bottom',
        ),
      );
    } else if (widget.type === 'progress') {
      container.append(node('h2', '', 'Progress'));
      const tracked = value.open.filter((task) => progressText(task));
      const task = tracked.find((item) => item.id === value.focus?.id) || tracked[0];
      const count = node('div', 'practice-count');
      count.append(
        node('strong', '', String(task ? task.completed_count : value.completed.length)),
        node(
          'span',
          '',
          task
            ? `of ${task.target_count}${task.unit ? ' ' + task.unit : ''}`
            : value.completed.length === 1
              ? 'commitment completed'
              : 'commitments completed',
        ),
      );
      container.append(count);
      if (task) {
        if (value.open.length > 1) container.append(node('p', 'live-progress-copy', task.title));
        const meter = node('progress', 'live-meter');
        meter.max = task.target_count;
        meter.value = task.completed_count;
        meter.setAttribute('aria-label', `${task.title}: ${progressText(task)}`);
        container.append(meter);
      }
      container.append(
        action('See progress', () => openDetail('progress'), 'text-button live-bottom'),
      );
    } else {
      container.append(node('h2', '', 'eïlo'));
      const entries = conversationEntries(snapshot, current.localPending),
        snippet = node('div', 'live-snippets');
      entries.slice(-2).forEach((entry) => snippet.append(miniMessage(entry)));
      if (!entries.length)
        snippet.append(node('p', 'live-empty', 'What would you like to make progress on?'));
      container.append(
        snippet,
        action(
          snapshot.status === 'busy' ? 'View conversation' : 'Message eïlo',
          () => talk(),
          'button live-bottom',
        ),
      );
    }
    return true;
  }
  return { renderBody, taskRow, miniMessage };
}
