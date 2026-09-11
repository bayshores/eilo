const CONNECTION_PATH = '/activity-connect';
const EXTENSIONS_ADDRESS = 'chrome://extensions';

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
const button = (text, handler, className = 'chrome-setup__button') => {
  const element = make('button', className, text);
  element.type = 'button';
  element.addEventListener('click', handler);
  return element;
};

/** Installation guidance only. Opening it never connects, grants, or samples activity. */
export function mountChromeSetup(
  container,
  {
    fetcher = fetch,
    clipboard = globalThis.navigator?.clipboard,
    openChrome = globalThis.eiloDesktop?.openActivityConnection,
    onControl = null,
    onNativeControl = null,
  } = {},
) {
  const root = make('section', 'chrome-setup');
  root.setAttribute('aria-label', 'Chrome extension installation guide');
  const intro = make('header', 'chrome-setup__intro');
  const progress = make('p', 'chrome-setup__progress');
  progress.setAttribute('aria-live', 'polite');
  intro.append(progress);
  root.append(intro);
  const steps = make('ol', 'chrome-setup__steps');
  root.append(steps);
  const native = make('section', 'chrome-setup__native');
  native.hidden = true;
  const nativeTitle = make('h2');
  const nativeCopy = make('p');
  let nativeActive = false;
  const nativeAction = button(
    'Connect Chrome',
    () => control(nativeActive ? 'pause' : 'connect', true),
    'chrome-setup__button chrome-setup__button--primary',
  );
  const nativePrivacy = make('details', 'chrome-setup__details');
  nativePrivacy.append(
    make('summary', '', 'Privacy'),
    make(
      'p',
      '',
      'Chrome connection is separate from visible text and adaptive help. Those stay off until you choose them in eïlo.',
    ),
  );
  native.append(nativeTitle, nativeCopy, nativeAction, nativePrivacy);
  root.append(native);
  let destroyed = false,
    loading = false;
  let controller = null;
  const feedback = make('p', 'chrome-setup__feedback');
  feedback.setAttribute('role', 'status');
  const step = (title, text) => {
    const item = make('li');
    item.append(make('h3', '', title), make('p', '', text));
    steps.append(item);
    return item;
  };
  async function copy(value, success) {
    try {
      if (!value || !clipboard?.writeText) throw new Error('unavailable');
      await clipboard.writeText(value);
      if (!destroyed) feedback.textContent = success;
      return true;
    } catch {
      if (!destroyed) feedback.textContent = 'Select and copy the text manually.';
      return false;
    }
  }
  const copyButton = (label, value, success, className) => {
    const item = button(
      label,
      async () => {
        if (await copy(value(), success)) item.textContent = 'Copied';
      },
      className,
    );
    item.addEventListener('blur', () => {
      item.textContent = label;
    });
    return item;
  };
  const settingsStep = step(
    'Open Chrome’s extensions',
    'Copy this address into Chrome’s address bar.',
  );
  const settingsRow = make('div', 'chrome-setup__copy-row');
  settingsRow.append(
    make('code', 'chrome-setup__value', EXTENSIONS_ADDRESS),
    copyButton(
      'Copy address',
      () => EXTENSIONS_ADDRESS,
      'Copied.',
      'chrome-setup__copy chrome-setup__button--primary',
    ),
  );
  settingsStep.append(settingsRow);
  const folderStep = step('Load eïlo', 'Turn on Developer mode, then click Load unpacked.');
  const folderRow = make('div', 'chrome-setup__copy-row');
  const folderValue = make('code', 'chrome-setup__value', 'Finding your extension folder…');
  folderValue.setAttribute('aria-label', 'Extension folder');
  const folderCopy = copyButton(
    'Copy folder path',
    () => folder,
    'Folder copied.',
    'chrome-setup__copy chrome-setup__button--primary',
  );
  folderCopy.disabled = true;
  const retry = button('Retry folder lookup', () => loadFolder());
  retry.hidden = true;
  folderRow.append(folderValue, folderCopy);
  folderStep.append(
    folderRow,
    make('p', 'chrome-setup__hint', 'In the folder picker: ⌘⇧G, paste, then Select.'),
    retry,
  );
  let folder = null;
  const connectStep = step(
    'Connect your browser',
    'Open eïlo from Chrome’s extensions menu and choose Allow Chrome.',
  );
  const connectionActions = make('div', 'chrome-setup__actions');
  const connectionURL = new URL(
    CONNECTION_PATH,
    globalThis.location?.origin || 'http://127.0.0.1:8765',
  ).href;
  const connectionHelp = make('details', 'chrome-setup__details');
  connectionHelp.append(
    make('summary', '', 'Having trouble?'),
    make(
      'p',
      '',
      'Reload the connection page after installing. If it still cannot open, copy the link into Chrome.',
    ),
  );
  if (typeof openChrome === 'function') {
    const open = button(
      'Open in Chrome',
      async () => {
        open.disabled = true;
        try {
          const opened = await openChrome();
          if (!destroyed)
            feedback.textContent = opened
              ? 'Opened in Chrome.'
              : 'Chrome could not open. Use the link under Having trouble?';
          if (!opened) connectionHelp.open = true;
        } catch {
          if (!destroyed)
            feedback.textContent = 'Chrome could not open. Use the link under Having trouble?';
          connectionHelp.open = true;
        } finally {
          if (!destroyed) open.disabled = false;
        }
      },
      'chrome-setup__button chrome-setup__button--primary',
    );
    connectionActions.append(open);
  } else {
    const open = make(
      'a',
      'chrome-setup__button chrome-setup__button--primary',
      'Open connection page',
    );
    open.href = CONNECTION_PATH;
    open.target = '_blank';
    open.rel = 'noopener';
    connectionActions.append(open);
  }
  connectionHelp.append(
    copyButton('Copy connection link', () => connectionURL, 'Copied.', 'chrome-setup__button'),
  );
  connectStep.append(connectionActions, connectionHelp);

  const scope = make('details', 'chrome-setup__details');
  scope.append(
    make('summary', '', 'What you’re sharing'),
    make(
      'p',
      '',
      'Active-site names and sanitized page titles, across the web. Selected observations can reach eïlo’s AI and stay in its local conversation. A page visit does not establish attention or task completion.',
    ),
    make(
      'p',
      '',
      'No page bodies, screenshots, browsing history, private windows, microphone audio, or keystrokes. Pause in eïlo or close its connected Chrome tab to stop. Optional site exclusions are in the extension.',
    ),
  );
  connectStep.append(scope);
  const status = make('p', 'chrome-setup__status');
  status.setAttribute('role', 'status');
  const controls = make('div', 'chrome-setup__actions');
  async function control(action, useNative = false) {
    const targets = useNative ? [nativeAction] : controls.querySelectorAll('button');
    targets.forEach((item) => {
      item.disabled = true;
    });
    try {
      await (useNative ? onNativeControl : onControl)?.(action);
    } catch (error) {
      if (!destroyed) feedback.textContent = error.message || 'Sharing could not be changed.';
    } finally {
      if (!destroyed)
        targets.forEach((item) => {
          item.disabled = false;
        });
    }
  }
  const pause = button('Pause sharing', () => control('pause'));
  const off = button('Turn off sharing', () => control('off'));
  pause.hidden = true;
  off.hidden = true;
  if (onControl) controls.append(pause, off);
  controls.hidden = true;
  connectStep.append(status, controls);
  const navigation = make('div', 'chrome-setup__navigation');
  const stepItems = [settingsStep, folderStep, connectStep];
  let currentStep = 0;
  const back = button('Back', () => changeStep(currentStep - 1));
  const next = button('Next', () => changeStep(currentStep + 1));
  navigation.append(back, next);
  root.append(feedback, navigation);
  settingsStep.append(
    button('Extension already installed', () => changeStep(stepItems.length - 1)),
  );
  function changeStep(index, focus = true) {
    currentStep = Math.max(0, Math.min(stepItems.length - 1, index));
    stepItems.forEach((item, i) => {
      item.hidden = i !== currentStep;
    });
    progress.textContent = `Step ${currentStep + 1} of ${stepItems.length}`;
    back.hidden = currentStep === 0;
    next.hidden = currentStep === stepItems.length - 1;
    feedback.textContent = '';
    if (focus) {
      const heading = stepItems[currentStep].querySelector('h3');
      heading.tabIndex = -1;
      heading.focus();
    }
  }
  changeStep(0, false);
  container.replaceChildren(root);

  async function loadFolder() {
    if (destroyed || loading) return;
    loading = true;
    retry.disabled = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetcher('/api/desktop', {
        headers: { 'X-Eilo-Client': 'local-chat' },
        signal: controller.signal,
      });
      const path = response.ok ? extensionFolder(await response.json()) : null;
      if (!path) throw new Error('unavailable');
      if (!destroyed) {
        folder = path;
        folderValue.textContent = path;
        folderCopy.disabled = false;
        retry.hidden = true;
      }
    } catch {
      if (!destroyed) {
        folderValue.textContent = 'Your extension folder could not be loaded.';
        retry.hidden = false;
      }
    } finally {
      clearTimeout(timeout);
      loading = false;
      if (!destroyed) retry.disabled = false;
    }
  }
  const ready = loadFolder();
  return {
    ready,
    update(view) {
      if (destroyed) return;
      const online = view?.connection === 'connected';
      const adaptive = view?.snapshot?.adaptive;
      const nativeConnected = adaptive?.capture_status?.browser?.connected === true;
      if (nativeConnected) {
        const policy = adaptive.policy || {};
        const active = policy.enabled === true && policy.browser_enabled === true;
        nativeActive = active;
        const health = adaptive.capture_status.browser.status;
        intro.hidden = true;
        steps.hidden = true;
        feedback.hidden = true;
        navigation.hidden = true;
        native.hidden = false;
        nativeTitle.textContent = active
          ? health === 'paused'
            ? 'Chrome is paused'
            : 'Chrome connected'
          : 'Chrome is ready';
        nativeCopy.textContent = active
          ? 'Browser context is configured on this device.'
          : 'Connect Chrome when you want browser context available.';
        nativeAction.textContent = active ? 'Pause' : 'Connect Chrome';
        nativeAction.disabled = !online || !onNativeControl;
        return;
      }
      intro.hidden = false;
      steps.hidden = false;
      feedback.hidden = false;
      navigation.hidden = false;
      native.hidden = true;
      const sharing = view?.snapshot?.accountability?.activity?.state;
      status.textContent = !online
        ? 'Waiting for your workspace’s current sharing status.'
        : sharing === 'active'
          ? 'Activity sharing is on in the connected Chrome page.'
          : sharing === 'paused'
            ? 'Activity sharing is paused.'
            : 'Waiting for connection.';
      pause.hidden = !online || sharing !== 'active';
      off.hidden = !online || !['active', 'paused'].includes(sharing);
      controls.hidden = !onControl || (pause.hidden && off.hidden);
    },
    destroy() {
      destroyed = true;
      controller?.abort();
    },
  };
}
