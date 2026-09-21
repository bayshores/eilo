'use strict';
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  Notification,
  ipcMain,
  dialog,
  systemPreferences,
  shell,
  screen,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createBackendSupervisor } = require('./backend-supervisor.cjs');
const { createNotificationPolicy } = require('./notifications.cjs');
const { registerNativeContext } = require('./native-context-registration.cjs');
const {
  ORIGIN,
  localURL,
  homeURL,
  audioRequest,
  checkInTarget,
  googleAuthorizationURL,
  briefingAuthorizationURL,
  briefingSourceURL,
} = require('./security.cjs');

const CHECK_IN_OVERLAY_DURATION_MS = 45_000;

function runDesktop() {
  app.setName('felis');
  process.umask(0o077);
  let root,
    supervisor,
    standalone = false;
  try {
    if (app.isPackaged) {
      standalone = fs.existsSync(path.join(process.resourcesPath, 'eilo-bundle.json'));
      if (standalone) {
        const manifest = JSON.parse(
          fs.readFileSync(path.join(process.resourcesPath, 'eilo-bundle.json'), 'utf8'),
        );
        if (manifest.workspace !== 'workspace' || manifest.runtime !== 'runtime')
          throw new Error('Invalid private bundle');
        root = path.join(process.resourcesPath, 'workspace');
      } else {
        root = JSON.parse(
          fs.readFileSync(path.join(process.resourcesPath, 'checkout.json'), 'utf8'),
        ).workspace;
      }
    } else root = path.resolve(__dirname, '../..');
    supervisor = createBackendSupervisor({
      rootPath: root,
      shutdownTimeoutMs: 20_000,
      onState: onBackendState,
      canonicalRoot: standalone ? root : undefined,
      extraEnvironment: standalone
        ? {
            EILO_DATA_HOME: path.join(app.getPath('appData'), 'eilo'),
            EILO_CACHE_HOME: path.join(app.getPath('cache'), 'eilo'),
            EILO_RUNTIME_HOME: path.join(process.resourcesPath, 'runtime'),
          }
        : {},
    });
    supervisor.validateCheckout();
  } catch {
    void app.whenReady().then(() => {
      dialog.showErrorBox(
        'felis could not open its workspace',
        'This development build needs its original felis checkout and local runtime. Rebuild it from the project if the checkout has moved. Your saved conversation is kept.',
      );
      app.exit(1);
    });
    return;
  }
  const stateRoot = standalone
    ? path.join(app.getPath('appData'), 'eilo', 'desktop')
    : path.join(root, '.state', 'desktop');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  app.setPath('userData', path.join(stateRoot, 'profile'));
  app.setPath('sessionData', path.join(stateRoot, 'profile'));
  const preferencesPath = path.join(stateRoot, 'notifications.json');
  const overlayPreferencesPath = path.join(stateRoot, 'check-in-overlay.json');
  const statusPath = path.join(stateRoot, 'status.json');
  let window = null,
    overlay = null,
    tray = null,
    policy = null,
    overlayPolicy = null,
    quitting = false,
    stopped = false;
  let startup = null,
    pendingTarget = null,
    overlayPayload = null,
    overlayTimer = null,
    overlayReady = false,
    overlayActionTarget = null,
    homeReady = false,
    timer = null,
    pollBusy = false;
  let notificationError = '',
    serviceError = '';
  let shutdownStage = 'running';
  let googleReturnTimer = null;
  let textPermissionRequesting = false;
  const activeNotifications = new Set();

  function notificationStatus() {
    return {
      enabled: !!policy?.status().enabled,
      supported: Notification.isSupported(),
      error: !!notificationError,
    };
  }

  function writePrivate(file, value) {
    const temporary = file + '.new';
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, file);
  }

  function recordStatus() {
    if (!policy) return;
    try {
      writePrivate(statusPath, {
        version: app.getVersion(),
        pid: process.pid,
        phase: supervisor.status().phase,
        ownsBackend: supervisor.status().ownsChild,
        windowVisible: !!window?.isVisible(),
        notificationsEnabled: policy.status().enabled,
        notificationError,
        serviceError,
        quitting,
        shutdownStage,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* The workspace remains usable if a diagnostic cannot be saved. */
    }
  }

  function onBackendState(state) {
    serviceError = state.phase === 'failed' ? 'The local service needs attention.' : '';
    if (tray) updateMenus();
    recordStatus();
  }

  function trustedSender(event) {
    return (
      window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      homeURL(event.senderFrame.url)
    );
  }

  function localServiceHeaders() {
    return { 'X-Eilo-Client': 'local-chat' };
  }

  function trustedFocusedHome(event) {
    return trustedSender(event) && !!window?.isVisible() && !!window?.isFocused();
  }

  function contextCollectorPath() {
    return standalone
      ? path.join(
          process.resourcesPath,
          'runtime',
          'eilo-context-collector',
          'EiloContextCollector',
        )
      : path.join(root, '.runtime', 'eilo-context-collector', 'EiloContextCollector');
  }

  function runFixedOpen(args) {
    return new Promise((resolve) => {
      execFile('/usr/bin/open', args, { timeout: 10_000 }, (error) => resolve(!error));
    });
  }

  function requestTextPermission() {
    if (textPermissionRequesting) return Promise.resolve(false);
    const collector = contextCollectorPath();
    if (!fs.existsSync(collector)) return Promise.resolve(false);
    textPermissionRequesting = true;
    return new Promise((resolve) => {
      // The collector owns the Accessibility prompt. This dedicated command
      // exits before building a Collector or reading the desktop.
      execFile(collector, ['--request-text-permission'], { timeout: 10_000 }, (error) => {
        textPermissionRequesting = false;
        resolve(!error);
      });
    });
  }

  function extensionDirectory() {
    const directory = path.join(root, 'activity', 'extension');
    try {
      return fs.statSync(directory).isDirectory() ? directory : null;
    } catch {
      return null;
    }
  }

  function flushTarget() {
    if (!homeReady || !pendingTarget || !window || !homeURL(window.webContents.getURL())) return;
    window.webContents.send('eilo:open-check-in', pendingTarget);
    pendingTarget = null;
  }

  function showWindow(target = null) {
    if (quitting) return;
    if (target) pendingTarget = checkInTarget(target);
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      if (target && !homeURL(window.webContents.getURL())) void window.loadURL(ORIGIN + '/home/');
      window.show();
      window.focus();
      window.webContents.send('eilo:window-shown');
      flushTarget();
      recordStatus();
    } else if (!quitting) {
      void openWorkspace();
    }
  }

  function overlayText(value) {
    if (typeof value !== 'string') return null;
    const compact = [...value]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600);
    return compact || null;
  }

  function closeOverlay() {
    clearTimeout(overlayTimer);
    overlayTimer = null;
    overlayPayload = null;
    overlayReady = false;
    overlayActionTarget = null;
    const current = overlay;
    overlay = null;
    if (current && !current.isDestroyed()) current.close();
  }

  function overlayBounds() {
    try {
      // Pointer location is not a useful display choice when the check-in is
      // triggered by keyboard or an automation. Keep the surface on the
      // workspace display and use pointer position only as a legacy fallback.
      const homeBounds =
        window && !window.isDestroyed() && typeof window.getBounds === 'function'
          ? window.getBounds()
          : null;
      const display =
        (homeBounds && typeof screen.getDisplayMatching === 'function'
          ? screen.getDisplayMatching(homeBounds)
          : null) ||
        (typeof screen.getPrimaryDisplay === 'function' ? screen.getPrimaryDisplay() : null) ||
        screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const area = display?.workArea;
      if (
        !area ||
        ![area.x, area.y, area.width, area.height].every((value) => Number.isFinite(value))
      )
        return {};
      return {
        x: Math.max(area.x, area.x + area.width - 424),
        y: Math.max(area.y, area.y + 34),
      };
    } catch {
      return {};
    }
  }

  function presentCheckInOverlay() {
    if (!overlay || overlay.isDestroyed() || !overlayPayload || !overlayReady) return;
    overlay.webContents.send('eilo:overlay-check-in', overlayPayload);
    overlay.showInactive();
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(closeOverlay, CHECK_IN_OVERLAY_DURATION_MS);
    overlayTimer.unref?.();
  }

  function showCheckInOverlay(record, { preview = false } = {}) {
    const target = checkInTarget(record);
    const text = overlayText(record?.text);
    // This visual surface is for an already delivered check-in. It is local,
    // non-activating, and never renders raw source context or a renderer-supplied URL.
    if (!target || !text || quitting || (!preview && window?.isFocused())) return;
    overlayPayload = { ...target, text };
    overlayActionTarget = preview ? null : target;
    if (overlay && !overlay.isDestroyed()) {
      presentCheckInOverlay();
      return;
    }
    try {
      const currentOverlay = new BrowserWindow({
        width: 396,
        height: 188,
        minWidth: 396,
        maxWidth: 396,
        minHeight: 188,
        maxHeight: 188,
        show: false,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        focusable: true,
        hasShadow: true,
        backgroundColor: '#00000000',
        ...overlayBounds(),
        webPreferences: {
          preload: path.join(__dirname, 'overlay-preload.cjs'),
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
          webSecurity: true,
          webviewTag: false,
          spellcheck: false,
          partition: 'persist:eilo-overlay',
          navigateOnDragDrop: false,
        },
      });
      overlay = currentOverlay;
      overlayReady = false;
      currentOverlay.setAlwaysOnTop(true, 'pop-up-menu');
      currentOverlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      const session = currentOverlay.webContents.session;
      session.setPermissionCheckHandler(() => false);
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setDevicePermissionHandler(() => false);
      session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
      session.on('will-download', (event) => event.preventDefault());
      currentOverlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      currentOverlay.webContents.on('will-navigate', (event) => event.preventDefault());
      currentOverlay.webContents.on('will-redirect', (event) => event.preventDefault());
      currentOverlay.on('closed', () => {
        if (overlay === currentOverlay) {
          overlay = null;
          overlayPayload = null;
          overlayReady = false;
          overlayActionTarget = null;
          clearTimeout(overlayTimer);
          overlayTimer = null;
        }
      });
      void currentOverlay.loadFile(path.join(__dirname, 'overlay.html')).catch(closeOverlay);
    } catch {
      closeOverlay();
    }
  }

  function configureSession(ses) {
    // The renderer is a client of one fixed local origin, never a web browser.
    ses.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !localURL(details.url) }),
    );
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
      if (permission === 'clipboard-sanitized-write') {
        callback(
          contents === window?.webContents &&
            details.isMainFrame === true &&
            homeURL(details.requestingUrl) &&
            !!window?.isVisible() &&
            !!window?.isFocused(),
        );
        return;
      }
      const eligible =
        contents === window?.webContents &&
        audioRequest({
          permission,
          url: details.requestingUrl,
          mainFrame: details.isMainFrame,
          focused: !!window?.isVisible() && !!window?.isFocused(),
          mediaTypes: details.mediaTypes,
        });
      if (!eligible) {
        callback(false);
        return;
      }
      try {
        const allowed =
          process.platform !== 'darwin' ||
          (await systemPreferences.askForMediaAccess('microphone'));
        callback(allowed && contents === window?.webContents && !!window?.isFocused());
      } catch {
        callback(false);
      }
    });
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback({}));
    ses.on('will-download', (event) => event.preventDefault());
  }

  async function openWorkspace() {
    if (startup) return startup;
    let retryRequested = false;
    startup = (async () => {
      try {
        await supervisor.start();
        if (quitting) return;
        if (window && !window.isDestroyed()) {
          await window.loadURL(ORIGIN + '/home/');
          window.show();
          window.focus();
          window.webContents.send('eilo:window-shown');
          return;
        }
        window = new BrowserWindow({
          width: 1280,
          height: 840,
          minWidth: 860,
          minHeight: 600,
          title: 'felis',
          show: false,
          backgroundColor: '#191a1d',
          autoHideMenuBar: true,
          // Home fills this space; macOS keeps its native traffic lights and drag behavior.
          ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' } : {}),
          icon: path.join(__dirname, 'assets', 'icon.png'),
          webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            webviewTag: false,
            spellcheck: false,
            partition: 'persist:eilo-desktop',
            navigateOnDragDrop: false,
          },
        });
        const currentWindow = window;
        configureSession(window.webContents.session);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', (event, url) => {
          if (!localURL(url)) event.preventDefault();
        });
        window.webContents.on('will-redirect', (event, url) => {
          if (!localURL(url)) event.preventDefault();
        });
        window.webContents.on('will-attach-webview', (event) => event.preventDefault());
        window.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
          if (isMainFrame && !inPlace) homeReady = false;
        });
        window.on('close', (event) => {
          if (!quitting) {
            event.preventDefault();
            window.hide();
            recordStatus();
          }
        });
        window.on('closed', () => {
          if (window === currentWindow) window = null;
          homeReady = false;
          recordStatus();
        });
        window.on('focus', closeOverlay);
        for (const event of ['show', 'hide', 'focus', 'blur']) window.on(event, recordStatus);
        await window.loadURL(ORIGIN + '/home/');
        window.show();
        window.focus();
        window.webContents.send('eilo:window-shown');
        flushTarget();
        updateMenus();
        recordStatus();
      } catch {
        serviceError = 'felis could not connect to its local workspace.';
        updateMenus();
        recordStatus();
        if (!quitting) {
          const result = await dialog.showMessageBox({
            type: 'error',
            title: 'Open felis',
            message: 'The local workspace could not start.',
            detail:
              'Your saved conversation is kept. Check that the felis checkout and its Python runtime are available, and that the local port belongs to felis.',
            buttons: ['Quit', 'Retry'],
            defaultId: 1,
            cancelId: 0,
          });
          if (result.response === 1) retryRequested = true;
          else app.quit();
        }
      } finally {
        startup = null;
        updateMenus();
        if (retryRequested && !quitting) queueMicrotask(() => void openWorkspace());
      }
    })();
    return startup;
  }

  function nativeNotification(target, { test = false } = {}) {
    if (!policy.status().enabled || !Notification.isSupported())
      throw new Error('Notifications are unavailable.');
    const notification = new Notification({
      title: 'felis',
      body: test
        ? 'Desktop notifications are ready. Open felis to continue.'
        : 'A new check-in is ready. Open felis to read it.',
      silent: true,
    });
    activeNotifications.add(notification);
    notification.on('click', () => {
      showWindow(target);
      activeNotifications.delete(notification);
    });
    notification.on('close', () => activeNotifications.delete(notification));
    notification.on('failed', () => {
      activeNotifications.delete(notification);
      notificationError = 'macOS could not deliver a notification.';
      updateMenus();
      recordStatus();
    });
    notification.show();
  }

  async function toggleNotifications(item) {
    const enabled = item?.checked === true;
    if (!policy || enabled === policy.status().enabled) return notificationStatus();
    if (enabled) {
      const response = await dialog.showMessageBox({
        type: 'question',
        title: 'felis notifications',
        message: 'Show new check-ins when felis is out of view?',
        detail:
          'Notifications use a private preview. Clicking one returns to that check-in. You can turn them off here at any time.',
        buttons: ['Enable notifications', 'Not now'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response.response !== 0) {
        updateMenus();
        return notificationStatus();
      }
    }
    notificationError = '';
    policy.setEnabled(enabled);
    if (!policy.status().enabled) {
      for (const note of activeNotifications) note.close();
      activeNotifications.clear();
    }
    updateMenus();
    recordStatus();
    void pollCheckIns();
    return notificationStatus();
  }

  function updateMenus() {
    if (!policy) return;
    const backend = supervisor.status();
    const connectionLabel = serviceError
      ? 'Workspace unavailable'
      : backend.ownsChild
        ? 'Local service · managed by felis'
        : backend.phase === 'attached'
          ? 'Local service · already running'
          : 'Connecting to workspace…';
    const controls = () => [
      { label: 'Open felis', accelerator: 'CmdOrCtrl+1', click: () => showWindow() },
      { label: connectionLabel, enabled: false },
      {
        label: 'Check-in notifications',
        type: 'checkbox',
        checked: policy.status().enabled,
        click: toggleNotifications,
      },
      {
        label: 'Send test notification',
        enabled: policy.status().enabled,
        click: () => {
          try {
            nativeNotification(null, { test: true });
          } catch {
            notificationError = 'Notifications are unavailable.';
            updateMenus();
            recordStatus();
          }
        },
      },
      ...(!app.isPackaged
        ? [
            {
              label: 'Preview check-in overlay',
              click: () =>
                showCheckInOverlay(
                  {
                    conversationId: 'overlay-preview',
                    messageId: 'overlay-preview',
                    eventId: 'overlay-preview',
                    text: 'This is a local overlay preview. It does not record a check-in.',
                  },
                  { preview: true },
                ),
            },
          ]
        : []),
      ...(notificationError ? [{ label: notificationError, enabled: false }] : []),
      {
        label: 'Reconnect to workspace',
        enabled: !startup,
        click: () => {
          void openWorkspace();
        },
      },
      { type: 'separator' },
      { role: 'quit', label: 'Quit felis' },
    ];
    tray?.setContextMenu(Menu.buildFromTemplate(controls()));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'felis', submenu: [{ role: 'about', label: 'About felis' }, ...controls()] },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
        { role: 'windowMenu' },
      ]),
    );
  }
  async function pollCheckIns() {
    if (pollBusy || quitting || (!policy?.status().enabled && !overlayPolicy?.status().enabled))
      return;
    pollBusy = true;
    try {
      const identity = await fetch(ORIGIN + '/api/desktop', {
        headers: { 'X-Eilo-Client': 'local-chat' },
        signal: AbortSignal.timeout(2000),
      });
      const value = await identity.json();
      if (!identity.ok || value.app !== 'eilo' || value.protocol !== 1 || value.workspace !== root)
        throw new Error('identity');
      const response = await fetch(ORIGIN + '/api/state', {
        headers: { 'X-Eilo-Client': 'local-chat' },
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error('state');
      const snapshot = await response.json();
      if (!quitting) {
        const foreground = !!window?.isVisible() && !!window?.isFocused();
        overlayPolicy?.inspect(snapshot, { foreground });
        if (policy.status().enabled) policy.inspect(snapshot, { foreground });
      }
      serviceError = '';
    } catch {
      serviceError = 'The local service is unavailable.';
    } finally {
      pollBusy = false;
      updateMenus();
      recordStatus();
    }
  }

  async function openAuthorizedProvider(
    event,
    url,
    { endpoint, isAuthorizationURL, isAuthorizationPending },
  ) {
    if (
      !trustedSender(event) ||
      !window?.isVisible() ||
      !window?.isFocused() ||
      !isAuthorizationURL(url)
    )
      return false;

    try {
      // Re-read the integration state before opening a browser. A renderer can
      // request only the exact authorization URL that the local service is
      // currently expecting; it cannot use this IPC as a general URL opener.
      const response = await fetch(`${ORIGIN}${endpoint}`, {
        headers: localServiceHeaders(),
        signal: AbortSignal.timeout(3_000),
      });
      const pending = await response.json();
      if (!response.ok || !isAuthorizationPending(pending, url)) return false;

      await shell.openExternal(url);
      clearTimeout(googleReturnTimer);
      const deadline = Date.now() + 310_000;
      const checkForCompletion = async () => {
        if (quitting || Date.now() > deadline) return;
        try {
          const result = await fetch(`${ORIGIN}${endpoint}`, {
            headers: localServiceHeaders(),
            signal: AbortSignal.timeout(2_500),
          });
          const status = await result.json();
          if (result.ok && !isAuthorizationPending(status, url)) {
            showWindow();
            return;
          }
        } catch {
          // A temporary outage must not restart or widen an authorization flow.
        }
        googleReturnTimer = setTimeout(checkForCompletion, 1_500);
        googleReturnTimer.unref();
      };
      googleReturnTimer = setTimeout(checkForCompletion, 1_500);
      googleReturnTimer.unref();
      return true;
    } catch {
      return false;
    }
  }

  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    app.on('second-instance', () => showWindow());
    app.on('activate', () => showWindow());
    app.on('window-all-closed', () => {});
    app.on('will-quit', () => {
      shutdownStage = 'exited';
      recordStatus();
    });
    app.on('before-quit', (event) => {
      if (stopped) return;
      event.preventDefault();
      if (quitting) return;
      quitting = true;
      shutdownStage = 'stopping';
      clearInterval(timer);
      clearTimeout(googleReturnTimer);
      closeOverlay();
      for (const note of activeNotifications) note.close();
      recordStatus();
      void (async () => {
        try {
          await startup;
          shutdownStage = 'stopping-service';
          recordStatus();
          await supervisor.stop();
        } catch {
          dialog.showErrorBox(
            'felis could not finish stopping',
            'The service started by this desktop app did not exit normally. Your saved conversation is kept.',
          );
        } finally {
          stopped = true;
          shutdownStage = 'service-stopped';
          recordStatus();
          tray?.destroy();
          // Let the cancelled native quit event unwind before asking macOS again.
          setImmediate(() => app.quit());
        }
      })();
    });
    ipcMain.on('eilo:overlay-open', (event) => {
      if (!overlay || event.sender !== overlay.webContents || !overlayPayload) return;
      const target = overlayActionTarget;
      closeOverlay();
      showWindow(target);
    });
    ipcMain.on('eilo:overlay-dismiss', (event) => {
      if (overlay && event.sender === overlay.webContents) closeOverlay();
    });
    ipcMain.handle('eilo:open-activity-connection', async (event) => {
      if (!trustedFocusedHome(event) || process.platform !== 'darwin') return false;
      // A fixed page in a fixed browser; renderer input never becomes a URL,
      // process name, argument, or shell command. Opening it does not enable sharing.
      return runFixedOpen(['-b', 'com.google.Chrome', ORIGIN + '/activity-connect']);
    });
    ipcMain.handle('eilo:open-chrome-setup', async (event) => {
      if (!trustedFocusedHome(event) || process.platform !== 'darwin') return false;
      // Open the connection guide so Chrome can detect the installed extension
      // and its grant. No renderer URL or permission crosses IPC.
      return runFixedOpen(['-b', 'com.google.Chrome', ORIGIN + '/activity-connect?client=desktop']);
    });
    ipcMain.handle('eilo:open-chrome-extensions', async (event) => {
      if (!trustedFocusedHome(event) || process.platform !== 'darwin') return false;
      // This is the sole Chrome settings destination felis can open. The
      // renderer cannot supply a browser, URL, option, or shell command.
      return runFixedOpen(['-b', 'com.google.Chrome', 'chrome://extensions/']);
    });
    ipcMain.handle('eilo:reveal-chrome-extension', async (event) => {
      if (!trustedFocusedHome(event) || process.platform !== 'darwin') return false;
      const directory = extensionDirectory();
      if (!directory) return false;
      // Reveal only the extension bundled with this felis workspace.
      return runFixedOpen(['-R', directory]);
    });
    ipcMain.handle('eilo:google-authorization', (event, url) =>
      openAuthorizedProvider(event, url, {
        endpoint: '/api/integrations/google-calendar',
        isAuthorizationURL: googleAuthorizationURL,
        isAuthorizationPending: (state, expectedURL) =>
          state.state === 'authorizing' && state.authorization_url === expectedURL,
      }),
    );
    ipcMain.handle('eilo:briefing-authorization', (event, url) =>
      openAuthorizedProvider(event, url, {
        endpoint: '/api/integrations/briefing-sources',
        isAuthorizationURL: briefingAuthorizationURL,
        isAuthorizationPending: (state, expectedURL) =>
          state.authorizing === true && state.authorization_url === expectedURL,
      }),
    );
    ipcMain.handle('eilo:briefing-source', async (event, runId, sourceId) => {
      if (
        !trustedSender(event) ||
        !window?.isVisible() ||
        !window?.isFocused() ||
        typeof runId !== 'string' ||
        typeof sourceId !== 'string'
      )
        return false;
      try {
        const response = await fetch(ORIGIN + '/api/state', {
          headers: { 'X-Eilo-Client': 'local-chat' },
          signal: AbortSignal.timeout(3000),
        });
        const state = await response.json(),
          run = state.workflow_run;
        if (!response.ok || run?.id !== runId) return false;
        const source = run.sources?.find((s) => s.id === sourceId);
        if (!source || !briefingSourceURL(source.url)) return false;
        await shell.openExternal(source.url);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('eilo:check-in-notification-status', (event) => {
      if (!trustedSender(event)) return null;
      return notificationStatus();
    });
    ipcMain.handle('eilo:context-permission', async (event, kind) => {
      if (
        !trustedFocusedHome(event) ||
        process.platform !== 'darwin' ||
        !['text', 'visual'].includes(kind)
      )
        return false;
      if (kind === 'text') {
        // Request only Accessibility. Visual capture retains its separate
        // consent and is never prompted as part of text setup.
        if (!(await requestTextPermission())) return false;
      }
      const pane = kind === 'text' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture';
      try {
        await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('eilo:account-authorization', async (event) => {
      if (!trustedSender(event) || !window?.isVisible() || !window?.isFocused()) return false;
      try {
        const response = await fetch(ORIGIN + '/api/state', {
          headers: { 'X-Eilo-Client': 'local-chat' },
          signal: AbortSignal.timeout(3000),
        });
        const { account } = await response.json();
        if (!response.ok || account?.state !== 'awaiting_sign_in') return false;
        await shell.openExternal('https://auth.openai.com/codex/device');
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('eilo:context-source', async (event, contextId, sourceId) => {
      if (!trustedSender(event) || !window?.isVisible() || !window?.isFocused()) return false;
      if (
        ![contextId, sourceId].every(
          (id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(id),
        )
      )
        return false;
      try {
        const response = await fetch(ORIGIN + '/api/state', {
          headers: { 'X-Eilo-Client': 'local-chat' },
          signal: AbortSignal.timeout(3000),
        });
        const state = await response.json();
        const context = state.current_work_context;
        if (!response.ok || context?.id !== contextId) return false;
        const source = context.resources?.find((item) => item.id === sourceId);
        const url = new URL(source?.url);
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.origin !== source.origin
        )
          return false;
        await shell.openExternal(url.href);
        return true;
      } catch {
        return false;
      }
    });
    ipcMain.handle('eilo:set-check-in-notifications', async (event, enabled) => {
      if (!trustedSender(event)) return null;
      if (typeof enabled !== 'boolean') return notificationStatus();
      return toggleNotifications({ checked: enabled });
    });
    ipcMain.on('eilo:home-ready', (event) => {
      if (trustedSender(event)) {
        homeReady = true;
        flushTarget();
      }
    });
    ipcMain.on('eilo:window-show-ready', (event) => {
      if (trustedSender(event) && window.isVisible()) window.webContents.send('eilo:window-shown');
    });
    ipcMain.on('eilo:overlay-ready', (event) => {
      if (!overlay || overlay.isDestroyed() || event.sender !== overlay.webContents) return;
      overlayReady = true;
      presentCheckInOverlay();
    });
    app.whenReady().then(async () => {
      try {
        registerNativeContext(
          standalone
            ? {
                userData: path.join(app.getPath('appData'), 'eilo'),
                resourcesPath: process.resourcesPath,
              }
            : {
                userData: path.join(root, '.state', 'desktop', 'profile'),
                dataHome: path.join(root, '.state'),
                workspacePath: root,
                pythonPath: path.join(root, '.runtime', 'venv', 'bin', 'python'),
              },
        );
      } catch {
        serviceError = 'Browser context host could not be registered.';
      }
      overlayPolicy = createNotificationPolicy({
        defaultEnabled: true,
        includeText: true,
        requireEligibility: true,
        load: () => {
          try {
            return JSON.parse(fs.readFileSync(overlayPreferencesPath, 'utf8'));
          } catch {
            return null;
          }
        },
        save: (value) => writePrivate(overlayPreferencesPath, value),
        show: showCheckInOverlay,
      });
      policy = createNotificationPolicy({
        load: () => {
          try {
            return JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
          } catch {
            return null;
          }
        },
        save: (value) => writePrivate(preferencesPath, value),
        show: (record) => nativeNotification(checkInTarget(record)),
        onError: () => {
          notificationError = 'A desktop notification could not be prepared.';
          recordStatus();
        },
      });
      const trayIcon = nativeImage.createFromPath(
        path.join(__dirname, 'assets', 'trayTemplate.png'),
      );
      trayIcon.setTemplateImage(true);
      tray = new Tray(trayIcon);
      tray.setToolTip('felis');
      tray.on('double-click', () => showWindow());
      updateMenus();
      recordStatus();
      await openWorkspace();
      if (!quitting) {
        await pollCheckIns();
        timer = setInterval(() => void pollCheckIns(), 4000);
        timer.unref();
      }
    });
  }
}
runDesktop();
