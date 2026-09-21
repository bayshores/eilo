'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

class FakeApp extends EventEmitter {
  constructor() {
    super();
    this.ready = Promise.resolve();
    this.quitCalls = 0;
  }
  setName() {}
  isPackaged = false;
  requestSingleInstanceLock() {
    return true;
  }
  whenReady() {
    return this.ready;
  }
  paths = {};
  setPath(name, value) {
    this.paths[name] = value;
  }
  getPath(name) {
    return '/user/' + name;
  }
  getVersion() {
    return 'test';
  }
  quit() {
    this.quitCalls += 1;
  }
  exit() {
    this.exitCalled = true;
  }
}

class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.visible = false;
    this.focused = false;
    this.url = '';
    this.sent = [];
    this.webContents = new EventEmitter();
    this.webContents.mainFrame = { url: 'http://127.0.0.1:8765/home/' };
    this.webContents.session = {
      webRequest: { onBeforeRequest: () => {} },
      setPermissionCheckHandler: () => {},
      setPermissionRequestHandler: () => {},
      setDevicePermissionHandler: () => {},
      setDisplayMediaRequestHandler: () => {},
      on: () => {},
    };
    this.webContents.setWindowOpenHandler = () => {};
    this.webContents.getURL = () => this.url;
    this.webContents.send = (...args) => this.sent.push(args);
  }
  async loadURL(url) {
    this.url = url;
    this.webContents.mainFrame.url = url;
  }
  async loadFile(file) {
    this.url = 'file://' + file;
    this.webContents.mainFrame.url = this.url;
    this.webContents.emit('did-finish-load');
  }
  show() {
    this.visible = true;
  }
  showInactive() {
    this.visible = true;
    this.shownInactive = true;
  }
  hide() {
    this.visible = false;
  }
  focus() {
    this.focused = true;
  }
  isVisible() {
    return this.visible;
  }
  isFocused() {
    return this.focused;
  }
  isDestroyed() {
    return this.destroyed === true;
  }
  close() {
    this.destroyed = true;
    this.visible = false;
    this.emit('closed');
  }
  setAlwaysOnTop(...value) {
    this.alwaysOnTop = value;
  }
  setVisibleOnAllWorkspaces(...value) {
    this.visibleOnAllWorkspaces = value;
  }
  isMinimized() {
    return false;
  }
  restore() {}
}

function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('development and standalone register the fixed context host with their respective runtimes', async () => {
  const development = buildHarness({ packaged: 'development' });
  await drain();
  assert.equal(development.supervisorOptions.rootPath, '/fixture/checkout');
  assert.equal(development.app.paths.userData, '/fixture/checkout/.state/desktop/profile');
  assert.equal(development.registrations.length, 1);
  assert.equal(development.registrations[0].userData, '/fixture/checkout/.state/desktop/profile');
  assert.equal(development.registrations[0].dataHome, '/fixture/checkout/.state');
  assert.equal(development.registrations[0].workspacePath, '/fixture/checkout');
  assert.equal(
    development.registrations[0].pythonPath,
    '/fixture/checkout/.runtime/venv/bin/python',
  );
  const standalone = buildHarness({ packaged: 'standalone' });
  await drain();
  assert.equal(standalone.supervisorOptions.rootPath, '/resources/workspace');
  assert.equal(
    standalone.supervisorOptions.extraEnvironment.EILO_RUNTIME_HOME,
    '/resources/runtime',
  );
  assert.equal(standalone.app.paths.userData, '/user/appData/eilo/desktop/profile');
  assert.equal(standalone.registrations.length, 1);
  assert.equal(standalone.windows.length, 1);
});

