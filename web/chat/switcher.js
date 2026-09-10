const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const button = (label, handler, cls = 'chat-switcher__item') => {
  const n = el('button', cls, label);
  n.type = 'button';
  n.addEventListener('click', handler);
  return n;
};

/** A small history picker. It never replaces Home or owns conversation messages. */
export function mountChatSwitcher(
  container,
  { onSwitch, onNew, onBrowse, canManage = () => true } = {},
) {
  const root = el('div', 'chat-switcher');
  container.prepend(root);
  let catalog = null,
    open = false,
    query = '',
    busy = false,
    error = '',
    fingerprint = '';
  const trigger = button('', () => setOpen(!open), 'chat-switcher__trigger');
  trigger.setAttribute('aria-label', 'Switch conversation');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'chat-switcher-panel');
  const name = el('span', '', 'New chat');
  trigger.append(name, el('span', 'chat-switcher__chevron', '⌄'));
  const panel = el('section', 'chat-switcher__panel');
  panel.id = 'chat-switcher-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Choose a chat');
  root.append(trigger, panel);
  function setOpen(value) {
    open = value;
    error = '';
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      render();
      panel.querySelector('input')?.focus();
    }
  }
  async function act(handler) {
    if (busy || !canManage()) return;
    busy = true;
    error = '';
    render();
    try {
      await handler();
      setOpen(false);
    } catch (fault) {
      error = fault.message || 'The conversation could not be opened.';
    } finally {
      busy = false;
      render();
    }
  }
  function render() {
    const active = document.activeElement,
      searchFocused = active?.dataset?.quickChatSearch === 'true',
      position = active?.selectionStart;
    panel.replaceChildren();
    const heading = el('div', 'chat-switcher__heading');
    heading.append(el('strong', '', 'Your chats'));
    const fresh = button('+ New chat', () => act(onNew), 'chat-switcher__new');
    fresh.disabled = busy || !canManage();
    heading.append(fresh);
    const search = el('input', 'chat-switcher__search');
    search.type = 'search';
    search.placeholder = 'Find a conversation';
    search.setAttribute('aria-label', 'Find a conversation');
    search.dataset.quickChatSearch = 'true';
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      render();
    });
    const list = el('div', 'chat-switcher__list');
    const needle = query.trim().toLowerCase();
    const chats = (catalog?.chats || [])
      .filter((c) => !c.archived && (!needle || c.name.toLowerCase().includes(needle)))
      .sort(
        (a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at),
      )
      .slice(0, 8);
    for (const chat of chats) {
      const item = button('', () => act(() => onSwitch(chat.id)));
      item.disabled = busy || !canManage();
      item.setAttribute('aria-current', chat.id === catalog.active_chat_id ? 'true' : 'false');
      const copy = el('span', 'chat-switcher__copy');
      copy.append(el('span', '', chat.name));
      const project = catalog.projects.find((p) => p.id === chat.project_id);
      if (project) copy.append(el('small', '', project.name));
      item.append(copy);
      if (chat.id === catalog.active_chat_id) {
        const mark = el('span', 'chat-switcher__selected', '✓');
        mark.setAttribute('aria-hidden', 'true');
        item.append(mark);
      }
      list.append(item);
    }
    if (!chats.length)
      list.append(
        el(
          'p',
          'chat-switcher__empty',
          needle ? 'No matching conversations.' : 'Your conversations will appear here.',
        ),
      );
    const browse = button(
      'All chats & projects',
      () => {
        setOpen(false);
        onBrowse();
      },
      'chat-switcher__browse',
    );
    panel.append(heading, search, list, browse);
    if (error) {
      const message = el('p', 'chat-switcher__error', error);
      message.setAttribute('role', 'alert');
      panel.append(message);
    }
    if (busy) {
      const status = el('p', 'sr-only', 'Opening conversation…');
      status.setAttribute('role', 'status');
      panel.append(status);
    }
    if (searchFocused) {
      search.focus({ preventScroll: true });
      if (position !== null && search.type === 'text') search.setSelectionRange(position, position);
    }
  }
  const outside = (event) => {
    if (open && !root.contains(event.target)) setOpen(false);
  };
  const keyboard = (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.focus();
    }
  };
  document.addEventListener('pointerdown', outside);
  root.addEventListener('keydown', keyboard);
  return {
    update(snapshot) {
      catalog = snapshot?.workspace || null;
      const chat = catalog?.chats.find((c) => c.id === catalog.active_chat_id);
      name.textContent = chat?.name || 'New chat';
      trigger.title = chat?.name || 'Switch conversation';
      const next = JSON.stringify([catalog, canManage()]);
      if (next !== fingerprint) {
        fingerprint = next;
        if (open) render();
      }
    },
    close: () => setOpen(false),
    destroy() {
      document.removeEventListener('pointerdown', outside);
      root.remove();
    },
  };
}
