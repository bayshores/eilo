import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeStorage, HOME_STORAGE_KEYS, normalizeHomePreferences } from './storage.js';

function memory(values = new Map()) {
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('blocked localStorage falls back without interrupting Home', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
  try {
    const storage = createHomeStorage();
    assert.equal(storage.read(HOME_STORAGE_KEYS.preferences, 'fresh'), 'fresh');
    assert.equal(
      storage.message,
      'Saved preferences could not be read. felis is using its defaults.',
    );
    assert.equal(storage.write(HOME_STORAGE_KEYS.preferences, { reducedMotion: true }), false);
    assert.equal(storage.available, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('preferences use one current key and keep the former key only for migration', () => {
  const store = memory();
  const storage = createHomeStorage({ storage: store });
  assert.equal(storage.write(HOME_STORAGE_KEYS.preferences, { reducedMotion: true }), true);
  assert.equal(store.values.get(HOME_STORAGE_KEYS.preferences), '{"reducedMotion":true}');
  assert.equal(HOME_STORAGE_KEYS.preferences, 'felis:preferences:v1');
  assert.equal(HOME_STORAGE_KEYS.legacyPreferences, 'eilo:widget-prototype:preferences:v1');
  store.values.set(HOME_STORAGE_KEYS.legacyPreferences, '{}');
  assert.equal(storage.remove(HOME_STORAGE_KEYS.legacyPreferences), true);
  assert.equal(store.values.has(HOME_STORAGE_KEYS.legacyPreferences), false);
});

test('preference normalization keeps only bounded current settings', () => {
  assert.deepEqual(
    normalizeHomePreferences({
      name: '  Morgan  ',
      reducedMotion: true,
      soundEffects: false,
      soundVolume: 2,
      dailyGuidance: false,
      spokenReplies: false,
      pin: true,
      widgetPins: ['old'],
    }),
    {
      name: 'Morgan',
      reducedMotion: true,
      soundEffects: false,
      soundVolume: 1,
      dailyGuidance: false,
      spokenReplies: false,
    },
  );
  assert.deepEqual(normalizeHomePreferences(null), {
    name: '',
    reducedMotion: false,
    soundEffects: true,
    soundVolume: 0.5,
    dailyGuidance: true,
    spokenReplies: true,
  });
  assert.equal(normalizeHomePreferences({ name: 'You' }).name, '');
  assert.equal(normalizeHomePreferences({ soundVolume: Infinity }).soundVolume, 0.5);
});
