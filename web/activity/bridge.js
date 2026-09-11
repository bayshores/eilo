'use strict';

// This bridge is inert until the visible product explicitly calls connect(). It has
// no DOM reads, polling, or model/network access of its own.
(() => {
  const PORT_NAME = 'eilo-metadata-v1';
  const ID = /^[A-Za-z0-9_-]{8,128}$/;
  const EXTENSION_ID = /^[a-p]{32}$/;
  let port = null;
  let clientId = null;
  let observationCallback = null;
  let statusCallback = null;
  // The server issues short-lived snapshots serially. Retain only the latest one:
  // a late response cannot become context for a newer activity state.
  let pendingNonce = null;

  function status(connected, reason) {
    if (typeof statusCallback === 'function') statusCallback(connected, reason);
  }
  function isFresh(value) {
    return Number.isInteger(value) && value >= Date.now() && value <= Date.now() + 9000;
  }
  function validObservation(value) {
    if (!value || typeof value !== 'object') return false;
    if (value.kind === 'activity_unshared' || value.kind === 'activity_unknown')
      return Object.keys(value).length === 1;
    if (
      value.kind !== 'approved_study_context' ||
      typeof value.origin !== 'string' ||
      typeof value.title !== 'string'
    )
      return false;
    return (
      Object.keys(value).length === 3 && value.origin.length <= 280 && value.title.length <= 180
    );
  }
  function clear(reason) {
    port = null;
    pendingNonce = null;
    status(false, reason);
  }
  function readiness(nextPort) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(
        () => finish({ ok: false, reason: 'extension_update_required' }),
        3000,
      );
      nextPort.onMessage.addListener((message) => {
        if (message?.type !== 'ready' || message.protocol !== 2) return;
        finish(
          message.granted === true
            ? { ok: true }
            : { ok: false, reason: 'browser_permission_required' },
        );
      });
      nextPort.onDisconnect.addListener(() =>
        finish({ ok: false, reason: 'extension_disconnected' }),
      );
    });
  }
  function openPort(extensionId) {
    if (!EXTENSION_ID.test(extensionId || '') || !globalThis.chrome?.runtime?.connect) return null;
    try {
      const nextPort = globalThis.chrome.runtime.connect(extensionId, { name: PORT_NAME });
      return nextPort?.postMessage &&
        nextPort.onMessage?.addListener &&
        nextPort.onDisconnect?.addListener
        ? nextPort
        : null;
    } catch {
      return null;
    }
  }
  // Readiness does not request a sample or start the server's activity lease.
  async function check(extensionId) {
    const probe = openPort(extensionId);
    if (!probe) return { ok: false, reason: 'chrome_unavailable' };
    const result = await readiness(probe);
    try {
      probe.disconnect();
    } catch {
      /* The extension may already have disconnected. */
    }
    return result;
  }
  async function connect(extensionId, nextClientId, onObservation, onStatus) {
    disconnect();
    observationCallback = typeof onObservation === 'function' ? onObservation : null;
    statusCallback = typeof onStatus === 'function' ? onStatus : null;
    if (!EXTENSION_ID.test(extensionId || '') || !ID.test(nextClientId || '')) {
      status(false, 'invalid_connection');
      return { ok: false, reason: 'invalid_connection' };
    }
    if (!globalThis.chrome?.runtime?.connect) {
      status(false, 'chrome_unavailable');
      return { ok: false, reason: 'chrome_unavailable' };
    }
    const nextPort = openPort(extensionId);
    if (!nextPort) {
      status(false, 'connection_failed');
      return { ok: false, reason: 'connection_failed' };
    }
    port = nextPort;
    clientId = nextClientId;
    nextPort.onMessage.addListener((message) => {
      if (
        port !== nextPort ||
        !message ||
        message.type !== 'observation' ||
        !ID.test(message.nonce || '') ||
        message.nonce !== pendingNonce ||
        !validObservation(message.observation)
      )
        return;
      pendingNonce = null;
      observationCallback?.(message.nonce, message.observation);
    });
    nextPort.onDisconnect.addListener(() => {
      // Read lastError to acknowledge a rejected Chrome messaging connection.
      void globalThis.chrome?.runtime?.lastError;
      if (port === nextPort) clear('extension_disconnected');
    });
    const ready = await readiness(nextPort);
    if (!ready.ok || port !== nextPort) {
      if (port === nextPort) disconnect();
      return ready.ok ? { ok: false, reason: 'extension_disconnected' } : ready;
    }
    status(true, 'connected');
    return { ok: true };
  }
  function update(activityState) {
    const request = activityState?.sample_request;
    if (
      !port ||
      !request ||
      !ID.test(request.nonce || '') ||
      request.client_id !== clientId ||
      !isFresh(request.expires_at) ||
      pendingNonce === request.nonce
    )
      return false;
    pendingNonce = request.nonce;
    try {
      port.postMessage({
        type: 'snapshot',
        nonce: request.nonce,
        client_id: clientId,
        expires_at: request.expires_at,
      });
      return true;
    } catch {
      pendingNonce = null;
      clear('extension_send_failed');
      return false;
    }
  }
  function disconnect() {
    const old = port;
    port = null;
    pendingNonce = null;
    if (old?.disconnect) {
      try {
        old.disconnect();
      } catch {
        /* A disconnected extension port cannot be closed again. */
      }
    }
    if (old) status(false, 'disconnected');
  }
  globalThis.EiloActivityBridge = { connect, check, update, disconnect };
})();