function buildHarness({
  deferStop = false,
  notificationEnabled = true,
  dialogResponse = 0,
  googleAuthorizationState = null,
  platform = 'linux',
  chromeOpenError = null,
  collectorAvailable = true,
  extensionDirectoryAvailable = true,
  deferExec = false,
  packaged = null,
} = {}) {
  const app = new FakeApp();
  app.isPackaged = Boolean(packaged);
  let supervisorOptions;
  const registrations = [];
  const ipcMain = new EventEmitter();
  ipcMain.handle = (name, handler) => {
    ipcMain[name] = handler;
  };
  let releaseStop;
  const stopGate = new Promise((resolve) => {
    releaseStop = resolve;
  });
  const supervisor = {
    starts: 0,
    stops: 0,
    validateCheckout: () => {},
    start: async () => {
      supervisor.starts += 1;
    },
    stop: async () => {
      supervisor.stops += 1;
      if (deferStop) await stopGate;
    },
    status: () => ({ phase: 'attached', ownsChild: false }),
  };
  const windows = [];
  const notifications = [];
  const externalURLs = [];
  const chromeOpens = [];
  const pendingExec = [];
  let timer = null;
  let applicationMenu = null;
  let stateCalls = 0;
  const electron = {
    app,
    ipcMain,
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
    },
    BrowserWindow: class extends FakeWindow {
      constructor(options) {
        super(options);
        windows.push(this);
      }
    },
    Menu: {
      buildFromTemplate: (value) => value,
      setApplicationMenu: (value) => {
        applicationMenu = value;
      },
    },
    Tray: class extends EventEmitter {
      setToolTip() {}
      setContextMenu() {}
      destroy() {}
    },
    nativeImage: { createFromPath: () => ({ setTemplateImage: () => {} }) },
    Notification: class extends EventEmitter {
      static isSupported() {
        return true;
      }
      constructor(options) {
        super();
        this.options = options;
        notifications.push(this);
      }
      show() {
        this.shown = true;
      }
      close() {
        this.closed = true;
        this.emit('close');
      }
    },
    dialog: { showErrorBox: () => {}, showMessageBox: async () => ({ response: dialogResponse }) },
    systemPreferences: { askForMediaAccess: async () => false },
    shell: {
      openExternal: async (url) => {
        externalURLs.push(url);
      },
    },
  };
  const fakeFs = {
    existsSync: (file) =>
      (packaged === 'standalone' && file.endsWith('eilo-bundle.json')) ||
      (collectorAvailable && file.endsWith('/EiloContextCollector')),
    statSync: (file) => {
      if (extensionDirectoryAvailable && file.endsWith('/activity/extension'))
        return { isDirectory: () => true };
      throw new Error('missing');
    },
    readFileSync: (file) =>
      file.endsWith('eilo-bundle.json')
        ? JSON.stringify({ workspace: 'workspace', runtime: 'runtime' })
        : file.endsWith('checkout.json')
          ? JSON.stringify({ workspace: '/fixture/checkout' })
          : file.endsWith('notifications.json')
            ? JSON.stringify({ enabled: notificationEnabled, seen: [] })
            : '',
    writeFileSync: () => {},
    renameSync: () => {},
    mkdirSync: () => {},
  };
  const requireStub = (name) => {
    if (name === 'electron') return electron;
    if (name === 'node:fs') return fakeFs;
    if (name === 'node:path') return path;
    if (name === 'node:child_process')
      return {
        execFile(command, args, options, callback) {
          chromeOpens.push({ command, args, options });
          if (deferExec) pendingExec.push(callback);
          else callback(chromeOpenError);
        },
      };
    if (name === './backend-supervisor.cjs')
      return {
        createBackendSupervisor: (options) => {
          supervisorOptions = options;
          return supervisor;
        },
      };
    if (name === './native-context-registration.cjs')
      return {
        ID: require('./native-context-registration.cjs').ID,
        registerNativeContext: (options) => registrations.push(options),
      };
    if (name === './notifications.cjs')
      return { createNotificationPolicy: require('./notifications.cjs').createNotificationPolicy };
    if (name === './security.cjs')
      return {
        ORIGIN: 'http://127.0.0.1:8765',
        localURL: (url) => url.startsWith('http://127.0.0.1:8765/'),
        homeURL: (url) => url === 'http://127.0.0.1:8765/home/',
        audioRequest: () => false,
        googleAuthorizationURL: (url) => url === 'https://accounts.google.com/approved',
        briefingAuthorizationURL: () => false,
        briefingSourceURL: () => false,
        checkInTarget: (value) =>
          value &&
          /^[A-Za-z0-9_-]{1,128}$/.test(value.conversationId || '') &&
          /^[A-Za-z0-9_-]{1,128}$/.test(value.messageId || '') &&
          /^[A-Za-z0-9_-]{1,128}$/.test(value.eventId || '')
            ? {
                conversationId: value.conversationId,
                messageId: value.messageId,
                eventId: value.eventId,
              }
            : null,
      };
    throw new Error(`unexpected require: ${name}`);
  };
  const context = {
    require: requireStub,
    __dirname,
    process: { umask: () => {}, pid: 1, platform, resourcesPath: '/resources' },
    fetch: async (url) => {
      if (url.endsWith('/api/desktop'))
        return {
          ok: true,
          json: async () => ({
            app: 'eilo',
            protocol: 1,
            workspace: path.resolve(__dirname, '../..'),
          }),
        };
      if (url.endsWith('/api/integrations/google-calendar')) {
        return { ok: true, json: async () => googleAuthorizationState || {} };
      }
      stateCalls += 1;
      return {
        ok: true,
        json: async () => ({
          conversation_id: 'c1',
          accountability: {
            check_ins: { notification_event_ids: stateCalls === 1 ? [] : ['e1'] },
          },
          messages:
            stateCalls === 1
              ? []
              : [
                  {
                    id: 'm1',
                    event_id: 'e1',
                    role: 'assistant',
                    origin: 'check_in',
                    text: 'private text',
                  },
                ],
        }),
      };
    },
    AbortSignal,
    setInterval: (fn) => {
      timer = fn;
      return { unref: () => {} };
    },
    clearInterval: () => {},
    queueMicrotask,
    setImmediate,
    setTimeout,
    clearTimeout,
    console,
    Date,
    JSON,
    Promise,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8'), context, {
    filename: 'main.cjs',
  });
  return {
    app,
    ipcMain,
    supervisor,
    windows,
    notifications,
    externalURLs,
    chromeOpens,
    resolveExec: (error = chromeOpenError) => pendingExec.shift()?.(error),
    get supervisorOptions() {
      return supervisorOptions;
    },
    registrations,
    get applicationMenu() {
      return applicationMenu;
    },
    releaseStop,
    runTimer: async () => {
      timer();
      await drain();
      await drain();
    },
  };
}

