import { createInlineDialog } from '../workspace/inline-dialog.js';
import { mountChromeSetup } from '../activity/setup.js';
import { mountDesktopSetup } from '../activity/desktop-setup.js';
import { refreshSetupHealth } from '../activity/setup-health.js';
import { mountCalendarConnection } from '../connections/calendar.js';
import { mountBriefingSources } from '../connections/briefing-sources.js';
import { checkinView } from '../activity/checkin-data.js';
import { browserReady, desktopReady, calendarSharingReady, sourceReady } from './support-state.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (label, handler, primary = false) => {
  const node = el('button', primary ? 'onboarding-support__primary' : '', label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};
const sourceLabel = (source) =>
  source === 'browser' ? 'Chrome' : source === 'desktop' ? 'your Mac' : 'Calendar';
const validSource = (source) => ['browser', 'desktop', 'calendar'].includes(source);

function openGoogleAuthorization(url) {
  if (globalThis.eiloDesktop?.openGoogleAuthorization)
    return globalThis.eiloDesktop.openGoogleAuthorization(url);
  const target = new URL(url);
  if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth')
    return false;
  return Boolean(window.open(url, '_blank', 'noopener,noreferrer'));
}

/** Optional onboarding support. Opening this dialog never changes a permission. */
export function mountOnboardingSupport({
  client,
  onFinish,
  onDismiss,
  onConfirmed = () => {},
  openSettings: _openSettings = () => {},
}) {
  const dialog = el('dialog', 'onboarding-support');
  const openInline = createInlineDialog(dialog);
  const body = el('section', 'onboarding-support__body');
  const status = el('p', 'onboarding-support__status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  dialog.append(body, status);
  document.body.append(dialog);

  let view = client.view;
  let source = null;
  let phase = 'source';
  let guide = null;
  let guidePhase = '';
  let focus = null;
  let busy = false;
  let generation = 0;
  let destroyed = false;
  let notificationState = null;
  let notificationRead = false;

  const setStatus = (message, urgent = false) => {
    status.textContent = message || '';
    status.setAttribute('role', urgent ? 'alert' : 'status');
    status.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    status.classList.toggle('onboarding-support__status--error', urgent);
  };
  const fullPolicy = (fields) => ({
    ...(view?.snapshot?.adaptive?.policy || {}),
    ...fields,
  });
  const configure = (fields) => client.contextCommand('configure', fullPolicy(fields));
  const refresh = async () => {
    await client.refresh?.();
  };
  const leave = (dismissed) => {
    generation += 1;
    guide?.destroy?.();
    guide = null;
    guidePhase = '';
    if (dialog.open) dialog.close();
    focus?.focus?.({ preventScroll: true });
    if (dismissed) onDismiss?.();
  };
  const change = (next) => {
    generation += 1;
    guide?.destroy?.();
    guide = null;
    guidePhase = '';
    phase = next;
    setStatus('');
    render();
  };
  const updateGuide = () => {
    if (phase === 'connect' && guide?.update) {
      if (source === 'desktop') guide.update(view?.snapshot?.adaptive, { text: false });
      else if (source === 'browser') guide.update(view);
    }
  };
  const mountGuide = (host) => {
    if (guide || guidePhase === phase) return;
    guidePhase = phase;
    if (phase === 'connect' && source === 'browser') {
      guide = mountChromeSetup(host, {
        onRefresh: () => refreshSetupHealth('browser', refresh),
        onDone: () => advanceWhenReady('sharing', () => sourceReady(view, source)),
        doneLabel: 'Continue',
        onDismiss: () => leave(true),
        onNativeControl: (action) =>
          configure(
            action === 'connect'
              ? { enabled: true, browser_enabled: true }
              : action === 'resume'
                ? { enabled: true }
                : { browser_enabled: false },
          ),
      });
    } else if (phase === 'connect' && source === 'desktop') {
      guide = mountDesktopSetup(host, {
        onConfigure: configure,
        onRefresh: () => refreshSetupHealth('desktop', refresh),
        onDone: () => advanceWhenReady('sharing', () => sourceReady(view, source)),
        doneLabel: 'Continue',
        onDismiss: () => leave(true),
      });
    } else if (phase === 'connect') {
      guide = mountCalendarConnection(host, {
        openAuthorization: openGoogleAuthorization,
        onChanged: () => void refresh(),
        onSkip: () => leave(true),
      });
    } else if (phase === 'sharing' && source === 'calendar') {
      guide = mountBriefingSources(host, {
        openAuthorization: openGoogleAuthorization,
        onChanged: () => void refresh(),
        section: 'calendar',
      });
    }
    updateGuide();
  };
  const advanceWhenReady = async (next, ready) => {
    if (busy) return;
    busy = true;
    sync();
    const attempt = generation;
    setStatus('');
    try {
      await refresh();
      if (destroyed || attempt !== generation || !dialog.open) return;
      if (!ready()) {
        setStatus('That step is not confirmed yet. Check the connection, then try again.', true);
        return;
      }
      onConfirmed({ source, step: phase });
      change(next);
    } catch (error) {
      if (!destroyed && attempt === generation)
        setStatus(error?.message || 'That could not be confirmed. Try again.', true);
    } finally {
      busy = false;
      sync();
    }
  };
  const allowSharing = async () => {
    if (source === 'calendar')
      return advanceWhenReady('checkins', () => calendarSharingReady(view));
    if (view?.snapshot?.adaptive?.policy?.ai_enabled === true)
      return advanceWhenReady(
        'checkins',
        () => view?.snapshot?.adaptive?.policy?.ai_enabled === true,
      );
    if (busy) return;
    busy = true;
    sync();
    const attempt = generation;
    setStatus('');
    try {
      await configure({ ai_enabled: true });
      await refresh();
      if (destroyed || attempt !== generation || !dialog.open) return;
      if (view?.snapshot?.adaptive?.policy?.ai_enabled !== true) {
        setStatus('AI sharing was not confirmed. Try again from Activity & AI.', true);
        return;
      }
      onConfirmed({ source, step: 'sharing' });
      change('checkins');
    } catch (error) {
      if (!destroyed && attempt === generation)
        setStatus(error?.message || 'AI sharing could not be saved. Try again.', true);
    } finally {
      busy = false;
      sync();
    }
  };
  const enableCheckins = async () => {
    if (checkinView(view).enabled)
      return advanceWhenReady('notifications', () => checkinView(view).enabled);
    if (busy) return;
    busy = true;
    sync();
    const attempt = generation;
    setStatus('');
    try {
      await client.activityControl('enable_check_ins', crypto.randomUUID());
      await refresh();
      if (destroyed || attempt !== generation || !dialog.open) return;
      if (!checkinView(view).enabled) {
        setStatus('Check-ins were not enabled. Try again when your workspace is connected.', true);
        return;
      }
      onConfirmed({ source, step: 'checkins' });
      change('notifications');
    } catch (error) {
      if (!destroyed && attempt === generation)
        setStatus(error?.message || 'Check-ins could not be enabled. Try again.', true);
    } finally {
      busy = false;
      sync();
    }
  };
  const enableNotifications = async () => {
    const native = globalThis.eiloDesktop;
    if (
      typeof native?.getCheckInNotifications !== 'function' ||
      typeof native?.setCheckInNotifications !== 'function'
    )
      return;
    if (busy || !notificationState?.supported) return;
    busy = true;
    sync();
    const attempt = generation;
    setStatus('');
    try {
      const result = await native.setCheckInNotifications(true);
      const latest = await native.getCheckInNotifications();
      if (destroyed || !dialog.open || generation !== attempt) return;
      notificationState = latest;
      if (!latest?.enabled || result?.enabled === false) {
        setStatus(
          'Desktop alerts are still off. You can enable them later in the felis Mac app.',
          true,
        );
        return;
      }
      if (latest.error) {
        setStatus(
          'Alerts are enabled in felis, but delivery needs attention in macOS notification settings.',
          true,
        );
        return;
      }
      onConfirmed({ source, step: 'notifications' });
      setStatus(
        'Desktop alerts are enabled in felis. macOS notification settings control delivery.',
      );
    } catch {
      if (!destroyed && dialog.open && generation === attempt)
        setStatus('Desktop alerts could not be enabled. You can try again later.', true);
    } finally {
      busy = false;
      sync();
    }
  };
  async function readNotifications() {
    const native = globalThis.eiloDesktop;
    if (notificationRead || typeof native?.getCheckInNotifications !== 'function') return;
    notificationRead = true;
    const attempt = generation;
    try {
      const latest = await native.getCheckInNotifications();
      if (destroyed || !dialog.open || generation !== attempt) return;
      notificationState = latest;
    } catch {
      if (!destroyed && dialog.open && generation === attempt)
        setStatus('Alert status is unavailable. You can keep check-ins inside felis.', true);
    } finally {
      notificationRead = false;
      if (generation === attempt) sync();
    }
  }
  function sync() {
    if (!dialog.open || destroyed) return;
    const controls = body.querySelectorAll('.onboarding-support__actions > button');
    for (const control of controls)
      control.disabled = busy && !['Back', 'Later'].includes(control.textContent);
    const primary = body.querySelector(
      '.onboarding-support__actions > .onboarding-support__primary',
    );
    if (primary && phase === 'connect') primary.disabled = busy || !sourceReady(view, source);
    if (primary && phase === 'sharing' && source === 'calendar')
      primary.disabled = busy || !calendarSharingReady(view);
    if (primary && phase === 'notifications' && primary.dataset.focus === 'Enable desktop alerts') {
      primary.disabled =
        busy || !notificationState?.supported || notificationState.enabled === true;
      primary.textContent = notificationState?.enabled
        ? 'Enabled in felis'
        : notificationState?.supported === false
          ? 'Alerts unavailable on this device'
          : 'Enable desktop alerts';
    }
  }
  function finish() {
    onFinish?.();
    leave(false);
  }
  function render() {
    if (destroyed || !dialog.open) return;
    const active = document.activeElement;
    const restore =
      active instanceof HTMLElement && body.contains(active) ? active.dataset.focus || '' : '';
    body.replaceChildren();
    const title = el('h2', '', '');
    title.id = 'onboarding-support-title';
    title.tabIndex = -1;
    dialog.setAttribute('aria-labelledby', title.id);
    const copy = el('p', 'onboarding-support__copy');
    const actions = el('div', 'onboarding-support__actions');
    const add = (label, handler, primary = false, key = label) => {
      const control = button(label, handler, primary);
      control.disabled = busy;
      control.dataset.focus = key;
      actions.append(control);
      return control;
    };
    const guideHost = el('div', 'onboarding-support__guide');

    if (phase === 'source') {
      title.textContent = 'What would help first?';
      copy.hidden = true;
      const choices = el('div', 'onboarding-support__choices');
      for (const choice of ['browser', 'desktop', 'calendar'])
        choices.append(
          button(sourceLabel(choice), () => {
            source = choice;
            change('connect');
          }),
        );
      add('Later', () => leave(true));
      body.append(title, copy, choices, actions);
    } else if (phase === 'connect') {
      title.textContent = `Set up ${sourceLabel(source)}`;
      title.classList.add('sr-only');
      copy.hidden = true;
      add('Back', () => change('source'));
      if (source === 'calendar') {
        add('Later', () => leave(true));
        add('Continue', () => advanceWhenReady('sharing', () => sourceReady(view, source)), true);
      }
      body.append(title, copy, guideHost, actions);
      mountGuide(guideHost);
    } else if (phase === 'sharing') {
      title.textContent = 'Let felis use this context?';
      copy.textContent =
        source === 'calendar'
          ? 'Calendar access and sending selected events to your AI are separate choices.'
          : 'Send your conversation and permitted activity context to your connected AI so felis can relate it to your goal.';
      add('Back', () => change('connect'));
      add('Later', () => leave(true));
      add(
        source === 'calendar'
          ? 'Continue'
          : view?.snapshot?.adaptive?.policy?.ai_enabled === true
            ? 'Continue'
            : 'Allow felis to use it',
        allowSharing,
        true,
      );
      body.append(title, copy);
      if (source === 'calendar') {
        body.append(guideHost);
        mountGuide(guideHost);
      }
      body.append(actions);
    } else if (phase === 'checkins') {
      title.textContent = 'Turn on check-ins?';
      copy.textContent =
        source === 'calendar'
          ? 'Calendar alone does not create activity check-ins. You can still get useful answers about selected events.'
          : 'felis can offer occasional in-app support when your permitted context warrants it.';
      add('Back', () => change('sharing'));
      add('Later', () => leave(true));
      if (source === 'calendar' && !browserReady(view) && !desktopReady(view)) {
        add('Connect activity', () => change('source'));
        add('Finish', finish, true);
      } else
        add(checkinView(view).enabled ? 'Continue' : 'Turn on check-ins', enableCheckins, true);
      body.append(title, copy, actions);
    } else {
      const native = globalThis.eiloDesktop;
      const supported =
        typeof native?.getCheckInNotifications === 'function' &&
        typeof native?.setCheckInNotifications === 'function';
      title.textContent = supported ? 'Desktop alerts are optional' : 'You’re ready to go';
      copy.textContent = supported
        ? 'Check-ins stay in felis unless you turn on desktop alerts. macOS notification settings also control delivery.'
        : 'Desktop alerts are available in the felis Mac app. In-app check-ins stay available here.';
      add('Back', () => change('checkins'));
      if (supported) add('Enable desktop alerts', enableNotifications, true);
      add(
        'Finish',
        () => {
          finish();
        },
        !supported,
      );
      body.append(title, copy, actions);
    }
    sync();
    if (phase === 'notifications') void readNotifications();
    if (restore)
      body.querySelector(`[data-focus="${CSS.escape(restore)}"]`)?.focus({ preventScroll: true });
    else {
      title.focus({ preventScroll: true });
      guide?.focus?.();
    }
  }
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    leave(true);
  });
  return {
    open(initialSource = null) {
      if (destroyed) return;
      focus = document.activeElement;
      source = validSource(initialSource) ? initialSource : null;
      phase = source ? 'connect' : 'source';
      generation += 1;
      setStatus('');
      if (!dialog.open) openInline();
      render();
    },
    update(next) {
      view = next;
      if (!dialog.open || destroyed) return;
      if (source && phase !== 'source' && phase !== 'connect' && !sourceReady(view, source)) {
        change('connect');
        setStatus('This source needs attention before setup can continue.', true);
        return;
      }
      const sharingReady =
        source === 'calendar'
          ? calendarSharingReady(view)
          : view?.snapshot?.adaptive?.policy?.ai_enabled === true;
      if (['checkins', 'notifications'].includes(phase) && !sharingReady) {
        change('sharing');
        setStatus('AI context is off. Choose whether to enable it before continuing.');
        return;
      }
      if (phase === 'notifications' && !checkinView(view).enabled) {
        change('checkins');
        setStatus('Check-ins are off. Desktop alerts remain a separate choice.');
        return;
      }
      updateGuide();
      sync();
    },
    destroy() {
      destroyed = true;
      generation += 1;
      guide?.destroy?.();
      dialog.remove();
    },
  };
}
