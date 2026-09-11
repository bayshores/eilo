'use strict';

const core = globalThis.EiloActivityExtensionCore;
const allow = document.querySelector('#allow');
const exclude = document.querySelector('#exclude');
const removeAccess = document.querySelector('#remove-access');
const excludedHosts = document.querySelector('#excluded-hosts');
const statusElement = document.querySelector('#status');
const nativeStatusElement = document.querySelector('#native-status');
let browserAccess = false;

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
  allow.textContent = granted ? 'Open eïlo' : 'Allow Chrome';
  return granted;
}
function openEilo() {
  return chrome.tabs.create({ url: `${core.PAGE_ORIGIN}/activity-connect` });
}
function nativeStatusText(state) {
  if (state === 'ready' || state === 'shared') return 'Desktop transport ready.';
  if (state === 'connected') return 'Desktop transport is connecting.';
  if (state === 'disabled') return 'Desktop context is off.';
  if (state === 'disconnected')
    return 'Desktop helper disconnected. Page connection remains available.';
  if (state === 'browser-access-off') return 'Desktop transport waits for browser access.';
  if (state === 'error' || state === 'unavailable')
    return 'Desktop helper unavailable. Page connection remains available.';
  return '';
}
async function refreshNativeStatus() {
  if (!nativeStatusElement || typeof chrome.runtime?.sendMessage !== 'function') return;
  try {
    const status = await chrome.runtime.sendMessage({ type: 'eilo-native-status' });
    nativeStatusElement.textContent = nativeStatusText(status?.state);
  } catch {
    nativeStatusElement.textContent =
      'Desktop helper unavailable. Page connection remains available.';
  }
}
allow.addEventListener('click', async () => {
  allow.disabled = true;
  try {
    if (browserAccess) {
      await openEilo();
      return;
    }
    const changed = await chrome.permissions.request({ origins: core.BROWSER_ORIGINS });
    if (!changed) {
      statusElement.textContent = 'Chrome access was not allowed.';
      return;
    }
    browserAccess = true;
    allow.textContent = 'Open eïlo';
    await openEilo();
  } catch {
    statusElement.textContent = 'Chrome could not change browser access.';
  } finally {
    allow.disabled = false;
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
Promise.all([refreshAccessState(), readExcludedHosts(), refreshNativeStatus()])
  .then(([, hosts]) => renderExcludedHosts(hosts))
  .catch(() => {
    statusElement.textContent = 'Chrome settings are unavailable.';
  });
