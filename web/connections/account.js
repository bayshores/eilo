import { createInlineDialog } from '../workspace/inline-dialog.js';
const AUTHORIZATION_URL = 'https://auth.openai.com/codex/device';
const create = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (className, text) => {
  const element = create('button', className, text);
  element.type = 'button';
  return element;
};

/** The header owns the entry point; authorization stays in a bounded native dialog. */
export function mountAccount(container, { client, fetcher = fetch } = {}) {
  if (!container?.replaceChildren || !client)
    throw new TypeError('An account host and client are required.');
  const trigger = button('button primary account-connect', 'Connect ChatGPT');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'account-dialog');
  container.replaceChildren(trigger);

  const dialog = create('dialog', 'account-dialog');
  const openInline = createInlineDialog(dialog);
  dialog.id = 'account-dialog';
  dialog.setAttribute('aria-labelledby', 'account-dialog-title');
  dialog.setAttribute('aria-describedby', 'account-dialog-detail');
  const header = create('div', 'account-dialog__header');
  const close = button('icon-button account-dialog__close');
  close.setAttribute('aria-label', 'Close ChatGPT sign-in');
  close.innerHTML = '<svg aria-hidden="true"><use href="#x"/></svg>';
  header.append(create('span', 'account-dialog__eyebrow', 'Your AI connection'), close);
  const title = create('h2');
  title.id = 'account-dialog-title';
  title.tabIndex = -1;
  const detail = create('p', 'account-dialog__detail');
  detail.id = 'account-dialog-detail';
  const code = create('code', 'account-dialog__code');
  code.setAttribute('aria-label', 'Sign-in code');
  const actions = create('div', 'account-dialog__actions');
  const start = button('button primary', 'Try again');
  const continueBrowser = button('button primary', 'Continue in browser');
  const cancel = button('text-button', 'Cancel sign-in');
  const status = create('p', 'account-dialog__status');
  status.setAttribute('role', 'status');
  actions.append(start, continueBrowser, cancel);
  dialog.append(header, title, detail, code, actions, status);
  document.body.append(dialog);

  let view = client.view;
  let pending = false;
  let destroyed = false;
  const account = () => view?.snapshot?.account || { state: 'unknown', revision: 0 };
  const authorizing = () => ['starting', 'awaiting_sign_in'].includes(account().state);
  const command = async (action) => {
    if (pending || destroyed) return false;
    pending = true;
    status.textContent = '';
    render();
    try {
      const response = await fetcher('/api/account/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: JSON.stringify({
          action,
          request_id: crypto.randomUUID(),
          based_on_revision: account().revision,
        }),
      });
      if (!response.ok) throw new Error('rejected');
      await client.refresh?.();
      return true;
    } catch {
      if (!destroyed)
        status.textContent =
          action === 'cancel'
            ? 'Could not cancel sign-in. Try again.'
            : 'Could not start sign-in. Try again.';
      return false;
    } finally {
      pending = false;
      if (!destroyed) render();
    }
  };
  const render = () => {
    const current = account();
    const state = current.state;
    container.hidden = state === 'connected' || state === 'unknown';
    trigger.textContent = authorizing() ? 'Finish sign-in' : 'Connect ChatGPT';
    const starting = state === 'starting' || (pending && !authorizing());
    title.textContent =
      state === 'awaiting_sign_in'
        ? 'Finish in your browser'
        : starting
          ? 'Connecting to ChatGPT'
          : state === 'unavailable'
            ? 'Let’s try that again'
            : 'Connect ChatGPT';
    detail.textContent =
      state === 'awaiting_sign_in'
        ? 'Enter this code when OpenAI asks.'
        : starting
          ? 'Getting your sign-in code…'
          : state === 'unavailable'
            ? 'Get a new code to continue signing in.'
            : 'Use your ChatGPT account with eïlo.';
    code.hidden = state !== 'awaiting_sign_in' || typeof current.user_code !== 'string';
    // Polls must not disturb a code the person is selecting to copy.
    const value = code.hidden ? '' : current.user_code;
    if (code.textContent !== value) code.textContent = value;
    start.hidden = authorizing() || starting || container.hidden;
    start.disabled = pending;
    continueBrowser.hidden = state !== 'awaiting_sign_in';
    continueBrowser.disabled = pending;
    cancel.hidden = !authorizing();
    cancel.disabled = pending;
    if (state === 'connected' && dialog.open) dialog.close();
  };
  trigger.addEventListener('click', () => {
    if (destroyed) return;
    if (!dialog.open) openInline();
    trigger.setAttribute('aria-expanded', 'true');
    title.focus({ preventScroll: true });
    if (!authorizing()) void command('start');
  });
  start.addEventListener('click', () => void command('start'));
  cancel.addEventListener('click', async () => {
    if (await command('cancel')) dialog.close();
  });
  // Closing keeps an in-progress code available from “Finish sign-in”.
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false');
    const target = container.hidden ? document.querySelector('#live-message-input') : trigger;
    target?.focus({ preventScroll: true });
  });
  continueBrowser.addEventListener('click', async () => {
    try {
      if (globalThis.eiloDesktop?.openAccountAuthorization) {
        await globalThis.eiloDesktop.openAccountAuthorization();
      } else {
        globalThis.open(AUTHORIZATION_URL, '_blank', 'noopener');
      }
    } catch {
      if (!destroyed) status.textContent = 'Could not open your browser. Try again.';
    }
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
      dialog.remove();
      container.replaceChildren();
    },
  };
}
