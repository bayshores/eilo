'use strict';

// Owns only the child created by this object. It never discovers or stops a
// process that was already listening on the local port.
const path = require('node:path');

const DESKTOP_IDENTITY = Object.freeze({ app: 'eilo', protocol: 1 });
const DEFAULT_PORT = 8765;

function safeEnvironment(source = process.env) {
  const names = ['HOME', 'PATH', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ'];
  return Object.fromEntries(
    names
      .filter((name) => typeof source[name] === 'string' && source[name])
      .map((name) => [name, source[name]]),
  );
}

function createBackendSupervisor(options) {
  const {
    rootPath,
    canonicalRoot = rootPath,
    fs = require('node:fs'),
    spawn = require('node:child_process').spawn,
    fetch = globalThis.fetch,
    environment = process.env,
    onState = () => {},
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    abortSignalTimeout = AbortSignal.timeout.bind(AbortSignal),
    requestTimeoutMs = 2_000,
    shutdownTimeoutMs = 5_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    port = DEFAULT_PORT,
    attempts = 20,
    retryDelayMs = 250,
  } = options || {};

  if (typeof fetch !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new TypeError('port must be a valid TCP port.');
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new TypeError('attempts must be positive.');
  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    !Number.isInteger(shutdownTimeoutMs) ||
    shutdownTimeoutMs < 1
  )
    throw new TypeError('timeouts must be positive.');

  const configuredRoot = path.resolve(String(rootPath || ''));
  const expectedRoot = path.resolve(String(canonicalRoot || ''));
  let child = null;
  let phase = 'idle';
  let lastError = null;
  let startPromise = null;
  let stopPromise = null;

  function report(nextPhase, error = null) {
    phase = nextPhase;
    lastError = error;
    onState({ phase, error: error ? error.message : null, ownsChild: Boolean(child) });
  }

  function validateCheckout() {
    if (!path.isAbsolute(rootPath || ''))
      throw new Error('The eïlo checkout path must be absolute.');
    let actualRoot;
    try {
      actualRoot = path.resolve(fs.realpathSync(configuredRoot));
    } catch {
      throw new Error('The configured eïlo checkout is unavailable.');
    }
    if (actualRoot !== expectedRoot)
      throw new Error('The configured eïlo checkout is not the approved canonical checkout.');
    const script = path.join(actualRoot, 'scripts', 'local-chat');
    const runtime = path.join(actualRoot, '.runtime', 'venv', 'bin', 'python');
    try {
      if (!fs.statSync(script).isFile() || !fs.statSync(runtime).isFile())
        throw new Error('missing');
    } catch {
      throw new Error('The eïlo local runtime is incomplete.');
    }
    return { root: actualRoot, script };
  }

  function urlFor(endpoint) {
    return `http://127.0.0.1:${port}${endpoint}`;
  }

  async function get(endpoint) {
    return fetch(urlFor(endpoint), {
      method: 'GET',
      headers: { 'X-Eilo-Client': 'local-chat' },
      cache: 'no-store',
      signal: abortSignalTimeout(requestTimeoutMs),
    });
  }

  async function inspectService(root) {
    let identityResponse;
    try {
      identityResponse = await get('/api/desktop');
    } catch (error) {
      return error && error.cause && error.cause.code === 'ECONNREFUSED'
        ? { kind: 'unavailable' }
        : { kind: 'foreign' };
    }
    if (!identityResponse || !identityResponse.ok) return { kind: 'foreign' };
    let identity;
    try {
      identity = await identityResponse.json();
    } catch {
      return { kind: 'foreign' };
    }
    if (
      !identity ||
      identity.app !== DESKTOP_IDENTITY.app ||
      identity.protocol !== DESKTOP_IDENTITY.protocol ||
      identity.workspace !== root
    )
      return { kind: 'foreign' };
    // This intentionally only checks response status. State contents are never
    // logged, retained, or forwarded by the supervisor.
    try {
      const stateResponse = await get('/api/state');
      return stateResponse && stateResponse.ok ? { kind: 'matching' } : { kind: 'foreign' };
    } catch {
      return { kind: 'foreign' };
    }
  }

  function isSettled(process) {
    return (
      (process.exitCode !== null && process.exitCode !== undefined) ||
      (process.signalCode !== null && process.signalCode !== undefined)
    );
  }

  function awaitSettlement(process, timeoutMs) {
    if (isSettled(process)) return Promise.resolve({ type: 'settled' });
    return new Promise((resolve) => {
      let timer;
      const finish = (result) => {
        clearTimeoutFn(timer);
        process.removeListener('exit', onExit);
        process.removeListener('close', onClose);
        process.removeListener('error', onError);
        resolve(result);
      };
      const onExit = () => finish({ type: 'exit' });
      const onClose = () => finish({ type: 'close' });
      const onError = (error) => finish({ type: 'error', error });
      timer = setTimeoutFn(() => finish({ type: 'timeout' }), timeoutMs);
      process.once('exit', onExit);
      process.once('close', onClose);
      process.once('error', onError);
    });
  }

  function watchOwnedChild(process) {
    process.once('error', (error) => {
      if (child !== process) return;
      child = null;
      report(
        'failed',
        error instanceof Error ? error : new Error('The local service could not start.'),
      );
    });
    process.once('exit', (code, signal) => {
      if (child !== process) return;
      child = null;
      if (phase !== 'stopping' && phase !== 'stopped') {
        report('failed', new Error(`The local service exited (${signal || code || 'unknown'}).`));
      }
    });
  }

  async function stopOwnedChild() {
    const owned = child;
    if (!owned) return;
    report('stopping');
    if (!isSettled(owned)) owned.kill('SIGTERM');
    let result = await awaitSettlement(owned, shutdownTimeoutMs);
    if (result.type === 'timeout') {
      owned.kill('SIGKILL');
      result = await awaitSettlement(owned, shutdownTimeoutMs);
    }
    if (result.type === 'timeout') {
      const error = new Error('The owned local service did not stop in time.');
      report('failed', error);
      throw error;
    }
    if (child === owned) child = null;
    if (result.type === 'error') {
      const error =
        result.error instanceof Error
          ? result.error
          : new Error('The owned local service stopped with an error.');
      report('failed', error);
      throw error;
    }
    report('stopped');
  }

  async function startInternal() {
    if (child) {
      if (isSettled(child)) child = null;
      else {
        const error = new Error('The owned local service has not stopped; restart is unavailable.');
        report('failed', error);
        throw error;
      }
    }
    const { root, script } = validateCheckout();
    report('checking');
    const existing = await inspectService(root);
    if (existing.kind === 'matching') {
      report('attached');
      return { status: 'attached', url: urlFor('/') };
    }
    if (existing.kind === 'foreign') {
      const error = new Error('Another local service is already responding on the eïlo port.');
      report('failed', error);
      throw error;
    }

    report('starting');
    let owned;
    try {
      owned = spawn(script, ['start', '--port', String(port)], {
        cwd: root,
        env: safeEnvironment(environment),
        shell: false,
        stdio: 'ignore',
      });
    } catch (error) {
      report(
        'failed',
        error instanceof Error ? error : new Error('The local service could not start.'),
      );
      throw lastError;
    }
    child = owned;
    watchOwnedChild(owned);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const service = await inspectService(root);
      if (service.kind === 'matching' && child === owned && !isSettled(owned)) {
        report('ready');
        return { status: 'started', url: urlFor('/') };
      }
      if (service.kind === 'foreign') break;
      if (!child) break;
      if (attempt + 1 < attempts) await sleep(retryDelayMs);
    }
    const error = new Error('The local eïlo service did not become ready.');
    try {
      await stopOwnedChild();
    } finally {
      report('failed', error);
    }
    throw error;
  }

  function start() {
    if (startPromise) return startPromise;
    if (stopPromise) return stopPromise.then(() => start());
    const operation = startInternal();
    startPromise = operation;
    return operation.finally(() => {
      if (startPromise === operation) startPromise = null;
    });
  }

  function stop() {
    if (stopPromise) return stopPromise;
    const operation = (async () => {
      // A start can be between its port probe and spawn. Wait for it to either
      // finish or clean up before deciding which owned child, if any, to stop.
      if (startPromise) {
        try {
          await startPromise;
        } catch {
          /* startup failure already reported */
        }
      }
      await stopOwnedChild();
    })();
    stopPromise = operation;
    return operation.finally(() => {
      if (stopPromise === operation) stopPromise = null;
    });
  }

  return Object.freeze({
    start,
    stop,
    status: () => ({
      phase,
      error: lastError ? lastError.message : null,
      ownsChild: Boolean(child),
      url: urlFor('/'),
    }),
    validateCheckout,
  });
}

module.exports = { DEFAULT_PORT, DESKTOP_IDENTITY, createBackendSupervisor, safeEnvironment };
