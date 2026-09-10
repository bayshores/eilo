'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBackendSupervisor, safeEnvironment } = require('./backend-supervisor.cjs');

const ROOT = '/approved/eilo';

function checkoutFs() {
  return {
    realpathSync: (value) => value,
    statSync: () => ({ isFile: () => true }),
  };
}

function response(ok, body) {
  return { ok, json: async () => body };
}

function serviceFetch({ available = true, root = ROOT } = {}) {
  return async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers['X-Eilo-Client'], 'local-chat');
    assert.ok(options.signal);
    if (!available) throw Object.assign(new Error('offline'), { cause: { code: 'ECONNREFUSED' } });
    if (url.endsWith('/api/desktop'))
      return response(true, { app: 'eilo', protocol: 1, workspace: root });
    if (url.endsWith('/api/state'))
      return response(true, { messages: ['private state is never retained'] });
    throw new Error('unexpected endpoint');
  };
}

function child() {
  const process = new EventEmitter();
  process.exitCode = null;
  process.killCalls = [];
  process.kill = (signal) => {
    process.killCalls.push(signal);
    process.exitCode = 0;
    process.emit('exit', 0, signal);
    return true;
  };
  return process;
}

test('attaches only to the exact desktop identity and never stops it', async () => {
  let spawns = 0;
  const foreign = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch({ root: '/another/eilo' }),
    spawn: () => {
      spawns += 1;
      return child();
    },
    attempts: 1,
  });
  await assert.rejects(foreign.start(), /already responding/);
  assert.equal(spawns, 0, 'a responding foreign listener was never attached or displaced');

  const attached = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch(),
    spawn: () => {
      throw new Error('must not spawn');
    },
  });
  assert.equal((await attached.start()).status, 'attached');
  await attached.stop();
  assert.equal(attached.status().ownsChild, false);
});

test('bounds every probe with the injected request timeout', async () => {
  const timeoutCalls = [];
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch(),
    abortSignalTimeout: (milliseconds) => {
      timeoutCalls.push(milliseconds);
      return { milliseconds };
    },
    requestTimeoutMs: 37,
    spawn: () => {
      throw new Error('must not spawn');
    },
  });
  await supervisor.start();
  assert.deepEqual(timeoutCalls, [37, 37]);
});

test('malformed identity and request timeouts fail closed without spawning', async () => {
  for (const fetch of [
    async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    }),
    async () => {
      throw new Error('request timed out');
    },
  ]) {
    let spawns = 0;
    const supervisor = createBackendSupervisor({
      rootPath: ROOT,
      canonicalRoot: ROOT,
      fs: checkoutFs(),
      fetch,
      spawn: () => {
        spawns += 1;
        return child();
      },
      attempts: 1,
    });
    await assert.rejects(supervisor.start(), /already responding/);
    assert.equal(spawns, 0);
  }
});

test('starts the approved launcher with an allowlisted environment', async () => {
  const spawned = child();
  const calls = [];
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch({ available: false }),
    spawn: (...args) => {
      calls.push(args);
      return spawned;
    },
    attempts: 1,
    environment: {
      PATH: '/safe/bin',
      HOME: '/safe/home',
      TOKEN: 'do-not-pass',
      EILO_SECRET: 'do-not-pass',
    },
  });
  await assert.rejects(supervisor.start(), /did not become ready/);
  assert.deepEqual(calls[0], [
    '/approved/eilo/scripts/local-chat',
    ['start', '--port', '8765'],
    { cwd: ROOT, env: { PATH: '/safe/bin', HOME: '/safe/home' }, shell: false, stdio: 'ignore' },
  ]);
  assert.deepEqual(spawned.killCalls, ['SIGTERM']);
  assert.deepEqual(safeEnvironment({ PATH: 'x', TOKEN: 'no' }), { PATH: 'x' });
});

test('failed readiness cleans up the owned child and reports failure', async () => {
  const spawned = child();
  const states = [];
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch({ available: false }),
    spawn: () => spawned,
    onState: (state) => states.push(state.phase),
    attempts: 2,
    sleep: async () => {},
  });
  await assert.rejects(supervisor.start(), /did not become ready/);
  assert.deepEqual(spawned.killCalls, ['SIGTERM']);
  assert.equal(supervisor.status().ownsChild, false);
  assert.equal(states.at(-1), 'failed');
});

