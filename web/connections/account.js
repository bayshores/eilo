const AUTHORIZATION_URL = 'https://auth.openai.com/codex/device';
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

/** Compact account authorization banner. Tokens and provider diagnostics never reach this view. */
export function mountAccount(container, { client, fetcher = fetch } = {}) {
  if (!container?.replaceChildren || !client)
    throw new TypeError('An account host and client are required.');
  const banner = create('section', 'account-banner');
  banner.setAttribute('aria-label', 'Account connection');
  const copy = create('div', 'account-banner__copy');
  const title = create('strong');
  const detail = create('span');
  copy.append(title, detail);
  const code = create('code', 'account-banner__code');
  const start = create('button', 'account-banner__action', 'Connect ChatGPT');
  start.type = 'button';
  const continueBrowser = create('button', 'account-banner__secondary', 'Continue in browser');
  continueBrowser.type = 'button';
  const cancel = create('button', 'account-banner__secondary', 'Cancel');
  cancel.type = 'button';
  const status = create('span', 'account-banner__status');
  status.setAttribute('role', 'status');
  banner.append(copy, code, start, continueBrowser, cancel, status);
  container.replaceChildren(banner);
  let view = client.view;
  let pending = false;
  let destroyed = false;
  const account = () => view?.snapshot?.account || { state: 'unknown', revision: 0 };
  const command = async (action) => {
    if (pending || destroyed) return;
    pending = true;
    render();
    try {
      const current = account();
      const response = await fetcher('/api/account/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: JSON.stringify({
          action,
          request_id: crypto.randomUUID(),
          based_on_revision: current.revision,
        }),
      });
      if (!response.ok) throw new Error('rejected');
      await client.refresh?.();
      if (!destroyed) status.textContent = '';
    } catch {
      if (!destroyed) status.textContent = 'Could not update account connection. Try again.';
    } finally {
      pending = false;
      if (!destroyed) render();
    }
  };
  const render = () => {
    const current = account();
    const state = current.state;
    banner.hidden = state === 'connected' || state === 'unknown';
    title.textContent = state === 'unavailable' ? 'Account unavailable' : 'Sign in to use eïlo';
    detail.textContent =
      state === 'awaiting_sign_in'
        ? 'Use the code in your browser to continue.'
        : state === 'starting'
          ? 'Preparing sign-in…'
          : state === 'unavailable'
            ? 'Try again when the local account service is ready.'
            : 'Connect ChatGPT to use eïlo.';
    code.hidden = state !== 'awaiting_sign_in' || typeof current.user_code !== 'string';
    code.textContent = code.hidden ? '' : current.user_code;
    start.hidden = state === 'awaiting_sign_in';
    start.textContent = state === 'unavailable' ? 'Retry' : 'Connect ChatGPT';
    start.disabled = pending || state === 'starting';
    continueBrowser.hidden = state !== 'awaiting_sign_in';
    continueBrowser.disabled = pending;
    cancel.hidden = state !== 'awaiting_sign_in' && state !== 'starting';
    cancel.disabled = pending;
  };
  start.addEventListener('click', () => void command('start'));
  cancel.addEventListener('click', () => void command('cancel'));
  continueBrowser.addEventListener('click', () => {
    if (globalThis.eiloDesktop?.openAccountAuthorization) {
      void globalThis.eiloDesktop.openAccountAuthorization();
      return;
    }
    globalThis.open(AUTHORIZATION_URL, '_blank', 'noopener');
  });
  const unsubscribe = client.subscribe?.((next) => {
    view = next;
    render();
  });
  render();
  return {
    update(next) {
      view = next;
      render();
    },
    destroy() {
      destroyed = true;
      unsubscribe?.();
      container.replaceChildren();
    },
  };
}
