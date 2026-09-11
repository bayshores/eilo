'use strict';
importScripts('core.js');
importScripts('native.js');

const core = globalThis.EiloActivityExtensionCore;
const nativeApi = globalThis.EiloNativeContext;
let privacyRevision = 0;
let nativeContext = null;
let nativeState = 'unavailable';
chrome.permissions.onRemoved.addListener(() => {
  privacyRevision++;
  nativeContext?.disconnect();
  nativeState = 'browser-access-off';
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.hasOwn(changes, 'excludedHosts')) {
    privacyRevision++;
    nativeContext?.invalidatePrivacy();
  }
});

function nativeStatus() {
  return { state: nativeState, ...(nativeContext?.status?.() || {}) };
}
function publicNativeStatus() {
  const status = nativeStatus();
  return {
    state: status.state,
    connected: status.connected === true,
    handshake_verified: status.handshake_verified === true,
    enabled: status.enabled === true,
  };
}
async function refreshNativeStatus() {
  if (!nativeApi) {
    nativeState = 'unavailable';
    return nativeStatus();
  }
  try {
    if (!(await hasGrant())) {
      nativeContext?.disconnect();
      nativeState = 'browser-access-off';
      return nativeStatus();
    }
    if (!nativeContext)
      nativeContext = nativeApi.createNativeContext({
        chrome,
        core,
        onStatus: (status) => {
          nativeState = status.state;
        },
      });
    nativeContext.connect();
  } catch {
    nativeState = 'error';
  }
  return nativeStatus();
}
function connectNativeWhenAllowed() {
  void refreshNativeStatus();
}
chrome.permissions.onAdded?.addListener(connectNativeWhenAllowed);
chrome.runtime.onStartup?.addListener(connectNativeWhenAllowed);
chrome.runtime.onInstalled?.addListener((details) => {
  if (details?.reason !== 'install') {
    connectNativeWhenAllowed();
    return;
  }
  // A fresh install needs a discoverable setup surface. Opening it does not
  // request Chrome access, connect a native host, or inspect a browser tab.
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: true }).catch(() => {
    /* Chrome can close before this first-install handoff completes. */
  });
});
chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'eilo-native-status' || Object.keys(message).length !== 1) return undefined;
  void refreshNativeStatus().then(sendResponse, () => sendResponse(nativeStatus()));
  return true;
});
connectNativeWhenAllowed();
// A disconnected native port does not keep the service worker alive. Retrying
// when Chrome regains focus reconnects after the app starts, without alarms.
chrome.windows.onFocusChanged?.addListener(connectNativeWhenAllowed);

function validExternalMessage(message, type) {
  return (
    message &&
    typeof message === 'object' &&
    Object.keys(message).length === 1 &&
    message.type === type
  );
}
chrome.runtime.onMessageExternal?.addListener((message, sender, sendResponse) => {
  if (!core.senderIsEiloPage(sender)) return undefined;
  if (validExternalMessage(message, 'eilo-open-setup')) {
    // This is a user-initiated handoff from eïlo, not a permission or policy
    // command. The extension's own popup is reused as the setup surface.
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html'), active: true }).then(
      () => sendResponse({ opened: true }),
      () => sendResponse({ opened: false }),
    );
    return true;
  }
  if (validExternalMessage(message, 'eilo-setup-status')) {
    void hasGrant().then(
      (granted) => sendResponse({ installed: true, granted, native: publicNativeStatus() }),
      () => sendResponse({ installed: true, granted: false, native: publicNativeStatus() }),
    );
    return true;
  }
  return undefined;
});

