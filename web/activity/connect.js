import { createHomeClient } from '/home/chat/client.js';
import { createActivitySession } from '/home/activity/session.js';
import '/home/styles/focus.js';

const $ = (selector) => document.querySelector(selector);
const elements = {
  connect: $('#connect'),
  setup: $('#extension-setup'),
  reload: $('#reload-page'),
  pause: $('#pause'),
  off: $('#turn-off'),
  status: $('#connection-status'),
  detail: $('#connection-detail'),
  consent: $('#connection-consent'),
  pill: $('#connection-state'),
  feedback: $('#action-feedback'),
};
const client = createHomeClient({ storage: null });
const session = createActivitySession(client);
let current = null,
  running = false,
  readiness = null;

function activityState(view) {
  return view?.snapshot?.accountability?.activity || { state: 'off', helper_available: false };
}
function render(view) {
  current = view;
  const activity = activityState(view),
    capable = session.capable(),
    online = view.connection === 'connected';
  const state = activity.state || 'off';
  const helperReady = activity.helper_available === true;
  // Chrome does not expose external-extension messaging when no matching
  // extension is installed/enabled. Its absence does not identify the browser.
  const needsExtension =
    state !== 'active' &&
    (!capable || ['chrome_unavailable', 'extension_disconnected'].includes(readiness?.reason));
  const needsPermission = state !== 'active' && readiness?.reason === 'browser_permission_required';
  const needsUpdate = state !== 'active' && readiness?.reason === 'extension_update_required';
  const checking = capable && readiness === null && state !== 'active';
  const unavailable = !online
    ? 'Connecting to your local workspace…'
    : needsExtension
      ? 'The Chrome extension is not detected.'
      : needsPermission
        ? 'Allow browser access.'
        : needsUpdate
          ? 'Extension update needed.'
          : checking
            ? 'Checking the extension…'
            : !helperReady
              ? 'The local activity helper is unavailable. Return to eïlo and try again.'
              : null;
  elements.pill.textContent = !online
    ? 'Connecting'
    : state === 'active'
      ? 'Sharing'
      : needsExtension || needsPermission || needsUpdate
        ? 'Setup needed'
        : checking
          ? 'Checking'
          : state === 'paused'
            ? 'Paused'
            : helperReady
              ? 'Ready'
              : 'Unavailable';
  elements.pill.dataset.state = !online
    ? 'idle'
    : state === 'active'
      ? 'active'
      : state === 'paused'
        ? 'paused'
        : unavailable
          ? 'error'
          : 'idle';
  elements.status.textContent =
    unavailable ||
    (state === 'active'
      ? session.owns()
        ? 'Chrome activity is connected in this tab.'
        : 'Chrome activity is sharing from another tab.'
      : state === 'paused'
        ? 'Sharing is paused.'
        : 'Ready when you are.');
  elements.detail.textContent = !online
    ? 'Waiting for eïlo to confirm the current sharing state.'
    : state === 'active'
      ? 'Keep the connected Chrome tab open while sharing. Closing it stops sharing.'
      : needsExtension
        ? 'Install or enable the eïlo extension, then reload this page.'
        : needsPermission
          ? 'Open eïlo in Chrome’s extensions menu and choose Allow Chrome.'
          : needsUpdate
            ? 'Reload eïlo in Chrome’s extensions, then reload this page.'
            : checking
              ? ''
              : state === 'paused'
                ? 'Reconnect when you’re ready.'
                : '';
  const ready = readiness?.ok === true;
  elements.detail.hidden = !elements.detail.textContent;
  elements.consent.hidden = !ready || state === 'active' || !online;
  elements.setup.hidden = !needsExtension;
  elements.reload.hidden = !(needsExtension || needsPermission || needsUpdate);
  elements.connect.hidden = !ready || state === 'active';
  elements.connect.disabled = running || !online || !ready || !helperReady || state === 'active';
  elements.pause.hidden = state !== 'active';
  elements.off.hidden = state === 'off';
  elements.pause.disabled = running || !online || state !== 'active';
  elements.off.disabled = running || !online || state === 'off';
}
async function control(action) {
  if (running) return;
  running = true;
  elements.feedback.textContent = '';
  render(current);
  try {
    await session.control(action);
  } catch (error) {
    elements.feedback.textContent = error?.message || 'The Chrome connection could not be changed.';
  } finally {
    running = false;
    render(client.view);
  }
}

elements.connect.addEventListener('click', () => control('enable'));
elements.pause.addEventListener('click', () => control('pause'));
elements.off.addEventListener('click', () => control('off'));
elements.reload.addEventListener('click', () => location.reload());
client.subscribe((view) => {
  session.update(view);
  render(view);
});
client.start();
session.check().then((result) => {
  readiness = result;
  render(client.view);
});
window.addEventListener('pagehide', () => client.stop());