test('main creates a sandboxed home window, hides on close, and stops only during quit', async () => {
  const h = buildHarness({ deferStop: true });
  await drain();
  await drain();
  await drain();
  const window = h.windows[0];
  assert.equal(h.supervisor.starts, 1);
  assert.equal(window.url, 'http://127.0.0.1:8765/home/');
  assert.deepEqual(
    {
      sandbox: window.options.webPreferences.sandbox,
      nodeIntegration: window.options.webPreferences.nodeIntegration,
      contextIsolation: window.options.webPreferences.contextIsolation,
    },
    { sandbox: true, nodeIntegration: false, contextIsolation: true },
  );

  let closePrevented = false;
  window.emit('close', {
    preventDefault: () => {
      closePrevented = true;
    },
  });
  assert.equal(closePrevented, true);
  assert.equal(h.supervisor.stops, 0);

  let quitPrevented = false;
  h.app.emit('before-quit', {
    preventDefault: () => {
      quitPrevented = true;
    },
  });
  await drain();
  assert.equal(quitPrevented, true);
  assert.equal(h.supervisor.stops, 1);
  assert.equal(h.app.quitCalls, 0);

  let repeatedQuitPrevented = false;
  h.app.emit('before-quit', {
    preventDefault: () => {
      repeatedQuitPrevented = true;
    },
  });
  assert.equal(repeatedQuitPrevented, true);
  assert.equal(h.supervisor.stops, 1);

  h.releaseStop();
  await drain();
  await drain();
  assert.equal(h.app.quitCalls, 1);
});

test('macOS merges Home into the titlebar while retaining native traffic lights', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  await drain();
  await drain();
  assert.equal(h.windows[0].options.titleBarStyle, 'hiddenInset');
});

test('visible Home replays its show signal only to the trusted renderer handshake', async () => {
  const h = buildHarness();
  await drain();
  await drain();
  await drain();
  const window = h.windows[0];
  window.sent.length = 0;
  h.ipcMain.emit('eilo:window-show-ready', { sender: {}, senderFrame: {} });
  assert.deepEqual(window.sent, []);
  h.ipcMain.emit('eilo:window-show-ready', {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  });
  assert.deepEqual(window.sent, [['eilo:window-shown']]);
});