function disconnected(port) {
  return !port || port.__eiloDisconnected === true;
}
function post(port, payload) {
  if (!disconnected(port)) {
    try {
      port.postMessage(payload);
    } catch {
      /* port closed */
    }
  }
}
async function hasGrant() {
  // A previous per-site installation does not imply consent to the new scope.
  return chrome.permissions.contains({ origins: core.BROWSER_ORIGINS });
}
async function permitsOrigin(origin, isStillAllowed) {
  const preferences = await chrome.storage.local.get('excludedHosts');
  return (
    isStillAllowed() && !core.isExcluded(origin, preferences.excludedHosts) && (await hasGrant())
  );
}
function usableTab(tab, windowId) {
  return Boolean(
    tab &&
    tab.incognito !== true &&
    tab.active === true &&
    tab.discarded !== true &&
    tab.hidden !== true &&
    tab.windowId === windowId &&
    (tab.status === undefined || tab.status === 'complete'),
  );
}
async function activeSnapshot(leaseIsActive) {
  const revision = privacyRevision;
  const isStillAllowed = () => leaseIsActive() && privacyRevision === revision;
  if (!isStillAllowed()) return null;
  if (!(await hasGrant())) return { observation: { kind: 'activity_unshared' } };
  if (!isStillAllowed()) return null;
  const initialWindow = await chrome.windows.getLastFocused();
  if (!isStillAllowed()) return null;
  if (!initialWindow || initialWindow.focused !== true) return null;
  const first = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!isStillAllowed() || !usableTab(first, initialWindow.id)) return null;
  const origin = core.approvedOrigin(first.url);
  if (!origin) return { observation: { kind: 'activity_unshared' } };
  if (!isStillAllowed()) return null;
  if (!(await permitsOrigin(origin, isStillAllowed)))
    return { observation: { kind: 'activity_unshared' } };
  if (!isStillAllowed()) return null;
  const finalWindow = await chrome.windows.getLastFocused();
  if (!isStillAllowed()) return null;
  const second = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (
    !isStillAllowed() ||
    !finalWindow ||
    finalWindow.focused !== true ||
    finalWindow.id !== initialWindow.id ||
    !usableTab(second, finalWindow.id) ||
    !core.equivalentTab(first, second)
  )
    return null;
  // Recheck after the Chrome reads so revocation or an exclusion also wins over
  // a sample already in flight.
  if (!(await permitsOrigin(origin, isStillAllowed)))
    return { observation: { kind: 'activity_unshared' } };
  if (!isStillAllowed()) return null;
  return { observation: core.observationForTab(second) };
}

// Test-only exposure is absent in normal extension execution.
if (globalThis.__EILO_ACTIVITY_TEST__)
  globalThis.__EILO_ACTIVITY_TEST__.activeSnapshot = activeSnapshot;

chrome.runtime.onConnectExternal.addListener((port) => {
  if (!port || port.name !== core.PORT_NAME || !core.senderIsEiloPage(port.sender)) {
    try {
      port.disconnect();
    } catch {
      /* The rejected external port may already be closed. */
    }
    return;
  }
  port.__eiloDisconnected = false;
  // Presence/permission handshake only; opening a port never reads browser tabs.
  hasGrant()
    .then((granted) => post(port, { type: 'ready', protocol: 2, granted }))
    .catch(() => post(port, { type: 'ready', protocol: 2, granted: false }));
  let inflightNonce = null;
  const recentNonces = new Map();
  const pruneRecent = (now) => {
    for (const [nonce, seenAt] of recentNonces)
      if (now - seenAt > 12000) recentNonces.delete(nonce);
    while (recentNonces.size > 32) recentNonces.delete(recentNonces.keys().next().value);
  };
  port.onDisconnect.addListener(() => {
    port.__eiloDisconnected = true;
  });
  port.onMessage.addListener(async (message) => {
    const now = Date.now();
    pruneRecent(now);
    if (
      disconnected(port) ||
      !core.validRequest(message, now) ||
      inflightNonce ||
      recentNonces.has(message.nonce)
    )
      return;
    recentNonces.set(message.nonce, now);
    inflightNonce = message.nonce;
    const stillAllowed = () => !disconnected(port) && core.validRequest(message);
    let snapshot;
    try {
      snapshot = await activeSnapshot(stillAllowed);
    } catch {
      snapshot = null;
    } finally {
      if (inflightNonce === message.nonce) inflightNonce = null;
    }
    if (!stillAllowed() || !snapshot) return;
    post(port, { type: 'observation', nonce: message.nonce, observation: snapshot.observation });
  });
});
