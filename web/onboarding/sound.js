const CUES = {
  workspace: [
    [293.66, 0, 0.09],
    [440, 0.06, 0.11],
  ],
  confirmed: [
    [392, 0, 0.08],
    [587.33, 0.055, 0.12],
  ],
  ready: [
    [523.25, 0, 0.08],
    [659.25, 0.05, 0.1],
  ],
  sent: [[349.23, 0, 0.055]],
  completed: [
    [523.25, 0, 0.07],
    [783.99, 0.045, 0.11],
  ],
};

const MAX_ACTIVE_VOICES = 4;

/**
 * Prepares optional interface cues during a user gesture, then plays them only
 * after an acknowledged result. It has no access to microphones or system audio.
 */
export function createInterfaceSound({
  enabled = () => false,
  muted = () => false,
  volume = () => 0.5,
  AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext,
  document = globalThis.document,
  isUserGesture = () => globalThis.navigator?.userActivation?.isActive ?? true,
} = {}) {
  let context = null;
  let disposed = false;
  let generation = 0;
  let prepared = false;
  const active = new Set();
  const cues = new Map();

  const hidden = () => document?.visibilityState === 'hidden';
  const level = () => Math.min(1, Math.max(0, Number(volume()) || 0));
  const allowed = () => !disposed && enabled() && !muted() && !hidden() && level() > 0;

  function remove(voice) {
    if (!active.delete(voice)) return;
    const group = cues.get(voice.kind);
    group?.delete(voice);
    if (group?.size === 0) cues.delete(voice.kind);
    try {
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    } catch {
      // The browser may have already released an ended voice.
    }
  }

  function stopVoice(voice) {
    try {
      voice.oscillator.stop();
    } catch {
      // Stopping an already-ended oscillator is harmless.
    }
    remove(voice);
  }

  function stopKind(kind) {
    for (const voice of [...(cues.get(kind) || [])]) stopVoice(voice);
  }

  function stop() {
    generation++;
    prepared = false;
    for (const voice of [...active]) stopVoice(voice);
  }

  function getContext() {
    if (!AudioContext) return null;
    if (context?.state === 'closed') {
      context = null;
      prepared = false;
    }
    if (context) return context;
    try {
      context = new AudioContext();
      return context;
    } catch {
      return null;
    }
  }

  function tone(kind, frequency, offset, duration) {
    while (active.size >= MAX_ACTIVE_VOICES) stopVoice(active.values().next().value);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + offset;
    const end = start + duration;
    const voice = { kind, oscillator, gain };
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    // Keep confirmation tones audible without competing with speech or media.
    // The live preference remains the final cap.
    gain.gain.exponentialRampToValueAtTime(0.05 * level(), start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    active.add(voice);
    if (!cues.has(kind)) cues.set(kind, new Set());
    cues.get(kind).add(voice);
    oscillator.onended = () => remove(voice);
    oscillator.start(start);
    oscillator.stop(end);
  }

  function begin(kind, token) {
    if (token !== generation || !prepared || !allowed() || context?.state !== 'running') return;
    stopKind(kind);
    for (const [frequency, offset, duration] of CUES[kind]) tone(kind, frequency, offset, duration);
  }

  function prepare() {
    if (!allowed() || !isUserGesture()) {
      if (!allowed()) stop();
      return false;
    }
    const nextContext = getContext();
    if (!nextContext) return false;
    const token = ++generation;
    const markReady = () => {
      if (token === generation && allowed() && nextContext.state === 'running') prepared = true;
    };
    try {
      const resumed = nextContext.state === 'suspended' ? nextContext.resume?.() : null;
      if (resumed?.then) resumed.then(markReady).catch(() => {});
      else markReady();
      return true;
    } catch {
      return false;
    }
  }

  function play(kind) {
    if (!allowed()) {
      stop();
      return false;
    }
    if (!CUES[kind] || !prepared || context?.state !== 'running') return false;
    const token = ++generation;
    begin(kind, token);
    return true;
  }

  async function playTest() {
    if (!allowed() || !isUserGesture()) {
      if (!allowed()) stop();
      return false;
    }
    const nextContext = getContext();
    if (!nextContext) return false;
    const token = ++generation;
    prepared = false;
    try {
      await nextContext.resume?.();
    } catch {
      return false;
    }
    if (
      token !== generation ||
      !allowed() ||
      context !== nextContext ||
      nextContext.state !== 'running'
    )
      return false;
    prepared = true;
    const playToken = ++generation;
    begin('ready', playToken);
    return true;
  }

  // Browser storage owns these preferences. Its subscriber calls sync after a
  // change so an active cue cannot outlive a mute or opt-out.
  function sync() {
    if (!allowed()) stop();
    return allowed();
  }

  const visibilityChanged = () => {
    if (hidden()) stop();
  };
  document?.addEventListener?.('visibilitychange', visibilityChanged);

  return {
    prepare,
    play,
    playTest,
    confirm() {
      return play('confirmed');
    },
    sent() {
      return play('sent');
    },
    complete() {
      return play('completed');
    },
    sync,
    stop,
    destroy() {
      if (disposed) return;
      disposed = true;
      stop();
      document?.removeEventListener?.('visibilitychange', visibilityChanged);
      context?.close?.().catch?.(() => {});
      context = null;
    },
  };
}
