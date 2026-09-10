import { calendarAgenda, calendarTime } from '../calendar/agenda.js';
import { conversationEntries, deliveryLabel, progressText } from './data.js';

const LIVE_TYPES = new Set(['today', 'goals', 'progress', 'conversation']);
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
      action('Talk to eïlo', talk, 'button live-bottom'),
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
        'live-speaker',
        entry.role === 'user' ? 'You' : entry.origin === 'check_in' ? 'eïlo check-in' : 'eïlo',
      ),
      node('p', '', entry.text),
    );
    if (entry.delivery) row.append(node('span', 'live-delivery', deliveryLabel(entry.delivery)));
    return row;
  };
  function renderBody(widget, container) {
    if (!LIVE_TYPES.has(widget.type)) return false;
    container.replaceChildren();
    container.classList.add('live-content');
    const current = getCurrent(),
      { snapshot, connection } = current,
      value = getData();
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
      const calendar = snapshot.integrations?.google_calendar,
        agenda = calendarAgenda(calendar);
      if (agenda.length) {
        container.append(
          node('h2', '', 'Today'),
          node(
            'p',
            'widget-subtitle',
            calendar.state === 'paused'
              ? 'Calendar sync paused'
              : calendar.error
                ? 'Calendar · last synced view'
                : 'From your calendars',
          ),
        );
        const list = node('div', 'live-agenda');
        agenda.slice(0, 3).forEach((event) => {
          const row = node('div', 'live-task calendar-agenda-row');
          row.append(
            node('span', 'live-task-time', calendarTime(event)),
            node('strong', '', event.title),
          );
          row.title = event.calendar_name;
          list.append(row);
        });
        container.append(
          list,
          action('View day', () => openDetail('calendar-day'), 'text-button live-bottom'),
        );
        return true;
      }
      if (!value.open.length) {
        empty(
          container,
          'Today',
          'Tell eïlo what you have coming up. Your commitments will appear here.',
        );
        return true;
      }
      container.append(
        node('h2', '', 'Today'),
        node('p', 'widget-subtitle', value.onBreak ? 'On a break' : 'Open commitments'),
      );
      const list = node('div', 'live-agenda');
      value.open.slice(0, 3).forEach((task) => list.append(taskRow(task, { due: true })));
      container.append(
        list,
        action(
          value.open.length > 3 ? `View all ${value.open.length}` : 'See commitments',
          () => openDetail('today'),
          'text-button live-bottom',
        ),
      );
    } else if (widget.type === 'goals') {
      if (!value.open.length) {
        empty(
          container,
          'Your goals',
          'A place for the things you want to move forward. Start with a conversation.',
        );
        return true;
      }
      container.append(
        node('h2', '', 'Your goals'),
        node('p', 'widget-subtitle', value.onBreak ? 'On a break' : 'Saved commitments'),
      );
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
      const observed = snapshot.accountability?.observed_activity,
        session = observed?.active_session || observed?.recent_sessions?.at(-1);
      if (session) {
        const minutes = Math.floor(session.observed_seconds / 60);
        const duration = node('div', 'practice-count');
        duration.append(
          node('strong', '', String(minutes || Math.floor(session.observed_seconds))),
          node(
            'span',
            '',
            minutes
              ? minutes === 1
                ? 'minute observed'
                : 'minutes observed'
              : Math.floor(session.observed_seconds) === 1
                ? 'second observed'
                : 'seconds observed',
          ),
        );
        container.append(
          node('h2', '', 'Progress'),
          duration,
          node('p', 'live-progress-copy', new URL(session.origin).hostname),
          node(
            'p',
            'live-progress-copy',
            `${value.completed.length} commitment${value.completed.length === 1 ? '' : 's'} completed`,
          ),
          action('See activity', () => openDetail('activity'), 'text-button live-bottom'),
        );
        return true;
      }
      container.append(node('h2', '', 'Progress'));
      const count = node('div', 'practice-count');
      count.append(
        node('strong', '', String(value.completed.length)),
        node(
          'span',
          '',
          value.completed.length === 1 ? 'commitment completed' : 'commitments completed',
        ),
      );
      container.append(count);
      const tracked = value.open.filter((task) => progressText(task));
      if (tracked.length) {
        const task = tracked.find((task) => task.id === value.focus?.id) || tracked[0];
        const copy = node('div', 'live-progress-copy');
        copy.append(node('strong', '', progressText(task)), node('p', '', task.title));
        const meter = node('progress', 'live-meter');
        meter.max = task.target_count;
        meter.value = task.completed_count;
        meter.setAttribute('aria-label', `${task.title}: ${progressText(task)}`);
        container.append(copy, meter);
      } else
        container.append(
          node(
            'p',
            'live-progress-copy',
            'Progress you share with eïlo is saved with your commitments.',
          ),
        );
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
          talk,
          'button live-bottom',
        ),
      );
    }
    return true;
  }
  return { renderBody, taskRow, miniMessage };
}
