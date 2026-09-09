"use strict";

// This bridge is inert until the visible product explicitly calls connect(). It has
// no DOM reads, polling, or model/network access of its own.
(() => {
  const PORT_NAME = "eilo-metadata-v1";
  const ID = /^[A-Za-z0-9_-]{8,128}$/;
  const EXTENSION_ID = /^[a-p]{32}$/;
  let port = null;
  let clientId = null;
  let observationCallback = null;
  let statusCallback = null;
  // The server issues short-lived snapshots serially. Retain only the latest one:
  // a late response cannot become context for a newer activity state.
  let pendingNonce = null;

  function status(connected, reason) { if (typeof statusCallback === "function") statusCallback(connected, reason); }
  function isFresh(value) {
    return Number.isInteger(value) && value >= Date.now() && value <= Date.now() + 9000;
  }
  function validObservation(value) {
    if (!value || typeof value !== "object") return false;
    if (value.kind === "activity_unshared" || value.kind === "activity_unknown") return Object.keys(value).length === 1;
    if (value.kind !== "approved_study_context" || typeof value.origin !== "string" || typeof value.title !== "string") return false;
    return Object.keys(value).length === 3 && value.origin.length <= 253 && value.title.length <= 180;
  }
  function clear(reason) {
    port = null;
    pendingNonce = null;
    status(false, reason);
  }
  function connect(extensionId, nextClientId, onObservation, onStatus) {
    disconnect();
    observationCallback = typeof onObservation === "function" ? onObservation : null;
    statusCallback = typeof onStatus === "function" ? onStatus : null;
    if (!EXTENSION_ID.test(extensionId || "") || !ID.test(nextClientId || "")) { status(false, "invalid_connection"); return { ok: false, reason: "invalid_connection" }; }
    if (!globalThis.chrome?.runtime?.connect) { status(false, "chrome_unavailable"); return { ok: false, reason: "chrome_unavailable" }; }
    let nextPort;
    try { nextPort = globalThis.chrome.runtime.connect(extensionId, { name: PORT_NAME }); }
    catch { status(false, "connection_failed"); return { ok: false, reason: "connection_failed" }; }
    if (!nextPort?.postMessage || !nextPort.onMessage?.addListener || !nextPort.onDisconnect?.addListener) { status(false, "connection_failed"); return { ok: false, reason: "connection_failed" }; }
    port = nextPort;
    clientId = nextClientId;
    nextPort.onMessage.addListener((message) => {
      if (port !== nextPort || !message || message.type !== "observation" || !ID.test(message.nonce || "") || message.nonce !== pendingNonce || !validObservation(message.observation)) return;
      pendingNonce = null;
      observationCallback?.(message.nonce, message.observation);
    });
    nextPort.onDisconnect.addListener(() => { if (port === nextPort) clear("extension_disconnected"); });
    status(true, "connected");
    return { ok: true };
  }
  function update(activityState) {
    const request = activityState?.sample_request;
    if (!port || !request || !ID.test(request.nonce || "") || request.client_id !== clientId || !isFresh(request.expires_at) || pendingNonce === request.nonce) return false;
    pendingNonce = request.nonce;
    try { port.postMessage({ type: "snapshot", nonce: request.nonce, client_id: clientId, expires_at: request.expires_at }); return true; }
    catch { pendingNonce = null; clear("extension_send_failed"); return false; }
  }
  function disconnect() {
    const old = port;
    port = null;
    pendingNonce = null;
    if (old?.disconnect) { try { old.disconnect(); } catch {} }
    if (old) status(false, "disconnected");
  }
  globalThis.EiloActivityBridge = { connect, update, disconnect };
})();
