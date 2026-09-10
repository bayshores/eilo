import test from 'node:test';
import assert from 'node:assert/strict';
import { createHoldGesture } from './hold.js';

function fakeTimers() {
  let now = 0,
    nextId = 1;
  const timers = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    tick(ms) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].find(([, timer]) => timer.at <= now);
        if (!due) return;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
  };
}

test('a short press cancelled before the threshold never activates', () => {
  const timers = fakeTimers(),
    activated = [],
    pending = [];
  const hold = createHoldGesture({
    onActivate: (value) => activated.push(value),
    onPending: (value) => pending.push(value),
    ...timers,
  });
  hold.start({ id: 'today-1', pointerId: 4, x: 10, y: 20 });
  timers.tick(419);
  hold.cancel();
  timers.tick(1000);
  assert.deepEqual(activated, []);
  assert.deepEqual(pending, [{ id: 'today-1', pointerId: 4, x: 10, y: 20 }, null]);
});

test('a hold activates exactly once at the threshold with its original candidate', () => {
  const timers = fakeTimers(),
    activated = [],
    pending = [];
  const hold = createHoldGesture({
    delay: 50,
    onActivate: (value) => activated.push(value),
    onPending: (value) => pending.push(value),
    ...timers,
  });
  hold.start({ id: 'notes-1', pointerId: 7, x: 1, y: 2 });
  timers.tick(49);
  assert.equal(activated.length, 0);
  timers.tick(1);
  timers.tick(500);
  assert.deepEqual(activated, [{ id: 'notes-1', pointerId: 7, x: 1, y: 2 }]);
  assert.deepEqual(pending, [{ id: 'notes-1', pointerId: 7, x: 1, y: 2 }, null]);
});

test('scroll-like movement beyond tolerance cancels the pending hold', () => {
  const timers = fakeTimers(),
    activated = [],
    pending = [];
  const hold = createHoldGesture({
    tolerance: 8,
    onActivate: (value) => activated.push(value),
    onPending: (value) => pending.push(value),
    ...timers,
  });
  hold.start({ id: 'clock-1', pointerId: 2, x: 0, y: 0 });
  hold.move({ pointerId: 2, x: 6, y: 6 }); // Euclidean distance is beyond eight pixels.
  timers.tick(1000);
  assert.deepEqual(activated, []);
  assert.equal(pending.at(-1), null);
});

test('replacement and a mismatched pointer each cancel the previous candidate', () => {
  const timers = fakeTimers(),
    activated = [],
    pending = [];
  const hold = createHoldGesture({
    onActivate: (value) => activated.push(value),
    onPending: (value) => pending.push(value),
    ...timers,
  });
  hold.start({ id: 'today-1', pointerId: 1, x: 0, y: 0 });
  hold.start({ id: 'goals-1', pointerId: 2, x: 0, y: 0 });
  hold.move({ pointerId: 99, x: 0, y: 0 });
  timers.tick(1000);
  assert.deepEqual(activated, []);
  assert.deepEqual(
    pending.map((value) => value?.id ?? null),
    ['today-1', null, 'goals-1', null],
  );
});
