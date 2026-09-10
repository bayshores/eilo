const ENDPOINT = '/api/integrations/briefing-sources';
const AUTH_POLL_MS = 2000;
const ACCOUNT_STATES = new Set(['connected', 'paused', 'reauth_required']);

const el = (tag, className, text) => {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};

const button = (label, handler, className = 'briefing-sources__button') => {
  const item = el('button', className, label);
  item.type = 'button'; item.addEventListener('click', handler);
  return item;
};

export function isBriefingSourcesSnapshot(value) {
  return Boolean(value) && Number.isInteger(value.revision) && typeof value.configured === 'boolean' &&
    typeof value.available === 'boolean' && Array.isArray(value.accounts) && Boolean(value.calendar) &&
    value.accounts.every(account => account && typeof account.id === 'string' && ACCOUNT_STATES.has(account.state));
}

export function formatCheckedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Last checked recently' : `Last checked ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`;
}

function messageFor(error) {
  if (error?.status === 401) return 'Your local session has expired. Reopen eïlo, then try again.';
  if (error?.status === 409) return 'This changed elsewhere. The latest connection state is shown below.';
  if (error?.name === 'AbortError') return 'That took too long. Try again when the connection is ready.';
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You appear to be offline. Reconnect, then try again.';
  return error?.message || 'Briefing sources could not be reached. Try again.';
}

