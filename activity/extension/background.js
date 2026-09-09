"use strict";
importScripts("core.js");

const core = globalThis.EiloActivityExtensionCore;

function disconnected(port) { return !port || port.__eiloDisconnected === true; }
function post(port, payload) { if (!disconnected(port)) { try { port.postMessage(payload); } catch { /* port closed */ } } }
async function hasGrant(origin) {
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}
function usableTab(tab, windowId) {
  return Boolean(tab && tab.active === true && tab.discarded !== true && tab.hidden !== true && tab.windowId === windowId && (tab.status === undefined || tab.status === "complete"));
}
async function activeSnapshot(isStillAllowed) {
  if (!isStillAllowed()) return null;
  const initialWindow = await chrome.windows.getLastFocused();
  if (!isStillAllowed()) return null;
  if (!initialWindow || initialWindow.focused !== true) return null;
  const first = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!isStillAllowed() || !usableTab(first, initialWindow.id)) return null;
  const origin = core.approvedOrigin(first.url);
  if (!origin) return { observation: { kind: "activity_unshared" } };
  if (!isStillAllowed()) return null;
  if (!(await hasGrant(origin))) return { observation: { kind: "activity_unshared" } };
  if (!isStillAllowed()) return null;
  const finalWindow = await chrome.windows.getLastFocused();
  if (!isStillAllowed()) return null;
  const second = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!isStillAllowed() || !finalWindow || finalWindow.focused !== true || finalWindow.id !== initialWindow.id || !usableTab(second, finalWindow.id) || !core.equivalentTab(first, second)) return null;
  return { observation: core.observationForTab(second) };
}

// Test-only exposure is absent in normal extension execution.
if (globalThis.__EILO_ACTIVITY_TEST__) globalThis.__EILO_ACTIVITY_TEST__.activeSnapshot = activeSnapshot;

chrome.runtime.onConnectExternal.addListener((port) => {
  if (!port || port.name !== core.PORT_NAME || !core.senderIsEiloPage(port.sender)) { try { port.disconnect(); } catch {} return; }
  port.__eiloDisconnected = false;
  let inflightNonce = null;
  const recentNonces = new Map();
  const pruneRecent = (now) => {
    for (const [nonce, seenAt] of recentNonces) if (now - seenAt > 12000) recentNonces.delete(nonce);
    while (recentNonces.size > 32) recentNonces.delete(recentNonces.keys().next().value);
  };
  port.onDisconnect.addListener(() => { port.__eiloDisconnected = true; });
  port.onMessage.addListener(async (message) => {
    const now = Date.now();
    pruneRecent(now);
    if (disconnected(port) || !core.validRequest(message, now) || inflightNonce || recentNonces.has(message.nonce)) return;
    recentNonces.set(message.nonce, now);
    inflightNonce = message.nonce;
    const stillAllowed = () => !disconnected(port) && core.validRequest(message);
    let snapshot;
    try { snapshot = await activeSnapshot(stillAllowed); } catch { snapshot = null; }
    finally { if (inflightNonce === message.nonce) inflightNonce = null; }
    if (!stillAllowed() || !snapshot) return;
    post(port, { type: "observation", nonce: message.nonce, observation: snapshot.observation });
  });
});
