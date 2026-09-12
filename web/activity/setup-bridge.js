const ID = /^[a-p]{32}$/;
/** Fixed, metadata-only extension messages. Opening setup requires a caller's click. */
export function extensionSetupBridge({
  runtime = globalThis.chrome?.runtime,
  extensionId = globalThis.EILO_ACTIVITY_EXTENSION_ID,
  timeout = 3000,
} = {}) {
  const available = Boolean(
    ID.test(extensionId || '') && typeof runtime?.sendMessage === 'function',
  );
  function send(type) {
    if (!available) return Promise.resolve(null);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeout);
      try {
        runtime.sendMessage(extensionId, { type }, (value) => {
          const failed = runtime.lastError;
          finish(failed ? null : value);
        });
      } catch {
        finish(null);
      }
    });
  }
  return {
    available,
    setupURL: ID.test(extensionId || '') ? `chrome-extension://${extensionId}/popup.html` : null,
    async probe() {
      const value = await send('eilo-setup-status');
      return value?.installed === true && typeof value.granted === 'boolean'
        ? {
            installed: true,
            granted: value.granted,
            ...(value.setup_protocol === 2 ? { setup_protocol: 2 } : {}),
          }
        : null;
    },
    async open() {
      return (await send('eilo-open-setup'))?.opened === true;
    },
  };
}
