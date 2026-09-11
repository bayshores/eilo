import { mountDesktopSetup } from '../activity/desktop-setup.js';

const FLAGS = [
  'enabled',
  'desktop_enabled',
  'browser_enabled',
  'text_enabled',
  'visuals_enabled',
  'ai_enabled',
];
const KIND_LABELS = {
  intention: 'Current intention',
  resume: 'Return point',
  outline: 'Outline',
  stages: 'Stages',
  resources: 'Resources',
  comparison: 'Comparison',
  note: 'Notes',
  timeline: 'Timeline',
  usage: 'Usage',
  connections: 'Tracking',
};

/** A layout preference never grants capture or AI access. */
export function contextPolicyPatch(current, changes) {
  const policy = current?.policy || {};
  return {
    ...Object.fromEntries(FLAGS.map((flag) => [flag, policy[flag] === true])),
    excluded_domains: [...(policy.excluded_domains || [])],
    excluded_bundle_ids: [...(policy.excluded_bundle_ids || [])],
    ...changes,
  };
}

export function contextSummary(current) {
  if (!current) return { label: 'Unavailable', tone: 'quiet' };
  if (!current.policy?.ai_enabled) return { label: 'Off', tone: 'quiet' };
  if (current.analysis?.status === 'updating') return { label: 'Updating', tone: 'active' };
  if (['error', 'unavailable'].includes(current.analysis?.status))
    return { label: 'Needs attention', tone: 'attention' };
  if (current.analysis?.status === 'budget_paused') return { label: 'Paused', tone: 'quiet' };
  return current.current_work_context
    ? { label: 'Ready', tone: 'active' }
    : { label: 'Waiting', tone: 'quiet' };
}

