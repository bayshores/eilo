const ENDPOINT = '/api/integrations/google-calendar';
const POLL_AUTHORIZING_MS = 2000;
const POLL_NORMAL_MS = 10000;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (label, handler, className = 'calendar-button calendar-button--secondary') => {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
};

export function isSnapshot(value) {
  return (
    value &&
    value.schema_version === 1 &&
    Number.isInteger(value.revision) &&
    [
      'unavailable',
      'disconnected',
      'authorizing',
      'choosing',
      'connected',
      'paused',
      'reauth_required',
      'error',
    ].includes(value.state)
  );
}

export function describeSnapshot(snapshot) {
  if (!snapshot?.configured || !snapshot?.available || snapshot.state === 'unavailable')
    return 'Calendar is not available in this build.';
  if (snapshot.state === 'disconnected') return 'Connect Google Calendar to get started.';
  if (snapshot.state === 'authorizing') return 'Finish Google sign-in.';
  if (snapshot.state === 'choosing') return 'Select calendars to read, then save.';
  if (snapshot.state === 'paused') return 'Calendar sync is paused.';
  if (snapshot.state === 'reauth_required')
    return snapshot.error?.message || 'Google Calendar access needs attention.';
  if (snapshot.state === 'error') return snapshot.error?.message || 'Calendar needs attention.';
  return snapshot.last_synced_at
    ? `Synced ${formatWhen(snapshot.last_synced_at)}.`
    : 'Connected. Ready to sync.';
}

