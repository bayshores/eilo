const MAX_SPOKEN_CHARACTERS = 900;

const assistantMessage = (value) =>
  value &&
  value.role === 'assistant' &&
  typeof value.id === 'string' &&
  value.id.length > 0 &&
  typeof value.text === 'string' &&
  value.text.trim()
    ? value
    : null;

export function speechText(value, limit = MAX_SPOKEN_CHARACTERS) {
  const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!clean || clean.length <= limit) return clean;
  const boundary = clean.lastIndexOf('.', limit - 40);
  const cutoff = boundary > limit / 2 ? boundary + 1 : Math.max(1, limit - 3);
  return clean.slice(0, cutoff).trim() + '...';
}

// Existing chat history is seeded silently; hidden/background windows never speak.
export function createSpeechOutput({
  getPreferences = () => ({ spokenReplies: false, soundVolume: 0.5 }),
  speechSynthesis = globalThis.speechSynthesis,
  SpeechSynthesisUtterance = globalThis.SpeechSynthesisUtterance,
  isVisible = () => {
    const document = globalThis.document;
    return (
      document?.visibilityState !== 'hidden' &&
      (typeof document?.hasFocus !== 'function' || document.hasFocus())
    );
  },
  onState = () => {},
} = {}) {
  let conversationId = '';
  let known = new Set();
  let utterance = null;
  let generation = 0;
  let disposed = false;

  const preference = () => getPreferences?.() || {};
  const enabled = () => preference().spokenReplies === true;
  const available = () =>
    !disposed &&
    !!speechSynthesis &&
    typeof speechSynthesis.speak === 'function' &&
    typeof SpeechSynthesisUtterance === 'function';
  const volume = () => Math.max(0, Math.min(1, Number(preference().soundVolume) || 0));
  const canSpeak = () => available() && enabled() && volume() > 0 && isVisible();

  function finish(token) {
    if (token !== generation || !utterance) return;
    utterance = null;
    onState({ speaking: false });
  }

  function stop({ announce = true } = {}) {
    const hadVoice = !!utterance;
    generation++;
    utterance = null;
    try {
      speechSynthesis?.cancel?.();
    } catch {
      // System speech can disappear while the host window is closing.
    }
    if (hadVoice && announce) onState({ speaking: false });
  }

  function speak(message) {
    const text = speechText(message?.text);
    if (!text || !canSpeak()) return false;
    stop({ announce: false });
    const token = ++generation;
    const next = new SpeechSynthesisUtterance(text);
    next.volume = volume();
    next.rate = 1.02;
    next.pitch = 0.98;
    next.onend = () => finish(token);
    next.onerror = () => finish(token);
    utterance = next;
    onState({ speaking: true, id: message.id });
    try {
      speechSynthesis.speak(next);
      return true;
    } catch {
      finish(token);
      return false;
    }
  }

  function update(view) {
    const snapshot = view?.snapshot;
    const nextConversation =
      typeof snapshot?.conversation_id === 'string' ? snapshot.conversation_id : '';
    const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : [];
    if (!nextConversation) return;
    const assistant = messages.map(assistantMessage).filter(Boolean);
    if (nextConversation !== conversationId) {
      stop();
      conversationId = nextConversation;
      known = new Set(assistant.map((message) => message.id));
      return;
    }
    const fresh = assistant.filter((message) => !known.has(message.id));
    fresh.forEach((message) => known.add(message.id));
    if (fresh.length) speak(fresh.at(-1));
  }

  function sync() {
    if (!canSpeak()) stop();
    return { available: available(), speaking: !!utterance };
  }

  return {
    update,
    sync,
    stop,
    get speaking() {
      return !!utterance;
    },
    get available() {
      return available();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      stop({ announce: false });
    },
  };
}

export function mountSpeechOutput(container, options = {}) {
  const actions = container.querySelector('.speech-actions');
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'text-button speech-output-stop';
  stop.textContent = 'Stop voice';
  stop.hidden = true;
  stop.setAttribute('aria-label', 'Stop spoken reply');
  actions?.append(stop);
  const output = createSpeechOutput({
    ...options,
    onState: (state) => {
      stop.hidden = !state.speaking;
      options.onState?.(state);
    },
  });
  stop.addEventListener('click', () => output.stop());
  return {
    update: output.update,
    sync: output.sync,
    stop: output.stop,
    get speaking() {
      return output.speaking;
    },
    get available() {
      return output.available;
    },
    destroy() {
      output.destroy();
      stop.remove();
    },
  };
}