export function canSaveContextCorrection(current, original) {
  return Boolean(
    current &&
    original &&
    ['id', 'title', 'return_point'].every((key) => current[key] === original[key]),
  );
}

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (label, className = 'text-button') => {
  const element = node('button', className, label);
  element.type = 'button';
  return element;
};
const iconButton = (name, label) => {
  const element = button('', 'context-icon-button');
  element.setAttribute('aria-label', label);
  element.innerHTML = `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
  return element;
};
const section = (title) => {
  const element = node('section', 'context-section');
  if (title) element.append(node('h3', 'context-section__title', title));
  return element;
};
const field = (label, placeholder, maximum) => {
  const wrapper = node('label', 'context-field');
  const input = node('input');
  input.placeholder = placeholder;
  input.maxLength = maximum;
  wrapper.append(node('span', '', label), input);
  return { wrapper, input };
};

/** The drawer owns editable controls; background Home updates never rebuild it. */
export function createContextPanel({
  onCommand,
  onTalk,
  onConnections,
  onRefreshSources,
  onClose,
} = {}) {
  const dialog = node('dialog', 'context-panel');
  dialog.setAttribute('aria-labelledby', 'context-panel-title');
  const header = node('header', 'context-panel__header');
  const heading = node('div');
  heading.append(node('h2', '', 'Home context'), node('p', '', 'Help Home follow your work.'));
  heading.querySelector('h2').id = 'context-panel-title';
  const close = iconButton('x', 'Close Home context');
  header.append(heading, close);
  const tabs = node('div', 'context-panel__tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Home context settings');
  const body = node('div', 'context-panel__body');
  const error = node('p', 'context-panel__error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const panels = new Map();
  const tabButtons = new Map();
  const mutators = new Set();
  const switches = new Map();
  let current = null,
    busy = false,
    selected = 'overview',
    trigger = null,
    afterClose = null,
    editBasis = null,
    renderedKey = '',
    preferencesKey = '',
    exclusionsKey = '';
  let desktopGuide = null,
    showDesktopGuide = false;

  function selectTab(id, focus = false) {
    selected = id;
    for (const [key, tab] of tabButtons) {
      tab.setAttribute('aria-selected', String(key === id));
      tab.tabIndex = key === id ? 0 : -1;
      panels.get(key).hidden = key !== id;
    }
    if (id !== 'sources') desktopGuide?.pause();
    if (focus) tabButtons.get(id).focus();
    body.scrollTop = 0;
  }
  for (const [id, label] of [
    ['overview', 'Overview'],
    ['sources', 'Sources'],
    ['memory', 'Memory'],
  ]) {
    const tab = button(label, 'context-panel__tab');
    tab.id = `context-tab-${id}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `context-view-${id}`);
    const panel = node('div', 'context-panel__view');
    panel.id = `context-view-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tab.addEventListener('click', () => selectTab(id));
    tab.addEventListener('keydown', (event) => {
      const ids = [...tabButtons.keys()];
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step && !['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target =
        event.key === 'Home'
          ? ids[0]
          : event.key === 'End'
            ? ids.at(-1)
            : ids[(ids.indexOf(id) + step + ids.length) % ids.length];
      selectTab(target, true);
    });
    tabButtons.set(id, tab);
    panels.set(id, panel);
    tabs.append(tab);
    body.append(panel);
  }

  async function run(lane, action, fields = {}) {
    if (busy || !current) return false;
    const active = document.activeElement;
    busy = true;
    error.hidden = true;
    syncDisabled();
    try {
      const ok = await onCommand(lane, action, fields);
      return ok;
    } finally {
      busy = false;
      syncDisabled();
      syncSwitches();
      if (active?.isConnected && document.activeElement === document.body)
        active.focus({ preventScroll: true });
    }
  }
  function action(label, lane, name, fields = () => ({}), className = 'text-button') {
    const control = button(label, className);
    mutators.add(control);
    control.addEventListener('click', () => void run(lane, name, fields()));
    return control;
  }
  function switchRow(id, label, detail, handler) {
    const row = node('label', 'context-setting');
    const copy = node('span', 'context-setting__copy');
    copy.append(node('strong', '', label), node('span', 'context-setting__detail', detail));
    const input = node('input', 'context-switch');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.addEventListener('change', () => void handler(input.checked));
    row.append(copy, input);
    mutators.add(input);
    switches.set(id, input);
    return row;
  }
  function syncDisabled() {
    for (const control of mutators) control.disabled = busy || !current;
    undo.disabled = busy || !current?.can_undo;
  }
  function syncSwitches() {
    for (const [id, input] of switches)
      input.checked =
        id === 'arrange' ? current?.mode === 'adaptive' : current?.policy?.[id] === true;
  }

  const overview = panels.get('overview');
  const work = section('Current work');
  const workTitle = node('p', 'context-work__title');
  const provenance = node('p', 'context-caption');
  const returnPoint = node('p', 'context-work__return');
  const workActions = node('div', 'context-actions');
  const talk = button('Tell eïlo', 'button context-primary');
  talk.addEventListener('click', () => closeThen(onTalk));
  const correct = button('Edit');
  const correction = node('form', 'context-correction');
  correction.hidden = true;
  const titleField = field('What you’re working on', 'A short title', 100);
  const returnField = field('Where to pick up', 'Your next step', 280);
  const save = button('Save', 'button context-primary');
  save.type = 'submit';
  mutators.add(save);
  const cancelEdit = button('Cancel');
  const correctionActions = node('div', 'context-actions');
  correctionActions.append(save, cancelEdit);
  correction.append(titleField.wrapper, returnField.wrapper, correctionActions);
  correct.addEventListener('click', () => {
    editBasis = { ...current?.current_work_context };
    titleField.input.value = current?.current_work_context?.title || '';
    returnField.input.value = current?.current_work_context?.return_point || '';
    correction.hidden = false;
    workActions.hidden = true;
    titleField.input.focus();
  });
  cancelEdit.addEventListener('click', () => {
    correction.hidden = true;
    workActions.hidden = false;
  });
  correction.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!canSaveContextCorrection(current?.current_work_context, editBasis)) {
      showError('Your work changed. Cancel this edit and open it again.');
      return;
    }
    if (
      await run('context', 'correct', {
        title: titleField.input.value.trim(),
        return_point: returnField.input.value.trim(),
      })
    ) {
      correction.hidden = true;
      workActions.hidden = false;
      correct.focus();
    }
  });
  workActions.append(talk, correct);
  work.append(workTitle, provenance, returnPoint, workActions, correction);
  const layout = section('Home arrangement');
  layout.append(
    switchRow(
      'arrange',
      'Arrange Home for me',
      'Let unpinned widgets follow your work.',
      (checked) => run('home', 'set_mode', { mode: checked ? 'adaptive' : 'manual' }),
    ),
  );
  const layoutHint = node('p', 'context-caption');
  const undo = action('Undo last arrangement', 'home', 'undo');
  layout.append(layoutHint, undo);
  const chooseSources = button('Choose context sources', 'context-navigation-row');
  chooseSources.innerHTML =
    '<span>Context sources<small>Choose what eïlo can use</small></span><svg aria-hidden="true"><use href="#arrow-right"/></svg>';
  chooseSources.addEventListener('click', () => selectTab('sources', true));
  overview.append(work, layout, chooseSources);

  const sources = panels.get('sources');
  const sharing = section('Use with eïlo');
  sharing.append(
    switchRow(
      'ai_enabled',
      'Understand my work',
      'Send conversation and permitted activity to your AI.',
      (checked) => run('context', 'configure', { ai_enabled: checked }),
    ),
  );
  const capture = section('Activity sources');
  const pause = action('Pause capture', 'context', 'configure', () => ({
    enabled: !current?.policy?.enabled,
  }));
  pause.classList.add('context-pause');
  const sourceRows = new Map();
  for (const [flag, label, detail, source] of [
    ['desktop_enabled', 'Desktop', 'The app you’re using. Text is a separate choice.', 'desktop'],
    ['browser_enabled', 'Chrome', 'Current tab. Private windows stay private.', 'browser'],
  ]) {
    const row = switchRow(flag, label, detail, async (checked) => {
      await run('context', 'configure', { [flag]: checked, ...(checked ? { enabled: true } : {}) });
      if (source === 'desktop' && checked) {
        showDesktopGuide = true;
        renderedKey = '';
        update(current);
        desktopGuide.focus();
      }
    });
    const health = node('span', 'context-source__state');
    row.querySelector('.context-setting__copy').append(health);
    sourceRows.set(source, health);
    capture.append(row);
  }
  const permission = button('Finish desktop setup', 'context-navigation-row');
  const desktopHost = node('div');
  desktopHost.hidden = true;
  desktopGuide = mountDesktopSetup(desktopHost, {
    onConfigure: (fields) => run('context', 'configure', fields),
    onRefresh: onRefreshSources,
    onDone: () => {
      showDesktopGuide = false;
      desktopHost.hidden = true;
      desktopGuide.pause();
      renderedKey = '';
      update(current);
      if (!permission.hidden) permission.focus();
      else switches.get('desktop_enabled')?.focus();
    },
  });
  permission.addEventListener('click', () => {
    showDesktopGuide = true;
    desktopHost.hidden = false;
    desktopGuide.update(current, { text: current?.policy?.text_enabled });
    desktopGuide.focus();
    void onRefreshSources?.();
  });
  const browserSetup = button('Connect the Chrome extension', 'context-navigation-row');
  browserSetup.addEventListener('click', () => closeThen(() => onConnections?.('browser')));
  capture.append(pause, permission, browserSetup, desktopHost);
  const rich = node('details', 'context-disclosure context-rich');
  rich.append(node('summary', '', 'More context detail'));
  rich.append(
    switchRow(
      'text_enabled',
      'Visible text',
      'Include text from permitted windows.',
      async (checked) => {
        await run('context', 'configure', { text_enabled: checked });
        if (checked && current?.policy?.desktop_enabled) {
          showDesktopGuide = true;
          renderedKey = '';
          update(current);
          void onRefreshSources?.();
        }
      },
    ),
  );
  const visual = switchRow(
    'visuals_enabled',
    'Visual context',
    'Use a temporary image of the permitted window.',
    (checked) => run('context', 'configure', { visuals_enabled: checked }),
  );
  rich.append(visual);
  const exclusions = node('details', 'context-disclosure');
  exclusions.append(node('summary', '', 'Excluded websites'));
  const excludedList = node('div', 'context-exclusions');
  const excludeForm = node('form', 'context-exclude-form');
  const website = field('Website to exclude', 'example.com', 253);
  const exclude = button('Exclude', 'button');
  exclude.type = 'submit';
  mutators.add(exclude);
  excludeForm.append(website.wrapper, exclude);
  excludeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const domain = website.input.value.trim();
    if (!domain) return;
    if (
      await run('context', 'configure', {
        excluded_domains: [...(current?.policy?.excluded_domains || []), domain],
      })
    )
      website.input.value = '';
  });
  exclusions.append(excludedList, excludeForm);
  const integrations = button('Manage connected apps', 'context-navigation-row');
  integrations.addEventListener('click', () => closeThen(onConnections));
  sources.append(sharing, capture, rich, exclusions, integrations);

  const memory = panels.get('memory');
  const retention = section('Kept on this Mac');
  for (const [name, time] of [
    ['Activity details', '24 hours'],
    ['Work summaries', '30 days'],
    ['Chosen notes & preferences', 'Until you remove them'],
  ]) {
    const row = node('div', 'context-retention');
    row.append(node('span', '', name), node('span', '', time));
    retention.append(row);
  }
  const preferences = section('Your preferences');
  const preferenceList = node('div', 'context-preferences');
  const preferenceEditor = node('details', 'context-disclosure');
  preferenceEditor.append(node('summary', '', 'Choose a widget preference'));
  const kind = node('select', 'context-select');
  kind.setAttribute('aria-label', 'Widget preference');
  for (const [value, label] of Object.entries(KIND_LABELS)) {
    const option = node('option', '', label);
    option.value = value;
    kind.append(option);
  }
  const preferenceActions = node('div', 'context-actions');
  preferenceActions.append(
    action('Prefer', 'home', 'preference', () => ({ component_kind: kind.value, value: 'prefer' })),
    action('Show less', 'home', 'preference', () => ({
      component_kind: kind.value,
      value: 'less',
    })),
  );
  preferenceEditor.append(kind, preferenceActions);
  preferences.append(preferenceList, preferenceEditor);
  const forget = section();
  const forgetButton = button('Forget activity & context', 'context-forget');
  const confirm = node('div', 'context-forget__confirm');
  confirm.hidden = true;
  confirm.append(
    node(
      'p',
      '',
      'Removes activity, work summaries and learned preferences. Saved chats, chosen notes and explicit preferences stay.',
    ),
  );
  const confirmActions = node('div', 'context-actions');
  const confirmForget = button('Forget this history', 'button context-danger');
  const cancelForget = button('Keep history');
  mutators.add(confirmForget);
  confirmActions.append(confirmForget, cancelForget);
  confirm.append(confirmActions);
  forgetButton.addEventListener('click', () => {
    confirm.hidden = false;
    forgetButton.hidden = true;
  });
  cancelForget.addEventListener('click', () => {
    confirm.hidden = true;
    forgetButton.hidden = false;
  });
  confirmForget.addEventListener('click', async () => {
    if (await run('context', 'forget')) {
      confirm.hidden = true;
      forgetButton.hidden = false;
    }
  });
  forget.append(forgetButton, confirm);
  memory.append(retention, preferences, forget);

  dialog.append(header, tabs, error, body);
  document.body.append(dialog);
  selectTab('overview');
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    )
      dialog.close();
  });
  dialog.addEventListener('close', () => {
    desktopGuide.pause();
    correction.hidden = true;
    workActions.hidden = false;
    editBasis = null;
    error.hidden = true;
    confirm.hidden = true;
    forgetButton.hidden = false;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus();
    onClose?.();
    const action = afterClose;
    afterClose = null;
    action?.();
  });
  function closeThen(action) {
    afterClose = action;
    dialog.close();
  }
  function showError(message) {
    if (!dialog.open) return;
    error.textContent = message;
    error.hidden = false;
  }
  function update(next) {
    current = next;
    if (!dialog.open) return;
    const nextKey = JSON.stringify([
      current?.current_work_context,
      current?.mode,
      current?.can_undo,
      current?.policy,
      current?.visual_available,
      current?.preferences,
      Object.entries(current?.capture_status || {}).map(([source, health]) => [
        source,
        health.status,
        health.permissions,
        health.setup_verified,
        health.connected,
      ]),
    ]);
    if (nextKey === renderedKey) return;
    renderedKey = nextKey;
    const context = current?.current_work_context;
    workTitle.textContent = context?.title || 'What are you working on?';
    provenance.textContent = context
      ? context.confidence === 'explicit'
        ? 'From your conversation'
        : context.confidence === 'observed'
          ? 'From permitted activity'
          : 'You can correct this'
      : 'Start with a conversation. Choose activity sources when you’re ready.';
    returnPoint.textContent = context?.return_point || '';
    returnPoint.hidden = !context?.return_point;
    talk.hidden = Boolean(context);
    correct.hidden = !context;
    layoutHint.textContent =
      current?.mode === 'adaptive'
        ? 'Pinned widgets stay where you put them.'
        : 'Your layout stays fixed. Use Edit home to arrange it.';
    undo.hidden = !current?.can_undo;
    const policy = current?.policy || {};
    visual.hidden = !current?.visual_available;
    const sourceLabels = {
      sampling: 'Receiving context',
      permission_required: 'Needs permission',
      registration_required: 'Chrome setup needed',
      disconnected: 'Not connected',
      waiting: 'Waiting for activity',
      configured: 'Ready to connect',
      connected: 'Connected',
      ready: 'Ready',
      error: 'Needs attention',
      unavailable: 'Unavailable',
    };
    for (const [source, health] of sourceRows) {
      const enabled = policy[`${source}_enabled`];
      health.hidden = !enabled;
      health.textContent = !enabled
        ? 'Off'
        : !policy.enabled
          ? 'Capture paused'
          : sourceLabels[current?.capture_status?.[source]?.status] || 'Waiting for activity';
    }
    pause.hidden = !policy.desktop_enabled && !policy.browser_enabled;
    pause.textContent = policy.enabled ? 'Pause capture' : 'Resume capture';
    const desktopHealth = current?.capture_status?.desktop || {};
    permission.hidden =
      showDesktopGuide ||
      !policy.desktop_enabled ||
      (!showDesktopGuide &&
        (!policy.text_enabled || desktopHealth.permissions?.accessibility_permission === true));
    desktopHost.hidden = !showDesktopGuide;
    if (showDesktopGuide && selected === 'sources')
      desktopGuide.update(current, { text: policy.text_enabled });
    browserSetup.hidden =
      !policy.browser_enabled ||
      !['disconnected', 'configured', 'registration_required', 'waiting'].includes(
        current?.capture_status?.browser?.status,
      );
    const nextExclusions = JSON.stringify(policy.excluded_domains || []);
    if (nextExclusions !== exclusionsKey) {
      exclusionsKey = nextExclusions;
      for (const control of excludedList.querySelectorAll('button')) mutators.delete(control);
      excludedList.replaceChildren();
      for (const domain of policy.excluded_domains || []) {
        const row = node('div', 'context-exclusion');
        const include = action('Include again', 'context', 'configure', () => ({
          excluded_domains: (current?.policy?.excluded_domains || []).filter(
            (value) => value !== domain,
          ),
        }));
        row.append(node('span', '', domain), include);
        excludedList.append(row);
      }
      if (!excludedList.children.length)
        excludedList.append(node('p', 'context-caption', 'No excluded websites.'));
    }
    const nextPreferences = JSON.stringify(current?.preferences || []);
    if (nextPreferences !== preferencesKey) {
      preferencesKey = nextPreferences;
      for (const control of preferenceList.querySelectorAll('button')) mutators.delete(control);
      preferenceList.replaceChildren();
      for (const preference of current?.preferences || []) {
        const row = node('div', 'context-preference');
        row.append(
          node(
            'span',
            '',
            `${KIND_LABELS[preference.component_kind] || 'Widget'} · ${preference.value === 'prefer' ? 'Prefer' : 'Less often'}`,
          ),
          action('Reset', 'home', 'preference', () => ({
            component_kind: preference.component_kind,
            value: 'reset',
          })),
        );
        preferenceList.append(row);
      }
      if (!preferenceList.children.length)
        preferenceList.append(node('p', 'context-caption', 'Your choices will appear here.'));
    }
    if (!busy) {
      syncDisabled();
      syncSwitches();
    }
  }
  return {
    update,
    showError,
    get isOpen() {
      return dialog.open;
    },
    open(opener) {
      trigger = opener;
      trigger?.setAttribute('aria-expanded', 'true');
      dialog.showModal();
      renderedKey = '';
      update(current);
      tabButtons.get(selected).focus({ preventScroll: true });
    },
    close() {
      dialog.close();
    },
    destroy() {
      desktopGuide.destroy();
      dialog.remove();
    },
  };
}