test('only the trusted main home frame flushes a pending check-in target', async () => {
  const h = buildHarness();
  await drain();
  await drain();
  await drain();
  h.windows[0].emit('close', { preventDefault: () => {} });
  await h.runTimer();
  const window = h.windows[0];
  assert.equal(h.notifications.length, 1);
  h.notifications[0].emit('click');

  h.ipcMain.emit('eilo:home-ready', { sender: {}, senderFrame: {} });
  h.ipcMain.emit('eilo:home-ready', {
    sender: window.webContents,
    senderFrame: { url: 'http://127.0.0.1:8765/home/' },
  });
  const delivered = () => window.sent.filter(([channel]) => channel === 'eilo:open-check-in');
  assert.equal(delivered().length, 0);

  h.ipcMain.emit('eilo:home-ready', {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  });
  assert.deepEqual(delivered(), [
    ['eilo:open-check-in', { conversationId: 'c1', messageId: 'm1', eventId: 'e1' }],
  ]);
});

test('a fresh background check-in opens a non-activating native overlay and only a deliberate click opens Home', async () => {
  const h = buildHarness({ notificationEnabled: false });
  await drain();
  await drain();
  await drain();
  const main = h.windows[0];
  main.focused = false;
  await h.runTimer();

  const overlay = h.windows[1];
  assert.ok(overlay, 'a fresh eligible check-in gets a native overlay');
  assert.equal(overlay.shownInactive, undefined, 'the overlay waits for its renderer listener');
  h.ipcMain.emit('eilo:overlay-ready', { sender: {} });
  assert.equal(overlay.shownInactive, undefined, 'untrusted renderer readiness cannot show it');
  h.ipcMain.emit('eilo:overlay-ready', { sender: overlay.webContents });
  assert.equal(overlay.shownInactive, true);
  assert.equal(main.focused, false, 'the overlay never steals focus from the active app');
  assert.deepEqual(overlay.alwaysOnTop, [true, 'pop-up-menu']);
  assert.equal(h.notifications.length, 0, 'desktop alerts remain independently off');
  assert.deepEqual(JSON.parse(JSON.stringify(overlay.sent)), [
    [
      'eilo:overlay-check-in',
      { conversationId: 'c1', eventId: 'e1', messageId: 'm1', text: 'private text' },
    ],
  ]);

  h.ipcMain.emit('eilo:overlay-open', { sender: {} });
  assert.equal(main.focused, false, 'untrusted overlay IPC cannot foreground Home');
  h.ipcMain.emit('eilo:overlay-open', { sender: overlay.webContents });
  assert.equal(overlay.isDestroyed(), true);
  assert.equal(main.focused, true, 'an intentional overlay click opens the existing conversation');
});

test('development can preview the non-activating overlay without creating a check-in', async () => {
  const h = buildHarness({ notificationEnabled: false });
  await drain();
  await drain();
  await drain();
  const controls = h.applicationMenu.find((item) => item.label === 'felis').submenu;
  const preview = controls.find((item) => item.label === 'Preview check-in overlay');
  assert.ok(preview, 'development keeps a deliberate visual preview for this native-only surface');

  preview.click();
  const overlay = h.windows[1];
  assert.ok(overlay);
  assert.equal(overlay.shownInactive, undefined, 'the preview still waits for renderer readiness');
  h.ipcMain.emit('eilo:overlay-ready', { sender: overlay.webContents });
  assert.equal(overlay.shownInactive, true);
  assert.equal(h.notifications.length, 0, 'the preview does not emit an OS notification');

  h.ipcMain.emit('eilo:overlay-open', { sender: overlay.webContents });
  assert.equal(
    h.windows[0].focused,
    true,
    'preview action opens Home without inventing a check-in target',
  );
});