test('stop waits for an owned child exit', async () => {
  const spawned = child();
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    fetch: serviceFetch({ available: false }),
    spawn: () => spawned,
    attempts: 1,
  });
  await assert.rejects(supervisor.start(), /did not become ready/);
  // Give this instance a fresh owned child through a readiness sequence.
  let calls = 0;
  const owned = child();
  const ready = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    spawn: () => owned,
    fetch: async (url, options) => {
      calls += 1;
      assert.equal(options.headers['X-Eilo-Client'], 'local-chat');
      if (calls <= 2)
        throw Object.assign(new Error('not listening yet'), { cause: { code: 'ECONNREFUSED' } });
      return url.endsWith('/api/desktop')
        ? response(true, { app: 'eilo', protocol: 1, workspace: ROOT })
        : response(true, {});
    },
    attempts: 3,
    sleep: async () => {},
  });
  await ready.start();
  await ready.stop();
  assert.deepEqual(owned.killCalls, ['SIGTERM']);
  assert.equal(ready.status().phase, 'stopped');
});

test('an owned child error is handled without an unhandled emitter error', async () => {
  const owned = child();
  let requests = 0;
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    spawn: () => owned,
    fetch: async (url) => {
      requests += 1;
      if (requests <= 2)
        throw Object.assign(new Error('not listening yet'), { cause: { code: 'ECONNREFUSED' } });
      return url.endsWith('/api/desktop')
        ? response(true, { app: 'eilo', protocol: 1, workspace: ROOT })
        : response(true, {});
    },
    attempts: 2,
    sleep: async () => {},
  });
  await supervisor.start();
  owned.emit('error', new Error('launch pipe failed'));
  assert.deepEqual(supervisor.status(), {
    phase: 'failed',
    error: 'launch pipe failed',
    ownsChild: false,
    url: 'http://127.0.0.1:8765/',
  });
});

test('shutdown times out, escalates only the owned child, and reports failure', async () => {
  const owned = new EventEmitter();
  owned.exitCode = null;
  owned.signalCode = null;
  owned.killCalls = [];
  owned.kill = (signal) => {
    owned.killCalls.push(signal);
    return true;
  };
  let requests = 0;
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    spawn: () => owned,
    fetch: async (url) => {
      requests += 1;
      if (requests <= 2)
        throw Object.assign(new Error('not listening yet'), { cause: { code: 'ECONNREFUSED' } });
      return url.endsWith('/api/desktop')
        ? response(true, { app: 'eilo', protocol: 1, workspace: ROOT })
        : response(true, {});
    },
    attempts: 2,
    sleep: async () => {},
    setTimeoutFn: (callback) => {
      queueMicrotask(callback);
      return {};
    },
    clearTimeoutFn: () => {},
    shutdownTimeoutMs: 1,
  });
  await supervisor.start();
  await assert.rejects(supervisor.stop(), /did not stop in time/);
  assert.deepEqual(owned.killCalls, ['SIGTERM', 'SIGKILL']);
  assert.equal(supervisor.status().phase, 'failed');
  assert.equal(supervisor.status().ownsChild, true);
  await assert.rejects(supervisor.start(), /has not stopped/);
  assert.deepEqual(
    owned.killCalls,
    ['SIGTERM', 'SIGKILL'],
    'retry never signals or spawns a retained child',
  );
});

test('concurrent starts share one startup operation and spawn one child', async () => {
  const owned = child();
  let requests = 0,
    spawns = 0;
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    spawn: () => {
      spawns += 1;
      return owned;
    },
    fetch: async (url) => {
      requests += 1;
      if (requests === 1)
        throw Object.assign(new Error('not listening yet'), { cause: { code: 'ECONNREFUSED' } });
      return url.endsWith('/api/desktop')
        ? response(true, { app: 'eilo', protocol: 1, workspace: ROOT })
        : response(true, {});
    },
    attempts: 2,
  });
  const [first, second] = await Promise.all([supervisor.start(), supervisor.start()]);
  assert.equal(first.status, 'started');
  assert.equal(second.status, 'started');
  assert.equal(spawns, 1);
  await supervisor.stop();
});

test('stop during a pending startup waits for and stops the one owned child', async () => {
  const owned = child();
  let releaseProbe;
  const firstProbe = new Promise((resolve, reject) => {
    releaseProbe = { resolve, reject };
  });
  let requests = 0,
    spawns = 0;
  const supervisor = createBackendSupervisor({
    rootPath: ROOT,
    canonicalRoot: ROOT,
    fs: checkoutFs(),
    spawn: () => {
      spawns += 1;
      return owned;
    },
    fetch: async (url) => {
      requests += 1;
      if (requests === 1) return firstProbe;
      return url.endsWith('/api/desktop')
        ? response(true, { app: 'eilo', protocol: 1, workspace: ROOT })
        : response(true, {});
    },
    attempts: 2,
  });
  const starting = supervisor.start();
  const stopping = supervisor.stop();
  releaseProbe.reject(
    Object.assign(new Error('not listening yet'), { cause: { code: 'ECONNREFUSED' } }),
  );
  await Promise.all([starting, stopping]);
  assert.equal(spawns, 1);
  assert.deepEqual(owned.killCalls, ['SIGTERM']);
  assert.equal(supervisor.status().ownsChild, false);
  assert.equal(supervisor.status().phase, 'stopped');
});
