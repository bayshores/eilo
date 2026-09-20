const ENDPOINT = '/api/workspace/catalog';
const create = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, click, className = 'chat-library__button') => {
  const node = create('button', className, text);
  node.type = 'button';
  node.addEventListener('click', click);
  return node;
};

export function isCatalog(value) {
  return (
    Boolean(value) &&
    Number.isInteger(value.revision) &&
    typeof value.active_chat_id === 'string' &&
    Array.isArray(value.projects) &&
    Array.isArray(value.chats) &&
    value.projects.every(
      (project) =>
        project &&
        typeof project.id === 'string' &&
        typeof project.name === 'string' &&
        typeof project.archived === 'boolean',
    ) &&
    value.chats.every(
      (chat) =>
        chat &&
        typeof chat.id === 'string' &&
        typeof chat.name === 'string' &&
        typeof chat.archived === 'boolean' &&
        typeof chat.pinned === 'boolean',
    )
  );
}

export function catalogFromSnapshot(snapshot) {
  return snapshot?.workspace?.catalog || snapshot?.workspace || null;
}
export function formatChatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function chatDisplayName(chat) {
  const name = typeof chat?.name === 'string' ? chat.name.trim() : '';
  const lower = name.toLocaleLowerCase();
  const generic = ['new chat', 'untitled chat', 'conversation'].includes(lower);
  const looksLikePrompt = name.length > 56 || name.endsWith('?');
  if (name && !generic && !looksLikePrompt) return name;
  const date = formatChatDate(chat?.updated_at);
  return date ? `Conversation · ${date}` : 'Conversation';
}

function labelError(error) {
  if (error?.status === 409) return 'That changed elsewhere. The latest library is shown.';
  if (error?.name === 'AbortError') return 'That took too long. Try again.';
  return error?.message || 'The chat library could not be updated.';
}

