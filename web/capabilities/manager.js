const ENDPOINT = '/api/capabilities';

export const CAPABILITY_KINDS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'connector', label: 'Connectors' },
  { id: 'skill', label: 'Skills' },
  { id: 'mcp', label: 'MCP' },
  { id: 'plugin', label: 'Plugins' },
]);

const COLLECTIONS = Object.freeze({
  connector: 'connectors',
  skill: 'skills',
  mcp: 'mcps',
  plugin: 'plugins',
});

const DEFINITIONS = Object.freeze([
  ['connector', 'account or local data'],
  ['skill', 'reusable instructions'],
  ['mcp', 'external tools and data'],
  ['plugin', 'installed capability bundle'],
]);

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const control = (label, className = '') => {
  const element = make('button', className, label);
  element.type = 'button';
  return element;
};

const isItem = (item) =>
  Boolean(item) &&
  typeof item.id === 'string' &&
  typeof item.name === 'string' &&
  typeof item.description === 'string' &&
  typeof item.scope === 'string' &&
  typeof item.available === 'boolean' &&
  typeof item.globally_enabled === 'boolean' &&
  typeof item.supported === 'boolean' &&
  typeof item.enabled === 'boolean';

export function isCapabilitiesSnapshot(value) {
  return (
    Boolean(value) &&
    value.version === 1 &&
    Number.isInteger(value.revision) &&
    typeof value.chat_id === 'string' &&
    typeof value.chat_name === 'string' &&
    Object.values(COLLECTIONS).every(
      (collection) => Array.isArray(value[collection]) && value[collection].every(isItem),
    )
  );
}

export function capabilityRows(snapshot, kind = 'all', query = '') {
  if (!isCapabilitiesSnapshot(snapshot)) return [];
  const term = String(query).trim().toLocaleLowerCase();
  return Object.entries(COLLECTIONS)
    .filter(([id]) => kind === 'all' || id === kind)
    .flatMap(([id, collection]) => snapshot[collection].map((item) => ({ ...item, kind: id })))
    .filter((item) =>
      term
        ? `${item.name} ${item.description} ${item.kind}`.toLocaleLowerCase().includes(term)
        : true,
    );
}

function errorText(error) {
  if (error?.status === 409) return 'This changed elsewhere. The latest settings are shown.';
  if (error?.name === 'AbortError') return 'felis could not reach the local service in time.';
  return error?.message || 'Capabilities could not be updated.';
}

/**
 * Separates global installation and connection state from the current chat's
 * allowlist. A successful toggle changes the next turn, never the turn in flight.
 */
