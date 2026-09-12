import { browserSetupState } from './setup-state.js';
import { createSetupMonitor } from './setup-monitor.js';
import { extensionSetupBridge } from './setup-bridge.js';
import { setupVisual, animateSetup } from './setup-visual.js';

export function extensionFolder(identity) {
  if (
    identity?.app !== 'eilo' ||
    identity.protocol !== 1 ||
    typeof identity.workspace !== 'string' ||
    !/^(\/|[A-Za-z]:[\\/])/.test(identity.workspace) ||
    [...identity.workspace].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return null;
  const separator = identity.workspace.startsWith('/') ? '/' : '\\';
  return (
    identity.workspace.replace(/[\\/]+$/, '') + separator + 'activity' + separator + 'extension'
  );
}

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (label, handler, primary = false) => {
  const element = make(
    'button',
    `chrome-setup__button${primary ? ' chrome-setup__button--primary' : ''}`,
    label,
  );
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
};
const EXTENSIONS_ADDRESS = 'chrome://extensions/';
const CONNECTION_ADDRESS = 'http://127.0.0.1:8765/activity-connect?client=desktop';
const STEP_KEY = 'eilo.chrome-setup.v2';

/** One current action. Merely opening this card never grants or enables activity. */
export function mountChromeSetup(
  container,
  {
    fetcher = fetch,
    clipboard = globalThis.navigator?.clipboard,
    openChrome = globalThis.eiloDesktop?.openChromeSetup,
    openExtensions = globalThis.eiloDesktop?.openChromeExtensions,
    revealFolder = globalThis.eiloDesktop?.revealChromeExtension,
    onNativeControl = null,
    onRefresh = null,
    onDone = null,
    onDismiss = null,
    returnToDesktop = false,
    bridge = extensionSetupBridge(),
    storage = null,
  } = {},
) {
  if (!storage) {
    try {
      storage = globalThis.localStorage;
    } catch {
      /* An in-page guide still works. */
    }
  }
  let step = 0;
  try {
    step = Math.max(0, Math.min(2, Number(storage?.getItem(STEP_KEY)) || 0));
  } catch {
    /* Optional convenience state. */
  }
  let view = null,
    extension = null,
    folder = null,
    state = null,
    destroyed = false,
    busy = false,
    lastKey = '',
    controller = null,
    loading = null;
  const root = make('section', 'chrome-setup source-setup');
  root.setAttribute('aria-label', 'Connect Chrome');
  const progress = make('p', 'chrome-setup__progress');
  const visual = setupVisual('browser');
  const content = make('div', 'chrome-setup__content');
  const heading = make('h2');
  const copy = make('p', 'chrome-setup__copy');
  copy.setAttribute('role', 'status');
  const receipt = make('p', 'chrome-setup__receipt');
  receipt.setAttribute('role', 'status');
  const feedback = make('p', 'chrome-setup__feedback');
  feedback.setAttribute('role', 'status');
  const primary = button('', () => void act(), true);
  primary.dataset.focus = 'chrome-setup-primary';
  const actions = make('div', 'chrome-setup__actions');
  actions.append(primary);
  const installed = button('Already installed', () => changeStep(2));
  const added = button('I added the extension', () => {
    changeStep(2);
    monitor.start({ restart: true });
  });
  const back = button('Back', () => changeStep(Math.max(0, step - 1)));
  const pause = button('Pause Chrome', () => void control('pause'));
  const later = button('Not now', () =>
    onDismiss ? onDismiss() : globalThis.location?.assign('/home/'),
  );
  const navigation = make('div', 'chrome-setup__navigation');
  navigation.append(back, installed, added, later);
  for (const [index, control] of [back, installed, added, pause, later].entries())
    control.dataset.focus = `chrome-setup-navigation-${index}`;
  const folderValue = make('code', 'chrome-setup__folder');
  const hint = make('p', 'chrome-setup__hint', 'In the folder picker: ⌘⇧G, paste, then Select.');
  const details = make('details', 'chrome-setup__details');
  details.append(make('summary', '', 'Privacy & help'));
  details.append(
    make(
      'p',
      '',
      'Website names, page titles and links stay on this Mac unless you enable AI context. Page text is a separate choice. Private windows are excluded.',
    ),
  );
  const help = make(
    'p',
    '',
    'Can’t open setup? In Chrome’s extensions, choose eïlo → Details → Extension options.',
  );
  const address = make('code', 'chrome-setup__folder', EXTENSIONS_ADDRESS);
  const repair = button(
    typeof openExtensions === 'function' ? 'Open Chrome extensions' : 'Copy extensions address',
    async () => {
      if (openExtensions && (await openExtensions())) return;
      await copyValue(EXTENSIONS_ADDRESS, 'Paste this address into Chrome.');
    },
  );
  const reveal = button('Show extension folder', async () => {
    if (revealFolder && (await revealFolder())) return;
    await loadFolder();
    await copyValue(folder, 'Extension folder copied.');
  });
  const recheck = button('Check connection', () => monitor.start({ restart: true }));
  details.append(help, address, repair, reveal, recheck, pause);
  content.append(heading, copy, folderValue, hint, actions, receipt, feedback, navigation, details);
  root.append(progress, visual, content);
  container.replaceChildren(root);
  const visible = () => root.isConnected !== false && (root.getClientRects?.().length ?? 1) > 0;
  const monitor = createSetupMonitor({
    visible,
    refresh: async () => {
      extension = await bridge.probe();
      if (destroyed) return;
      await onRefresh?.();
      if (!destroyed) render();
    },
  });
  function changeStep(value) {
    step = value;
    try {
      storage?.setItem(STEP_KEY, String(step));
    } catch {
      /* No personal state is required. */
    }
    feedback.textContent = '';
    render();
    heading.tabIndex = -1;
    heading.focus?.({ preventScroll: true });
  }
  async function copyValue(value, message) {
    if (!value) {
      feedback.textContent = 'The extension folder is unavailable. Reopen eïlo and try again.';
      return false;
    }
    try {
      await clipboard.writeText(value);
      if (!destroyed) feedback.textContent = message;
      return true;
    } catch {
      if (!destroyed) {
        folderValue.textContent = value;
        folderValue.hidden = false;
        feedback.textContent = 'Select the address above and copy it.';
      }
      return false;
    }
  }
  function loadFolder() {
    if (folder || destroyed) return Promise.resolve(folder);
    if (loading) return loading;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    loading = (async () => {
      try {
        const response = await fetcher('/api/desktop', {
          headers: { 'X-Eilo-Client': 'local-chat' },
          signal: controller.signal,
        });
        const value = response.ok ? extensionFolder(await response.json()) : null;
        if (!value) throw new Error('unavailable');
        if (!destroyed) folder = value;
        return value;
      } catch {
        if (!destroyed)
          feedback.textContent = 'The extension folder is unavailable. Reopen eïlo and try again.';
        return null;
      } finally {
        clearTimeout(timeout);
        loading = null;
      }
    })();
    return loading;
  }
  async function control(action) {
    if (busy || !onNativeControl || view?.connection !== 'connected') return false;
    const restore = document.activeElement === primary || document.activeElement === pause;
    busy = true;
    feedback.textContent = '';
    render();
    try {
      await onNativeControl(action);
      return true;
    } catch (error) {
      if (!destroyed)
        feedback.textContent = error?.message || 'The connection could not be changed.';
      return false;
    } finally {
      busy = false;
      if (!destroyed) {
        render();
        if (restore && document.activeElement === document.body)
          primary.focus({ preventScroll: true });
      }
    }
  }
  async function handoff() {
    if (bridge.available && (await bridge.open())) return true;
    if (typeof openChrome === 'function' && (await openChrome())) return true;
    if (!bridge.available)
      return copyValue(CONNECTION_ADDRESS, 'Paste this connection address into Chrome.');
    if (bridge.setupURL) return copyValue(bridge.setupURL, 'Paste the setup address into Chrome.');
    feedback.textContent = 'In Chrome’s extensions, choose eïlo → Details → Extension options.';
    details.open = true;
    return false;
  }
  async function act() {
    if (busy || destroyed || !state) return;
    const action = state.action;
    feedback.textContent = '';
    if (action === 'done') {
      if (onDone) onDone();
      else globalThis.location?.assign('/home/#activity');
      return;
    }
    if (action === 'retry') {
      monitor.start({ restart: true });
      return;
    }
    if (['connect', 'resume'].includes(action)) {
      await control(action);
      monitor.start({ restart: true });
      return;
    }
    const restore = document.activeElement === primary;
    busy = true;
    render();
    try {
      if (action === 'extensions' || action === 'reload') {
        const opened = typeof openExtensions === 'function' && (await openExtensions());
        if (opened || (await copyValue(EXTENSIONS_ADDRESS, 'Paste this address into Chrome.'))) {
          if (action === 'extensions') changeStep(1);
          else monitor.start({ restart: true });
        }
      } else if (action === 'folder') {
        await loadFolder();
        await copyValue(folder, 'Folder copied. Paste it into Chrome’s folder picker.');
      } else {
        // This click consents only to browser metadata. Text, AI and other sources keep their choices.
        if (onNativeControl && !view?.snapshot?.adaptive?.policy?.browser_enabled)
          await onNativeControl('connect');
        changeStep(2);
        await handoff();
        monitor.start({ restart: true });
      }
    } catch (error) {
      if (!destroyed) feedback.textContent = error?.message || 'Chrome could not open. Try again.';
    } finally {
      busy = false;
      if (!destroyed) {
        render();
        if (restore && document.activeElement === document.body)
          primary.focus({ preventScroll: true });
      }
    }
  }
  function render() {
    if (destroyed) return;
    state = browserSetupState({
      online: view?.connection === 'connected',
      current: view?.snapshot?.adaptive,
      extension,
      step,
      inChrome: bridge.available,
    });
    const key = JSON.stringify(state);
    if (key !== lastKey) {
      lastKey = key;
      root.dataset.state = state.id;
      visual.dataset.stage = String(state.stage);
      progress.textContent =
        state.id === 'update'
          ? 'Update connection'
          : state.stage === 3
            ? 'Ready to go'
            : ['Chrome → eïlo', 'Install once', 'Connect once'][Math.min(state.stage, 2)];
      heading.textContent = state.title;
      copy.textContent =
        returnToDesktop && state.id === 'connected'
          ? 'Chrome is connected. Return to the eïlo desktop app; you can close this tab.'
          : state.copy;
      primary.textContent =
        ['reload', 'extensions'].includes(state.action) && typeof openExtensions !== 'function'
          ? 'Copy extensions address'
          : state.label;
      receipt.textContent =
        state.id === 'connected' && state.received ? 'Website activity received' : '';
      receipt.hidden = !receipt.textContent;
      animateSetup(content);
    }
    primary.disabled = busy || (['connect', 'resume'].includes(state.action) && !onNativeControl);
    primary.hidden = returnToDesktop && state.id === 'connected';
    primary.setAttribute('aria-busy', String(busy));
    folderValue.textContent = folder || EXTENSIONS_ADDRESS;
    folderValue.hidden = state.id !== 'install';
    hint.hidden = state.id !== 'install';
    back.hidden = step === 0 || !['install', 'finish'].includes(state.id);
    installed.hidden = state.id !== 'extensions';
    added.hidden = state.id !== 'install';
    pause.hidden =
      view?.snapshot?.adaptive?.policy?.browser_enabled !== true ||
      !onNativeControl ||
      view?.connection !== 'connected';
    pause.disabled = busy;
    later.hidden = returnToDesktop || state.id === 'connected';
    if (['connected', 'ready', 'paused'].includes(state.id)) monitor.stop();
  }
  render();
  monitor.start();
  return {
    ready: Promise.resolve(),
    update(next) {
      view = next;
      render();
      if (!['connected', 'ready', 'paused'].includes(state?.id)) monitor.start();
    },
    refresh() {
      monitor.start({ restart: true });
    },
    destroy() {
      destroyed = true;
      controller?.abort();
      monitor.destroy();
      globalThis.gsap?.killTweensOf(content);
    },
  };
}
