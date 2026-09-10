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
  setPath() {}
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
  show() {
    this.visible = true;
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
    return false;
  }
  isMinimized() {
    return false;
  }
  restore() {}
}

function drain() {
  return new Promise((resolve) => setImmediate(resolve));
}

function buildHarness({
  deferStop = false,
  notificationEnabled = true,
  dialogResponse = 0,
  googleAuthorizationState = null,
} = {}) {
  const app = new FakeApp();
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
  let timer = null;
  let stateCalls = 0;
  const electron = {
    app,
    ipcMain,
    BrowserWindow: class extends FakeWindow {
      constructor(options) {
        super(options);
        windows.push(this);
      }
    },
    Menu: { buildFromTemplate: (value) => value, setApplicationMenu: () => {} },
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
    readFileSync: (file) =>
      file.endsWith('notifications.json')
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
    if (name === './backend-supervisor.cjs') return { createBackendSupervisor: () => supervisor };
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
    process: { umask: () => {}, pid: 1, platform: 'linux', resourcesPath: '/resources' },
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
  assert.equal(window.sent.length, 0);

  h.ipcMain.emit('eilo:home-ready', {
    sender: window.webContents,
    senderFrame: window.webContents.mainFrame,
  });
  assert.deepEqual(window.sent, [
    ['eilo:open-check-in', { conversationId: 'c1', messageId: 'm1', eventId: 'e1' }],
  ]);
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

test('disabling check-in notifications closes notices owned by eïlo', async () => {
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
