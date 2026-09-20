const RUN_STATUSES = new Set([
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
]);
const STEP_STATUSES = new Set(['pending', 'running', 'completed', 'failed', 'skipped']);
const TERMINAL_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);

const WORKFLOW_DISMISSAL_KEY = 'eilo:dismissed-workflow-runs:v1';
const WORKFLOW_DISMISSAL_CAP = 100;

const savedRunId = (value) =>
  typeof value === 'string' && value.trim() && value.length <= 160 ? value : '';

/** Presentation-only receipts keep completed source runs from returning after restart. */
export function loadWorkflowDismissals(storage = null) {
  try {
    const saved = JSON.parse(storage?.getItem(WORKFLOW_DISMISSAL_KEY) || '[]');
    return Array.isArray(saved)
      ? [...new Set(saved.map(savedRunId).filter(Boolean))].slice(-WORKFLOW_DISMISSAL_CAP)
      : [];
  } catch {
    return [];
  }
}

export function rememberWorkflowDismissal(storage = null, current = [], runId) {
  const id = savedRunId(runId);
  const prior = Array.isArray(current) ? current.map(savedRunId).filter(Boolean) : [];
  const next = id ? [...new Set([...prior.filter((value) => value !== id), id])] : prior;
  const retained = next.slice(-WORKFLOW_DISMISSAL_CAP);
  try {
    storage?.setItem(WORKFLOW_DISMISSAL_KEY, JSON.stringify(retained));
  } catch {
    /* A current session can still keep its dismissed card out of the way. */
  }
  return retained;
}

const permittedSourceUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.origin === 'https://mail.google.com' || url.origin === 'https://calendar.google.com')
      ? url.href
      : '';
  } catch {
    return '';
  }
};

const statusCopy = {
  running: 'Working on your briefing',
  completed: 'Briefing ready',
  partial: 'Briefing ready with gaps',
  failed: 'Briefing could not be completed',
  cancelled: 'Briefing cancelled',
  interrupted: 'Briefing interrupted',
};

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

export function normalizeWorkflowRun(run = {}) {
  const status = RUN_STATUSES.has(run.status) ? run.status : 'running';
  const steps = Array.isArray(run.steps)
    ? run.steps.map((step, index) => ({
        id: String(step?.id || `step-${index}`),
        label: String(step?.label || 'Untitled step'),
        status: STEP_STATUSES.has(step?.status) ? step.status : 'pending',
        detail: typeof step?.detail === 'string' ? step.detail : '',
        completed_count: Number.isFinite(step?.completed_count) ? step.completed_count : null,
        total_count: Number.isFinite(step?.total_count) ? step.total_count : null,
      }))
    : [];
  return {
    id: String(run.id || ''),
    status,
    title:
      typeof run.title === 'string' && run.title.trim()
        ? run.title.trim()
        : 'Preparing your briefing',
    started_at: run.started_at || null,
    finished_at: run.finished_at || null,
    steps,
    sources_checked: Number.isFinite(run.sources_checked) ? Math.max(0, run.sources_checked) : null,
    needs_connection: Boolean(run.needs_connection),
    sources: Array.isArray(run.sources)
      ? run.sources.map((source, index) => ({
          id: String(source?.id || `source-${index}`),
          label:
            typeof source?.label === 'string' && source.label.trim()
              ? source.label.trim()
              : 'Open source',
          url: typeof source?.url === 'string' ? source.url : '',
        }))
      : [],
    summary: typeof run.summary === 'string' ? run.summary.trim() : '',
    can_cancel: Boolean(run.can_cancel) && status === 'running',
  };
}

export function workflowTransition(previous, next) {
  const before = previous ? normalizeWorkflowRun(previous) : null;
  const after = normalizeWorkflowRun(next);
  const terminal = new Set(['completed', 'partial', 'failed', 'cancelled', 'interrupted']);
  return {
    run: after,
    changed: !before || JSON.stringify(before) !== JSON.stringify(after),
    enteredTerminal: Boolean(
      before && before.status !== after.status && terminal.has(after.status),
    ),
    currentStep: after.steps.find((step) => step.status === 'running') || null,
  };
}

function stepState(step) {
  if (step.status === 'completed') return 'Done';
  if (step.status === 'failed') return 'Needs attention';
  if (step.status === 'skipped') return 'Skipped';
  if (step.status === 'running') return 'In progress';
  return 'Waiting';
}

function stepCount(step) {
  if (step.completed_count === null || step.total_count === null) return '';
  return `${step.completed_count} of ${step.total_count}`;
}

