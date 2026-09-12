import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHomeStorage,
  HOME_STORAGE_KEYS,
  normalizeHomeContent,
  normalizeHomePreferences,
} from './storage.js';

function memory(values = new Map()) {
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('blocked localStorage lookup falls back without throwing during adapter creation', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    },
  });
  try {
    const storage = createHomeStorage();
    assert.equal(storage.read(HOME_STORAGE_KEYS.layout, 'fresh'), 'fresh');
    assert.equal(
      storage.message,
      'Saved preferences could not be read. This preview is using a fresh layout.',
    );
    assert.equal(storage.write(HOME_STORAGE_KEYS.layout, { version: 1 }), false);
    assert.equal(storage.available, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('corrupt saved JSON uses the supplied fallback and keeps the storage warning', () => {
  const store = memory(new Map([[HOME_STORAGE_KEYS.content, '{bad json']]));
  const storage = createHomeStorage({ storage: store });
  assert.deepEqual(storage.read(HOME_STORAGE_KEYS.content, { notes: '' }), { notes: '' });
  assert.equal(
    storage.message,
    'Saved preferences could not be read. This preview is using a fresh layout.',
  );
});

test('writes preserve the established Home storage keys and JSON values', () => {
  const store = memory();
  const storage = createHomeStorage({ storage: store });
  assert.equal(storage.write(HOME_STORAGE_KEYS.layout, { version: 1 }), true);
  assert.equal(store.values.get(HOME_STORAGE_KEYS.layout), '{"version":1}');
  assert.equal(HOME_STORAGE_KEYS.content, 'eilo:widget-prototype:content:v1');
  assert.equal(HOME_STORAGE_KEYS.preferences, 'eilo:widget-prototype:preferences:v1');
});

test('normalizers accept only bounded profile and note fields', () => {
  assert.deepEqual(
    normalizeHomePreferences({ name: ' A '.repeat(30), pin: 1, reducedMotion: true }),
    {
      name: ' A '.repeat(30).slice(0, 40),
      pin: false,
      homeLayoutVersion: 1,
      reducedMotion: true,
      widgetPins: [],
      dismissedContextWidgets: [],
    },
  );
  assert.deepEqual(normalizeHomePreferences(null), {
    name: 'You',
    pin: false,
    homeLayoutVersion: 1,
    reducedMotion: false,
    widgetPins: [],
    dismissedContextWidgets: [],
  });
  assert.equal(normalizeHomeContent({ notes: 'n'.repeat(10001) }).notes.length, 10000);
  assert.deepEqual(normalizeHomeContent(['not a record']), { notes: '' });
});

test('personal profile names are restored only from local preferences', () => {
  const store = memory();
  const storage = createHomeStorage({ storage: store });
  const personal = normalizeHomePreferences({ name: 'Morgan' });
  storage.write(HOME_STORAGE_KEYS.preferences, personal);
  assert.equal(
    normalizeHomePreferences(storage.read(HOME_STORAGE_KEYS.preferences, {})).name,
    'Morgan',
  );
  assert.equal(normalizeHomePreferences({}).name, 'You');
});

test('scrolling Home migration version is explicit and survives normalization', () => {
  assert.equal(normalizeHomePreferences({ homeLayoutVersion: 2 }).homeLayoutVersion, 2);
  assert.equal(normalizeHomePreferences({ homeLayoutVersion: '2' }).homeLayoutVersion, 1);
});
