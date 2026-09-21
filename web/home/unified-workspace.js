import {
  RETURN_AFTER_ABSENCE_MS,
  returnBriefingData,
  shouldOfferReturn,
} from './return-briefing-data.js';
import { homeAttentionLens, ANALYTIC_WINDOWS } from './attention-lens.js';
import { formatRecordedTime, recordingControlState } from './tracking-data.js';
import { homeHealth } from './health-data.js';
import { dailyStartData, localDay } from './daily-start.js';
import { progressText } from './data.js';
import { goalActionOperations, undoGoalOperations } from '../goals/editor.js';

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (label, handler, className = 'button') => {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
};
const setText = (element, value) => {
  const text = value || '';
  if (element.textContent !== text) element.textContent = text;
};
const utcDayLabel = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  timeZone: 'UTC',
});
const dayLabel = (date) => {
  try {
    return utcDayLabel.format(new Date(date + 'T12:00:00Z'));
  } catch {
    return '';
  }
};
const needsGoalReview = (status) => ['deadline-passed', 'deadline-needs-review'].includes(status);

function independentAttention(view) {
  return (homeHealth(view)?.items || []).filter(
    (item) => !['calendar', 'desktop', 'browser'].includes(item.id),
  );
}

/**
 * The Home view exposes current focus, recorded aggregates, and the check-in
 * state in one screen. It does not invent attention, progress, or a reason
 * for an intervention; writes stay with the existing task and activity owners.
 */
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
  onRecordingToggle = async () => {},
  onForegroundChange = () => {},
}) {
  const header = workspace.querySelector('.home-header');
  const heading = header.querySelector('h1');
  const board = workspace.querySelector('.board-scroll');
  const actions = header.querySelector('.header-actions');
  const date = node('time', 'unified-date');
  heading.before(date);
  const legacyActions = [
    ...actions.querySelectorAll('.add-toggle, .edit-toggle, .overflow-toggle, .save-state'),
  ];
  const goalsButton = button(
    'New goal',
    () => startGoalConversation(),
    'button unified-header-action',
  );
  const settingsButton = button(
    'Settings',
    () => showPage('settings'),
    'button unified-header-action',
  );
  actions.append(goalsButton, settingsButton);

  const overview = node('section', 'unified-overview');
  overview.setAttribute('aria-label', 'Focus, recorded context, and felis check-ins');

  const focus = node('section', 'unified-focus-panel');
  focus.setAttribute('aria-label', 'Current focus');
  const focusHeading = node('div', 'unified-panel-heading');
  focusHeading.append(node('span', 'unified-panel-kicker', 'Current focus'));
  const focusTitle = node('h2', 'unified-focus-title');
  const focusMeta = node('p', 'unified-focus-meta');
  const focusState = node('p', 'unified-focus-state');
  const focusMain = node('div', 'unified-focus-main');
  const focusProgress = node('div', 'unified-goal-progress');
  focusProgress.setAttribute('role', 'img');
  const focusProgressValue = node('strong', 'unified-goal-progress-value');
  focusProgress.append(focusProgressValue);
  const focusSummary = node('div', 'unified-focus-summary');
  focusSummary.append(focusTitle, focusMeta, focusState);
  focusMain.append(focusProgress, focusSummary);
  const calendar = button(
    '',
    () => {
      if (data?.event) openCalendar();
      else showPage('settings', { settingsSection: 'connections' });
    },
    'unified-calendar-row',
  );
  const calendarKicker = node('span', 'unified-calendar-kicker', 'Calendar');
  const calendarTitle = node('strong', 'unified-calendar-title');
  const calendarMeta = node('span', 'unified-calendar-meta');
  calendar.append(calendarKicker, calendarTitle, calendarMeta);
  const focusActions = node('div', 'unified-panel-actions');
  const focusPrimary = button(
    '',
    () => {
      if (!data?.task) {
        showPage('goals');
        return;
      }
      showPage('goals', {
        goalId: data.task.id,
        editGoal: needsGoalReview(data.status),
      });
    },
    'button primary unified-focus-primary',
  );
  const focusTalk = button(
    'Plan next step',
    () => {
      talk(
        data?.task
          ? 'Help me choose one small next step for "' + data.task.title + '".'
          : 'Help me choose one small next step for today.',
      );
    },
    'button unified-focus-talk',
  );
  focusActions.append(focusPrimary, focusTalk);
  focus.append(focusHeading, focusMain, focusActions, calendar);

  const activity = node('section', 'unified-activity-panel');
  activity.setAttribute('aria-label', 'Recorded activity');
  const activityHeading = node('div', 'unified-panel-heading');
  const activityHeadingCopy = node('div');
  activityHeadingCopy.append(node('h2', 'unified-panel-title', 'activity'));
  activityHeading.append(activityHeadingCopy);
  const openActivity = button(
    'View data as list',
    () => showPage('activity'),
    'button unified-open-activity',
  );
  const capture = node('div', 'unified-capture-row');
  const captureState = node('span', 'unified-capture-state');
  const recording = button('', () => toggleRecording(), 'button unified-recording-toggle');
  const recordingFeedback = node('span', 'unified-recording-feedback');
  recordingFeedback.setAttribute('role', 'status');
  const periodControls = node('div', 'unified-period-controls');
  periodControls.setAttribute('role', 'group');
  periodControls.setAttribute('aria-label', 'Recorded time range');
  const periodButtons = new Map();
  for (const id of ['day', 'week', 'month']) {
    const control = button(
      ANALYTIC_WINDOWS[id].label,
      () => {
        if (analyticWindow === id) return;
        analyticWindow = id;
        render();
        animateReveal([metric, plot, ranking]);
      },
      'unified-period-control',
    );
    periodControls.append(control);
    periodButtons.set(id, control);
  }
  capture.append(captureState, periodControls, recording, recordingFeedback);
  const activityVisual = node('div', 'unified-activity-visual');
  const metric = node('strong', 'unified-activity-metric');
  const metricLabel = node('span', 'unified-activity-metric-label');
  const plot = node('div', 'unified-usage-plot');
  plot.setAttribute('role', 'img');
  const sites = node('ol', 'unified-site-list');
  const ranking = node('div', 'unified-ranking');
  const rankingHeading = node('h3', 'unified-ranking-heading');
  ranking.append(rankingHeading, sites);
  const emptyUsage = node('p', 'unified-usage-empty');
  const usageScope = node('p', 'unified-activity-scope');
  const historyLimit = node('p', 'unified-history-limit');
  activityVisual.append(metric, metricLabel, plot, ranking, emptyUsage, usageScope, historyLimit);
  const sourceList = node('ul', 'unified-source-list');
  sourceList.setAttribute('aria-label', 'Connected and recording sources');
  const activityFooter = node('div', 'unified-activity-footer');
  activityFooter.append(node('span', 'unified-sources-label', 'Sources'), sourceList, openActivity);
  activity.append(activityHeading, capture, activityVisual, activityFooter);

  const agent = node('section', 'unified-agent-panel');
  agent.setAttribute('aria-label', 'felis check-in state');
  const agentHeading = node('div', 'unified-panel-heading');
  const agentHeadingCopy = node('div');
  agentHeadingCopy.append(node('h2', 'unified-panel-title', 'check-ins'));
  agentHeading.append(
    agentHeadingCopy,
    button(
      'details',
      () => showPage('activity', { activityTab: 'ai' }),
      'button unified-agent-open',
    ),
  );
  const agentStatus = node('strong', 'unified-agent-status');
  const agentDescription = node('p', 'unified-agent-description');
  const agentLatest = node('p', 'unified-agent-latest');
  const attention = node('div', 'unified-attention');
  attention.hidden = true;
  const attentionCopy = node('p', 'unified-attention-copy');
  attention.append(
    attentionCopy,
    button(
      'Review',
      () => showPage('settings', { settingsSection: 'sources' }),
      'button unified-attention-action',
    ),
  );
  agent.append(agentHeading, agentStatus, agentDescription, agentLatest, attention);
  overview.append(focus, activity, agent);
  board.before(overview);

  const dockHeader = node('div', 'unified-dock-header');
  const launcher = button(
    '',
    () => {
      if (!isOpen()) setOpen(true);
    },
    'unified-dock-launcher',
  );
  const orb = node('span', 'unified-presence');
  const dockCopy = node('span', 'unified-dock-copy');
  const dockTitle = node('strong', 'unified-dock-title', 'Talk to felis');
  const dockStatus = node('span', 'unified-dock-status');
  dockCopy.append(dockTitle, dockStatus);
  launcher.append(orb, dockCopy);
  const dockTools = node('div', 'unified-dock-tools');
  const history = button('History', onHistory, 'button unified-history');
  const conversationControl = button(
    '',
    () => setOpen(!isOpen()),
    'button unified-conversation-control',
  );
  conversationControl.setAttribute('aria-controls', 'eilo-conversation-thread');
  dockTools.append(history, conversationControl);
  dockHeader.append(launcher, dockTools);
  dock.prepend(dockHeader);

  const briefing = node('section', 'unified-briefing');
  briefing.setAttribute('aria-label', 'Welcome-back briefing');
  const goalStart = node('section', 'unified-goal-start');
  goalStart.setAttribute('aria-label', 'New goal');
  goalStart.hidden = true;
  goalStart.append(
    node('p', 'unified-goal-question', 'What would you like to work toward?'),
    button(
      'Use the form',
      () => showPage('goals', { newGoal: true }),
      'button unified-goal-manual',
    ),
  );
  const prompt = node('p', 'unified-prompt');
  let whyAnimation = null;
  const why = button(
    'Why this?',
    () => {
      whyAnimation?.cancel();
      const expanded = why.getAttribute('aria-expanded') === 'true';
      why.setAttribute('aria-expanded', String(!expanded));
      if (expanded) {
        const closing = animateReveal([whyPanel], true);
        whyAnimation = closing;
        if (closing)
          closing.finished
            .then(() => {
              whyPanel.hidden = true;
            })
            .catch(() => {});
        else whyPanel.hidden = true;
      } else {
        whyPanel.hidden = false;
        whyAnimation = animateReveal([whyPanel]);
      }
    },
    'button unified-why',
  );
  why.setAttribute('aria-expanded', 'false');
  why.setAttribute('aria-controls', 'eilo-why-this');
  const whyPanel = node('div', 'unified-why-panel');
  whyPanel.id = 'eilo-why-this';
  whyPanel.hidden = true;
  const whyHeading = node('strong', 'unified-why-heading', 'Why felis asked');
  const whyBody = node('p', 'unified-why-body');
  const whyBasis = node('p', 'unified-why-basis');
  whyPanel.append(
    whyHeading,
    whyBody,
    whyBasis,
    button(
      'Change check-ins',
      () => showPage('settings', { settingsSection: 'general' }),
      'button unified-why-settings',
    ),
  );
  const briefingStatus = node('span', 'unified-briefing-status');
  const replies = node('div', 'unified-replies');
  const completed = button(
    'Finished',
    () => changeGoal('complete'),
    'button unified-reply-primary',
  );
  const keep = button(
    'Still want to',
    () => {
      if (!data?.task) return;
      dismiss();
      showPage('goals', { goalId: data.task.id, editGoal: true });
    },
    'button',
  );
  const drop = button('Drop goal', () => changeGoal('cancel'), 'button unified-drop');
  const start = button(
    'Plan next step',
    () => {
      dismiss();
      talk(
        data?.task
          ? 'Help me choose one small next step for "' + data.task.title + '".'
          : 'Help me choose one small next step for today.',
      );
    },
    'button',
  );
  const later = button(
    'Not now',
    () => {
      dismiss();
      setOpen(false, { focus: false });
      conversationControl.focus({ preventScroll: true });
    },
    'button unified-later',
  );
  replies.append(completed, keep, drop, start, later);
  briefing.append(prompt, why, whyPanel, briefingStatus, replies);
  dock.querySelector('.conversation-thread').prepend(briefing, goalStart);
  const notice = node('div', 'unified-notice');
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  briefing.after(notice);

  const foreground = node('dialog', 'unified-return-foreground');
  foreground.setAttribute('aria-labelledby', 'eilo-return-title');
  const returnFrame = node('div', 'unified-return-frame');
  const returnOrb = node('div', 'unified-return-orb');
  const returnContent = node('div', 'unified-return-content');
  const returnTitle = node('h2', 'unified-return-title', 'Welcome back.');
  returnTitle.id = 'eilo-return-title';
  const returnFocus = node('section', 'unified-return-focus');
  returnFocus.setAttribute('aria-label', 'Where you left off');
  const returnFocusTitle = node('strong', 'unified-return-focus-title');
  const returnFocusMeta = node('span', 'unified-return-focus-meta');
  returnFocus.append(
    node('span', 'unified-return-label', 'current focus'),
    returnFocusTitle,
    returnFocusMeta,
  );
  const returnContext = node('p', 'unified-return-context');
  const returnPrompt = node('p', 'unified-return-prompt');
  const continueButton = button(
    'Continue to workspace',
    () => closeForeground(),
    'button unified-return-continue',
  );
  returnContent.append(
    node('span', 'unified-return-eyebrow', 'felis · pick up'),
    returnTitle,
    returnFocus,
    returnContext,
    returnPrompt,
    continueButton,
  );
  returnFrame.append(returnOrb, returnContent);
  foreground.append(returnFrame);
  workspace.append(foreground);
  foreground.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeForeground();
  });

  let data = null;
  let view = null;
  let page = 'home';
  let active = false;
  let boardOpen = false;
  let dockBeforeLayout = false;
  let undoRevision = null;
  let dismissed = false;
  let saving = false;
  let recordingBusy = false;
  let analyticWindow = 'week';
  let lastKey = '';
  let lastDay = '';
  let lastActiveAt = 0;
  let returnCheckPending = true;
  let returnedAfterAbsence = false;
  let lastChat = null;
  let returnRequestKey = '';
  let briefingWasVisible = false;
  let explainedPrompt = '';
  let goalMode = false;
  let foregroundEligible = false;
  let foregroundClosing = false;
  let focusStamp = '';
  let agentStamp = '';
  let enteredHome = false;
  let destroyed = false;
  let motion = null;
  const storeKey = 'eilo:unified-return:v1';
  try {
    lastDay = storage?.getItem(storeKey) || '';
    dismissed = storage?.getItem(storeKey + ':dismissed') === localDay();
    const storedActiveAt = Number(storage?.getItem(storeKey + ':active-at'));
    lastActiveAt = Number.isFinite(storedActiveAt) && storedActiveAt > 0 ? storedActiveAt : 0;
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
  const stopMotion = () => {
    for (const tween of tweens) tween.progress(1).kill();
    tweens.clear();
  };
  function enter(targets, options = {}) {
    stopMotion();
    if (!motion || preference.matches || getPreferences().reducedMotion || document.hidden) return;
    const elements = targets.filter((element) => element && !element.hidden);
    if (!elements.length) return;
    const tween = motion.fromTo(
      elements,
      { opacity: 0, y: options.y ?? 12, scale: options.scale ?? 0.985 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        duration: options.duration ?? 0.46,
        stagger: options.stagger ?? 0.045,
        ease: 'back.out(1.08)',
        clearProps: 'opacity,transform',
        onComplete: () => tweens.delete(tween),
      },
    );
    tweens.add(tween);
  }
  function animateReveal(targets, reverse = false) {
    if (preference.matches || getPreferences().reducedMotion || document.hidden) return null;
    const animations = targets
      .filter((target) => target && !target.hidden)
      .map((target) =>
        target.animate(
          reverse
            ? [
                { opacity: 1, translate: '0 0' },
                { opacity: 0, translate: '0 -6px' },
              ]
            : [
                { opacity: 0.3, translate: '0 6px' },
                { opacity: 1, translate: '0 0' },
              ],
          { duration: reverse ? 170 : 290, easing: 'cubic-bezier(.2,.8,.2,1)' },
        ),
      );
    return animations[0] || null;
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
  function startGoalConversation(input = '') {
    if (!client.canManage()) return;
    goalMode = true;
    dismiss();
    talk(`I want to set a goal: ${input}`.trimEnd());
    render();
    animateReveal([goalStart]);
  }
  function closeForeground() {
    if (!foreground.open || foregroundClosing) return;
    foregroundClosing = true;
    const finish = () => {
      foreground.close();
      foregroundClosing = false;
      foregroundEligible = false;
      onForegroundChange();
      heading.focus({ preventScroll: true });
      enter([overview, dock], { y: 8, duration: 0.38 });
    };
    if (preference.matches || getPreferences().reducedMotion) finish();
    else
      foreground
        .animate(
          [
            { opacity: 1, translate: '0 0' },
            { opacity: 0, translate: '0 -10px' },
          ],
          { duration: 260, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
        )
        .finished.then(finish, finish);
  }
  function showForeground() {
    if (
      !foregroundEligible ||
      foreground.open ||
      page !== 'home' ||
      !data ||
      view.connection !== 'connected' ||
      !getPreferences().dailyGuidance ||
      data.onBreak ||
      view.draft ||
      view.sending ||
      view.localPending ||
      view.snapshot?.status === 'busy'
    )
      return;
    const recent = dailyStartData(view);
    setText(returnFocusTitle, data.task?.title || 'Choose your next focus');
    setText(
      returnFocusMeta,
      data.task ? [data.dueLabel, progressText(data.task)].filter(Boolean).join(' \u00b7 ') : '',
    );
    returnFocusMeta.hidden = !returnFocusMeta.textContent;
    setText(
      returnContext,
      recent?.nextStep
        ? 'Last point \u00b7 ' + recent.nextStep
        : data.event
          ? data.eventLabel + ' \u00b7 ' + data.event.title
          : '',
    );
    returnContext.hidden = !returnContext.textContent;
    setText(
      returnPrompt,
      needsGoalReview(data.status)
        ? data.status === 'deadline-passed'
          ? 'Did you finish it, still want it, or want to drop it?'
          : 'Is that deadline still current?'
        : data.task
          ? 'Your focus is ready when you are.'
          : 'Start by telling e\u00eflo what matters now.',
    );
    foreground.showModal();
    onForegroundChange();
    continueButton.focus({ preventScroll: true });
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
    if (open) dockBeforeLayout = isOpen();
    boardOpen = open;
    setOpen(open ? false : dockBeforeLayout, { focus: false });
    workspace.classList.toggle('unified-show-widgets', open);
    if (open) enter([board]);
    window.dispatchEvent(new Event('resize'));
  }
  async function toggleRecording() {
    if (recordingBusy || !view || !recordingControlState(view).available) return;
    recordingBusy = true;
    recordingFeedback.textContent = 'Updating recording...';
    render();
    try {
      await onRecordingToggle();
      recordingFeedback.textContent = '';
    } catch (error) {
      recordingFeedback.textContent =
        error?.message || 'Recording could not be updated. Try again.';
    } finally {
      recordingBusy = false;
      render();
      animateReveal([captureState, recording]);
    }
  }
  async function changeGoal(action) {
    if (!data?.task || saving || !client.canManage()) return;
    const state = view.snapshot;
    const task = { ...data.task };
    const focusId = state.tasks.focus_id;
    saving = true;
    notice.hidden = true;
    render();
    try {
      const next = await client.controlTasks(
        goalActionOperations(task, action, focusId),
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
              undoGoalOperations(task, action, focusId),
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
        'button unified-notice-action',
      );
      notice.append(undo);
      notice.hidden = false;
      undo.focus({ preventScroll: true });
    } catch (error) {
      notice.textContent = error?.message || 'That goal could not be updated. Try again.';
      notice.hidden = false;
    } finally {
      saving = false;
      render();
    }
  }
  function renderSources(rows) {
    sourceList.replaceChildren();
    for (const source of rows) {
      const item = node('li', 'unified-source');
      item.dataset.tone = source.tone;
      item.title = [source.name, source.status, source.detail].filter(Boolean).join(' · ');
      const detail = node('span', 'unified-source-detail', source.detail);
      detail.hidden = !source.detail;
      item.append(node('strong', '', source.name), node('span', '', source.status), detail);
      sourceList.append(item);
    }
  }
  function renderUsage(lens) {
    const hasUsage = lens.usage.available && lens.usage.hasData;
    const period = lens.period;
    for (const [id, control] of periodButtons) {
      const supported = id !== 'month' || period.supported;
      control.disabled = !hasUsage || !supported;
      control.setAttribute('aria-pressed', String(id === analyticWindow));
      control.dataset.selected = String(id === analyticWindow);
      if (id === 'month' && !supported) {
        control.title = '31-day history is unavailable. felis retains seven days of recorded time.';
        control.setAttribute('aria-label', '31 days unavailable. Seven days are retained.');
      } else {
        control.removeAttribute('title');
        control.setAttribute('aria-label', ANALYTIC_WINDOWS[id].label + ' recorded time');
      }
    }
    activity.classList.toggle('unified-activity-empty', !hasUsage);
    activity.classList.toggle('unified-activity-no-ranking', !period.hasBreakdown);
    metric.hidden = !hasUsage;
    metricLabel.hidden = !hasUsage;
    plot.hidden = !hasUsage;
    ranking.hidden = !hasUsage || !period.hasBreakdown;
    emptyUsage.hidden = hasUsage;
    historyLimit.hidden = period.supported || !hasUsage;
    if (!hasUsage) {
      setText(
        emptyUsage,
        view?.connection === 'offline'
          ? 'Recorded activity is unavailable while felis reconnects.'
          : 'Recorded desktop apps or browser sites appear here after you enable a source.',
      );
      setText(usageScope, 'Only retained activity from enabled sources appears here.');
      plot.replaceChildren();
      sites.replaceChildren();
      return;
    }
    setText(metric, formatRecordedTime(lens.totalSeconds));
    setText(metricLabel, lens.source + ' · ' + (period.id === 'day' ? 'today' : 'last 7 days'));
    plot.dataset.period = period.id;
    plot.replaceChildren();
    plot.setAttribute(
      'aria-label',
      period.days
        .map((day) => dayLabel(day.date) + ': ' + formatRecordedTime(day.seconds) + ' recorded')
        .join('. '),
    );
    for (const day of period.days) {
      const column = node('span', 'unified-usage-column');
      const bar = node('span', 'unified-usage-bar');
      const height = Math.max(day.seconds ? 8 : 3, (day.seconds / lens.peakSeconds) * 100);
      bar.style.setProperty('--usage-height', height + '%');
      bar.title = dayLabel(day.date) + ': ' + formatRecordedTime(day.seconds) + ' recorded';
      bar.setAttribute('aria-hidden', 'true');
      column.append(bar, node('span', 'unified-usage-day', dayLabel(day.date)));
      plot.append(column);
    }
    const rankedApps = lens.source === 'desktop';
    setText(
      rankingHeading,
      rankedApps ? 'most used apps (last 7 days)' : 'most used sites (last 7 days)',
    );
    sites.setAttribute(
      'aria-label',
      rankedApps ? 'Most recorded desktop apps' : 'Most recorded browser sites',
    );
    sites.replaceChildren();
    for (const entry of lens.entries) {
      const item = node('li', 'unified-site');
      const meter = node('span', 'unified-site-meter');
      meter.style.setProperty(
        '--site-share',
        Math.max(5, (entry.seconds / Math.max(1, lens.totalSeconds)) * 100) + '%',
      );
      item.append(
        node('span', 'unified-site-host', entry.name),
        node('span', 'unified-site-time', formatRecordedTime(entry.seconds)),
        meter,
      );
      sites.append(item);
    }
    setText(
      usageScope,
      'Recorded ' + lens.source + ' time only. Gaps are not counted. Days use UTC.',
    );
    setText(historyLimit, '31-day history is unavailable while only seven days are retained.');
  }
  function render() {
    const wasActive = active;
    active = Boolean(data) && page === 'home';
    const open = isOpen();
    workspace.classList.toggle('unified-home', active);
    workspace.classList.toggle('unified-context-visible', active && open && !boardOpen);
    workspace.classList.toggle('unified-browsing', active && !open && !boardOpen);
    for (const element of [overview, date, goalsButton, settingsButton, dockHeader])
      element.hidden = !active;
    for (const legacy of legacyActions)
      legacy.hidden = active || legacy.classList.contains('overflow-toggle');
    if (!active) {
      briefing.hidden = true;
      briefingWasVisible = false;
      return;
    }

    heading.textContent = data.onBreak ? 'Taking a break' : 'Focus workspace';
    date.textContent = data.dateLabel;
    date.dateTime = localDay();

    const task = data.task;
    const review = needsGoalReview(data.status);
    setText(focusTitle, task?.title || 'Choose what to focus on');
    const hasCount = Boolean(
      task &&
      Number.isInteger(task.target_count) &&
      task.target_count > 0 &&
      Number.isInteger(task.completed_count),
    );
    focusProgress.hidden = !hasCount;
    focusMain.classList.toggle('unified-no-progress', !hasCount);
    if (hasCount) {
      setText(focusProgressValue, task.completed_count + ' / ' + task.target_count);
      focusProgress.style.setProperty(
        '--goal-progress',
        Math.min(100, Math.max(0, (task.completed_count / task.target_count) * 100)) + '%',
      );
      focusProgress.setAttribute('aria-label', progressText(task));
    }
    setText(
      focusMeta,
      task
        ? [data.dueLabel, hasCount ? '' : progressText(task)].filter(Boolean).join(' \u00b7 ')
        : '',
    );
    focusMeta.hidden = !focusMeta.textContent;
    setText(focusState, review ? 'Needs your update' : '');
    focusState.hidden = !focusState.textContent;
    focusState.dataset.needsReview = String(review);
    focusPrimary.textContent = !task ? 'Choose focus' : review ? 'Review goal' : 'Open goal';
    focusPrimary.disabled = Boolean(task && !client.canManage());
    goalsButton.disabled = !client.canManage();
    focusTalk.hidden = Boolean(task && review);
    focusTalk.disabled = !client.canManage();
    const nextFocusStamp = [task?.id, task?.completed_count, data.status].join(':');
    if (focusStamp && focusStamp !== nextFocusStamp) animateReveal([focusMain, focusPrimary]);
    focusStamp = nextFocusStamp;

    setText(calendarTitle, data.event?.title || data.calendarState || 'Calendar');
    setText(calendarMeta, data.event ? data.eventLabel || '' : '');
    calendarMeta.hidden = !calendarMeta.textContent;
    calendar.setAttribute(
      'aria-label',
      data.event ? 'Open calendar event ' + data.event.title : 'Manage Calendar connection',
    );

    const lens = homeAttentionLens(view, analyticWindow);
    const recordingState = recordingControlState(view);
    setText(
      captureState,
      recordingState.available ? recordingState.status : 'Recording unavailable',
    );
    captureState.dataset.state = recordingState.active ? 'active' : 'paused';
    recording.hidden = !recordingState.available;
    recording.disabled = recordingBusy;
    recording.textContent = recordingBusy ? 'Updating...' : recordingState.label;
    recording.dataset.state = recordingState.active ? 'active' : 'paused';
    recording.setAttribute(
      'aria-label',
      recordingState.status + '. ' + (recordingBusy ? 'Updating recording' : recordingState.label),
    );
    renderUsage(lens);

    const checkins = lens.checkins;
    setText(agentStatus, checkins.title);
    agentStatus.dataset.tone = checkins.tone;
    setText(agentDescription, checkins.description);
    const nextAgentStamp = [checkins.title, checkins.description].join(':');
    if (agentStamp && agentStamp !== nextAgentStamp) animateReveal([agentStatus, agentDescription]);
    agentStamp = nextAgentStamp;
    const latest = checkins.history[0];
    setText(agentLatest, latest ? latest.title + '. ' + latest.description : '');
    agentLatest.hidden = !agentLatest.textContent;
    renderSources(lens.sources);
    const attentionItems = independentAttention(view);
    attention.hidden = !attentionItems.length;
    if (attentionItems.length)
      setText(
        attentionCopy,
        attentionItems.length === 1
          ? attentionItems[0].title + '. ' + attentionItems[0].detail
          : attentionItems.length + ' connection details need attention.',
      );

    const preparing = view.snapshot?.return_briefing?.phase === 'preparing';
    setText(briefingStatus, preparing ? 'Putting together your catch-up...' : '');
    briefingStatus.hidden = !briefingStatus.textContent;
    setText(prompt, data.prompt);
    if (explainedPrompt !== data.prompt) {
      explainedPrompt = data.prompt;
      whyPanel.hidden = true;
      why.setAttribute('aria-expanded', 'false');
      animateReveal([prompt]);
    }
    setText(
      whyBody,
      review
        ? 'The saved deadline has passed. felis asks for your update before suggesting a next step.'
        : task
          ? 'This is your saved current focus goal. Daily welcome-back guidance is on.'
          : 'Daily welcome-back guidance is on, and there is no saved current focus goal.',
    );
    setText(
      whyBasis,
      task ? 'Based on: saved goal and daily guidance setting' : 'Based on: daily guidance setting',
    );
    const briefingVisible = !dismissed && getPreferences().dailyGuidance && !data.onBreak && open;
    briefing.hidden = !briefingVisible || goalMode;
    goalStart.hidden = !goalMode || !open;
    const composer = dock.querySelector('.live-input');
    if (composer)
      composer.placeholder = goalMode
        ? 'Describe the goal, timing, or progress…'
        : 'Tell felis what’s on your mind…';
    dock.classList.toggle('has-return-briefing', briefingVisible);
    if (briefingVisible && !briefingWasVisible)
      requestAnimationFrame(() => {
        const thread = dock.querySelector('.conversation-thread');
        if (thread) thread.scrollTop = 0;
      });
    briefingWasVisible = briefingVisible;
    for (const action of [completed, keep, drop]) {
      action.hidden = !task || !review;
      action.disabled = saving || !client.canManage();
    }
    start.hidden = Boolean(task && review);
    start.textContent = task ? 'Plan next step' : 'Choose a next step';
    start.disabled = !client.canManage();
    later.disabled = saving;

    launcher.disabled = open;
    launcher.setAttribute(
      'aria-label',
      open ? 'Conversation is open' : 'Open conversation with felis',
    );
    setText(dockStatus, checkins.title);
    history.hidden = !open;
    conversationControl.textContent = open ? 'Hide' : 'Open';
    conversationControl.setAttribute(
      'aria-label',
      open ? 'Hide conversation' : 'Open conversation',
    );
    conversationControl.setAttribute('aria-expanded', String(open));

    if (!wasActive) enter([header, overview, dock]);
  }
  function update(next, nextPage) {
    view = next;
    page = nextPage;
    data = returnBriefingData(view);
    if (page !== 'home' || view.sending || view.localPending) goalMode = false;
    if (page === 'home' && !enteredHome) {
      enteredHome = true;
      if (!isOpen()) setOpen(true, { focus: false });
    }
    const chat = view.snapshot?.conversation_id;
    if (lastChat && lastChat !== chat) {
      dismissed = true;
      notice.hidden = true;
      returnRequestKey = '';
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
      Boolean(data) &&
      !document.hidden &&
      page === 'home' &&
      view.connection === 'connected' &&
      returnCheckPending;
    const now = Date.now();
    const reason = day !== lastDay ? 'daily' : 'absence';
    const offer =
      canCheckReturn &&
      !dismissed &&
      shouldOfferReturn({
        day,
        lastDay,
        now,
        lastActiveAt: returnedAfterAbsence ? now - RETURN_AFTER_ABSENCE_MS : lastActiveAt,
        absenceMs: RETURN_AFTER_ABSENCE_MS,
        hasDraft: Boolean(view.draft),
        busy: view.sending || Boolean(view.localPending) || view.snapshot?.status === 'busy',
        onBreak: data?.onBreak,
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
      foregroundEligible = true;
      setOpen(true, { focus: false });
      const key = [chat, day, reason].join(':');
      if (returnRequestKey !== key) {
        returnRequestKey = key;
        void client.requestReturn?.(reason, day);
      }
    }
    const key = page + ':' + isOpen();
    render();
    showForeground();
    if (key !== lastKey) {
      if (active) enter([overview, dock], { y: 10, duration: 0.42 });
      else if (lastKey.split(':')[0] !== page)
        enter([header, workspace.querySelector('.workspace-page')], { y: 10, duration: 0.34 });
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
    startGoal: startGoalConversation,
    destroy() {
      destroyed = true;
      stopMotion();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      preference.removeEventListener('change', onPreference);
      layoutObserver.disconnect();
      for (const legacy of legacyActions) legacy.hidden = false;
      for (const element of [
        overview,
        date,
        goalsButton,
        settingsButton,
        dockHeader,
        briefing,
        goalStart,
        foreground,
        notice,
      ])
        element.remove();
    },
  };
}