test('check-in notification bridge is trusted, read-only status has no side effects, and enable honors cancellation', async () => {
  const h = buildHarness({ notificationEnabled: false, dialogResponse: 1 });
  await drain();
  await drain();
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const status = await h.ipcMain['eilo:check-in-notification-status'](trusted);
  assert.equal(
    JSON.stringify(status),
    JSON.stringify({ enabled: false, supported: true, error: false }),
  );
  assert.equal(h.notifications.length, 0);
  const subframe = {
    sender: window.webContents,
    senderFrame: { url: 'http://127.0.0.1:8765/home/' },
  };
  assert.equal(await h.ipcMain['eilo:check-in-notification-status'](subframe), null);
  assert.equal(await h.ipcMain['eilo:set-check-in-notifications'](subframe, true), null);
  assert.equal(
    await h.ipcMain['eilo:check-in-notification-status']({
      sender: {},
      senderFrame: window.webContents.mainFrame,
    }),
    null,
  );
  assert.equal(
    JSON.stringify(await h.ipcMain['eilo:set-check-in-notifications'](trusted, 'true')),
    JSON.stringify(status),
  );
  assert.equal(
    JSON.stringify(await h.ipcMain['eilo:set-check-in-notifications'](trusted, true)),
    JSON.stringify(status),
  );
});

test('disabling check-in notifications closes notices owned by felis', async () => {
  const h = buildHarness();
  await drain();
  await drain();
  await drain();
  h.windows[0].emit('close', { preventDefault: () => {} });
  await h.runTimer();
  assert.equal(h.notifications.length, 1);
  const window = h.windows[0];
  const result = await h.ipcMain['eilo:set-check-in-notifications'](
    { sender: window.webContents, senderFrame: window.webContents.mainFrame },
    false,
  );
  assert.equal(
    JSON.stringify(result),
    JSON.stringify({ enabled: false, supported: true, error: false }),
  );
  assert.equal(h.notifications[0].closed, true);
});

test("authorization IPC opens only the local service's currently pending URL", async () => {
  const url = 'https://accounts.google.com/approved';
  const h = buildHarness({
    googleAuthorizationState: { state: 'authorizing', authorization_url: url },
  });
  await drain();
  await drain();
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };

  assert.equal(await h.ipcMain['eilo:google-authorization'](trusted, url), true);
  assert.deepEqual(h.externalURLs, [url]);
  assert.equal(await h.ipcMain['eilo:google-authorization'](trusted, `${url}/other`), false);
  assert.deepEqual(h.externalURLs, [url]);
});

test('Chrome handoff opens only the fixed connection URL for focused trusted Home', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  const window = h.windows[0];
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(
    await h.ipcMain['eilo:open-activity-connection'](event, 'https://example.test'),
    true,
  );
  assert.equal(h.chromeOpens.length, 1);
  assert.equal(h.chromeOpens[0].command, '/usr/bin/open');
  assert.equal(
    JSON.stringify(h.chromeOpens[0].args),
    JSON.stringify(['-b', 'com.google.Chrome', 'http://127.0.0.1:8765/activity-connect']),
  );
  assert.equal(h.chromeOpens[0].options.timeout, 10000);
  assert.equal(
    await h.ipcMain['eilo:open-activity-connection']({
      sender: {},
      senderFrame: event.senderFrame,
    }),
    false,
  );
  assert.equal(
    await h.ipcMain['eilo:open-activity-connection']({
      ...event,
      senderFrame: { url: event.senderFrame.url },
    }),
    false,
  );
  window.focused = false;
  assert.equal(await h.ipcMain['eilo:open-activity-connection'](event), false);
  window.focused = true;
  window.visible = false;
  assert.equal(await h.ipcMain['eilo:open-activity-connection'](event), false);
  assert.equal(h.chromeOpens.length, 1);
});

test('Chrome setup opens the connection guide only from the focused trusted Home', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  const window = h.windows[0];
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await h.ipcMain['eilo:open-chrome-setup'](event, 'https://example.test'), true);
  assert.equal(
    JSON.stringify(h.chromeOpens[0].args),
    JSON.stringify([
      '-b',
      'com.google.Chrome',
      'http://127.0.0.1:8765/activity-connect?client=desktop',
    ]),
  );
  assert.equal(h.chromeOpens[0].options.timeout, 10_000);
  for (const untrusted of [
    { ...event, sender: {} },
    { ...event, senderFrame: { url: event.senderFrame.url } },
  ])
    assert.equal(await h.ipcMain['eilo:open-chrome-setup'](untrusted), false);
  window.focused = false;
  assert.equal(await h.ipcMain['eilo:open-chrome-setup'](event), false);
  window.focused = true;
  window.visible = false;
  assert.equal(await h.ipcMain['eilo:open-chrome-setup'](event), false);
  assert.equal(h.chromeOpens.length, 1);
  for (const options of [
    { platform: 'darwin', chromeOpenError: new Error('not installed') },
    { platform: 'linux' },
  ]) {
    const unavailable = buildHarness(options);
    await drain();
    const other = unavailable.windows[0];
    assert.equal(
      await unavailable.ipcMain['eilo:open-chrome-setup']({
        sender: other.webContents,
        senderFrame: other.webContents.mainFrame,
      }),
      false,
    );
  }
});