/** Mounts the email/calendar sharing controls used inside Connections. */
export function mountBriefingSources(container, { fetcher = fetch, openAuthorization = async () => false, onChanged = () => {}, section = 'all' } = {}) {
  if (!(container instanceof Element)) throw new TypeError('A Briefing Sources container is required.');
  const root = el('section', 'briefing-sources');
  root.setAttribute('aria-labelledby', 'briefing-sources-title');
  const live = el('p', 'briefing-sources__status');
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  container.replaceChildren(root);
  let snapshot = null, timer = null, request = null, destroyed = false, busy = false, consent = false, connectMode = '', removeId = '', authorizationUrl = '';

  const clearTimer = () => { if (timer) clearTimeout(timer); timer = null; };
  const setStatus = (text, urgent = false) => {
    live.textContent = text || '';
    live.setAttribute('role', urgent ? 'alert' : 'status');
    live.setAttribute('aria-live', urgent ? 'assertive' : 'polite');
    live.classList.toggle('briefing-sources__status--error', urgent);
  };
  const scheduleAuthorizationPoll = () => {
    clearTimer();
    if (!destroyed && snapshot?.authorizing) timer = setTimeout(() => refresh({ quiet: true }), AUTH_POLL_MS);
  };
  const focusKey = () => {
    const active = document.activeElement;
    return active instanceof HTMLElement && root.contains(active) ? active.dataset.focus || '' : '';
  };
  const restoreFocus = key => root.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  const transport = async (method, payload) => {
    const controller = new AbortController(); request = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(ENDPOINT, { method, headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' }, body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data?.error || 'Briefing sources request failed.'), { status: response.status });
      return data;
    } finally { clearTimeout(timeout); if (request === controller) request = null; }
  };
  const accept = (next, preserve = '') => {
    if (!isBriefingSourcesSnapshot(next)) throw new Error('Briefing sources returned an unexpected response. Try again.');
    if (snapshot && next.revision < snapshot.revision) return;
    snapshot = next; authorizationUrl = next.authorization_url || ''; onChanged(next); render(preserve); scheduleAuthorizationPoll();
  };
  const refresh = async ({ quiet = false } = {}) => {
    if (busy || request) return;
    const prior = focusKey();
    try { accept(await transport('GET'), prior); }
    catch (error) { if (!destroyed) { setStatus(messageFor(error), true); if (!quiet) render(prior); } }
  };
  const mutate = async (action, extra = {}, focusAfter = '') => {
    if (!snapshot || busy) return null;
    busy = true; const prior = focusKey(); render(prior);
    try {
      const next = await transport('POST', { action, based_on_revision: snapshot.revision, ...extra });
      if (!destroyed) accept(next, focusAfter || prior);
      return next;
    } catch (error) {
      if (!destroyed) { setStatus(messageFor(error), true); render(focusAfter || prior); if (error?.status === 409) refresh({ quiet: true }); }
      return null;
    } finally { busy = false; if (!destroyed) render(focusAfter || prior); }
  };
  const connect = async () => {
    if (!consent) return;
    consent = false;
    const next = await beginAuthorization('briefing-sources-status');
    if (next) connectMode = '';
    if (!next) return;
  };
  const beginAuthorization = async (focusAfter) => {
    const next = await mutate('connect_gmail', { allow_model: true }, focusAfter);
    if (!next?.authorization_url) return;
    try {
      if (!await openAuthorization(next.authorization_url)) { setStatus('Google sign-in did not open. Try Connect Gmail again.', true); render('briefing-sources-status'); }
    } catch { setStatus('Google sign-in did not open. Try Connect Gmail again.', true); render('briefing-sources-status'); }
    return next;
  };
  const render = (restore = '') => {
    const content = el('div', 'briefing-sources__content');
    const heading = el('div', 'briefing-sources__heading');
    const title = el('h2', '', section==='gmail'?'Connected inboxes':section==='calendar'?'Use in conversations':'Briefing sources'); title.id = 'briefing-sources-title'; title.tabIndex = -1; title.dataset.focus = 'briefing-sources-title';
    heading.append(title); content.append(heading);
    if (!snapshot) {
      content.append(el('p', 'briefing-sources__copy', 'Checking whether briefing sources are available in this build.'));
      const actions = el('div', 'briefing-sources__actions'); actions.append(button('Check connection', () => refresh())); content.append(actions);
    } else if (!snapshot.configured || !snapshot.available) {
      content.append(el('p', 'briefing-sources__copy', 'Briefing-source setup is not available in this build. You can keep using eïlo without connected sources.'));
    } else {
      if(section==='all'){const description = el('p', 'briefing-sources__copy', 'Choose which connected information eïlo may use when answering or preparing a briefing.'); content.append(description);}
      if (typeof snapshot.error === 'string' && snapshot.error) content.append(el('p', 'briefing-sources__error-copy', snapshot.error));
      const inbox = el('section', 'briefing-sources__group'); inbox.setAttribute('aria-labelledby', 'briefing-inbox-title');
      const inboxTitle = el('h3', section==='gmail'?'sr-only':'', 'Gmail'); inboxTitle.id = 'briefing-inbox-title'; inbox.append(inboxTitle);
      if (snapshot.authorizing) {
        inbox.append(el('p', 'briefing-sources__copy', 'Finish Google sign-in in your system browser, then return here.'));
        const actions = el('div', 'briefing-sources__actions');
        if (authorizationUrl) actions.append(button('Open Google sign-in', async () => { if (!await openAuthorization(authorizationUrl)) setStatus('Google sign-in did not open. Try again.', true); }, 'briefing-sources__button briefing-sources__button--primary'));
        actions.append(button('Cancel connection', () => mutate('cancel_gmail', {}, 'briefing-inbox-title'))); inbox.append(actions);
      } else if (!snapshot.accounts.length || connectMode) {
        const reconnecting = Boolean(connectMode && connectMode !== 'add');
        inbox.append(el('p', 'briefing-sources__copy', reconnecting ? 'Reconnect this inbox only if you want relevant email excerpts used for answers and briefings.' : snapshot.accounts.length ? 'Connect another inbox only if you want relevant email excerpts used for answers and briefings.' : 'Connect an inbox only if you want relevant email excerpts used for answers and briefings.'));
        const consentLabel = el('label', 'briefing-sources__consent');
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = consent; check.dataset.focus = 'gmail-consent'; check.addEventListener('change', () => { consent = check.checked; render('gmail-consent'); });
        consentLabel.append(check, el('span', '', 'Use relevant email excerpts in answers. Luna processes them through your Codex sign-in; completed answers are saved in this conversation.'));
        inbox.append(consentLabel);
        const actions = el('div', 'briefing-sources__actions'); const start = button(reconnecting ? 'Reconnect Gmail' : 'Connect Gmail', connect, 'briefing-sources__button briefing-sources__button--primary'); start.disabled = busy || !consent; start.dataset.focus = 'connect-gmail'; actions.append(start);
        if (snapshot.accounts.length) actions.append(button('Cancel', () => { connectMode = ''; consent = false; render('briefing-inbox-title'); }));
        inbox.append(actions);
      } else {
        const accounts = el('div', 'briefing-sources__accounts');
        snapshot.accounts.forEach(account => {
          const card = el('article', 'briefing-sources__account');
          const copy = el('div', 'briefing-sources__account-copy'); copy.append(el('strong', '', account.email));
          const state = account.state === 'reauth_required' ? 'Reconnect required' : account.state === 'paused' ? 'Paused' : account.enabled ? 'Used in answers and briefings' : 'Not used in answers and briefings';
          copy.append(el('span', '', state)); if (account.last_checked_at) copy.append(el('small', '', formatCheckedAt(account.last_checked_at))); if (account.error) copy.append(el('small', 'briefing-sources__error-copy', account.error));
          const toggle = el('label', 'briefing-sources__switch'); const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('role','switch'); input.checked = Boolean(account.enabled); input.disabled = busy; input.dataset.focus = `mail-${account.id}`; input.setAttribute('aria-label', `Use ${account.email} in answers and briefings`); input.addEventListener('change', () => mutate('set_mail_enabled', { account_id: account.id, enabled: input.checked }, input.dataset.focus)); toggle.append(input, el('span', '', 'Use inbox'));
          card.append(copy, toggle);
          const actions = el('div', 'briefing-sources__account-actions');
          if (account.state === 'reauth_required') actions.append(button('Reconnect', () => { connectMode = account.id; consent = false; render(`mail-${account.id}`); }));
          if (removeId === account.id) {
            const confirm = el('div', 'briefing-sources__confirm'); confirm.append(el('p', '', 'Remove this inbox from this Mac? Google app permission is unchanged, and your existing Calendar connection stays in place.'));
            const yes = button('Remove inbox', () => { removeId = ''; mutate('remove_gmail', { account_id: account.id }, 'briefing-inbox-title'); }, 'briefing-sources__button briefing-sources__button--danger'); yes.dataset.focus = `remove-${account.id}`;
            confirm.append(yes, button('Keep inbox', () => { removeId = ''; render(`mail-${account.id}`); })); actions.append(confirm);
          } else { const remove = button('Remove inbox', () => { removeId = account.id; render(`remove-${account.id}`); }, 'briefing-sources__button briefing-sources__button--quiet'); remove.dataset.focus = `remove-${account.id}`; actions.append(remove); }
          card.append(actions); accounts.append(card);
        });
        inbox.append(accounts);
        const actions = el('div', 'briefing-sources__actions');
        actions.append(button('Add another inbox', () => { connectMode = 'add'; consent = false; render('gmail-consent'); }));
        inbox.append(actions);
      }
      if(section!=='calendar')content.append(inbox);
      const calendar = snapshot.calendar;
      const calendarGroup = el('section', 'briefing-sources__group'); calendarGroup.setAttribute('aria-labelledby', 'briefing-calendar-title');
      const calendarTitle = el('h3', '', 'Selected calendars'); calendarTitle.id = 'briefing-calendar-title'; calendarGroup.append(calendarTitle);
      const calendarLabel = el('label', 'briefing-sources__toggle-row');
      const calendarInput = document.createElement('input'); calendarInput.type = 'checkbox'; calendarInput.checked = Boolean(calendar.enabled); calendarInput.disabled = busy || !calendar.available || !calendar.selected_count; calendarInput.dataset.focus = 'calendar-enabled'; calendarInput.addEventListener('change', () => mutate('set_calendar_enabled', { enabled: calendarInput.checked }, 'calendar-enabled'));
      const calendarCopy = el('span'); calendarCopy.append(el('strong', '', 'Use selected calendars in answers'));
      calendarCopy.append(el('small', '', calendar.available && calendar.selected_count ? `${calendar.selected_count} selected calendar${calendar.selected_count === 1 ? '' : 's'}${calendar.account_label ? ` · ${calendar.account_label}` : ''}. Relevant event details are sent to Luna for answers and briefings.` : 'Connect Calendar and select at least one calendar before you can use it in answers.'));
      calendarLabel.append(calendarInput, calendarCopy); calendarGroup.append(calendarLabel); if(section!=='gmail')content.append(calendarGroup);
    }
    root.replaceChildren(content, live); if (restore) restoreFocus(restore);
  };
  render(); refresh();
  return { destroy() { destroyed = true; clearTimer(); request?.abort(); root.remove(); }, refresh: () => refresh() };
}