export function formatWhen(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'recently'
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function errorMessage(error) {
  if (error?.name === 'AbortError')
    return 'That took too long. Try again when your connection is ready.';
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return 'You appear to be offline. Reconnect, then try again.';
  return error?.message || error?.error || 'Calendar could not be reached. Try again.';
}

/**
 * Mount the Google Calendar section used inside Connections.
 * The owner opens authorization in the normal browser; this component never opens windows itself.
 */
export function mountCalendarConnection(
  container,
  {
    fetcher = fetch,
    openAuthorization = async () => false,
    onChanged = () => {},
    onSkip = () => {},
  } = {},
) {
  if (!container) throw new Error('A Calendar Connections container is required.');
  let destroyed = false;
  let snapshot = null;
  let selectionDraft = null;
  let selectionRevision = null;
  let authorizationUrl = '';
  let timer = null;
  let requestId = 0;
  let activeRequest = null;
  let viewFingerprint = '';
  let busy = false;
  let confirmation = false;
  const root = element('section', 'calendar-connection');
  root.setAttribute('aria-labelledby', 'calendar-connection-title');
  const live = element('p', 'calendar-status');
  live.tabIndex = -1;
  live.dataset.focus = 'calendar-status';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  root.append(live);
  container.replaceChildren(root);

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const setStatus = (message, urgent = false) => {
    live.textContent = message || '';
    live.setAttribute('role', urgent ? 'alert' : 'status');
    live.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    live.classList.toggle('calendar-status--error', urgent);
  };
  const restoreFocus = (token) => {
    if (!token) return;
    const next = root.querySelector(`[data-focus="${CSS.escape(token)}"]`);
    if (next instanceof HTMLElement) next.focus({ preventScroll: true });
  };
  const schedule = () => {
    clearTimer();
    if (destroyed || !snapshot || snapshot.state === 'unavailable') return;
    timer = setTimeout(
      () => refresh({ quiet: true }),
      snapshot.state === 'authorizing' ? POLL_AUTHORIZING_MS : POLL_NORMAL_MS,
    );
  };
  const fingerprint = (value) => {
    const { revision, ...view } = value;
    return JSON.stringify(view);
  };
  const accept = (next, { focusKey = '' } = {}) => {
    if (!isSnapshot(next)) throw new Error('Calendar returned an unexpected response. Try again.');
    if (snapshot && next.revision < snapshot.revision) return;
    const enteringChoice =
      next.state === 'choosing' &&
      (snapshot?.state !== 'choosing' || selectionRevision !== next.revision);
    const unchanged = snapshot && fingerprint(next) === viewFingerprint;
    snapshot = next;
    if (next.state === 'authorizing' && typeof next.authorization_url === 'string')
      authorizationUrl = next.authorization_url;
    else if (next.state !== 'authorizing') authorizationUrl = '';
    viewFingerprint = fingerprint(next);
    if (enteringChoice && selectionDraft === null) {
      selectionDraft = new Set(
        next.selected_ids?.length
          ? next.selected_ids
          : next.calendars?.filter((calendar) => calendar.primary).map((calendar) => calendar.id),
      );
      selectionRevision = next.revision;
    }
    // Calendar discovery can refresh its list while someone is choosing. Keep
    // every still-present local choice, but never submit an id no longer shown.
    if (next.state === 'choosing' && selectionDraft && !next.loading_calendars) {
      const validIds = new Set((next.calendars || []).map((calendar) => calendar.id));
      selectionDraft = new Set([...selectionDraft].filter((id) => validIds.has(id)));
    }
    if (next.state !== 'choosing') {
      selectionDraft = null;
      selectionRevision = null;
    }
    if (!unchanged) {
      onChanged(next);
      render({ focusKey, preserveFocus: !focusKey });
    }
    schedule();
  };
  const request = async (method, payload) => {
    const controller = new AbortController();
    activeRequest = { controller, method };
    const signal = controller.signal;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(ENDPOINT, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: payload ? JSON.stringify(payload) : undefined,
        signal,
      });
      const data = await response.json();
      if (!response.ok)
        throw Object.assign(new Error(data?.error || 'Calendar request failed.'), data || {});
      return data;
    } finally {
      clearTimeout(timeout);
      if (activeRequest?.controller === controller) activeRequest = null;
    }
  };
  const refresh = async ({ quiet = false } = {}) => {
    if (busy || activeRequest) return;
    const id = ++requestId;
    try {
      const next = await request('GET');
      if (!destroyed && id === requestId) accept(next);
    } catch (error) {
      if (!destroyed && id === requestId) {
        setStatus(errorMessage(error), true);
        if (!quiet) render({ focusKey: 'calendar-status' });
        schedule();
      }
    }
  };
  const mutate = async (action, extra = {}) => {
    if (!snapshot || busy) return null;
    if (activeRequest?.method === 'GET') activeRequest.controller.abort();
    busy = true;
    render({ preserveFocus: true });
    const id = ++requestId;
    try {
      const next = await request('POST', {
        action,
        based_on_revision: snapshot.revision,
        ...extra,
      });
      if (!destroyed && id === requestId) {
        if (action === 'begin') authorizationUrl = next.authorization_url || '';
        accept(next, { focusKey: action === 'disconnect' ? 'calendar-title' : 'calendar-status' });
      }
      return next;
    } catch (error) {
      if (!destroyed && id === requestId) {
        setStatus(errorMessage(error), true);
        render({ focusKey: 'calendar-status' });
      }
      return null;
    } finally {
      if (!destroyed && id === requestId) {
        busy = false;
        render({ preserveFocus: true });
        schedule();
      }
    }
  };
  const begin = async () => {
    const next = await mutate('begin');
    if (!next?.authorization_url) return;
    try {
      const opened = await openAuthorization(next.authorization_url);
      if (!opened) {
        setStatus('Google sign-in did not open. Use Open Google sign-in to try again.', true);
        render({ focusKey: 'calendar-status' });
      }
    } catch {
      setStatus('Google sign-in did not open. Use Open Google sign-in to try again.', true);
      render({ focusKey: 'calendar-status' });
    }
  };
  const openSignIn = async () => {
    if (!authorizationUrl) return begin();
    try {
      const opened = await openAuthorization(authorizationUrl);
      if (!opened) {
        setStatus('Google sign-in did not open. Try the button again.', true);
        render({ focusKey: 'calendar-status' });
      }
    } catch {
      setStatus('Google sign-in did not open. Try the button again.', true);
      render({ focusKey: 'calendar-status' });
    }
  };
  const render = ({ focusKey = '', preserveFocus = false } = {}) => {
    const active = document.activeElement;
    const priorFocus =
      preserveFocus && active instanceof HTMLElement && root.contains(active)
        ? active.dataset.focus
        : '';
    const content = element('div', 'calendar-connection__content');
    const heading = element('div', 'calendar-connection__heading');
    const copy = element('div');
    const title = element('h2', '', 'Google Calendar');
    title.id = 'calendar-connection-title';
    title.tabIndex = -1;
    title.dataset.focus = 'calendar-title';
    copy.append(title);
    copy.append(element('p', 'calendar-connection__summary', describeSnapshot(snapshot)));
    heading.append(copy);
    content.append(heading);
    const actions = element('div', 'calendar-connection__actions');
    const disabled = busy;
    const add = (label, handler, primary = false, token = label, additionallyDisabled = false) => {
      const item = button(
        label,
        handler,
        primary ? 'calendar-button calendar-button--primary' : undefined,
      );
      item.disabled = disabled || additionallyDisabled;
      item.dataset.focus = token;
      actions.append(item);
      return item;
    };
    if (!snapshot) {
      content.append(
        element('p', 'calendar-connection__detail', 'Checking whether Calendar is available…'),
      );
      add('Check connection', () => refresh());
    } else if (!snapshot.configured || !snapshot.available || snapshot.state === 'unavailable') {
      content.append(
        element(
          'p',
          'calendar-connection__detail',
          'Calendar setup is unavailable here. You can keep using felis.',
        ),
      );
    } else if (snapshot.state === 'disconnected') {
      content.append(
        element(
          'p',
          'calendar-connection__detail',
          'Connect Google Calendar, then choose calendars felis can read.',
        ),
      );
      content.append(
        element(
          'p',
          'calendar-connection__permission',
          'Read-only. felis reads only calendars you select; sharing with answers stays separate.',
        ),
      );
      const disclosure = element('details', 'calendar-disclosure');
      disclosure.append(element('summary', '', 'Calendar access details'));
      disclosure.append(
        element(
          'p',
          '',
          'felis reads selected calendars and keeps them on this Mac. It cannot edit Google events. Sending events to the AI is a separate choice under Use calendars in answers.',
        ),
      );
      content.append(disclosure);
      add('Connect Google Calendar', begin, true);
      add('Not now', () => onSkip());
    } else if (snapshot.state === 'authorizing') {
      content.append(
        element(
          'p',
          'calendar-connection__detail',
          'Finish Google sign-in, then return here. You can cancel.',
        ),
      );
      if (authorizationUrl) add('Open Google sign-in', openSignIn, true);
      add('Cancel connection', () => mutate('cancel'));
    } else if (snapshot.state === 'choosing') {
      const calendars = snapshot.calendars || [];
      content.append(
        element(
          'p',
          'calendar-connection__detail',
          'Select calendars felis can read. Save to confirm.',
        ),
      );
      if (snapshot.loading_calendars) {
        content.append(
          element('p', 'calendar-connection__detail', 'Loading calendars from Google…'),
        );
      } else if (calendars.length) {
        const list = element('fieldset', 'calendar-list');
        list.append(element('legend', '', 'Calendars to read'));
        for (const calendar of calendars) {
          const label = element('label', 'calendar-option');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = selectionDraft?.has(calendar.id) || false;
          input.dataset.focus = `calendar-${calendar.id}`;
          input.addEventListener('change', () => {
            input.checked ? selectionDraft.add(calendar.id) : selectionDraft.delete(calendar.id);
          });
          const words = element('span');
          words.append(element('strong', '', calendar.name));
          words.append(element('small', '', calendar.primary ? 'Primary calendar' : 'Calendar'));
          label.append(input, words);
          list.append(label);
        }
        content.append(list);
        add(
          'Save calendars',
          () => mutate('save_selection', { calendar_ids: [...selectionDraft] }),
          true,
        );
      } else {
        content.append(
          element(
            'p',
            'calendar-connection__detail',
            'No calendars found yet. Refresh to try again.',
          ),
        );
        add('Refresh calendars', () => mutate('calendars'));
      }
      add('Cancel connection', () => mutate('cancel'));
    } else if (snapshot.state === 'connected' || snapshot.state === 'paused') {
      const account = snapshot.account?.email
        ? `Connected as ${snapshot.account.email}.`
        : 'Connected.';
      const sync = snapshot.syncing
        ? 'Syncing calendars now.'
        : snapshot.last_synced_at
          ? ''
          : 'Not synced yet.';
      const network = snapshot.error
        ? ` ${snapshot.error.message || 'Calendar could not update.'}${snapshot.error.retryable ? ' Try syncing again when you are ready.' : ''}`
        : '';
      content.append(element('p', 'calendar-connection__detail', `${account} ${sync}${network}`));
      add('Manage calendars', () => mutate('calendars'));
      add(
        snapshot.state === 'paused' ? 'Resume sync' : 'Pause sync',
        () => mutate(snapshot.state === 'paused' ? 'resume' : 'pause'),
        snapshot.state === 'paused',
      );
      if (snapshot.state !== 'paused')
        add(
          snapshot.syncing ? 'Syncing…' : 'Sync now',
          () => mutate('sync'),
          false,
          'sync-calendar',
          snapshot.syncing,
        );
      if (confirmation) {
        const recovery = element('div', 'calendar-confirmation');
        recovery.append(
          element(
            'p',
            '',
            'Disconnect Google Calendar? Reading stops. Gmail using this account will need to reconnect.',
          ),
        );
        const confirm = button(
          'Disconnect Calendar',
          () => {
            confirmation = false;
            mutate('disconnect');
          },
          'calendar-button calendar-button--danger',
        );
        confirm.dataset.focus = 'confirm-disconnect';
        recovery.append(
          confirm,
          button('Keep connected', () => {
            confirmation = false;
            render({ focusKey: 'calendar-title' });
          }),
        );
        content.append(recovery);
      } else
        add('Disconnect', () => {
          confirmation = true;
          render({ focusKey: 'confirm-disconnect' });
        });
    } else {
      const expired = snapshot.state === 'reauth_required';
      const recoveryDetail = snapshot.error?.message
        ? `The last access check could not restore the existing permission: ${snapshot.error.message} Reconnect Calendar to grant a new one.`
        : 'Retry the existing access, or reconnect if Google no longer allows it.';
      content.append(
        element(
          'p',
          'calendar-connection__detail',
          expired ? recoveryDetail : snapshot.error?.message || 'Calendar needs attention.',
        ),
      );
      if (expired) {
        add('Reconnect Google Calendar', begin, true);
        if (snapshot.selected_ids?.length)
          add(
            snapshot.syncing ? 'Checking access…' : 'Retry sync',
            () => mutate('retry'),
            false,
            'retry-calendar',
            snapshot.syncing,
          );
      } else if (snapshot.error?.retryable) add('Try again', () => mutate('sync'), true);
      else add('Check connection', () => refresh(), true);
      if (authorizationUrl) add('Open Google sign-in', openSignIn);
    }
    if (actions.childElementCount) content.append(actions);
    root.replaceChildren(content, live);
    restoreFocus(focusKey || priorFocus);
  };
  render();
  refresh();
  return {
    destroy() {
      destroyed = true;
      clearTimer();
      activeRequest?.controller.abort();
      root.remove();
    },
    refresh: () => refresh(),
  };
}
