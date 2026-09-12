const ENDPOINT = '/api/connections';
const TABS = ['all', 'apps', 'mcps'];

const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const button = (text, onClick, className = 'connections-manager__button') => {
  const node = make('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
};

const icon = (id) => {
  const kind =
    { gmail: 'mail', calendar: 'calendar', activity: 'browser', browser: 'browser', mcp: 'server' }[
      id
    ] || 'server';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('connections-manager__icon', `connections-manager__icon--${kind}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = (name, attrs) => {
    const item = document.createElementNS(svg.namespaceURI, name);
    Object.entries(attrs).forEach(([key, value]) => item.setAttribute(key, value));
    svg.append(item);
  };
  if (kind === 'mail') {
    path('rect', { x: '3.5', y: '5.5', width: '17', height: '13', rx: '2.4' });
    path('path', { d: 'm4.5 7 7.5 5.6L19.5 7' });
  } else if (kind === 'calendar') {
    path('rect', { x: '4.5', y: '5.5', width: '15', height: '14', rx: '2.5' });
    path('path', { d: 'M8 3.8v3.5M16 3.8v3.5M4.8 10h14.4' });
  } else if (kind === 'browser') {
    path('rect', { x: '3.5', y: '4.5', width: '17', height: '15', rx: '3' });
    path('path', { d: 'M3.8 9h16.4M7 6.8h.1M10 6.8h.1' });
  } else {
    path('rect', { x: '4', y: '4', width: '16', height: '16', rx: '3' });
    path('path', { d: 'M8 9h.01M8 15h.01M12 9h4M12 15h4' });
  }
  return svg;
};

export function isConnectionsSnapshot(value) {
  return (
    Boolean(value) &&
    Number.isInteger(value.revision) &&
    Array.isArray(value.apps) &&
    Array.isArray(value.mcps) &&
    value.apps.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.enabled === 'boolean',
    ) &&
    value.mcps.every(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.enabled === 'boolean',
    )
  );
}

export function isMcpDraft(value) {
  if (
    !value ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    !['http', 'stdio'].includes(value.transport)
  )
    return false;
  if (value.transport === 'http')
    return typeof value.url === 'string' && /^https:\/\/[^\s]+$/i.test(value.url.trim());
  return (
    typeof value.command === 'string' &&
    Boolean(value.command.trim()) &&
    (!value.args || Array.isArray(value.args))
  );
}

function errorText(error) {
  if (error?.status === 409 && error?.needs_setup)
    return error.message || 'Open this connection to finish its setup.';
  if (error?.status === 409) return 'This changed somewhere else. The latest state is shown.';
  if (error?.name === 'AbortError') return 'That took too long. Try again.';
  return error?.message || 'Connections could not be updated. Try again.';
}

/**
 * A source-of-truth Connections workspace. It deliberately manages only data
 * returned by /api/connections: no marketplace, discovery, or implied grants.
 */
export function mountConnectionsManager(
  container,
  {
    fetcher = fetch,
    openGoogleAuthorization = async () => false,
    openBriefingAuthorization = async () => false,
    onActivitySetup = () => {},
    mountActivitySetup = null,
    onChanged = () => {},
    mountCalendar = null,
    mountBriefingSources = null,
  } = {},
) {
  if (!(container instanceof Element)) throw new TypeError('A Connections container is required.');
  const root = make('section', 'connections-manager');
  root.setAttribute('aria-labelledby', 'connections-manager-title');
  container.replaceChildren(root);

  let snapshot = null,
    snapshotView = '',
    tab = 'apps',
    query = '',
    selected = '',
    addOpen = false,
    removeId = '';
  let addDraft = { name: '', transport: 'http', target: '', args: '' };
  let destroyed = false,
    busy = false,
    active = null,
    message = '';
  const mounted = new Map(),
    childHosts = new Map();

  const currentFocus = () => {
    const activeElement = document.activeElement;
    return activeElement instanceof HTMLElement && root.contains(activeElement)
      ? activeElement.dataset.focus || ''
      : '';
  };
  const restoreFocus = (key) =>
    root.querySelector(`[data-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  const request = async (method, payload) => {
    const controller = new AbortController();
    active = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(ENDPOINT, {
        method,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Object.assign(new Error(data.error || 'Connections request failed.'), {
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
    if (!isConnectionsSnapshot(next))
      throw new Error('Connections returned an unexpected response.');
    if (snapshot && next.revision < snapshot.revision) return;
    const { revision, ...view } = next;
    const fingerprint = JSON.stringify(view);
    snapshot = next;
    if (fingerprint === snapshotView) return;
    snapshotView = fingerprint;
    onChanged(next);
    render(focus);
  };
  const refresh = async ({ quiet = false } = {}) => {
    if (busy || active) return;
    const focus = currentFocus();
    try {
      accept(await request('GET'), focus);
    } catch (error) {
      if (!destroyed && !quiet) {
        message = errorText(error);
        render(focus);
      }
    }
  };
  const mutate = async (payload, focus = '') => {
    if (!snapshot || busy) return null;
    busy = true;
    let refreshAfterConflict = false;
    const prior = currentFocus();
    render(prior);
    try {
      const next = await request('POST', { ...payload, based_on_revision: snapshot.revision });
      if (!destroyed) {
        message = '';
        accept(next, focus || prior);
      }
      return next;
    } catch (error) {
      if (!destroyed) {
        message = errorText(error);
        render(focus || prior);
        refreshAfterConflict = error?.status === 409;
      }
      return null;
    } finally {
      busy = false;
      if (!destroyed) render(focus || prior);
      if (refreshAfterConflict && !destroyed) void refresh({ quiet: true });
    }
  };
  const appDetail = (item, host) => {
    if (item.id === 'google-calendar' && typeof mountCalendar === 'function') {
      const existing = childHosts.get(item.id);
      if (existing) {
        host.append(existing);
        return;
      }
      const embedded = make('div', 'connections-manager__embedded');
      host.append(embedded);
      childHosts.set(item.id, embedded);
      mounted.set(
        item.id,
        mountCalendar(embedded, {
          openAuthorization: openGoogleAuthorization,
          onChanged: () => {
            void refresh({ quiet: true });
          },
        }),
      );
      return;
    }
    if (item.id === 'gmail' && typeof mountBriefingSources === 'function') {
      const existing = childHosts.get(item.id);
      if (existing) {
        host.append(existing);
        return;
      }
      const embedded = make('div', 'connections-manager__embedded');
      host.append(embedded);
      childHosts.set(item.id, embedded);
      mounted.set(
        item.id,
        mountBriefingSources(embedded, {
          openAuthorization: openBriefingAuthorization,
          onChanged: () => {
            void refresh({ quiet: true });
          },
        }),
      );
      return;
    }
    if (item.id === 'browser-activity') {
      if (typeof mountActivitySetup === 'function') {
        const existing = childHosts.get(item.id);
        if (existing) {
          host.append(existing);
          return;
        }
        const embedded = make('div', 'connections-manager__embedded');
        host.append(embedded);
        childHosts.set(item.id, embedded);
        mounted.set(item.id, mountActivitySetup(embedded));
        return;
      }
      const copy = make(
        'p',
        'connections-manager__detail-copy',
        'Start by installing the Chrome extension.',
      );
      host.append(
        copy,
        button(
          'Install Chrome extension',
          () => onActivitySetup(),
          'connections-manager__button connections-manager__button--primary',
        ),
      );
      return;
    }
    host.append(
      make(
        'p',
        'connections-manager__detail-copy',
        item.detail || 'This connection has no additional local settings.',
      ),
    );
  };
  const renderMcpDetail = (item, host) => {
    const facts = make('dl', 'connections-manager__facts');
    const addFact = (term, value) => {
      if (!value) return;
      facts.append(make('dt', '', term), make('dd', '', value));
    };
    addFact('Transport', item.transport === 'stdio' ? 'Local process' : 'HTTP');
    addFact(
      item.transport === 'stdio' ? 'Command' : 'Address',
      item.transport === 'stdio' ? item.command : item.url,
    );
    addFact('Tools', Number.isInteger(item.tool_count) ? String(item.tool_count) : 'Not inspected');
    addFact('State', item.state || (item.enabled ? 'Enabled' : 'Disabled'));
    if (facts.childElementCount) host.append(facts);
    if (item.error) host.append(make('p', 'connections-manager__error', item.error));
    host.append(make('p', 'connections-manager__detail-copy', 'Not available in chats yet.'));
    if (item.transport === 'stdio')
      host.append(
        make('p', 'connections-manager__detail-copy', 'Testing starts this command on your Mac.'),
      );
    host.append(
      button(
        'Test connection',
        async () => {
          await mutate({ action: 'test_mcp', id: item.id }, `mcp-${item.id}`);
        },
        'connections-manager__button',
      ),
    );
    if (removeId === item.id) {
      const confirm = make('div', 'connections-manager__confirm');
      confirm.append(
        make(
          'p',
          '',
          `Remove “${item.name}” from eïlo? This removes its local configuration only.`,
        ),
      );
      confirm.append(
        button(
          'Remove MCP',
          async () => {
            removeId = '';
            selected = '';
            await mutate({ action: 'remove_mcp', id: item.id }, 'connections-search');
          },
          'connections-manager__button connections-manager__button--danger',
        ),
        button('Keep it', () => {
          removeId = '';
          render(`mcp-${item.id}`);
        }),
      );
      host.append(confirm);
    } else
      host.append(
        button(
          'Remove MCP',
          () => {
            removeId = item.id;
            render(`mcp-${item.id}`);
          },
          'connections-manager__button connections-manager__button--quiet',
        ),
      );
  };
  const toggle = (item) => {
    const control = make('label', 'connections-manager__switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = item.enabled;
    input.disabled = busy;
    input.dataset.focus = `toggle-${item.id}`;
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-checked', String(item.enabled));
    input.setAttribute('aria-label', `Use ${item.name}`);
    input.addEventListener('change', async () => {
      const wanted = input.checked;
      input.setAttribute('aria-checked', String(wanted));
      const next = await mutate(
        { action: 'set_enabled', id: item.id, enabled: wanted },
        `toggle-${item.id}`,
      );
      if (!next && wanted) {
        selected = item.id;
        render(`row-${item.id}`);
      }
    });
    control.append(input);
    return control;
  };
  const row = (item, kind) => {
    const open = selected === item.id;
    const article = make('article', `connections-manager__row${open ? ' is-open' : ''}`);
    const select = button(
      '',
      () => {
        selected = open ? '' : item.id;
        removeId = '';
        render(`row-${item.id}`);
        if (!open && item.id === 'browser-activity') mounted.get(item.id)?.refresh?.();
      },
      'connections-manager__select',
    );
    select.dataset.focus = `row-${item.id}`;
    select.setAttribute('aria-expanded', String(open));
    select.setAttribute('aria-controls', `connection-detail-${item.id}`);
    select.append(
      icon(kind === 'mcp' ? 'mcp' : item.id.replace('google-', '').replace('browser-', '')),
      make('span', 'connections-manager__row-copy'),
    );
    select
      .querySelector('.connections-manager__row-copy')
      .append(
        make('strong', '', item.name),
        make('small', '', item.description || item.detail || ''),
      );
    const stateText =
      item.state && !['on', 'off', 'enabled', 'disabled'].includes(item.state.toLowerCase())
        ? item.state
        : '';
    const status = make(
      'span',
      `connections-manager__state state-${item.state || (item.enabled ? 'enabled' : 'disabled')}`,
      stateText,
    );
    const controls = make('div', 'connections-manager__row-actions');
    const options = button(
      open ? 'Close details' : 'Manage',
      () => {
        selected = open ? '' : item.id;
        removeId = '';
        render(`options-${item.id}`);
      },
      'connections-manager__details-toggle',
    );
    options.dataset.focus = `options-${item.id}`;
    options.setAttribute('aria-label', `${open ? 'Close details for' : 'Manage'} ${item.name}`);
    options.setAttribute('aria-expanded', String(open));
    if (item.id === 'browser-activity' && !item.setup_verified) {
      const setup = button(
        item.enabled ? 'Finish setup' : 'Connect',
        () => {
          selected = item.id;
          render(`row-${item.id}`);
          mounted.get(item.id)?.refresh?.();
        },
        'connections-manager__button',
      );
      controls.append(status, setup, options);
    } else controls.append(status, toggle(item), options);
    article.append(select, controls);
    if (open) {
      const detail = make('div', 'connections-manager__detail');
      detail.id = `connection-detail-${item.id}`;
      detail.tabIndex = -1;
      if (kind === 'mcp') renderMcpDetail(item, detail);
      else appDetail(item, detail);
      article.append(detail);
    }
    return article;
  };
  const addForm = () => {
    const form = make('form', 'connections-manager__add-form');
    form.noValidate = true;
    const title = make('h2', '', 'Add an MCP');
    title.id = 'connections-add-mcp-title';
    form.append(
      title,
      make('p', 'connections-manager__detail-copy', 'Add a connection. It starts off.'),
    );
    const field = (label, name, type = 'text', placeholder = '') => {
      const wrap = make('label', 'connections-manager__field');
      wrap.append(make('span', '', label));
      const input = document.createElement('input');
      input.name = name;
      input.type = type;
      input.placeholder = placeholder;
      input.autocomplete = 'off';
      input.maxLength = name === 'name' ? 80 : 2048;
      input.dataset.focus = `mcp-${name}`;
      input.value = addDraft[name] || '';
      input.addEventListener('input', () => {
        addDraft[name] = input.value;
      });
      wrap.append(input);
      return wrap;
    };
    const name = field('Name', 'name', 'text', 'Example: Project notes');
    const transport = make('label', 'connections-manager__field');
    transport.append(make('span', '', 'Transport'));
    const select = document.createElement('select');
    select.name = 'transport';
    select.append(new Option('HTTPS', 'http'), new Option('Local process', 'stdio'));
    select.value = addDraft.transport;
    transport.append(select);
    const target = field('HTTPS address', 'target', 'url', 'https://…');
    const hint = make(
      'p',
      'connections-manager__field-hint',
      'Use HTTPS. Authentication secrets are not supported here.',
    );
    const updateTarget = () => {
      const stdio = select.value === 'stdio';
      addDraft.transport = select.value;
      target.querySelector('span').textContent = stdio ? 'Command' : 'HTTPS address';
      const input = target.querySelector('input');
      input.type = stdio ? 'text' : 'url';
      input.placeholder = stdio ? 'Example: npx' : 'https://…';
      hint.textContent = stdio
        ? 'One argument per line, or a JSON array.'
        : 'Use HTTPS. Authentication secrets are not supported here.';
      args.hidden = !stdio;
    };
    const args = make('label', 'connections-manager__field');
    args.append(make('span', '', 'Arguments (optional)'));
    const argsInput = document.createElement('textarea');
    argsInput.name = 'args';
    argsInput.rows = 3;
    argsInput.placeholder = 'Example: ["-y", "package-name"]';
    argsInput.value = addDraft.args || '';
    argsInput.dataset.focus = 'mcp-args';
    argsInput.addEventListener('input', () => {
      addDraft.args = argsInput.value;
    });
    args.append(argsInput);
    args.hidden = select.value !== 'stdio';
    select.addEventListener('change', updateTarget);
    updateTarget();
    const actions = make('div', 'connections-manager__form-actions');
    actions.append(
      button(
        'Add disabled MCP',
        async () => {
          const data = new FormData(form),
            currentTransport = String(data.get('transport'));
          const draft = {
            name: String(data.get('name') || '').trim(),
            transport: currentTransport,
          };
          if (currentTransport === 'http') draft.url = String(data.get('target') || '').trim();
          else {
            draft.command = String(data.get('target') || '').trim();
            const raw = String(data.get('args') || '').trim();
            try {
              draft.args = raw
                ? raw.startsWith('[')
                  ? JSON.parse(raw)
                  : raw.split(/\r?\n/).filter(Boolean)
                : [];
            } catch {
              message = 'Arguments must be a JSON array or one argument per line.';
              render('mcp-args');
              return;
            }
          }
          if (!isMcpDraft(draft)) {
            message =
              currentTransport === 'http'
                ? 'Enter a name and an HTTPS MCP address.'
                : 'Enter a name and command.';
            render('mcp-name');
            return;
          }
          const next = await mutate({ action: 'add_mcp', ...draft }, 'connections-search');
          if (next) {
            addOpen = false;
            addDraft = { name: '', transport: 'http', target: '', args: '' };
            render('connections-search');
          }
        },
        'connections-manager__button connections-manager__button--primary',
      ),
      button('Cancel', () => {
        addOpen = false;
        render('connections-add');
      }),
    );
    form.append(name, transport, target, hint, args, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      actions.querySelector('button')?.click();
    });
    return form;
  };
  const render = (focus = '') => {
    for (const [id, instance] of mounted) {
      if (id !== selected) {
        instance?.destroy?.();
        mounted.delete(id);
        childHosts.delete(id);
      }
    }
    root.replaceChildren();
    const chosen =
      snapshot && [...snapshot.apps, ...snapshot.mcps].find((item) => item.id === selected);
    if (chosen || addOpen) {
      const back = button(
        '‹  Connections',
        () => {
          selected = '';
          addOpen = false;
          removeId = '';
          message = '';
          render('connections-search');
        },
        'connections-manager__back',
      );
      back.dataset.focus = 'connection-back';
      root.append(back);
      const heading = make('h2', '', chosen?.name || 'Add MCP');
      heading.id = 'connections-manager-title';
      root.append(heading);
      if (message) {
        const notice = make(
          'p',
          'connections-manager__notice connections-manager__notice--error',
          message,
        );
        notice.setAttribute('role', 'alert');
        root.append(notice);
      }
      if (chosen) {
        const detail = make('div', 'connections-manager__service');
        if (snapshot.mcps.some((item) => item.id === chosen.id)) renderMcpDetail(chosen, detail);
        else appDetail(chosen, detail);
        root.append(detail);
      } else {
        const form = addForm();
        form.querySelector('h2')?.remove();
        root.append(form);
      }
      restoreFocus(focus);
      return;
    }
    const header = make('header', 'connections-manager__header');
    header.append(make('div', 'connections-manager__title-wrap'));
    const heading = make('h2', '', 'Connections');
    heading.id = 'connections-manager-title';
    header.firstChild.append(heading, make('p', '', 'Choose what eïlo can work with.'));
    const add = button(
      'Add MCP',
      () => {
        addOpen = !addOpen;
        render('connections-add');
      },
      'connections-manager__button connections-manager__button--primary',
    );
    add.dataset.focus = 'connections-add';
    if (tab === 'mcps') header.append(add);
    root.append(header);
    const toolbar = make('div', 'connections-manager__toolbar');
    const tabs = make('div', 'connections-manager__tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Filter connections');
    for (const next of TABS) {
      const control = button(
        next === 'all' ? 'All' : next === 'apps' ? 'Apps' : 'Developer tools',
        () => {
          tab = next;
          selected = '';
          render(`tab-${next}`);
        },
        'connections-manager__tab',
      );
      control.dataset.focus = `tab-${next}`;
      control.setAttribute('aria-pressed', String(tab === next));
      tabs.append(control);
    }
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search connections';
    search.value = query;
    search.dataset.focus = 'connections-search';
    search.setAttribute('aria-label', 'Search connections');
    search.addEventListener('input', () => {
      query = search.value;
      selected = '';
      render('connections-search');
    });
    toolbar.append(tabs, search);
    root.append(toolbar);
    if (!snapshot) {
      root.append(make('p', 'connections-manager__notice', message || 'Loading connections…'));
      return;
    }
    if (message) {
      const notice = make(
        'p',
        'connections-manager__notice connections-manager__notice--error',
        message,
      );
      notice.setAttribute('role', 'alert');
      root.append(notice);
    }
    if (addOpen) root.append(addForm());
    const needle = query.trim().toLocaleLowerCase();
    const matches = (item) =>
      !needle ||
      `${item.name} ${item.description || ''} ${item.state || ''}`
        .toLocaleLowerCase()
        .includes(needle);
    const apps = snapshot.apps.filter(matches),
      mcps = snapshot.mcps.filter(matches);
    const list = make('div', 'connections-manager__list');
    if (tab !== 'mcps') apps.forEach((item) => list.append(row(item, 'app')));
    if (tab !== 'apps') mcps.forEach((item) => list.append(row(item, 'mcp')));
    if (!list.childElementCount)
      list.append(
        make(
          'p',
          'connections-manager__empty',
          query ? 'No connections match that search.' : 'No MCPs are configured yet.',
        ),
      );
    root.append(list);
    restoreFocus(focus);
  };
  render();
  void refresh();
  return {
    refresh,
    show({ tab: next, id } = {}) {
      if (TABS.includes(next)) {
        tab = next;
        selected = typeof id === 'string' ? id : '';
        render(`tab-${next}`);
      }
    },
    destroy() {
      destroyed = true;
      active?.abort();
      for (const instance of mounted.values()) instance?.destroy?.();
      mounted.clear();
      childHosts.clear();
      root.remove();
    },
  };
}
