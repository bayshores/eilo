import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeHomePreferences,
  normalizeAccent,
  createHomeStorage,
  HOME_STORAGE_KEYS,
} from '../home/storage.js';
import { accentChannels, readableAccent } from './accent.js';

test('accent preferences validate, preserve RGB, and survive storage reload', () => {
  for (const invalid of [null, {}, '#fff', '#123456ff', 'red', 'url(x)', 123])
    assert.equal(normalizeAccent(invalid), '#fac399');
  assert.equal(normalizeHomePreferences({ accentColor: '#12ABef' }).accentColor, '#12abef');
  assert.deepEqual(accentChannels('#12abef'), [18, 171, 239]);
  const values = new Map();
  const storage = createHomeStorage({
    storage: { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) },
  });
  const prefs = normalizeHomePreferences({ name: 'Sample', accentColor: '#12abef', pin: true });
  assert.equal(storage.write(HOME_STORAGE_KEYS.preferences, prefs), true);
  assert.deepEqual(
    normalizeHomePreferences(storage.read(HOME_STORAGE_KEYS.preferences, {})),
    prefs,
  );
  assert.equal(readableAccent('#fac399'), '#fac399');
});

test('even extreme RGB choices keep accent labels legible on dark panels', () => {
  for (const color of ['#000000', '#0000ff', '#ff0000', '#00ff00', '#ffffff', '#121212']) {
    const linear = accentChannels(readableAccent(color)).map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    const luminance = linear.reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
    assert.ok((luminance + 0.05) / (0.05 + 0.046) >= 4.5, color);
  }
});