test('Chrome launch failure and unsupported platforms do not report success', async () => {
  for (const options of [
    { platform: 'darwin', chromeOpenError: new Error('not installed') },
    { platform: 'linux' },
  ]) {
    const h = buildHarness(options);
    await drain();
    const window = h.windows[0];
    assert.equal(
      await h.ipcMain['eilo:open-activity-connection']({
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      }),
      false,
    );
  }
});

test('Chrome setup opens only fixed Chrome and bundled-extension destinations', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };

  assert.equal(
    await h.ipcMain['eilo:open-chrome-extensions'](trusted, 'https://example.test'),
    true,
  );
  assert.equal(await h.ipcMain['eilo:reveal-chrome-extension'](trusted, '/private/example'), true);
  assert.equal(
    JSON.stringify(
      h.chromeOpens.map(({ command, args, options }) => ({
        command,
        args,
        timeout: options.timeout,
      })),
    ),
    JSON.stringify([
      {
        command: '/usr/bin/open',
        args: ['-b', 'com.google.Chrome', 'chrome://extensions/'],
        timeout: 10_000,
      },
      {
        command: '/usr/bin/open',
        args: ['-R', path.join(path.resolve(__dirname, '../..'), 'activity', 'extension')],
        timeout: 10_000,
      },
    ]),
  );
  window.focused = false;
  assert.equal(await h.ipcMain['eilo:open-chrome-extensions'](trusted), false);
  assert.equal(await h.ipcMain['eilo:reveal-chrome-extension'](trusted), false);
  assert.equal(h.chromeOpens.length, 2);
});

test('revealing Chrome extension fails closed when the owned bundle directory is unavailable', async () => {
  const h = buildHarness({ platform: 'darwin', extensionDirectoryAvailable: false });
  await drain();
  const window = h.windows[0];
  assert.equal(
    await h.ipcMain['eilo:reveal-chrome-extension']({
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    }),
    false,
  );
  assert.equal(h.chromeOpens.length, 0);
});

test('text permission uses only the dedicated collector command before opening Accessibility settings', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await h.ipcMain['eilo:context-permission'](trusted, 'text'), true);
  assert.equal(
    JSON.stringify(h.chromeOpens),
    JSON.stringify([
      {
        command: path.join(
          path.resolve(__dirname, '../..'),
          '.runtime',
          'eilo-context-collector',
          'EiloContextCollector',
        ),
        args: ['--request-text-permission'],
        options: { timeout: 10_000 },
      },
    ]),
  );
  assert.deepEqual(h.externalURLs, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  ]);
});

test('text permission has a timeout-bounded concurrent-click guard and never opens settings if the helper fails', async () => {
  const h = buildHarness({ platform: 'darwin', deferExec: true });
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const first = h.ipcMain['eilo:context-permission'](trusted, 'text');
  assert.equal(await h.ipcMain['eilo:context-permission'](trusted, 'text'), false);
  assert.equal(h.chromeOpens.length, 1);
  assert.equal(h.chromeOpens[0].options.timeout, 10_000);
  h.resolveExec(new Error('unavailable'));
  assert.equal(await first, false);
  assert.deepEqual(h.externalURLs, []);
});

test('visual permissions do not invoke the Accessibility helper', async () => {
  const h = buildHarness({ platform: 'darwin' });
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await h.ipcMain['eilo:context-permission'](trusted, 'visual'), true);
  assert.equal(h.chromeOpens.length, 0);
  assert.deepEqual(h.externalURLs, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ]);
});

test('context permissions do not open macOS settings or invoke helpers off macOS', async () => {
  const h = buildHarness();
  await drain();
  const window = h.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal(await h.ipcMain['eilo:context-permission'](trusted, 'text'), false);
  assert.equal(await h.ipcMain['eilo:context-permission'](trusted, 'visual'), false);
  assert.equal(h.chromeOpens.length, 0);
  assert.deepEqual(h.externalURLs, []);
});
