import { createSpeechCapture } from './capture.js';

export function mountSpeechInput(container, client) {
  const controls = document.createElement('div');
  controls.className = 'speech-controls';
  controls.innerHTML =
    '<div class="speech-actions"><button type="button" class="speech-mic" aria-label="Start recording" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg><span class="speech-button-label">Speak</span></button><label class="sr-only" for="speech-mode">Microphone mode</label><select id="speech-mode" aria-label="Microphone mode"><option value="toggle">Click to toggle</option><option value="hold">Hold to talk</option></select><div class="speech-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><button type="button" class="text-button speech-cancel" hidden>Cancel</button></div><p class="speech-status" role="status">Speech is transcribed on this Mac. Nothing is sent until you choose Send.</p>';
  container.append(controls);
  const send = container.querySelector('.live-send'),
    footer = container.querySelector('.live-composer-footer');
  if (send) controls.querySelector('.speech-actions').append(send);
  if (footer) container.append(footer);
  const mic = controls.querySelector('.speech-mic'),
    label = controls.querySelector('.speech-button-label'),
    mode = controls.querySelector('select'),
    status = controls.querySelector('.speech-status'),
    cancel = controls.querySelector('.speech-cancel');
  const method = document.createElement('div');
  method.className = 'speech-method';
  mic.before(method);
  method.append(mic, mode);
  const caret = document.createElement('span');
  caret.className = 'speech-mode-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>';
  method.append(caret);
  mode.title = 'Choose click-to-toggle or hold-to-talk';
  let heldPointer = null,
    heldKey = null,
    disposed = false,
    available = false,
    levels = [0, 0, 0, 0, 0];
  try {
    mode.value = localStorage.getItem('eilo:speech-mode') === 'hold' ? 'hold' : 'toggle';
  } catch {
    /* Remembering the selected input mode is optional. */
  }
  function stateChanged({ state, message }) {
    if (disposed) return;
    const recording = state === 'recording',
      busy = ['requesting', 'stopping', 'transcribing'].includes(state);
    mic.disabled = !available || state === 'stopping' || state === 'transcribing';
    mode.disabled = recording || busy;
    mic.setAttribute('aria-pressed', String(recording));
    controls.dataset.state = state;
    label.textContent = recording
      ? mode.value === 'hold'
        ? 'Release to finish'
        : 'Stop'
      : state === 'requesting'
        ? 'Cancel'
        : mode.value === 'hold'
          ? 'Hold to talk'
          : 'Speak';
    mic.setAttribute(
      'aria-label',
      recording
        ? mode.value === 'hold'
          ? 'Recording. Release to transcribe.'
          : 'Stop recording'
        : state === 'requesting'
          ? 'Cancel microphone request'
          : mode.value === 'hold'
            ? 'Hold to talk. Hold Space or Enter while this button is focused.'
            : 'Start recording',
    );
    cancel.hidden = !recording && !busy;
    status.textContent =
      message ||
      (state === 'recording'
        ? 'Listening…'
        : state === 'requesting'
          ? 'Allow microphone access to begin.'
          : state === 'transcribing'
            ? 'Transcribing on this Mac…'
            : state === 'stopping'
              ? 'Finishing the recording…'
              : mode.value === 'hold'
                ? 'Hold the button, Space or Enter to speak. Release to transcribe.'
                : 'Transcribed locally. Review your words before sending.');
  }
  const capture = createSpeechCapture({
    onState: stateChanged,
    onLevel: (value) => {
      levels.push(Math.max(0, Math.min(1, value * 7)));
      levels.shift();
      controls
        .querySelectorAll('.speech-wave i')
        .forEach((bar, i) => bar.style.setProperty('--level', String(levels[i])));
    },
    onTranscript: (text) => {
      const draft = client.view.draft;
      client.setDraft(draft + (draft && !/\s$/.test(draft) ? '\n' : '') + text);
      const input = container.querySelector('.live-input');
      input?.focus();
    },
  });
  mic.disabled = true;
  fetch('/api/speech', { headers: { 'X-Eilo-Client': 'local-chat' }, cache: 'no-store' })
    .then((r) => r.json())
    .then((value) => {
      if (disposed) return;
      available = value.ready === true;
      if (available) stateChanged({ state: 'idle' });
      else status.textContent = 'Local speech setup is unavailable. You can still type.';
    })
    .catch(() => {
      if (!disposed) status.textContent = 'Could not check local speech. You can still type.';
    });
  mode.addEventListener('change', () => {
    try {
      localStorage.setItem('eilo:speech-mode', mode.value);
    } catch {
      /* Browser storage may be unavailable in private or embedded contexts. */
    }
    stateChanged({ state: capture.state });
  });
  mic.addEventListener('click', () => {
    if (mode.value === 'toggle')
      capture.state === 'recording' || capture.state === 'requesting'
        ? capture.stop()
        : capture.start();
  });
  mic.addEventListener('pointerdown', (event) => {
    if (mode.value !== 'hold' || event.button !== 0 || !event.isPrimary || mic.disabled) return;
    event.preventDefault();
    mic.focus();
    heldPointer = event.pointerId;
    mic.setPointerCapture(event.pointerId);
    capture.start();
  });
  mic.addEventListener('pointerup', (event) => {
    if (heldPointer !== event.pointerId) return;
    heldPointer = null;
    capture.stop();
  });
  const cancelHold = () => {
    if (heldPointer !== null || heldKey !== null) {
      heldPointer = null;
      heldKey = null;
      capture.stop({ cancel: true });
    }
  };
  mic.addEventListener('pointercancel', cancelHold);
  mic.addEventListener('lostpointercapture', cancelHold);
  mic.addEventListener('blur', cancelHold);
  mic.addEventListener('keydown', (event) => {
    if (![' ', 'Enter'].includes(event.key)) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    if (mode.value === 'hold') {
      event.preventDefault();
      heldKey = event.key;
      capture.start();
    }
  });
  mic.addEventListener('keyup', (event) => {
    if (heldKey !== event.key) return;
    event.preventDefault();
    heldKey = null;
    capture.stop();
  });
  cancel.addEventListener('click', () => capture.stop({ cancel: true }));
  const escape = (event) => {
    if (event.key === 'Escape' && !['idle', 'error'].includes(capture.state)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      heldKey = null;
      heldPointer = null;
      capture.stop({ cancel: true });
    }
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') capture.stop({ cancel: true });
  };
  const blur = () => {
    if (mode.value === 'hold') cancelHold();
  };
  document.addEventListener('keydown', escape, true);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('blur', blur);
  return {
    cancel() {
      heldPointer = null;
      heldKey = null;
      capture.stop({ cancel: true });
    },
    dispose() {
      disposed = true;
      heldPointer = null;
      heldKey = null;
      capture.stop({ cancel: true });
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
    },
  };
}
