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
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createBackendSupervisor } = require('./backend-supervisor.cjs');
const { createNotificationPolicy } = require('./notifications.cjs');
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

function runDesktop() {
  app.setName('eïlo');
  process.umask(0o077);
  let root, supervisor;
  try {
    root = app.isPackaged
      ? JSON.parse(fs.readFileSync(path.join(process.resourcesPath, 'checkout.json'), 'utf8'))
          .workspace
      : path.resolve(__dirname, '../..');
    supervisor = createBackendSupervisor({
      rootPath: root,
      shutdownTimeoutMs: 20_000,
      onState: onBackendState,
    });
    supervisor.validateCheckout();
  } catch {
    void app.whenReady().then(() => {
      dialog.showErrorBox(
        'eïlo could not open its workspace',
        'This development build needs its original eïlo checkout and local runtime. Rebuild it from the project if the checkout has moved. Your saved conversation is kept.',
      );
      app.exit(1);
    });
    return;
  }
  const stateRoot = path.join(root, '.state', 'desktop');
  fs.mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  app.setPath('userData', path.join(stateRoot, 'profile'));
  app.setPath('sessionData', path.join(stateRoot, 'profile'));
  const preferencesPath = path.join(stateRoot, 'notifications.json');
  const statusPath = path.join(stateRoot, 'status.json');
  let window = null,
    tray = null,
    policy = null,
    quitting = false,
    stopped = false;
  let startup = null,
    pendingTarget = null,
    homeReady = false,
    timer = null,
    pollBusy = false;
  let notificationError = '',
    serviceError = '';
  let shutdownStage = 'running';
  let googleReturnTimer = null;
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
      flushTarget();
      recordStatus();
    } else if (!quitting) {
      void openWorkspace();
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
          return;
        }
        window = new BrowserWindow({
          width: 1280,
          height: 840,
          minWidth: 860,
          minHeight: 600,
          title: 'eïlo',
          show: false,
          backgroundColor: '#191a1d',
          autoHideMenuBar: true,
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
        for (const event of ['show', 'hide', 'focus', 'blur']) window.on(event, recordStatus);
        await window.loadURL(ORIGIN + '/home/');
        window.show();
        window.focus();
        flushTarget();
        updateMenus();
        recordStatus();
      } catch {
        serviceError = 'eïlo could not connect to its local workspace.';
        updateMenus();
        recordStatus();
        if (!quitting) {
          const result = await dialog.showMessageBox({
            type: 'error',
            title: 'Open eïlo',
            message: 'The local workspace could not start.',
            detail:
              'Your saved conversation is kept. Check that the eïlo checkout and its Python runtime are available, and that the local port belongs to eïlo.',
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
      title: 'eïlo',
      body: test
        ? 'Desktop notifications are ready. Open eïlo to continue.'
        : 'A new check-in is ready. Open eïlo to read it.',
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
        title: 'eïlo notifications',
        message: 'Show new check-ins when eïlo is out of view?',
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
        ? 'Local service · managed by eïlo'
        : backend.phase === 'attached'
          ? 'Local service · already running'
          : 'Connecting to workspace…';
    const controls = () => [
      { label: 'Open eïlo', accelerator: 'CmdOrCtrl+1', click: () => showWindow() },
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
      ...(notificationError ? [{ label: notificationError, enabled: false }] : []),
      {
        label: 'Reconnect to workspace',
        enabled: !startup,
        click: () => {
          void openWorkspace();
        },
      },
      { type: 'separator' },
      { role: 'quit', label: 'Quit eïlo' },
    ];
    tray?.setContextMenu(Menu.buildFromTemplate(controls()));
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: 'eïlo', submenu: [{ role: 'about', label: 'About eïlo' }, ...controls()] },
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
    if (pollBusy || quitting || !policy.status().enabled) return;
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
      if (!quitting && policy.status().enabled)
        policy.inspect(snapshot, { foreground: !!window?.isVisible() && !!window?.isFocused() });
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
            'eïlo could not finish stopping',
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
    app.whenReady().then(async () => {
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
      tray.setToolTip('eïlo');
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
