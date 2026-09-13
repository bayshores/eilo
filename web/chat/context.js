const formatter = new Intl.NumberFormat('en-US');
const safeNumber = (value) => Number.isFinite(value) && value >= 0;
const displayNumber = (value) => (safeNumber(value) ? formatter.format(value) : '—');

/** Converts optional runtime metadata into display-safe context facts. */
export function contextPresentation(chatContext, { connected = true } = {}) {
  const value = chatContext && typeof chatContext === 'object' ? chatContext : null;
  const live = connected && Boolean(value);
  const windowTokens =
    live && safeNumber(value.window_tokens) && value.window_tokens > 0 ? value.window_tokens : null;
  const usedTokens = live && safeNumber(value.used_tokens) ? value.used_tokens : null;
  const known = windowTokens !== null && usedTokens !== null;
  const progress = known ? Math.min(100, (usedTokens / windowTokens) * 100) : 0;
  return {
    known,
    percentText: known ? `${Math.round(progress)}%` : '—',
    used: known ? displayNumber(usedTokens) : '—',
    remaining: known ? displayNumber(Math.max(0, windowTokens - usedTokens)) : '—',
    total: windowTokens === null ? '—' : displayNumber(windowTokens),
    threshold:
      live && safeNumber(value.threshold_tokens) && windowTokens
        ? Math.round((value.threshold_tokens / windowTokens) * 100) + '%'
        : '—',
    compressionEnabled: live ? value.compression_enabled : null,
    input: live ? displayNumber(value.usage?.input_tokens) : '—',
    output: live ? displayNumber(value.usage?.output_tokens) : '—',
    progress,
    canCompress: live && Boolean(value.can_compress),
    status: live && typeof value.status === 'string' ? value.status : 'unavailable',
    error: live && typeof value.error === 'string' ? value.error : '',
  };
}

const make = (tag, className, value) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
};
const focusByKey = (root, key) =>
  [...root.querySelectorAll('[data-context-focus]')].find(
    (node) => node.dataset.contextFocus === key,
  );

export function mountChatContext(host, { client } = {}) {
  if (!(host instanceof Element))
    throw new TypeError('mountChatContext requires a DOM element host.');
  if (!client?.subscribe) throw new TypeError('mountChatContext requires a chat client.');
  const trigger = make('button', 'chat-context__trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'chat-context-details');
  host.insertBefore(trigger, host.querySelector('.live-send'));
  const details = make('section', 'chat-context');
  details.id = 'chat-context-details';
  details.hidden = true;
  details.setAttribute('aria-label', 'Chat context details');
  const form = host.closest('.live-composer');
  form.after(details);
  let view = client.view,
    panel = 'context',
    expanded = false,
    actionError = '',
    rendered = '';
  const close = (restoreFocus = false) => {
    expanded = false;
    details.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  };
  function render() {
    const facts = contextPresentation(view?.snapshot?.chat_context, {
      connected: view?.connection === 'connected',
    });
    const fingerprint = JSON.stringify([facts, panel, Boolean(client.canManage?.()), actionError]);
    if (fingerprint === rendered) return;
    rendered = fingerprint;
    const active = details.contains(document.activeElement)
      ? document.activeElement.dataset.contextFocus
      : '';
    trigger.textContent =
      facts.status === 'compressing'
        ? 'Summarizing…'
        : facts.known
          ? `Context · ~${facts.percentText}`
          : 'Context · —';
    trigger.setAttribute('aria-label', trigger.textContent + '. View chat context');
    trigger.disabled = view?.connection === 'loading';
    details.replaceChildren();
    const info = make('p', 'chat-context__info');
    info.textContent =
      panel === 'usage'
        ? `Chat totals: ${facts.input} input · ${facts.output} output tokens`
        : facts.known
          ? `~${facts.used} / ${facts.total} tokens · ${facts.remaining} left`
          : view?.connection !== 'connected'
            ? 'Reconnect to see context usage.'
            : 'Context usage updates after your next message.';
    details.append(info);
    const controls = make('div', 'chat-context__actions');
    const button = (key, label, callback) => {
      const node = make('button', '', label);
      node.type = 'button';
      node.dataset.contextFocus = key;
      node.addEventListener('click', callback);
      controls.append(node);
      return node;
    };
    if (panel === 'context') {
      controls.append(
        make(
          'span',
          'chat-context__auto',
          facts.compressionEnabled === false
            ? 'Auto-summary off'
            : `Auto-summary ${facts.threshold}`,
        ),
      );
      const summarize = button(
        'summarize',
        facts.status === 'compressing' ? 'Summarizing…' : 'Summarize',
        async () => {
          actionError = '';
          try {
            await client.compressContext();
          } catch (error) {
            actionError = error?.message || 'Could not summarize. Try again.';
          }
          render();
        },
      );
      summarize.title = 'Summarize older messages. Your saved chat stays available.';
      summarize.disabled =
        !facts.canCompress || !client.canManage?.() || facts.status === 'compressing';
    }
    button('view', panel === 'usage' ? 'Context' : 'Usage', () => {
      panel = panel === 'usage' ? 'context' : 'usage';
      render();
    });
    const collapse = button('close', '×', () => close(true));
    collapse.className = 'chat-context__close';
    collapse.setAttribute('aria-label', 'Collapse context details');
    details.append(controls);
    const result =
      facts.error ||
      actionError ||
      {
        compressed: 'Older messages summarized.',
        failed: 'Could not summarize. Try again.',
        interrupted: 'Summary interrupted. Your saved chat is available.',
        unchanged: 'No summary needed yet.',
      }[facts.status];
    if (result) {
      const status = make('p', 'chat-context__result', result);
      status.setAttribute('role', facts.status === 'failed' || actionError ? 'alert' : 'status');
      details.append(status);
    }
    if (active) {
      const target = focusByKey(details, active);
      (target && !target.disabled ? target : collapse).focus({ preventScroll: true });
    }
  }
  const open = (mode = 'context', focus = true) => {
    panel = mode === 'usage' ? 'usage' : 'context';
    actionError = '';
    render();
    expanded = true;
    details.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    if (focus) details.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  };
  trigger.addEventListener('click', (event) =>
    expanded ? close() : open('context', event.detail === 0),
  );
  const onEscape = (event) => {
    if (event.key === 'Escape' && expanded && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close(details.contains(document.activeElement));
    }
  };
  form.parentNode.addEventListener('keydown', onEscape);
  const unsubscribe = client.subscribe((next) => {
    if (view?.snapshot?.conversation_id !== next?.snapshot?.conversation_id) close();
    view = next;
    render();
  });
  render();
  return {
    open,
    destroy() {
      unsubscribe();
      form.parentNode.removeEventListener('keydown', onEscape);
      details.remove();
      trigger.remove();
    },
  };
}
