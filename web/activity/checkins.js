import { checkinView, checkinTime } from './checkin-data.js';

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

export function mountCheckinCenter(host, { onToggle, onConnect, onDiscuss }) {
  let current = null,
    pendingTarget = null;
  const settings = el('dialog', 'detail-dialog checkin-dialog');
  const settingsHeading = el('header', 'dialog-heading');
  const title = el('h2', '', 'Check-ins');
  title.id = 'checkin-settings-title';
  settings.setAttribute('aria-labelledby', title.id);
  const close = button('', () => settings.close(), 'icon-button');
  close.setAttribute('aria-label', 'Close check-in settings');
  close.innerHTML = '<svg aria-hidden="true"><use href="#x"/></svg>';
  settingsHeading.append(title, close);

  const description = el('p', 'checkin-description');
  const cta = button(
    'Talk to eïlo',
    () => {
      settings.close();
      if (cta.dataset.action === 'discuss') onDiscuss('');
      else onConnect();
    },
    'button',
  );
  const feedback = el('p', 'checkin-feedback');
  feedback.setAttribute('role', 'alert');
  feedback.hidden = true;
  const announcement = el('span', 'sr-only');
  announcement.setAttribute('role', 'status');

  const control = el('label', 'checkin-control');
  const controlText = el('span', '', 'Check-ins');
  const toggle = el('input');
  toggle.type = 'checkbox';
  toggle.setAttribute('role', 'switch');
  const knob = el('span', 'checkin-switch');
  knob.setAttribute('aria-hidden', 'true');
  control.append(controlText, toggle, knob);
  const open = () => {
    if (!settings.open) settings.showModal();
    void refreshDelivery();
  };
  const trigger = button('', open, 'icon-button checkin-settings-trigger');
  trigger.setAttribute('aria-label', 'Check-in settings');
  trigger.title = 'Check-in settings';
  trigger.innerHTML = '<svg aria-hidden="true"><use href="#sliders"/></svg>';
  host.append(control, trigger, announcement);
  settings.addEventListener('close', () => {
    if (trigger.getClientRects().length) trigger.focus({ preventScroll: true });
  });

  const help = el('details', 'checkin-help');
  help.append(
    el('summary', '', 'What check-ins use'),
    el(
      'p',
      '',
      'Your conversation and context you choose to share. Turning check-ins on does not connect a source or enable AI sharing.',
    ),
  );
  const delivery = el('section', 'checkin-delivery');
  delivery.setAttribute('aria-label', 'Check-in delivery');
  const deliveryCopy = el('div');
  const deliveryText = el('p', 'checkin-caption');
  deliveryCopy.append(el('h3', '', 'Desktop alerts'), deliveryText);
  const native = window.eiloDesktop;
  let deliveryState = null,
    deliveryPending = false,
    lastDeliveryRead = 0;
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
  settings.append(settingsHeading, description, cta, feedback, delivery, help);
  document.body.append(settings);

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
      ? 'Available in the eïlo Mac app.'
      : !deliveryState
        ? 'Alert status unavailable.'
        : !deliveryState.supported
          ? 'Unavailable on this device.'
          : deliveryState.error
            ? 'Check macOS notification settings.'
            : deliveryState.enabled
              ? 'On · macOS Focus may silence alerts.'
              : 'Off';
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
    const pending = pendingTarget !== null;
    toggle.checked = enabled;
    toggle.disabled = pending || !checkinView(current).supported;
    toggle.setAttribute('aria-checked', String(enabled));
    toggle.setAttribute('aria-busy', String(pending));
    toggle.setAttribute(
      'aria-label',
      !checkinView(current).supported
        ? 'Check-in status unavailable'
        : pending
          ? pendingTarget
            ? 'Turning on check-ins…'
            : 'Turning off check-ins…'
          : enabled
            ? 'Turn off check-ins'
            : 'Turn on check-ins',
    );
  };
  toggle.addEventListener('change', async () => {
    if (pendingTarget !== null) return;
    const enabled = toggle.checked;
    pendingTarget = enabled;
    feedback.hidden = true;
    renderToggle(enabled);
    announcement.textContent = 'Saving check-ins…';
    try {
      await onToggle(enabled);
      announcement.textContent = enabled ? 'Check-ins enabled.' : 'Check-ins disabled.';
    } catch (error) {
      feedback.textContent = error?.message || 'Could not save check-ins. Try again.';
      feedback.hidden = false;
      announcement.textContent = 'Check-ins could not be saved.';
      if (!settings.open) settings.showModal();
    } finally {
      pendingTarget = null;
      update(current);
    }
  });
  function update(view) {
    current = view;
    const value = checkinView(view);
    renderToggle(pendingTarget ?? value.enabled);
    control.title = value.description;
    description.textContent = value.description;
    cta.hidden = true;
    if (value.enabled && ['no_goals', 'no_conversation', 'on_break'].includes(value.phase)) {
      cta.hidden = false;
      cta.textContent = 'Talk to eïlo';
      cta.dataset.action = 'discuss';
    } else if (value.enabled && ['activity_off', 'activity_paused'].includes(value.phase)) {
      cta.hidden = false;
      cta.textContent = 'Connect Chrome';
      cta.dataset.action = 'connect';
    }
    if (settings.open) void refreshDelivery();
  }
  return {
    update,
    close() {
      if (settings.open) settings.close();
    },
  };
}

export function renderAgentLog(host, view, { onCheckIns }) {
  const value = checkinView(view);
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
    copy.append(el('h3', '', item.title));
    row.title = item.description;
    if (['stale', 'failed_quiet'].includes(item.outcome))
      copy.append(el('p', '', item.description));
    const time = el('time', '', checkinTime(item.finishedAt || item.createdAt));
    time.dateTime = new Date((item.finishedAt || item.createdAt) * 1000).toISOString();
    row.append(icon, copy, time);
    if (item.outcome === 'delivered') copy.append(button('Read check-ins', onCheckIns));
    host.append(row);
  }
}
