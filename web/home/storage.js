export const HOME_STORAGE_KEYS = Object.freeze({
  preferences: 'felis:preferences:v1',
  legacyPreferences: 'eilo:widget-prototype:preferences:v1',
});

/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void, removeItem?(key: string): void }} StorageLike */

/** @param {{ storage?: StorageLike | null }} [options]
 * Create a safe JSON adapter for the browser-owned presentation preferences. */
export function createHomeStorage(options = {}) {
  /** @type {StorageLike | null} */
  let storage = options.storage ?? null;
  let message = '';
  let available = true;

  function getStorage() {
    if (storage) return storage;
    try {
      storage = globalThis.localStorage;
      return storage;
    } catch {
      return null;
    }
  }

  /** @param {string} key @param {unknown} fallback */
  function read(key, fallback) {
    try {
      const target = getStorage();
      if (!target) throw new Error('Browser storage is unavailable');
      const value = target.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch {
      message = 'Saved preferences could not be read. felis is using its defaults.';
      return fallback;
    }
  }

  /** @param {string} key @param {unknown} value */
  function write(key, value) {
    try {
      const target = getStorage();
      if (!target) throw new Error('Browser storage is unavailable');
      target.setItem(key, JSON.stringify(value));
      available = true;
      return true;
    } catch {
      available = false;
      message = 'Your preferences could not be saved. Changes will last until this page closes.';
      return false;
    }
  }

  /** @param {string} key */
  function remove(key) {
    try {
      getStorage()?.removeItem?.(key);
    } catch {
      return false;
    }
    return true;
  }

  return {
    read,
    write,
    remove,
    get available() {
      return available;
    },
    get message() {
      return message;
    },
  };
}

/** @param {unknown} raw @returns {Record<string, unknown>} */
function record(raw) {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? /** @type {Record<string, unknown>} */ (raw)
    : {};
}

/** Sanitize the small set of browser-owned appearance and conversation choices. */
/** @param {unknown} raw */
export function normalizeHomePreferences(raw = {}) {
  const value = record(raw);
  return {
    name:
      typeof value.name === 'string' && value.name.trim() && value.name.trim() !== 'You'
        ? value.name.trim().slice(0, 40)
        : '',
    reducedMotion: value.reducedMotion === true,
    soundEffects: typeof value.soundEffects === 'boolean' ? value.soundEffects : true,
    soundVolume:
      typeof value.soundVolume === 'number' && Number.isFinite(value.soundVolume)
        ? Math.max(0, Math.min(1, value.soundVolume))
        : 0.5,
    dailyGuidance: typeof value.dailyGuidance === 'boolean' ? value.dailyGuidance : true,
    spokenReplies: typeof value.spokenReplies === 'boolean' ? value.spokenReplies : true,
  };
}
