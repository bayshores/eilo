import assert from 'node:assert/strict';
import { glassOffset } from './glass-math.js';

const at = (x, y) => glassOffset(x, y, 500, 200, 20);
assert.ok(at(250, 100).every((n) => n === 0));
assert.equal(at(250, 0)[1], 1);
assert.equal(at(250, 200)[1], -1);
assert.equal(at(0, 100)[0], 1);
assert.equal(at(500, 100)[0], -1);
assert.ok(Math.abs(at(10, 10)[0] - at(10, 10)[1]) < 1e-9);
for (let y = 0; y <= 200; y += 5) {
  for (let x = 0; x <= 500; x += 5) {
    const v = at(x, y);
    assert.ok(v.every((n) => Number.isFinite(n) && Math.abs(n) <= 1));
    assert.ok(Math.abs(v[0] + at(500 - x, y)[0]) < 1e-9);
    assert.ok(Math.abs(v[1] + at(x, 200 - y)[1]) < 1e-9);
  }
}
console.log(
  'Passed: neutral center, inward refraction, rounded corner, symmetry, bounded offsets.',
);

import { glassPose } from './glass-math.js';

assert.equal(glassPose(0, 0).rotation, '0 1 0 0deg');
assert.equal(glassPose(1, 0).rotation, '0 -1 0 2.4deg');
assert.equal(glassPose(0, -1).rotation, '-1 0 0 2.4deg');
assert.deepEqual(glassPose(4, -3), glassPose(1, -1));
for (const x of [-1, -0.5, 0, 0.5, 1]) {
  for (const y of [-1, -0.5, 0, 0.5, 1]) {
    const p = glassPose(x, y);
    assert.ok(parseFloat(p.rotation.split(' ')[3]) <= 2.4);
    assert.ok(parseFloat(p.lightX) >= 20 && parseFloat(p.lightX) <= 80);
    assert.ok(parseFloat(p.lightY) >= 0 && parseFloat(p.lightY) <= 44);
  }
}
console.log('Passed: centered rest, tilt direction, capped rotation and bounded reflection.');

import { mapSize } from './glass-math.js';
for (const [w, h] of [
  [1, 1],
  [200, 100],
  [1200, 900],
  [3840, 2160],
]) {
  const s = mapSize(w, h);
  assert.ok(s.width * s.height <= 161000);
  assert.ok(s.width > 0 && s.height > 0);
}
console.log('Passed: refraction map area cap.');
