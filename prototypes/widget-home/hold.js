/** Timer-injectable, DOM-free hold gesture state machine. */
export function createHoldGesture({
  onActivate,
  onPending = () => {},
  delay = 420,
  tolerance = 8,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof onActivate !== 'function') throw new TypeError('onActivate must be a function');
  let candidate = null;
  let timer = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    const hadCandidate = candidate !== null;
    timer = null;
    candidate = null;
    if (hadCandidate) onPending(null);
  };

  return {
    start({ id, pointerId, x, y }) {
      cancel();
      candidate = { id, pointerId, x, y };
      const pending = candidate;
      onPending(pending);
      timer = setTimer(() => {
        if (candidate !== pending) return;
        timer = null;
        candidate = null;
        onPending(null);
        onActivate(pending);
      }, delay);
    },
    move({ pointerId, x, y }) {
      if (!candidate) return;
      if (pointerId !== candidate.pointerId || !Number.isFinite(x) || !Number.isFinite(y) ||
        Math.hypot(x - candidate.x, y - candidate.y) > tolerance) cancel();
    },
    cancel,
  };
}