/** A real chat/project catalog. Names and grouping only: goals and sources stay global. */
export function mountChatLibrary(
  container,
  { fetcher = fetch, onActivate = () => {}, onChanged = () => {}, canManage = () => true } = {},
) {
  if (!(container instanceof Element)) throw new TypeError('A chat library container is required.');
  const root = create('section', 'chat-library');
  root.setAttribute('aria-label', 'Chats and projects');
  container.replaceChildren(root);
  let catalog = null,
    catalogView = '',
    manageView = null,
    projectId = null,
    archived = false,
    pinnedOnly = false,
    query = '',
    menuId = '',
    projectActions = false,
    editor = null,
    notice = '',
    busy = false,
    destroyed = false,
    active = null;
  const focusKey = () => {
    const node = document.activeElement;
    return node instanceof HTMLElement && root.contains(node) ? node.dataset.focus || '' : '';
  };
  const restore = (key) =>
    root.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  const request = async (method, body) => {
    const controller = new AbortController();
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(ENDPOINT, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(new Error(data.error || 'Catalog request failed.'), {
          status: response.status,
          ...data,
        });
      return data;
    } finally {
      clearTimeout(timeout);
      if (active === controller) active = null;
    }
  };
  const accept = (next, focus = '') => {
    if (!isCatalog(next)) throw new Error('The chat library returned an unexpected response.');
    if (catalog && next.revision < catalog.revision) return;
    const { revision, ...view } = next;
    const fingerprint = JSON.stringify(view),
      currentManage = Boolean(canManage());
    catalog = next;
    if (fingerprint === catalogView && currentManage === manageView) return;
    catalogView = fingerprint;
    manageView = currentManage;
    render(focus);
  };
  const refresh = async ({ quiet = false } = {}) => {
    if (busy || active) return;
    const focus = focusKey();
    try {
      accept(await request('GET'), focus);
    } catch (error) {
      if (!destroyed && !quiet) {
        notice = labelError(error);
        render(focus);
      }
    }
  };
  const mutate = async (action, values = {}, focus = '') => {
    if (!catalog || busy || !canManage()) return null;
    busy = true;
    let refreshAfterConflict = false;
    const prior = focusKey();
    render(prior);
    try {
      const snapshot = await request('POST', {
        action,
        based_on_revision: catalog.revision,
        ...values,
      });
      const next = catalogFromSnapshot(snapshot);
      if (!isCatalog(next))
        throw new Error('The workspace did not return its updated chat library.');
      notice = '';
      accept(next, focus || prior);
      onChanged(snapshot);
      return next;
    } catch (error) {
      if (!destroyed) {
        notice = labelError(error);
        refreshAfterConflict = error?.status === 409;
        render(focus || prior);
      }
      return null;
    } finally {
      busy = false;
      if (!destroyed) render(focus || prior);
      if (refreshAfterConflict && !destroyed) void refresh({ quiet: true });
    }
  };
  const selectChat = async (chat) => {
    const next = await mutate('switch_chat', { chat_id: chat.id }, `chat-${chat.id}`);
    if (next) onActivate(next.chats.find((item) => item.id === chat.id) || chat);
  };
  const startEditor = (kind, id, value) => {
    editor = { kind, id, value };
    menuId = '';
    render(`edit-${kind}-${id}`);
  };
  const inlineEditor = () => {
    if (!editor) return null;
    const form = create('form', 'chat-library__inline-editor');
    const input = document.createElement('input');
    input.value = editor.value || '';
    input.maxLength = editor.kind === 'project' ? 80 : 120;
    input.dataset.focus = `edit-${editor.kind}-${editor.id}`;
    input.setAttribute('aria-label', editor.kind === 'project' ? 'Project name' : 'Chat name');
    input.addEventListener('input', () => {
      if (editor) editor.value = input.value;
    });
    const cancel = () => {
      editor = null;
      render(editor?.kind ? '' : 'chat-library-search');
    };
    form.append(
      input,
      button(editor.id === 'new' ? 'Create project' : 'Save', async () => {
        const name = input.value.trim();
        if (!name) {
          notice = 'Enter a name.';
          render(input.dataset.focus);
          return;
        }
        const action =
          editor.kind === 'project'
            ? editor.id === 'new'
              ? 'create_project'
              : 'rename_project'
            : editor.id === 'new'
              ? 'new_chat'
              : 'rename_chat';
        const values =
          editor.kind === 'project'
            ? editor.id === 'new'
              ? { name }
              : { project_id: editor.id, name }
            : editor.id === 'new'
              ? { name, project_id: projectId || undefined }
              : { chat_id: editor.id, name };
        const next = await mutate(action, values, 'chat-library-search');
        if (next) {
          if (action === 'create_project') {
            projectId = next.projects.find((project) => project.name === name)?.id || null;
            archived = false;
            pinnedOnly = false;
          }
          editor = null;
          render('chat-library-search');
          if (action === 'new_chat')
            onActivate(next.chats.find((chat) => chat.id === next.active_chat_id));
        }
      }),
      button('Cancel', cancel),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      form.querySelector('button')?.click();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    return form;
  };
  const rowMenu = (chat) => {
    const menu = create('div', 'chat-library__menu');
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', `Options for ${chat.name}`);
    menu.append(
      button('Rename', () => startEditor('chat', chat.id, chat.name), 'chat-library__menu-item'),
      button(
        chat.pinned ? 'Unpin' : 'Pin',
        async () => {
          menuId = '';
          await mutate('pin_chat', { chat_id: chat.id, pinned: !chat.pinned }, `chat-${chat.id}`);
        },
        'chat-library__menu-item',
      ),
    );
    const move = create('select', 'chat-library__move');
    move.setAttribute('aria-label', `Move ${chat.name}`);
    move.append(new Option('Move to project…', ''), new Option('No project', '__none__'));
    catalog.projects
      .filter((project) => !project.archived && project.id !== chat.project_id)
      .forEach((project) => move.append(new Option(project.name, project.id)));
    move.addEventListener('change', async () => {
      if (!move.value) return;
      menuId = '';
      await mutate(
        'move_chat',
        { chat_id: chat.id, project_id: move.value === '__none__' ? null : move.value },
        `chat-${chat.id}`,
      );
    });
    menu.append(move);
    if (chat.archived)
      menu.append(
        button(
          'Restore',
          async () => {
            menuId = '';
            await mutate('archive_chat', { chat_id: chat.id, archived: false }, `chat-${chat.id}`);
          },
          'chat-library__menu-item',
        ),
      );
    else {
      const archive = button(
        'Archive',
        async () => {
          menuId = '';
          await mutate('archive_chat', { chat_id: chat.id, archived: true }, 'chat-library-search');
        },
        'chat-library__menu-item',
      );
      if (chat.id === catalog.active_chat_id) {
        archive.disabled = true;
        archive.title = 'Switch to another chat before archiving this one.';
      }
      menu.append(archive);
    }
    return menu;
  };
  const closeMenuOutside = (event) => {
    if (menuId && !root.contains(event.target)) {
      menuId = '';
      render();
    }
  };
  const closeMenuEscape = (event) => {
    if (event.key === 'Escape' && menuId) {
      event.preventDefault();
      event.stopPropagation();
      const focus = 'menu-' + menuId;
      menuId = '';
      render(focus);
    }
  };
  document.addEventListener('pointerdown', closeMenuOutside, true);
  root.addEventListener('keydown', closeMenuEscape);
  const render = (focus = '') => {
    root.replaceChildren();
    const main = create('div', 'chat-library__main');
    const header = create('header', 'chat-library__header');
    header.append(create('h2', '', 'History'));
    const actions = create('div', 'chat-library__header-actions');
    const selectedProject = projectId && catalog?.projects.find((item) => item.id === projectId);
    const newProject = button(
      'New project',
      () => startEditor('project', 'new', ''),
      'chat-library__button chat-library__new-project',
    );
    newProject.dataset.focus = 'new-project';
    newProject.disabled = busy || !canManage();
    const newChat = button(
      'New chat',
      async () => {
        const next = await mutate('new_chat', { project_id: projectId || undefined }, 'new-chat');
        if (next) onActivate(next.chats.find((chat) => chat.id === next.active_chat_id));
      },
      'chat-library__button chat-library__button--primary',
    );
    newChat.dataset.focus = 'new-chat';
    newChat.disabled =
      !catalog || busy || !canManage() || archived || Boolean(selectedProject?.archived);
    actions.append(newProject, newChat);
    header.append(actions);
    main.append(header);
    const detail = inlineEditor();
    if (detail) main.append(detail);
    const search = document.createElement('input');
    search.type = 'search';
    search.value = query;
    search.placeholder = 'Search chats';
    search.dataset.focus = 'chat-library-search';
    search.setAttribute('aria-label', 'Search chats');
    search.addEventListener('input', () => {
      query = search.value;
      menuId = '';
      render('chat-library-search');
    });
    main.append(search);
    const filters = create('div', 'chat-library__filters');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', 'Filter chats');
    const filter = (label, pressed, click, key) => {
      const item = button(label, click, 'chat-library__filter');
      item.dataset.focus = key;
      item.setAttribute('aria-pressed', String(pressed));
      return item;
    };
    filters.append(
      filter(
        'All',
        !archived && !pinnedOnly,
        () => {
          archived = false;
          pinnedOnly = false;
          render('filter-all');
        },
        'filter-all',
      ),
      filter(
        'Pinned',
        !archived && pinnedOnly,
        () => {
          archived = false;
          pinnedOnly = true;
          render('filter-pinned');
        },
        'filter-pinned',
      ),
      filter(
        'Archived',
        archived,
        () => {
          archived = true;
          pinnedOnly = false;
          render('filter-archived');
        },
        'filter-archived',
      ),
    );
    main.append(filters);
    if (catalog?.projects.some((project) => !project.archived)) {
      const projects = create('div', 'chat-library__projects');
      projects.setAttribute('aria-label', 'Project filters');
      const all = button(
        'All projects',
        () => {
          projectId = null;
          render('project-all');
        },
        `chat-library__project-chip${projectId ? '' : ' is-selected'}`,
      );
      all.dataset.focus = 'project-all';
      all.setAttribute('aria-pressed', String(!projectId));
      projects.append(all);
      catalog.projects
        .filter((project) => !project.archived)
        .forEach((project) => {
          const item = button(
            project.name,
            () => {
              projectId = project.id;
              render(`project-${project.id}`);
            },
            `chat-library__project-chip${projectId === project.id ? ' is-selected' : ''}`,
          );
          item.dataset.focus = `project-${project.id}`;
          item.setAttribute('aria-pressed', String(projectId === project.id));
          projects.append(item);
        });
      if (selectedProject) {
        const options = button(
          'Project options',
          () => {
            projectActions = !projectActions;
            render('project-options');
          },
          'chat-library__project-options',
        );
        options.dataset.focus = 'project-options';
        options.disabled = busy || !canManage();
        options.setAttribute('aria-expanded', String(projectActions));
        projects.append(options);
      }
      main.append(projects);
      if (projectActions && selectedProject) {
        const controls = create('div', 'chat-library__project-actions');
        controls.append(
          button(
            'Rename project',
            () => startEditor('project', projectId, selectedProject.name),
            'chat-library__button',
          ),
          button(
            'Archive project',
            async () => {
              const next = await mutate(
                'archive_project',
                { project_id: projectId, archived: true },
                'project-all',
              );
              if (next) {
                projectId = null;
                projectActions = false;
                render('project-all');
              }
            },
            'chat-library__button',
          ),
        );
        controls.append(create('span', 'chat-library__project-note', 'Chats stay where they are.'));
        main.append(controls);
      }
    }
    if (catalog?.projects.some((project) => project.archived)) {
      const oldProjects = create('details', 'chat-library__archived-projects');
      oldProjects.append(create('summary', '', 'Archived projects'));
      catalog.projects
        .filter((project) => project.archived)
        .forEach((project) => {
          const item = create('div', 'chat-library__archived-project');
          item.append(
            create('span', '', project.name),
            button(
              'Restore',
              async () => {
                await mutate(
                  'archive_project',
                  { project_id: project.id, archived: false },
                  'project-all',
                );
              },
              'chat-library__menu-item',
            ),
          );
          oldProjects.append(item);
        });
      main.append(oldProjects);
    }
    if (notice) {
      const status = create('p', 'chat-library__status chat-library__status--error', notice);
      status.setAttribute('role', 'alert');
      main.append(status);
    }
    const list = create('div', 'chat-library__chats');
    if (!catalog) list.append(create('p', 'chat-library__empty', 'Loading chats…'));
    else {
      const needle = query.trim().toLocaleLowerCase();
      const projectName = (id) => catalog.projects.find((project) => project.id === id)?.name || '';
      const chats = catalog.chats
        .filter(
          (chat) =>
            chat.archived === archived &&
            (!pinnedOnly || chat.pinned) &&
            (!projectId || chat.project_id === projectId) &&
            (!needle ||
              `${chat.name} ${projectName(chat.project_id)}`.toLocaleLowerCase().includes(needle)),
        )
        .sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            String(b.updated_at).localeCompare(String(a.updated_at)),
        );
      chats.forEach((chat) => {
        const row = create(
          'article',
          `chat-library__chat${chat.id === catalog.active_chat_id ? ' is-active' : ''}`,
        );
        const open = button('', () => void selectChat(chat), 'chat-library__chat-open');
        open.dataset.focus = `chat-${chat.id}`;
        open.disabled = busy || !canManage();
        open.setAttribute('aria-current', chat.id === catalog.active_chat_id ? 'page' : 'false');
        const copy = create('span', 'chat-library__chat-copy');
        const label = chatDisplayName(chat);
        copy.append(create('strong', '', label));
        const project = projectName(chat.project_id);
        if (project) copy.append(create('small', '', project));
        open.append(copy);
        const stamp = create('time', 'chat-library__chat-date', formatChatDate(chat.updated_at));
        stamp.dateTime = chat.updated_at || '';
        const more = button(
          '⋯',
          () => {
            menuId = menuId === chat.id ? '' : chat.id;
            render(`menu-${chat.id}`);
          },
          'chat-library__more',
        );
        more.dataset.focus = `menu-${chat.id}`;
        more.disabled = busy || !canManage();
        more.setAttribute('aria-label', `Options for ${label}`);
        more.setAttribute('aria-expanded', String(menuId === chat.id));
        row.append(open, stamp, more);
        if (menuId === chat.id) row.append(rowMenu(chat));
        list.append(row);
      });
      if (!list.childElementCount)
        list.append(
          create(
            'p',
            'chat-library__empty',
            query
              ? 'No chats match that search.'
              : archived
                ? 'No archived chats.'
                : 'No chats here yet.',
          ),
        );
    }
    main.append(list);
    root.append(main);
    restore(focus);
  };
  const update = (next) => {
    const source = catalogFromSnapshot(next) || next;
    if (isCatalog(source)) accept(source, focusKey());
  };
  const show = ({ projectId: nextProjectId } = {}) => {
    if (nextProjectId !== undefined) {
      projectId = nextProjectId;
      archived = false;
    }
    render();
  };
  render();
  void refresh();
  return {
    update,
    show,
    refresh,
    destroy() {
      destroyed = true;
      active?.abort();
      document.removeEventListener('pointerdown', closeMenuOutside, true);
      root.removeEventListener('keydown', closeMenuEscape);
      root.remove();
    },
  };
}
