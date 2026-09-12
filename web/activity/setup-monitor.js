/** A visible, bounded setup check. It never owns capture or permission changes. */
export function createSetupMonitor({
  refresh,
  visible = () => true,
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  interval = 2500,
  duration = 120000,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let timer = null,
    flight = null,
    deadline = 0,
    active = false,
    destroyed = false,
    wasVisible = false;
  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const isVisible = () => !documentTarget?.hidden && visible();
  const allowed = () => {
    if (!isVisible()) {
      wasVisible = false;
      return false;
    }
    return !destroyed && active && now() < deadline;
  };
  function queue() {
    clear();
    if (allowed())
      timer = schedule(() => {
        timer = null;
        void check();
      }, interval);
  }
  function check() {
    clear();
    if (!allowed()) return Promise.resolve();
    if (flight) return flight;
    flight = Promise.resolve()
      .then(refresh)
      .catch(() => {})
      .finally(() => {
        flight = null;
        queue();
      });
    return flight;
  }
  function wake() {
    if (destroyed || !active) return;
    if (isVisible()) {
      if (!wasVisible) deadline = now() + duration;
      wasVisible = true;
      void check();
    } else {
      wasVisible = false;
      clear();
    }
  }
  windowTarget?.addEventListener?.('focus', wake);
  documentTarget?.addEventListener?.('visibilitychange', wake);
  return {
    start({ restart = false } = {}) {
      if (destroyed) return;
      if (restart) clear();
      const currentlyVisible = isVisible();
      if (!active || restart || (currentlyVisible && !wasVisible)) {
        active = true;
        deadline = now() + duration;
      }
      wasVisible = currentlyVisible;
      if (!flight && timer === null && allowed()) void check();
    },
    check,
    stop() {
      active = false;
      clear();
    },
    destroy() {
      destroyed = true;
      active = false;
      clear();
      windowTarget?.removeEventListener?.('focus', wake);
      documentTarget?.removeEventListener?.('visibilitychange', wake);
    },
  };
}
