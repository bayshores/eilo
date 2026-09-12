import { checkinView, checkinTime, observedContext } from './checkin-data.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (text, handler, cls = 'text-button') => {
  const n = el('button', cls, text);
  n.type = 'button';
  n.addEventListener('click', handler);
  return n;
};

export function mountCheckinCenter(
  host,
  { onToggle, onConnect, onDiscuss, onLog, onCheckIns, onObserved },
) {
  let current = null,
    signature = '',
    pending = false,
    pendingTarget = null;
  host.classList.add('checkin-center');
  const hero = el('section', 'checkin-hero');
  hero.setAttribute('aria-label', 'Check-in status');
  const heading = el('div', 'checkin-heading'),
    copy = el('div');
  const eyebrow = el('p', 'checkin-eyebrow', 'Automatic check-ins'),
    title = el('h2'),
    description = el('p', 'checkin-description');
  copy.append(eyebrow, title, description);
  const control = el('label', 'checkin-control'),
    controlText = el('span', '', 'Allow check-ins');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', 'Turn on check-ins');
  const knob = el('span', 'checkin-switch');
  knob.setAttribute('aria-hidden', 'true');
  control.append(controlText, toggle, knob);
  heading.append(copy, control);
  const next = el('div', 'checkin-next'),
    nextText = el('p'),
    cta = button(
      'Connect activity',
      () => (cta.dataset.action === 'discuss' ? onDiscuss('') : onConnect()),
      'button primary',
    );
  next.append(nextText, cta);
  const feedback = el('p', 'checkin-feedback');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  hero.append(heading, next, feedback);
  const columns = el('div', 'checkin-columns');
  const recent = el('section', 'checkin-recent');
  recent.setAttribute('aria-label', 'Latest agent activity');
  const recentHeading = el('div', 'checkin-section-heading');
  recentHeading.append(el('h3', '', 'Latest activity'), button('View log', onLog));
  const recentBody = el('div', 'checkin-recent-body');
  recent.append(recentHeading, recentBody);
  const conditions = el('details', 'checkin-conditions checkin-help');
  conditions.append(el('summary', '', 'How check-ins work'));
  const conditionsBody = el('div');
  conditions.append(conditionsBody);
  columns.append(recent, conditions);
  host.append(hero, columns);
  const delivery = el('section', 'checkin-delivery');
  delivery.setAttribute('aria-label', 'Check-in delivery');
  const deliveryCopy = el('div'),
    deliveryTitle = el('h3', '', 'Desktop alerts'),
    deliveryText = el('p', 'checkin-caption');
  deliveryCopy.append(deliveryTitle, deliveryText);
  let deliveryState = null,
    deliveryPending = false,
    lastDeliveryRead = 0;
  const native = window.eiloDesktop;
  const deliveryButton = button(
    'Enable alerts',
    async () => {
      if (deliveryPending || !deliveryState) return;
      deliveryPending = true;
      renderDelivery();
      try {
        deliveryState = await native.setCheckInNotifications(!deliveryState.enabled);
      } catch {
        deliveryState = null;
      } finally {
        deliveryPending = false;
        renderDelivery();
      }
    },
    'button',
  );
  delivery.append(deliveryCopy, deliveryButton);
  recent.append(delivery);
  function renderDelivery() {
    const capable =
      typeof native?.getCheckInNotifications === 'function' &&
      typeof native?.setCheckInNotifications === 'function';
    deliveryButton.hidden = !capable;
    deliveryButton.disabled = deliveryPending || !deliveryState?.supported;
    deliveryButton.textContent = deliveryPending
      ? 'Saving…'
      : deliveryState?.enabled
        ? 'Turn off alerts'
        : 'Enable alerts';
    deliveryText.textContent = !capable
      ? 'Manage desktop alerts in the eïlo app.'
      : !deliveryState
        ? 'Alert status unavailable. In-app check-ins still work.'
        : !deliveryState.supported
          ? 'Desktop alerts are unavailable on this device.'
          : deliveryState.error
            ? 'The last alert could not be delivered. Check macOS notification settings.'
            : deliveryState.enabled
              ? 'On · macOS Focus may silence alerts.'
              : 'Off · check-ins appear inside eïlo.';
  }
  async function refreshDelivery() {
    if (
      typeof native?.getCheckInNotifications !== 'function' ||
      deliveryPending ||
      Date.now() - lastDeliveryRead < 10000
    )
      return;
    lastDeliveryRead = Date.now();
    try {
      deliveryState = await native.getCheckInNotifications();
    } catch {
      deliveryState = null;
    }
    renderDelivery();
  }
  renderDelivery();
  const renderToggle = (enabled) => {
    const action = enabled ? 'Turn off check-ins' : 'Turn on check-ins';
    const loading = pendingTarget !== null;
    const loadingAction = pendingTarget ? 'Turning on check-ins…' : 'Turning off check-ins…';
    controlText.textContent = loading ? loadingAction : action;
    toggle.setAttribute('aria-label', loading ? loadingAction : action);
    toggle.setAttribute('aria-checked', String(enabled));
  };
  toggle.addEventListener('change', async () => {
    if (pending) return;
    const enabled = toggle.checked;
    pending = true;
    pendingTarget = enabled;
    toggle.disabled = true;
    renderToggle(enabled);
    feedback.hidden = false;
    feedback.textContent = 'Saving…';
    try {
      await onToggle(enabled);
      feedback.textContent = enabled
        ? 'Check-ins on. Sharing stays separate.'
        : 'Check-ins off. Sharing unchanged.';
    } catch (error) {
      feedback.textContent = error.message || 'Could not confirm the change. Try again.';
    } finally {
      pending = false;
      pendingTarget = null;
      signature = '';
      update(current);
    }
  });
  function update(view) {
    void refreshDelivery();
    current = view;
    const value = checkinView(view),
      source = view?.snapshot?.accountability?.activity;
    const tasks = view?.snapshot?.tasks,
      open = (tasks?.tasks || []).filter((task) => task.status === 'open');
    const nextSignature = JSON.stringify([
      value,
      source?.state,
      source?.helper_available,
      tasks?.revision,
      pending,
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    host.dataset.tone = value.tone;
    title.textContent = value.title;
    description.textContent = value.description;
    toggle.checked = pendingTarget ?? value.enabled;
    toggle.disabled = pending || !value.supported;
    renderToggle(toggle.checked);
    next.hidden = false;
    cta.hidden = false;
    cta.textContent = 'Connect activity';
    // Keep one stable button, including focus, while live status refreshes.
    cta.dataset.action = 'connect';
    if (!value.supported) {
      nextText.textContent = 'Reconnect your workspace.';
      cta.hidden = true;
    } else if (value.phase === 'off') {
      next.hidden = true;
      cta.hidden = true;
    } else if (['activity_off', 'activity_paused', 'awaiting_observation'].includes(value.phase)) {
      nextText.textContent =
        source?.state === 'active'
          ? 'Check your Chrome connection.'
          : 'Start with the Chrome extension.';
      cta.textContent = source?.state === 'active' ? 'Check connection' : 'Set up Chrome';
    } else if (['no_goals', 'no_conversation'].includes(value.phase)) {
      nextText.textContent = 'Start in the conversation.';
      cta.textContent = 'Talk to eïlo';
      cta.dataset.action = 'discuss';
    } else if (value.phase === 'on_break') {
      nextText.textContent = 'Tell eïlo when you want to resume.';
      cta.textContent = 'Talk to eïlo';
      cta.dataset.action = 'discuss';
    } else if (value.eligibleAt) {
      nextText.textContent = `May check after ${checkinTime(value.eligibleAt)}. A message is not guaranteed.`;
      cta.hidden = true;
    } else {
      next.hidden = true;
    }
    recentBody.replaceChildren();
    const facts = el('dl', 'checkin-facts');
    for (const [label, text] of [
      ['Last observation', value.observation ? checkinTime(value.observation.at) : 'Not yet'],
      ['Last agent check', value.history[0] ? checkinTime(value.history[0].createdAt) : 'Not yet'],
    ]) {
      const fact = el('div');
      fact.append(el('dt', '', label), el('dd', '', text));
      facts.append(fact);
    }
    recentBody.append(facts);
    if (value.history.length) {
      const latest = value.history[0];
      recentBody.append(
        el('strong', 'checkin-latest-title', latest.title),
        el('p', 'checkin-caption', latest.description),
      );
      if (latest.outcome === 'delivered') recentBody.append(button('Read check-ins', onCheckIns));
    } else
      recentBody.append(
        el('p', 'checkin-caption', 'Quiet decisions and interrupted checks appear here too.'),
      );
    if (value.observation)
      recentBody.append(
        button(observedContext(value.observation), onObserved, 'checkin-observation'),
      );
    conditionsBody.replaceChildren();
    const rules = el('ol', 'checkin-rule-list');
    const rule = (title, text) => {
      const li = el('li');
      li.append(el('strong', '', title), el('p', '', text));
      rules.append(li);
    };
    const focus = open.find((task) => task.id === tasks?.focus_id) || open[0];
    rule(
      'Something you care about',
      focus
        ? `${focus.title}${open.length > 1 ? ` · and ${open.length - 1} other open goal${open.length > 2 ? 's' : ''}` : ''}. Your progress and breaks give eïlo context.`
        : 'An open goal from your conversation gives a check-in a purpose.',
    );
    rule(
      'A change it can notice',
      'Permitted Chrome context can prompt a check. Unshared activity never proves that you’re distracted.',
    );
    const r = value.rules || {};
    rule(
      'Room to act',
      Number.isFinite(r.human_grace_seconds) && Number.isFinite(r.stable_seconds)
        ? `At least ${r.human_grace_seconds / 60} minutes after you speak, with ${r.stable_seconds} seconds of stable activity. eïlo can still choose to stay quiet.`
        : 'eïlo waits after you speak and lets activity settle before checking.',
    );
    conditionsBody.append(rules);
    const details = el('div', 'checkin-details');
    const limit =
      Number.isFinite(r.cooldown_seconds) &&
      Number.isFinite(r.max_per_hour) &&
      Number.isFinite(r.max_per_day)
        ? `Checks are at least ${r.cooldown_seconds / 60} minutes apart, with at most ${r.max_per_hour} per hour and ${r.max_per_day} per day. These limits include checks that stay quiet.`
        : 'Checks are paced and limited to avoid repeated interruptions.';
    details.append(
      el('p', '', limit),
      el(
        'p',
        '',
        'A calendar connection does not yet schedule check-ins by itself. Deadline wording is context for the agent; it is not an automatic alarm.',
      ),
    );
    conditionsBody.append(details);
  }
  return { update };
}

export function renderAgentLog(host, view, { onCheckIns }) {
  const value = checkinView(view);
  host.append(el('p', 'activity-explanation', 'Completed and interrupted agent checks.'));
  if (!value.history.length) {
    const empty = el('div', 'workspace-empty-state');
    empty.append(
      el('h2', '', value.supported ? 'No agent checks yet.' : 'Agent log unavailable.'),
      el(
        'p',
        '',
        value.supported
          ? 'Checks will appear here.'
          : 'Reconnect to the local workspace to see confirmed activity.',
      ),
    );
    host.append(empty);
    return;
  }
  for (const item of value.history) {
    const row = el('article', 'agent-log-row');
    row.dataset.outcome = item.outcome;
    const icon = el(
      'span',
      'agent-log-symbol',
      { delivered: '↗', quiet: '–', stale: '↶', failed_quiet: '!', running: '…' }[item.outcome],
    );
    icon.setAttribute('aria-hidden', 'true');
    const copy = el('div');
    copy.append(el('h3', '', item.title), el('p', '', item.description));
    const time = el('time', '', checkinTime(item.finishedAt || item.createdAt));
    time.dateTime = new Date((item.finishedAt || item.createdAt) * 1000).toISOString();
    row.append(icon, copy, time);
    if (item.outcome === 'delivered') copy.append(button('Read check-ins', onCheckIns));
    host.append(row);
  }
}
