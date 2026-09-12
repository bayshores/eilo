/**
 * Browser persistence for the Home prototype. Keeping the keys here makes the
 * preview and live Home use the same durable layout contract without coupling
 * rendering code to localStorage failure handling.
 */
export const HOME_STORAGE_KEYS = Object.freeze({
  layout: 'eilo:widget-prototype:layout:v1',
  content: 'eilo:widget-prototype:content:v1',
  preferences: 'eilo:widget-prototype:preferences:v1',
});

/** @typedef {{ getItem(key: string): string | null, setItem(key: string, value: string): void }} StorageLike */

/**
 * Create a safe JSON storage adapter and expose its latest user-facing status.
 * Storage access is deferred because browsers may throw while reading localStorage itself.
 * @param {{ storage?: StorageLike | null }} [options]
 */
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
      message = 'Saved preferences could not be read. This preview is using a fresh layout.';
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
      message =
        'Your browser cannot save this layout. Changes will last until this page is reloaded.';
      return false;
    }
  }

  return {
    read,
    write,
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

/** @param {unknown} value */
export function normalizeAccent(value) {
  return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : '#fac399';
}

/** @param {unknown} raw Read and sanitize the small, user-editable preferences shared by both Home modes. */
export function normalizeHomePreferences(raw = {}) {
  const value = record(raw);
  return {
    name:
      typeof value.name === 'string' && value.name.trim() && value.name.trim() !== 'You'
        ? value.name.slice(0, 40)
        : '',
    pin: value.pin === true,
    homeLayoutVersion: value.homeLayoutVersion === 2 ? 2 : 1,
    reducedMotion: value.reducedMotion === true,
    soundEffects: value.soundEffects === true,
    accentColor: normalizeAccent(value.accentColor),
    widgetPins: Array.isArray(value.widgetPins)
      ? value.widgetPins
          .filter((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id))
          .slice(0, 24)
      : [],
    dismissedContextWidgets: Array.isArray(value.dismissedContextWidgets)
      ? [...new Set(value.dismissedContextWidgets)]
          .filter((id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(id))
          .slice(-128)
      : [],
  };
}

/** @param {unknown} raw Read only the durable note field; fixture content always remains in code. */
export function normalizeHomeContent(raw = {}) {
  const value = record(raw);
  return { notes: typeof value.notes === 'string' ? value.notes.slice(0, 10000) : '' };
}
