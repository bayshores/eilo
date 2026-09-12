/** Present actual conversation/capture state without starting work or a microphone. */
export function orbState(view = {}, speech = 'idle') {
  if (speech === 'recording') return 'listening';
  if (['requesting', 'stopping', 'transcribing'].includes(speech)) return 'processing';
  if (view.connection === 'loading') return 'connecting';
  if (view.connection === 'offline') return 'offline';
  if (view.error || view.snapshot?.status === 'error' || view.snapshot?.recovery_pending)
    return 'attention';
  if (
    view.sending ||
    view.snapshot?.status === 'busy' ||
    view.snapshot?.reply_stream?.status === 'writing'
  )
    return 'thinking';
  return 'idle';
}

const LABELS = {
  idle: 'eïlo',
  listening: 'eïlo · Listening',
  processing: 'eïlo · Preparing your message',
  connecting: 'eïlo · Connecting',
  offline: 'eïlo · Offline',
  attention: 'eïlo · Needs attention',
  thinking: 'eïlo · Replying',
};

export function mountOrb(
  container,
  { detail = 14, interactive = true, loadRenderer = () => import('./renderer.js') } = {},
) {
  container.classList.add('agent-orb');
  container.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('span');
  fallback.className = 'agent-orb-fallback';
  container.append(fallback);
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let renderer = null,
    loading = false,
    failed = false,
    disposed = false,
    intersecting = !globalThis.IntersectionObserver,
    paused = false,
    state = 'idle',
    amplitude = 0,
    color = '#fac399',
    reducedMotion = false;
  function options() {
    return {
      color,
      reducedMotion,
      paused: paused || !intersecting || document.visibilityState === 'hidden',
      amplitude: state === 'listening' ? amplitude : 0,
      busy: ['thinking', 'processing', 'connecting'].includes(state),
    };
  }
  function sync() {
    if (disposed) return;
    const next = options();
    renderer?.update(next);
    if (renderer || loading || failed || next.paused) return;
    loading = true;
    // Defer the Three.js parser and GPU context until this surface is visible.
    loadRenderer()
      .then(({ createVoiceOrb }) => {
        if (disposed || options().paused) return;
        renderer = createVoiceOrb(container, { detail, interactive });
        renderer.update(options());
        container.dataset.orbRenderer = 'webgl';
      })
      .catch(() => {
        if (disposed) return;
        failed = true;
        container.dataset.orbRenderer = 'fallback';
      })
      .finally(() => {
        loading = false;
      });
  }
  function appearanceChanged() {
    color = getComputedStyle(container).getPropertyValue('--peach').trim() || '#fac399';
    reducedMotion = media.matches || document.body.classList.contains('reduce-motion');
    sync();
  }
  const appearance = new MutationObserver(appearanceChanged);
  appearance.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  appearance.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const visibility = globalThis.IntersectionObserver
    ? new IntersectionObserver(([entry]) => {
        intersecting =
          entry.isIntersecting &&
          entry.intersectionRect.width > 0 &&
          entry.intersectionRect.height > 0;
        sync();
      })
    : null;
  visibility?.observe(container);
  const lost = () => {
    container.dataset.orbRenderer = 'fallback';
  };
  const restored = () => {
    container.dataset.orbRenderer = 'webgl';
    sync();
  };
  container.addEventListener('webglcontextlost', lost, true);
  container.addEventListener('webglcontextrestored', restored, true);
  document.addEventListener('visibilitychange', sync);
  media.addEventListener('change', appearanceChanged);
  appearanceChanged();
  return {
    update({ state: nextState = state, amplitude: nextAmplitude = amplitude } = {}) {
      if (disposed) return;
      state = Object.hasOwn(LABELS, nextState) ? nextState : 'idle';
      amplitude = Number.isFinite(nextAmplitude) ? Math.max(0, Math.min(1, nextAmplitude)) : 0;
      container.dataset.orbState = state;
      container.title = LABELS[state];
      sync();
    },
    pause(value) {
      paused = !!value;
      sync();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      visibility?.disconnect();
      appearance.disconnect();
      document.removeEventListener('visibilitychange', sync);
      media.removeEventListener('change', appearanceChanged);
      container.removeEventListener('webglcontextlost', lost, true);
      container.removeEventListener('webglcontextrestored', restored, true);
      renderer?.destroy();
      fallback.remove();
      delete container.dataset.orbRenderer;
    },
  };
}