export function mountCapabilitiesManager(
  container,
  { fetcher = fetch, onManageGlobal = () => {} } = {},
) {
  if (!(container instanceof Element)) throw new TypeError('A capabilities container is required.');
  const root = make('section', 'capabilities-manager');
  root.setAttribute('aria-labelledby', 'capabilities-title');
  container.replaceChildren(root);

  let snapshot = null;
  let kind = 'all';
  let scopeMode = 'chat';
  let query = '';
  let busy = false;
  let message = '';
  let destroyed = false;
  let requestController = null;

  const request = async (method, body) => {
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetcher(ENDPOINT, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Eilo-Client': 'local-chat' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const value = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(value.error || 'Capability request failed.');
        error.status = response.status;
        throw error;
      }
      if (!isCapabilitiesSnapshot(value)) throw new Error('felis returned an unexpected response.');
      return value;
    } finally {
      clearTimeout(timeout);
      if (requestController === controller) requestController = null;
    }
  };

  const refresh = async ({ quiet = false } = {}) => {
    if (busy || requestController || destroyed) return;
    try {
      snapshot = await request('GET');
      message = '';
      render();
    } catch (error) {
      if (!quiet && !destroyed) {
        message = errorText(error);
        render();
      }
    }
  };

  const mutate = async (item, enabled) => {
    const globalChange = scopeMode === 'global';
    if (!snapshot || busy) return;
    if (globalChange && ['connector', 'mcp'].includes(item.kind)) {
      onManageGlobal();
      return;
    }
    if ((globalChange && !item.supported) || (!globalChange && !item.available)) return;
    busy = true;
    message = '';
    render(item.id);
    try {
      snapshot = await request('POST', {
        action: globalChange ? 'set_global_enabled' : 'set_enabled',
        based_on_revision: snapshot.revision,
        chat_id: snapshot.chat_id,
        kind: item.kind,
        id: item.id,
        enabled,
      });
      message = globalChange
        ? `${item.name} will be ${enabled ? 'available' : 'disabled'} for felis on the next turn.`
        : `${item.name} will be ${enabled ? 'available' : 'off'} on the next turn.`;
    } catch (error) {
      message = errorText(error);
      if (error?.status === 409) {
        try {
          snapshot = await request('GET');
        } catch {
          // Keep the original actionable message.
        }
      }
    } finally {
      busy = false;
      render(item.id);
    }
  };

  function render(focusId = '') {
    if (destroyed) return;
    const header = make('header', 'capabilities-manager__header');
    const title = make('div');
    const heading = make('h2', '', 'capabilities');
    heading.id = 'capabilities-title';
    title.append(
      heading,
      make(
        'p',
        '',
        snapshot
          ? scopeMode === 'chat'
            ? `${snapshot.chat_name} / changes apply next turn`
            : 'machine-wide availability / changes apply next turn'
          : 'capability access',
      ),
    );
    const headerActions = make('div', 'capabilities-manager__header-actions');
    const scopes = make('div', 'capabilities-manager__scopes');
    scopes.setAttribute('role', 'group');
    scopes.setAttribute('aria-label', 'Capability scope');
    for (const [id, label] of [
      ['chat', 'this chat'],
      ['global', 'this Mac'],
    ]) {
      const scope = control(label, 'capabilities-manager__scope-button');
      scope.setAttribute('aria-pressed', String(scopeMode === id));
      scope.addEventListener('click', () => {
        scopeMode = id;
        message = '';
        render();
      });
      scopes.append(scope);
    }
    const global = control('manage connections', 'capabilities-manager__global');
    global.addEventListener('click', onManageGlobal);
    headerActions.append(scopes, global);
    header.append(title, headerActions);

    const glossary = make('dl', 'capabilities-manager__glossary');
    for (const [term, definition] of DEFINITIONS) {
      const pair = make('div');
      pair.append(make('dt', '', term), make('dd', '', definition));
      glossary.append(pair);
    }

    const toolbar = make('div', 'capabilities-manager__toolbar');
    const tabs = make('div', 'capabilities-manager__tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', 'Capability type');
    for (const tab of CAPABILITY_KINDS) {
      const item = control(tab.label, 'capabilities-manager__tab');
      item.setAttribute('aria-pressed', String(kind === tab.id));
      item.addEventListener('click', () => {
        kind = tab.id;
        render();
      });
      tabs.append(item);
    }
    const search = make('input', 'capabilities-manager__search');
    search.type = 'search';
    search.placeholder = 'Find a capability';
    search.setAttribute('aria-label', 'Find a capability');
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value;
      render();
      root.querySelector('.capabilities-manager__search')?.focus({ preventScroll: true });
    });
    toolbar.append(tabs, search);

    const list = make('div', 'capabilities-manager__list');
    const rows = capabilityRows(snapshot, kind, query);
    for (const item of rows) {
      const row = make('article', 'capabilities-manager__row');
      row.dataset.capability = item.id;
      if (scopeMode === 'chat' ? !item.available : !item.supported)
        row.classList.add('is-unavailable');
      const copy = make('div', 'capabilities-manager__copy');
      const identity = make('div', 'capabilities-manager__identity');
      identity.append(
        make('strong', '', item.name),
        make('span', 'capabilities-manager__kind', item.kind),
        make('span', 'capabilities-manager__scope', item.scope),
      );
      copy.append(identity, make('p', '', item.description));
      if ((scopeMode === 'chat' && !item.available) || (scopeMode === 'global' && !item.supported))
        copy.append(make('small', '', item.state || 'configure first'));

      let setting;
      if (scopeMode === 'global' && ['connector', 'mcp'].includes(item.kind)) {
        setting = control(
          item.globally_enabled ? 'connected' : 'manage',
          'capabilities-manager__manage',
        );
        setting.dataset.focus = item.id;
        setting.addEventListener('click', onManageGlobal);
      } else {
        const enabled = scopeMode === 'global' ? item.globally_enabled : item.enabled;
        setting = make('label', 'capabilities-manager__toggle');
        const input = make('input');
        input.type = 'checkbox';
        input.role = 'switch';
        input.checked = enabled;
        input.disabled = busy || (scopeMode === 'global' ? !item.supported : !item.available);
        input.dataset.focus = item.id;
        input.setAttribute(
          'aria-label',
          `${enabled ? 'Disable' : 'Enable'} ${item.name} ${scopeMode === 'global' ? 'on this Mac' : 'for this chat'}`,
        );
        input.addEventListener('change', () => void mutate(item, input.checked));
        setting.append(
          make(
            'span',
            '',
            enabled
              ? scopeMode === 'global'
                ? 'available to felis'
                : 'on for this chat'
              : scopeMode === 'global'
                ? 'disabled on this Mac'
                : 'off for this chat',
          ),
          input,
        );
      }
      row.append(copy, setting);
      list.append(row);
    }
    if (!rows.length) {
      const empty = make('div', 'capabilities-manager__empty');
      empty.append(
        make(
          'strong',
          '',
          query ? 'No matches' : kind === 'plugin' ? 'No plugins installed' : 'Nothing here yet',
        ),
        make(
          'p',
          '',
          query
            ? 'Try another name or capability type.'
            : kind === 'plugin'
              ? 'Installed bundles will appear here automatically.'
              : scopeMode === 'chat'
                ? 'Connect or install it first, then choose it for this chat.'
                : 'Installed capabilities will appear here automatically.',
        ),
      );
      list.append(empty);
    }
    const status = make('p', 'capabilities-manager__status', message);
    status.setAttribute('role', message ? 'status' : 'presentation');
    root.replaceChildren(header, glossary, toolbar, list, status);
    if (focusId) {
      root
        .querySelector(
          `[data-capability="${CSS.escape(focusId)}"] [data-focus="${CSS.escape(focusId)}"]`,
        )
        ?.focus({ preventScroll: true });
    }
  }

  render();
  void refresh();
  return {
    refresh,
    show({ kind: nextKind = 'all' } = {}) {
      kind = CAPABILITY_KINDS.some((item) => item.id === nextKind) ? nextKind : 'all';
      scopeMode = 'chat';
      query = '';
      render();
      void refresh({ quiet: true });
    },
    destroy() {
      destroyed = true;
      requestController?.abort();
      root.remove();
    },
  };
}
