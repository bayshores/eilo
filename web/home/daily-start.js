import { homeData } from './data.js';
import { calendarAgenda, calendarTime } from '../calendar/agenda.js';

export function localDay(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

// Never promote observed activity to the person's confirmed intention.
export function dailyStartData(view, now = new Date()) {
  if (view?.connection !== 'connected' || !view.snapshot) return null;
  const snapshot = view.snapshot;
  if (['draft', 'proposed'].includes(snapshot.onboarding?.status)) return null;
  const goals = homeData(snapshot);
  const task = goals.focus || (goals.open.length === 1 ? goals.open[0] : null);
  const context = snapshot.adaptive?.current_work_context;
  const nextStep =
    task && context?.confidence === 'explicit' && context.task_ids?.includes(task.id)
      ? context.return_point || ''
      : '';
  const calendar = snapshot.integrations?.google_calendar;
  const synced = Date.parse(calendar?.last_synced_at);
  const fresh =
    calendar?.state === 'connected' &&
    Number.isFinite(synced) &&
    now.getTime() - synced >= 0 &&
    now.getTime() - synced < 15 * 60 * 1000;
  const event = fresh ? calendarAgenda(calendar, now).find((item) => !item.all_day) : null;
  return {
    key: snapshot.workspace?.active_chat_id || snapshot.conversation_id || 'new',
    task,
    nextStep,
    title: goals.onBreak
      ? 'Pick up when you’re ready'
      : task
        ? 'Pick up where you left off'
        : 'One thing to start with',
    detail: nextStep || task?.title || 'Tell eïlo what you want to get started on.',
    commitment: event ? calendarTime(event) + ' · ' + event.title : '',
    onBreak: goals.onBreak,
  };
}

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const KEY = 'eilo:daily-start:v1';

export function mountDailyStart(
  host,
  { getPreferences, onContinue, onChange, onDisable, storage = null, now = () => new Date() },
) {
  const root = node('section', 'daily-start');
  root.setAttribute('aria-label', 'Your next step');
  root.hidden = true;
  const copy = node('div', 'daily-start-copy');
  const heading = node('h2', 'daily-start-title');
  const detail = node('p', 'daily-start-detail');
  const commitment = node('p', 'daily-start-commitment');
  copy.append(heading, detail, commitment);
  const actions = node('div', 'daily-start-actions');
  const makeButton = (label, fn, primary = false) => {
    const button = node('button', primary ? 'button primary' : 'text-button', label);
    button.type = 'button';
    button.addEventListener('click', fn);
    return button;
  };
  let view,
    page = 'home',
    conversationOpen = false,
    data,
    day = localDay(now()),
    dismissed = {};
  try {
    dismissed = JSON.parse(storage?.getItem(KEY) || '{}');
  } catch {
    /* In-memory dismissal still works. */
  }
  if (!dismissed || typeof dismissed !== 'object' || Array.isArray(dismissed)) dismissed = {};
  function dismiss() {
    if (!data) return;
    dismissed.all = day;
    dismissed = Object.fromEntries(Object.entries(dismissed).slice(-80));
    try {
      storage?.setItem(KEY, JSON.stringify(dismissed));
    } catch {
      /* Keep this session usable. */
    }
    root.hidden = true;
  }
  const resume = makeButton(
    'Continue',
    () => {
      dismiss();
      onContinue(data);
    },
    true,
  );
  actions.append(
    resume,
    makeButton('Change', () => {
      dismiss();
      onChange(data);
    }),
    makeButton('Not now', () => {
      dismiss();
      host.querySelector('.home-header h1')?.focus({ preventScroll: true });
    }),
  );
  const disable = makeButton('Turn off daily guidance', () => {
    dismiss();
    onDisable();
  });
  disable.classList.add('daily-start-disable');
  root.append(copy, actions, disable);
  host.querySelector('.home-header').append(root);
  function render() {
    data = dailyStartData(view, now());
    root.hidden =
      !data ||
      page !== 'home' ||
      conversationOpen ||
      !getPreferences().dailyGuidance ||
      dismissed.all === day ||
      dismissed[data?.key] === day ||
      Boolean(view?.draft || view?.localPending || view?.snapshot?.status === 'busy');
    if (root.hidden) return;
    heading.textContent = data.title;
    detail.textContent = data.detail;
    detail.title = data.detail;
    commitment.textContent = data.commitment;
    commitment.hidden = !data.commitment;
    resume.textContent = data.task ? 'Continue' : 'Let’s start';
  }
  const foreground = () => {
    if (!document.hidden && !conversationOpen && !view?.draft) {
      day = localDay(now());
      render();
    }
  };
  document.addEventListener('visibilitychange', foreground);
  return {
    update(next, nextPage, open) {
      view = next;
      page = nextPage;
      conversationOpen = open;
      render();
    },
    dismiss,
    refresh: render,
    destroy() {
      document.removeEventListener('visibilitychange', foreground);
      root.remove();
    },
  };
}
