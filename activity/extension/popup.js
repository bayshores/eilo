'use strict';

const core = globalThis.EiloActivityExtensionCore;
const allow = document.querySelector('#allow');
const retryConnection = document.querySelector('#retry-connection');
const connectionHelp = document.querySelector('#connection-help');
const permissionConsequence = document.querySelector('#permission-consequence');
const connectionHeading = document.querySelector('#connection-heading');
const exclude = document.querySelector('#exclude');
const removeAccess = document.querySelector('#remove-access');
const excludedHosts = document.querySelector('#excluded-hosts');
const statusElement = document.querySelector('#status');
const nativeStatusElement = document.querySelector('#native-status');
let browserAccess = false;
let refreshTimer = null;
let refreshAttempts = 0;
let refreshGeneration = 0;
const MAX_STATUS_REFRESHES = 8;

document.addEventListener(
  'pointerdown',
  () => {
    document.body.dataset.focusOrigin = 'pointer';
  },
  true,
);
document.addEventListener(
  'keydown',
  (event) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) delete document.body.dataset.focusOrigin;
  },
  true,
);

function storedHosts(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((host) => typeof host === 'string' && host.length > 0))].sort();
}
async function readExcludedHosts() {
  const value = await chrome.storage.local.get('excludedHosts');
  return storedHosts(value.excludedHosts);
}
async function writeExcludedHosts(hosts) {
  await chrome.storage.local.set({ excludedHosts: storedHosts(hosts) });
}
function renderExcludedHosts(hosts) {
  excludedHosts.replaceChildren();
  for (const host of hosts) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = host;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${host} from excluded sites`);
    remove.addEventListener('click', async () => {
      try {
        const remaining = (await readExcludedHosts()).filter((value) => value !== host);
        await writeExcludedHosts(remaining);
        renderExcludedHosts(remaining);
        statusElement.textContent = `${host} can be shared again.`;
      } catch {
        statusElement.textContent = 'Chrome could not update excluded sites.';
      }
    });
    item.append(name, remove);
    excludedHosts.append(item);
  }
  if (!hosts.length) {
    const item = document.createElement('li');
    item.textContent = 'No excluded sites.';
    excludedHosts.append(item);
  }
}
async function refreshAccessState() {
  const granted = await chrome.permissions.contains({ origins: core.BROWSER_ORIGINS });
  browserAccess = granted;
  return granted;
}
function isVerified(status) {
  return status?.handshake_verified === true && status?.connected === true;
}
function nativeStatusText(status) {
  const state = status?.state;
  if (state === 'shared' && isVerified(status)) return 'Recent activity was sent to felis.';
  if (isVerified(status)) return state === 'unshared' ? 'This page is not being shared.' : '';
  if (state === 'browser-access-off') return 'Chrome access is no longer available.';
  if (browserAccess && (state === 'error' || state === 'unavailable'))
    return 'The local connection is unavailable. Connection help can check what’s missing.';
  return '';
}
function renderConnectionState(status) {
  const pending = browserAccess && !isVerified(status);
  allow.hidden = browserAccess;
  retryConnection.hidden = !pending;
  connectionHelp.hidden = !pending;
  if (!browserAccess) {
    connectionHeading.textContent = 'Allow Chrome access';
    permissionConsequence.textContent =
      'Allow Chrome so felis can notice the site names and titles you choose to share.';
    return;
  }
  if (isVerified(status)) {
    connectionHeading.textContent =
      status?.state === 'disabled' ? 'Chrome is ready' : 'Chrome connected';
    permissionConsequence.textContent =
      status?.state === 'disabled'
        ? 'Activity is paused in felis.'
        : 'Return to the felis desktop app to continue.';
    statusElement.textContent = '';
    return;
  }
  connectionHeading.textContent = 'Chrome access is allowed';
  permissionConsequence.textContent = 'Keep the felis desktop app open, then retry the connection.';
}
async function refreshNativeStatus() {
  if (!nativeStatusElement || typeof chrome.runtime?.sendMessage !== 'function') return null;
  try {
    const status = await chrome.runtime.sendMessage({ type: 'eilo-native-status' });
    if (status?.state === 'browser-access-off') browserAccess = false;
    nativeStatusElement.textContent = nativeStatusText(status);
    renderConnectionState(status);
    return status;
  } catch {
    nativeStatusElement.textContent = browserAccess
      ? 'Chrome access is allowed. Connection to felis on this Mac is pending.'
      : '';
    renderConnectionState({ state: 'error' });
    return { state: 'error' };
  }
}
function stopStatusRefresh() {
  refreshGeneration++;
  if (refreshTimer !== null && typeof clearTimeout === 'function') clearTimeout(refreshTimer);
  refreshTimer = null;
}
function keepRefreshing(status) {
  return browserAccess && !isVerified(status);
}
function scheduleStatusRefresh() {
  stopStatusRefresh();
  refreshAttempts = 0;
  const generation = refreshGeneration;
  const refresh = async () => {
    if (
      generation !== refreshGeneration ||
      document.hidden ||
      refreshAttempts >= MAX_STATUS_REFRESHES
    )
      return;
    refreshAttempts++;
    const status = await refreshNativeStatus();
    if (
      generation === refreshGeneration &&
      !document.hidden &&
      keepRefreshing(status) &&
      refreshAttempts < MAX_STATUS_REFRESHES &&
      typeof setTimeout === 'function'
    )
      refreshTimer = setTimeout(refresh, 1500);
  };
  void refresh();
}
allow.addEventListener('click', async () => {
  allow.disabled = true;
  try {
    if (browserAccess) {
      return;
    }
    const changed = await chrome.permissions.request({ origins: core.BROWSER_ORIGINS });
    if (!changed) {
      statusElement.textContent = 'Chrome access was not allowed.';
      return;
    }
    browserAccess = true;
    await refreshAccessState();
    statusElement.textContent = 'Chrome allowed. Looking for felis on this Mac.';
    renderConnectionState({ state: 'connecting' });
    scheduleStatusRefresh();
  } catch {
    statusElement.textContent = 'Chrome could not change browser access.';
  } finally {
    allow.disabled = false;
  }
});
retryConnection.addEventListener('click', async () => {
  retryConnection.disabled = true;
  try {
    scheduleStatusRefresh();
  } catch {
    statusElement.textContent = 'Chrome could not check the felis connection.';
  } finally {
    retryConnection.disabled = false;
  }
});
exclude.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const origin = core.approvedOrigin(tab?.url);
    if (!origin) {
      statusElement.textContent = 'This site cannot be excluded.';
      return;
    }
    const host = new URL(origin).hostname;
    const hosts = storedHosts([...(await readExcludedHosts()), host]);
    await writeExcludedHosts(hosts);
    renderExcludedHosts(hosts);
    statusElement.textContent = `${host} and its subdomains are excluded.`;
  } catch {
    statusElement.textContent = 'Chrome could not exclude this site.';
  }
});
removeAccess.addEventListener('click', async () => {
  try {
    const changed = await chrome.permissions.remove({ origins: core.BROWSER_ORIGINS });
    await refreshAccessState();
    statusElement.textContent = browserAccess
      ? 'Browser access is still allowed.'
      : changed
        ? 'Browser access removed.'
        : 'Browser access is already removed.';
  } catch {
    statusElement.textContent = 'Chrome could not remove browser access.';
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopStatusRefresh();
  else if (browserAccess) scheduleStatusRefresh();
});
globalThis.addEventListener?.('pagehide', stopStatusRefresh);
Promise.all([refreshAccessState(), readExcludedHosts(), refreshNativeStatus()])
  .then(([granted, hosts, status]) => {
    renderExcludedHosts(hosts);
    nativeStatusElement.textContent = nativeStatusText(status);
    renderConnectionState(status);
    if (granted && keepRefreshing(status)) scheduleStatusRefresh();
  })
  .catch(() => {
    statusElement.textContent = 'Chrome settings are unavailable.';
  });
