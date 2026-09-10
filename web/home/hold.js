/** @typedef {{ id: string, pointerId: number, x: number, y: number }} HoldCandidate */
/** @typedef {{ onActivate?: (candidate: HoldCandidate) => void, onPending?: (candidate: HoldCandidate | null) => void, delay?: number, tolerance?: number, setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>, clearTimer?: (timer: ReturnType<typeof setTimeout>) => void }} HoldGestureOptions */

/** Timer-injectable, DOM-free hold gesture state machine. @param {HoldGestureOptions} options */
export function createHoldGesture({
  onActivate,
  onPending = () => {},
  delay = 420,
  tolerance = 8,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof onActivate !== 'function') throw new TypeError('onActivate must be a function');
  /** @type {HoldCandidate | null} */
  let candidate = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;

  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    const hadCandidate = candidate !== null;
    timer = null;
    candidate = null;
    if (hadCandidate) onPending(null);
  };

  return {
    /** @param {HoldCandidate} next */
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
    /** @param {{ pointerId: number, x: number, y: number }} point */
    move({ pointerId, x, y }) {
      if (!candidate) return;
      if (
        pointerId !== candidate.pointerId ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.hypot(x - candidate.x, y - candidate.y) > tolerance
      )
        cancel();
    },
    cancel,
  };
}
