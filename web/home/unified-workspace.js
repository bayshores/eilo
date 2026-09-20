import {
  RETURN_AFTER_ABSENCE_MS,
  returnBriefingData,
  shouldOfferReturn,
} from './return-briefing-data.js';
import { selectTracking } from './tracking-data.js';
import { homeHealth } from './health-data.js';
import { localDay } from './daily-start.js';
import { progressText } from './data.js';
import { goalActionOperations, undoGoalOperations } from '../goals/editor.js';

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (label, run, cls = 'button') => {
  const el = node('button', cls, label);
  el.type = 'button';
  el.addEventListener('click', run);
  return el;
};
const icon = (name) => {
  const el = node('span', 'unified-icon');
  el.innerHTML = '<svg aria-hidden="true"><use href="#' + name + '"/></svg>';
  return el;
};

// Presentation only; writes use the existing revisioned task service.
export function mountUnifiedWorkspace({
  workspace,
  dock,
  client,
  getPreferences,
  storage,
  setOpen,
  isOpen,
  talk,
  showPage,
  openCalendar,
  onHistory,
}) {
  const header = workspace.querySelector('.home-header');
  const heading = header.querySelector('h1');
  const board = workspace.querySelector('.board-scroll');
  const date = node('time', 'unified-date');
  heading.before(date);
  const summary = node('section', 'unified-summary');
  summary.setAttribute('aria-label', 'Your day');
  function card(kind) {
    const trigger = button(
      '',
      () =>
        ['event', 'health'].includes(kind)
          ? toggleDetail(kind)
          : showPage(kind === 'goal' ? 'goals' : 'activity'),
      'unified-card unified-' + kind,
    );
    const copy = node('span', 'unified-card-copy');
    const title = node('strong', 'unified-card-title');
    const meta = node('span', 'unified-card-meta');
    const state = node('span', 'unified-card-state');
    copy.append(
      node(
        'span',
        'unified-card-eyebrow',
        kind === 'event'
          ? 'Coming up'
          : kind === 'goal'
            ? 'Your goals'
            : kind === 'health'
              ? 'Needs attention'
              : 'Activity',
      ),
    );
    copy.append(title, meta, state);
    const disclosure = node('span', 'unified-disclosure');
    disclosure.setAttribute('aria-hidden', 'true');
    trigger.append(copy, disclosure);
    trigger.setAttribute(
      'aria-controls',
      ['event', 'health'].includes(kind) ? 'unified-detail' : 'workspace-inspector',
    );
    if (['event', 'health'].includes(kind)) trigger.setAttribute('aria-expanded', 'false');
    else trigger.setAttribute('aria-haspopup', 'dialog');
    summary.append(trigger);
    return { trigger, title, meta, state };
  }
  const goal = card('goal'),
    event = card('event'),
    activity = card('activity'),
    health = card('health');
  const detail = node('section', 'unified-detail');
  detail.id = 'unified-detail';
  detail.hidden = true;
  detail.setAttribute('aria-label', 'Selected widget details');
  board.before(summary, detail);
  const settings = button('Settings', () => showPage('settings'), 'button unified-settings');
  header.querySelector('.header-actions').append(settings);
  const dockHeader = node('div', 'unified-dock-header');
  const orb = node('div', 'unified-presence');
  const tools = node('div', 'unified-dock-tools');
  const history = button('History', onHistory, 'text-button');
  const toggle = button(
    '',
    () => setOpen(!isOpen(), { focus: false }),
    'icon-button unified-dock-toggle',
  );
  toggle.append(icon('arrow-down'));
  toggle.setAttribute('aria-controls', 'eilo-conversation-thread');
  tools.append(history, toggle);
  dockHeader.append(orb, node('h2', '', 'Talk to eïlo'), tools);
  dock.prepend(dockHeader);
  const briefing = node('section', 'unified-briefing');
  briefing.setAttribute('aria-label', 'Welcome-back briefing');
  const prompt = node('p', 'unified-prompt'),
    briefingStatus = node('span', 'unified-briefing-status'),
    actions = node('div', 'unified-replies');
  const completed = button('Finished', () => changeGoal('complete'));
  const keep = button('Still want to', () => {
    if (!data?.task) return;
    dismiss();
    showPage('goals', { goalId: data.task.id, editGoal: true });
  });
  const drop = button('Drop goal', () => changeGoal('cancel'), 'button unified-drop');
  const start = button('Plan next step', () => {
    dismiss();
    talk(
      data?.task
        ? 'Help me choose one small next step for “' + data.task.title + '”.'
        : 'Help me choose one small next step for today.',
    );
  });
  const later = button(
    'Not now',
    () => {
      dismiss();
      setOpen(false, { focus: false });
      toggle.focus();
    },
    'text-button unified-later',
  );
  actions.append(completed, keep, drop, start, later);
  briefing.append(prompt, briefingStatus, actions);
  dock.querySelector('.conversation-thread').prepend(briefing);
  const notice = node('div', 'unified-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  briefing.after(notice);
  let data = null,
    healthState = null,
    view = null,
    page = 'home',
    active = false,
    boardOpen = false,
    dockBeforeLayout = false;
  let selection = null,
    selectionContext = null,
    detailKey = '',
    undoRevision = null,
    lastKey = '',
    dismissed = false,
    saving = false;
  let lastDay = '',
    lastActiveAt = 0,
    returnCheckPending = true,
    returnedAfterAbsence = false,
    lastChat = null,
    returnRequestKey = '',
    destroyed = false,
    motion = null;
  const storeKey = 'eilo:unified-return:v1';
  try {
    lastDay = storage?.getItem(storeKey) || '';
    dismissed = storage?.getItem(storeKey + ':dismissed') === localDay();
    const savedActiveAt = Number(storage?.getItem(storeKey + ':active-at'));
    lastActiveAt = Number.isFinite(savedActiveAt) && savedActiveAt > 0 ? savedActiveAt : 0;
  } catch {
    lastDay = '';
  }
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  import('../adaptive/dependencies.js')
    .then(({ gsap }) => {
      if (!destroyed) motion = gsap;
    })
    .catch(() => {
      motion = null;
    });
  const tweens = new Set();
  function stopMotion() {
    for (const tween of tweens) tween.progress(1).kill();
    tweens.clear();
  }
  function enter(targets) {
    stopMotion();
    if (!motion || preference.matches || getPreferences().reducedMotion || document.hidden) return;
    const elements = targets.filter((el) => el && !el.hidden);
    if (!elements.length) return;
    const tween = motion.fromTo(
      elements,
      { opacity: 0, y: 14, scale: 0.99 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: 0.46,
        stagger: 0.045,
        ease: 'back.out(1.15)',
        clearProps: 'opacity,transform',
        onComplete: () => tweens.delete(tween),
      },
    );
    tweens.add(tween);
  }
  function dismiss() {
    dismissed = true;
    try {
      storage?.setItem(storeKey + ':dismissed', localDay());
    } catch {
      dismissed = true;
    }
    render();
  }
  function rememberActive(at = Date.now()) {
    if (!Number.isFinite(at) || at <= 0) return;
    lastActiveAt = at;
    try {
      storage?.setItem(storeKey + ':active-at', String(at));
    } catch {
      return;
    }
  }
  function setBoard(open) {
    if (open) {
      dockBeforeLayout = isOpen();
      closeDetail(false);
    }
    boardOpen = open;
    setOpen(open ? false : dockBeforeLayout, { focus: false });
    workspace.classList.toggle('unified-show-widgets', open);
    if (open) enter([board]);
    window.dispatchEvent(new Event('resize'));
  }
  function detailValue(kind) {
    if (kind === 'goal') return data.task;
    if (kind === 'health') return healthState?.items || [];
    return [data.event, data.calendarState];
  }
  function detailTrigger(kind = selection) {
    return { goal: goal.trigger, event: event.trigger, health: health.trigger }[kind] || null;
  }
  function closeDetail(focus = true) {
    const trigger = detailTrigger();
    selection = null;
    detail.hidden = true;
    goal.trigger.setAttribute('aria-expanded', 'false');
    event.trigger.setAttribute('aria-expanded', 'false');
    health.trigger.setAttribute('aria-expanded', 'false');
    if (focus && trigger) trigger.focus({ preventScroll: true });
  }
  function toggleDetail(kind) {
    if (selection === kind) return closeDetail();
    selection = kind;
    selectionContext = view.snapshot.conversation_id;
    detailKey = JSON.stringify(detailValue(kind));
    goal.trigger.setAttribute('aria-expanded', String(kind === 'goal'));
    event.trigger.setAttribute('aria-expanded', String(kind === 'event'));
    health.trigger.setAttribute('aria-expanded', String(kind === 'health'));
    detail.replaceChildren();
    detail.hidden = false;
    const title = node(
      'h2',
      '',
      kind === 'goal'
        ? data.task?.title || 'Your goals'
        : kind === 'health'
          ? 'Needs attention'
          : data.event?.title || 'Calendar',
    );
    title.tabIndex = -1;
    detail.append(
      button('Close', () => closeDetail(), 'text-button unified-detail-close'),
      title,
    );
    if (kind === 'health') {
      const items = healthState?.items || [];
      detail.append(node('p', '', healthState?.detail || 'Everything is up to date.'));
      for (const item of items) {
        const row = node('article', 'unified-health-item');
        row.append(node('h3', '', item.title), node('p', '', item.detail));
        row.append(
          button(item.action, () => {
            closeDetail(false);
            if (item.id === 'checkins') showPage('activity', { activityTab: 'ai' });
            else
              showPage('settings', {
                settingsSection: 'sources',
                connectionId: item.id === 'browser' ? 'browser-activity' : item.id,
              });
          }),
        );
        detail.append(row);
      }
    } else if (kind === 'goal' && data.task) {
      const task = data.task;
      detail.append(
        node(
          'p',
          '',
          [task.due_text, progressText(task)].filter(Boolean).join(' · ') || 'No deadline set.',
        ),
      );
      if (['deadline-passed', 'deadline-needs-review'].includes(data.status))
        detail.append(
          button('Review deadline', () => {
            closeDetail(false);
            dismiss();
            showPage('goals', { goalId: task.id, editGoal: true });
          }),
        );
      detail.append(button('Discuss this goal', () => talk('About “' + task.title + '”: ')));
      detail.append(button('Manage goals', () => showPage('goals'), 'text-button'));
    } else if (kind === 'goal') {
      detail.append(node('p', '', 'Choose what you want to focus on.'));
      detail.append(button('Choose a goal', () => showPage('goals')));
    } else {
      detail.append(node('p', '', data.eventLabel));
      detail.append(
        button(data.event ? 'See today’s events' : 'Manage Calendar', () =>
          data.event ? openCalendar() : showPage('settings', { settingsSection: 'connections' }),
        ),
      );
    }
    enter([detail]);
    title.focus({ preventScroll: true });
  }
  detail.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
    }
  });
  async function changeGoal(action) {
    if (!data?.task || saving || !client.canManage()) return;
    const state = view.snapshot,
      task = { ...data.task },
      focus = state.tasks.focus_id;
    saving = true;
    notice.hidden = true;
    render();
    try {
      const next = await client.controlTasks(
        goalActionOperations(task, action, focus),
        state.tasks.revision,
        state.conversation_id,
      );
      if (view.snapshot.conversation_id !== state.conversation_id || page !== 'home') return;
      undoRevision = next.tasks.revision;
      dismiss();
      notice.replaceChildren(
        node('span', '', action === 'complete' ? 'Goal completed.' : 'Goal cancelled.'),
      );
      const undo = button(
        'Undo',
        async () => {
          undo.disabled = true;
          try {
            if (view.snapshot.conversation_id !== state.conversation_id)
              throw new Error('Return to the original conversation to undo.');
            await client.controlTasks(
              undoGoalOperations(task, action, focus),
              next.tasks.revision,
              state.conversation_id,
            );
            notice.hidden = true;
            undoRevision = null;
            dismissed = false;
            try {
              storage?.removeItem(storeKey + ':dismissed');
            } catch {
              dismissed = false;
            }
            render();
            completed.focus({ preventScroll: true });
          } catch (error) {
            notice.replaceChildren(node('span', '', error.message));
          }
        },
        'text-button',
      );
      notice.append(undo);
      notice.hidden = false;
      undo.focus({ preventScroll: true });
    } catch (error) {
      notice.textContent = error.message || 'That goal could not be updated. Try again.';
      notice.hidden = false;
    } finally {
      saving = false;
      render();
    }
  }
  function render() {
    const previous = active;
    active = !!data && page === 'home';
    healthState = homeHealth(view);
    const open = isOpen();
    const showContext = active && open && !boardOpen;
    const contextChanged = workspace.classList.contains('unified-context-visible') !== showContext;
    workspace.classList.toggle('unified-home', active);
    workspace.classList.toggle('unified-browsing', active && !open && !boardOpen);
    workspace.classList.toggle('unified-context-visible', showContext);
    if (contextChanged && active)
      requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
        enter([board, dock]);
      });
    for (const el of [summary, date, dockHeader, settings]) el.hidden = !active;
    if (!active) {
      briefing.hidden = true;
      detail.hidden = true;
      return;
    }
    heading.textContent = data.onBreak ? 'Take your time' : 'Welcome back';
    date.textContent = data.dateLabel;
    date.dateTime = localDay();
    goal.title.textContent = data.task?.title || 'Choose your focus';
    goal.meta.textContent = data.dueLabel || 'One thing to work on';
    goal.state.textContent = data.goalLabel || '';
    goal.state.hidden = !goal.state.textContent;
    event.title.textContent = data.event?.title || data.calendarState;
    event.meta.textContent = data.eventLabel;
    event.state.hidden = true;
    const sources = selectTracking(view).rows.filter((row) =>
      ['desktop', 'browser'].includes(row.id),
    );
    const recording = sources.some((row) => ['Collecting', 'Sharing'].includes(row.status));
    const paused = sources.some((row) => row.status === 'Paused');
    activity.title.textContent = recording
      ? 'Recording activity'
      : paused
        ? 'Recording paused'
        : 'Your activity';
    activity.meta.textContent = sources.map((row) => row.name + ': ' + row.status).join(' · ');
    activity.state.textContent = paused ? 'Resume in Activity' : '';
    activity.state.hidden = !activity.state.textContent;
    health.trigger.hidden = !healthState.items.length;
    health.title.textContent = healthState.title;
    health.meta.textContent = healthState.detail;
    health.state.hidden = true;
    activity.trigger.setAttribute('aria-label', 'Open activity');
    goal.trigger.setAttribute(
      'aria-label',
      data.task ? 'Details for ' + data.task.title : 'Choose your focus',
    );
    event.trigger.setAttribute(
      'aria-label',
      data.event ? 'Details for ' + data.event.title : data.calendarState,
    );
    health.trigger.setAttribute('aria-label', healthState.title || 'Needs attention');
    toggle.setAttribute('aria-label', open ? 'Collapse conversation' : 'Expand conversation');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('use').setAttribute('href', open ? '#arrow-down' : '#arrow-up');
    history.hidden = !open;
    prompt.textContent = data.prompt;
    const preparingReturn = view.snapshot?.return_briefing?.phase === 'preparing';
    briefingStatus.textContent = preparingReturn ? 'Putting together your catch-up...' : '';
    briefingStatus.hidden = !preparingReturn;
    const empty = dock.querySelector('.conversation-empty-state .live-empty');
    if (empty)
      empty.textContent = data.task
        ? 'What would help you get started?'
        : 'What would you like to work on next?';
    briefing.hidden = dismissed || !getPreferences().dailyGuidance || data.onBreak || !open;
    dock.classList.toggle('has-return-briefing', !briefing.hidden);
    const needsReview = ['deadline-passed', 'deadline-needs-review'].includes(data.status);
    for (const action of [completed, keep, drop]) {
      action.hidden = !data.task || !needsReview;
      action.disabled = saving || !client.canManage();
    }
    start.hidden = !!data.task && needsReview;
    start.textContent = data.task ? 'Plan next step' : 'Choose a next step';
    start.disabled = !client.canManage();
    later.disabled = saving;
    if (
      selection &&
      (selectionContext !== view.snapshot.conversation_id ||
        detailKey !== JSON.stringify(detailValue(selection)))
    )
      closeDetail(false);
    if (!previous) enter([header, summary, dock]);
  }
  function update(next, nextPage) {
    view = next;
    page = nextPage;
    data = returnBriefingData(view);
    const chat = view.snapshot?.conversation_id;
    if (lastChat && lastChat !== chat) {
      dismissed = true;
      notice.hidden = true;
      returnRequestKey = '';
      closeDetail(false);
    }
    lastChat = chat;
    const day = localDay();
    if (
      undoRevision !== null &&
      (page !== 'home' || view.snapshot?.tasks?.revision !== undoRevision)
    ) {
      notice.hidden = true;
      undoRevision = null;
    }
    const canCheckReturn =
      !!data &&
      !document.hidden &&
      page === 'home' &&
      view.connection === 'connected' &&
      returnCheckPending;
    const now = Date.now();
    const returnReason = day !== lastDay ? 'daily' : 'absence';
    const offer =
      canCheckReturn &&
      !dismissed &&
      shouldOfferReturn({
        day,
        lastDay,
        now,
        lastActiveAt: returnedAfterAbsence ? now - RETURN_AFTER_ABSENCE_MS : lastActiveAt,
        absenceMs: RETURN_AFTER_ABSENCE_MS,
        hasDraft: !!view.draft,
        busy: view.sending || !!view.localPending || view.snapshot?.status === 'busy',
        onBreak: data.onBreak,
        guidance: getPreferences().dailyGuidance,
        onboarding: view.snapshot?.onboarding,
      });
    if (canCheckReturn) {
      returnCheckPending = false;
      returnedAfterAbsence = false;
      lastDay = day;
      try {
        storage?.setItem(storeKey, day);
      } catch {
        console.warn('Return preference could not be saved.');
      }
      rememberActive(now);
    }
    if (offer) {
      dismissed = false;
      setOpen(true, { focus: false });
      const requestKey = [chat, day, returnReason].join(':');
      if (returnRequestKey !== requestKey) {
        returnRequestKey = requestKey;
        void client.requestReturn?.(returnReason, day);
      }
    }
    const key = page + ':' + isOpen();
    render();
    if (key !== lastKey) {
      if (active) enter([dock]);
      else if (lastKey.split(':')[0] !== page)
        enter([header, workspace.querySelector('.workspace-page')]);
    }
    lastKey = key;
  }
  const refresh = () => {
    if (view) update(view, page);
  };
  const onVisibility = () => {
    if (document.hidden) {
      rememberActive();
      stopMotion();
      return;
    }
    const now = Date.now();
    returnedAfterAbsence = Boolean(lastActiveAt && now - lastActiveAt >= RETURN_AFTER_ABSENCE_MS);
    if (returnedAfterAbsence) returnCheckPending = true;
    rememberActive(now);
    refresh();
  };
  const onPageHide = () => rememberActive();
  const onPreference = () => {
    stopMotion();
    render();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  preference.addEventListener('change', onPreference);
  const timer = setInterval(refresh, 60000);
  const appWindow = workspace.closest('.app-window');
  const syncLayoutMode = () => {
    const editing =
      appWindow.classList.contains('editing') || appWindow.classList.contains('placing-widget');
    if (editing !== boardOpen) setBoard(editing);
  };
  const layoutObserver = new MutationObserver(syncLayoutMode);
  layoutObserver.observe(appWindow, { attributes: true, attributeFilter: ['class'] });
  syncLayoutMode();
  return {
    get active() {
      return active;
    },
    update,
    refresh,
    dismiss,
    destroy() {
      destroyed = true;
      stopMotion();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      preference.removeEventListener('change', onPreference);
      layoutObserver.disconnect();
      for (const el of [summary, detail, date, dockHeader, briefing, notice, settings]) el.remove();
    },
  };
}
