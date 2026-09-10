import { createHomeClient } from '/home/home-client.js';
import { createActivitySession } from '/home/activity-session.js';

const $ = selector => document.querySelector(selector);
const elements = { connect:$('#connect'), pause:$('#pause'), off:$('#turn-off'), status:$('#connection-status'), detail:$('#connection-detail'), pill:$('#connection-state'), feedback:$('#action-feedback') };
const client = createHomeClient({ storage:null });
const session = createActivitySession(client);
let current = null, running = false;

function activityState(view) { return view?.snapshot?.accountability?.activity || { state:'off', helper_available:false }; }
function render(view) {
  current = view;
  const activity = activityState(view), capable = session.capable(), online = view.connection === 'connected';
  const state = activity.state || 'off';
  const helperReady = activity.helper_available === true;
  const unavailable = !capable ? 'Open this page in Chrome to connect an approved extension.'
    : !helperReady ? 'The local activity helper is unavailable. Check eïlo Home or try again shortly.' : null;
  elements.pill.textContent = state === 'active' ? 'Sharing' : state === 'paused' ? 'Paused' : 'Idle';
  elements.pill.dataset.state = state === 'active' ? 'active' : state === 'paused' ? 'paused' : unavailable ? 'error' : 'idle';
  elements.status.textContent = unavailable || (state === 'active' ? 'Chrome activity is connected.' : state === 'paused' ? 'Sharing is paused.' : online ? 'Ready when you are.' : 'Connecting to your local workspace…');
  elements.detail.textContent = state === 'active' ? 'eïlo can request a fresh approved-tab signal only while this tab remains open.'
    : state === 'paused' ? 'Nothing is currently requested from Chrome. You can reconnect when you choose.'
    : 'Nothing is shared until you choose Connect.';
  elements.connect.disabled = running || !online || !capable || !helperReady || state === 'active';
  elements.pause.disabled = running || state !== 'active';
  elements.off.disabled = running || state === 'off';
}
async function control(action) {
  if (running) return;
  running = true; elements.feedback.textContent = ''; render(current);
  try { await session.control(action); }
  catch (error) { elements.feedback.textContent = error?.message || 'The Chrome connection could not be changed.'; }
  finally { running = false; render(client.view); }
}

elements.connect.addEventListener('click', () => control('enable'));
elements.pause.addEventListener('click', () => control('pause'));
elements.off.addEventListener('click', () => control('off'));
client.subscribe(view => { session.update(view); render(view); });
client.start();
window.addEventListener('pagehide', () => client.stop());