export function mountWorkflowProgress(
  container,
  {
    onCancel = () => {},
    onConnect = () => {},
    onDismiss = () => {},
    onOpenSource = () => false,
  } = {},
) {
  if (!(container instanceof Element))
    throw new TypeError('mountWorkflowProgress requires a DOM element container.');
  const root = node('section', 'workflow-progress');
  root.setAttribute('aria-label', 'Briefing progress');
  root.setAttribute('aria-live', 'off');
  const heading = node('div', 'workflow-progress__heading');
  const eyebrow = node('p', 'workflow-progress__eyebrow');
  const title = node('h2', 'workflow-progress__title');
  const current = node('p', 'workflow-progress__current');
  const facts = node('p', 'workflow-progress__facts');
  const details = node('div', 'workflow-progress__details');
  details.id = `workflow-progress-${Math.random().toString(36).slice(2)}`;
  const list = node('ol', 'workflow-progress__steps');
  const sources = node('div', 'workflow-progress__sources');
  details.append(list, sources);
  const actions = node('div', 'workflow-progress__actions');
  const detailToggle = node('button', 'workflow-progress__button', 'Details');
  detailToggle.type = 'button';
  detailToggle.setAttribute('aria-controls', details.id);
  const cancel = node(
    'button',
    'workflow-progress__button workflow-progress__button--quiet',
    'Stop briefing',
  );
  cancel.type = 'button';
  const connect = node(
    'button',
    'workflow-progress__button workflow-progress__button--primary',
    'Connect a source',
  );
  connect.type = 'button';
  const dismiss = node(
    'button',
    'workflow-progress__button workflow-progress__button--quiet',
    'Dismiss',
  );
  dismiss.type = 'button';
  const announcement = node('p', 'workflow-progress__announcement');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  root.append(heading, current, facts, details, actions, announcement);
  container.replaceChildren(root);

  let activeRun = null;
  let expanded = false;
  let destroyed = false;
  const setExpanded = (value) => {
    expanded = value;
    details.hidden = !expanded;
    detailToggle.setAttribute('aria-expanded', String(expanded));
    detailToggle.textContent = expanded ? 'Hide details' : 'Details';
  };
  detailToggle.addEventListener('click', () => setExpanded(!expanded));
  cancel.addEventListener('click', () => activeRun && onCancel(activeRun));
  connect.addEventListener('click', () => activeRun && onConnect(activeRun));
  dismiss.addEventListener('click', () => activeRun && onDismiss(activeRun));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      setExpanded(false);
      detailToggle.focus();
    }
  });

  function render(nextRun) {
    if (destroyed) return;
    const priorFocus =
      document.activeElement === detailToggle
        ? 'details'
        : document.activeElement === cancel
          ? 'cancel'
          : document.activeElement === dismiss
            ? 'dismiss'
            : '';
    const transition = workflowTransition(activeRun, nextRun);
    if (!transition.changed) return;
    activeRun = transition.run;
    const run = activeRun;
    root.dataset.status = run.status;
    eyebrow.textContent = statusCopy[run.status];
    title.textContent = run.title;
    heading.replaceChildren(eyebrow, title);
    const running = transition.currentStep;
    current.textContent = running
      ? running.label
      : run.summary ||
        (run.steps.length ? 'No step is currently running.' : 'No source checks have started.');
    facts.replaceChildren();
    if (running?.detail) facts.append(node('span', '', running.detail));
    if (running && stepCount(running)) facts.append(node('span', '', stepCount(running)));
    if (run.sources_checked !== null)
      facts.append(
        node(
          'span',
          '',
          `${run.sources_checked} source${run.sources_checked === 1 ? '' : 's'} checked`,
        ),
      );
    facts.hidden = !facts.childElementCount;
    list.replaceChildren();
    run.steps.forEach((step) => {
      const item = node('li', `workflow-progress__step is-${step.status}`);
      const marker = node('span', 'workflow-progress__marker');
      marker.setAttribute('aria-hidden', 'true');
      const copy = node('div', 'workflow-progress__step-copy');
      copy.append(node('strong', '', step.label));
      const meta = [stepState(step), stepCount(step), step.detail].filter(Boolean).join(' · ');
      if (meta) copy.append(node('span', '', meta));
      item.append(marker, copy);
      list.append(item);
    });
    sources.replaceChildren();
    const safeSources = run.sources
      .map((source) => ({ ...source, safeUrl: permittedSourceUrl(source.url) }))
      .filter((source) => source.safeUrl);
    if (safeSources.length) {
      sources.append(node('p', 'workflow-progress__sources-label', 'Sources checked'));
      const sourceList = node('div', 'workflow-progress__source-list');
      safeSources.forEach((source) => {
        const link = node('a', 'workflow-progress__source', source.label);
        link.href = source.safeUrl;
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.addEventListener('click', (event) => {
          if (link.dataset.allowFallback === 'true') {
            delete link.dataset.allowFallback;
            return;
          }
          event.preventDefault();
          Promise.resolve(onOpenSource(run, source))
            .then((opened) => {
              if (opened === false && link.isConnected) {
                link.dataset.allowFallback = 'true';
                link.click();
              }
            })
            .catch(() => {
              /* Keep the source private; the native layer owns errors. */
            });
        });
        sourceList.append(link);
      });
      sources.append(sourceList);
    }
    details.hidden = !expanded;
    detailToggle.hidden = run.steps.length === 0;
    cancel.hidden = !run.can_cancel;
    connect.hidden =
      !run.needs_connection && (Boolean(run.steps.length) || run.status === 'running');
    dismiss.hidden = !TERMINAL_STATUSES.has(run.status);
    actions.replaceChildren(detailToggle, cancel, connect, dismiss);
    actions.hidden = [...actions.children].every((button) => button.hidden);
    if (transition.enteredTerminal) {
      setExpanded(false);
      announcement.textContent = `${statusCopy[run.status]}.`;
    } else announcement.textContent = '';
    if (priorFocus === 'details' && !detailToggle.hidden)
      detailToggle.focus({ preventScroll: true });
    if (priorFocus === 'cancel' && !cancel.hidden) cancel.focus({ preventScroll: true });
    if (priorFocus === 'dismiss' && !dismiss.hidden) dismiss.focus({ preventScroll: true });
  }

  setExpanded(false);
  return {
    update: render,
    destroy() {
      destroyed = true;
      root.remove();
    },
  };
}
