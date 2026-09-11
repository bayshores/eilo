/** Refresh only setup metadata; permissions and source policy are never changed here. */
export async function refreshSetupHealth(source, refresh, fetcher = fetch) {
  if (!['browser', 'desktop'].includes(source)) throw new TypeError('Unknown setup source.');
  try {
    await fetcher(`/api/context/capabilities?source=${source}`, {
      headers: { 'X-Eilo-Client': 'local-chat' },
      signal: AbortSignal.timeout(6000),
    });
  } finally {
    await refresh?.();
  }
}
