import test from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTIVE_MOTION, createAdaptiveMotion } from './motion.js';

test('content transitions use the standard 180ms token and control feedback uses 120ms', () => {
  const calls = [];
  const gsap = {
    set: (...args) => calls.push(['set', ...args]),
    to: (...args) => {
      calls.push(['to', ...args]);
      return { kill() {} };
    },
  };
  const Flip = {
    getState: (nodes) => ({ nodes }),
    from: (_state, options) => {
      calls.push(['flip', options]);
      return { kill() {} };
    },
  };
  const motion = createAdaptiveMotion({ gsap, Flip });
  let changed = false;
  motion.transition(
    () => {
      changed = true;
    },
    [{ id: 'card' }],
    { content: true },
  );
  assert.equal(changed, true);
  assert.equal(
    calls.find(([kind]) => kind === 'flip')[1].duration,
    ADAPTIVE_MOTION.standard / 1000,
  );
  motion.feedback({ id: 'button' });
  assert.equal(calls.find(([kind]) => kind === 'to')[2].duration, ADAPTIVE_MOTION.quick / 1000);
  motion.destroy();
});

test('reduced, busy, or hidden motion mutates immediately without a stale animation', () => {
  const calls = [];
  const gsap = {
    set: (...args) => calls.push(args),
    to() {
      throw new Error('should not animate');
    },
  };
  const Flip = {
    getState() {
      throw new Error('should not capture');
    },
    from() {
      throw new Error('should not animate');
    },
  };
  const motion = createAdaptiveMotion({ gsap, Flip, reducedMotion: true, isBusy: () => true });
  let count = 0;
  motion.transition(() => {
    count++;
  }, [{ id: 'card' }]);
  motion.feedback({ id: 'button' });
  assert.equal(count, 1);
  assert.deepEqual(calls, []);
  motion.destroy();
});

test('layout movement and arriving content have separate durations; cancellation settles chart values', () => {
  const calls = [];
  const gsap = {
    set() {},
    to(_target, options) {
      calls.push(['value', options]);
      return { kill() {} };
    },
    fromTo(_target, _start, options) {
      calls.push(['entry', options]);
      return { kill() {} };
    },
  };
  const Flip = {
    getState: () => ({}),
    from(_state, options) {
      calls.push(['layout', options]);
      return { kill() {} };
    },
  };
  const motion = createAdaptiveMotion({ gsap, Flip });
  const prior = {},
    next = {};
  motion.transition(() => {}, [prior], { getTargets: () => [prior, next] });
  assert.equal(calls.find(([kind]) => kind === 'layout')[1].duration, 0.36);
  assert.equal(calls.find(([kind]) => kind === 'entry')[1].duration, 0.18);
  const target = {
    attributes: {},
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
  };
  motion.values(target, { height: 24, y: 32 });
  motion.cancel();
  assert.deepEqual(target.attributes, { height: '24', y: '32' });
  motion.destroy();
});
