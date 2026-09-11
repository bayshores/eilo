import test from 'node:test';
import assert from 'node:assert/strict';
import { createSetupMonitor } from './setup-monitor.js';

class Target {
  constructor() {
    this.listeners = new Map();
    this.hidden = false;
  }
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
  removeEventListener(name, listener) {
    if (this.listeners.get(name) === listener) this.listeners.delete(name);
  }
  emit(name) {
    this.listeners.get(name)?.();
  }
}

function clock() {
  let time = 0;
  let next = 1;
  const jobs = new Map();
  return {
    now: () => time,
    schedule(callback, delay) {
      const id = next++;
      jobs.set(id, { callback, at: time + delay });
      return id;
    },
    cancel(id) {
      jobs.delete(id);
    },
    advance(amount) {
      time += amount;
      const due = [...jobs.entries()].filter(([, job]) => job.at <= time);
      for (const [id, job] of due) {
        jobs.delete(id);
        job.callback();
      }
    },
    pending: () => jobs.size,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('setup monitor allows one in-flight refresh and schedules the next check only after it settles', async () => {
  const timer = clock();
  const windowTarget = new Target();
  const documentTarget = new Target();
  let resolveRefresh;
  let calls = 0;
  const monitor = createSetupMonitor({
    refresh: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
    windowTarget,
    documentTarget,
    now: timer.now,
    schedule: timer.schedule,
    cancel: timer.cancel,
    interval: 10,
  });
  monitor.start();
  await settle();
  assert.equal(calls, 1);
  windowTarget.emit('focus');
  monitor.check();
  assert.equal(calls, 1);
  assert.equal(timer.pending(), 0);
  resolveRefresh();
  await settle();
  assert.equal(timer.pending(), 1);
  timer.advance(10);
  await settle();
  assert.equal(calls, 2);
  monitor.destroy();
});

test('setup monitor pauses while hidden and focus resumes checks once visible', async () => {
  const timer = clock();
  const windowTarget = new Target();
  const documentTarget = new Target();
  let calls = 0;
  const monitor = createSetupMonitor({
    refresh: () => {
      calls += 1;
    },
    windowTarget,
    documentTarget,
    now: timer.now,
    schedule: timer.schedule,
    cancel: timer.cancel,
    interval: 10,
  });
  documentTarget.hidden = true;
  monitor.start();
  await settle();
  assert.equal(calls, 0);
  documentTarget.hidden = false;
  windowTarget.emit('focus');
  await settle();
  assert.equal(calls, 1);
  documentTarget.hidden = true;
  documentTarget.emit('visibilitychange');
  assert.equal(timer.pending(), 0);
  monitor.destroy();
});

test('setup monitor has a finite two-minute attempt, restart resets it, and destroy cannot reschedule', async () => {
  const timer = clock();
  const windowTarget = new Target();
  const documentTarget = new Target();
  let calls = 0;
  let resolveRefresh;
  const monitor = createSetupMonitor({
    refresh: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    },
    windowTarget,
    documentTarget,
    now: timer.now,
    schedule: timer.schedule,
    cancel: timer.cancel,
    interval: 10,
    duration: 120000,
  });
  monitor.start();
  await settle();
  timer.advance(120000);
  resolveRefresh();
  await settle();
  assert.equal(timer.pending(), 0);
  monitor.start({ restart: true });
  await settle();
  assert.equal(calls, 2);
  monitor.destroy();
  resolveRefresh();
  await settle();
  assert.equal(timer.pending(), 0);
  windowTarget.emit('focus');
  timer.advance(120000);
  await settle();
  assert.equal(calls, 2);
});

test('stopping after setup completion clears pending work', async () => {
  const timer = clock();
  const monitor = createSetupMonitor({
    refresh: () => {},
    windowTarget: new Target(),
    documentTarget: new Target(),
    now: timer.now,
    schedule: timer.schedule,
    cancel: timer.cancel,
  });
  monitor.start();
  await settle();
  assert.equal(timer.pending(), 1);
  monitor.stop();
  assert.equal(timer.pending(), 0);
  monitor.destroy();
});

test('returning to a hidden card gets a fresh attempt but repeated visible snapshots do not extend it', async () => {
  const timer = clock();
  let visible = true,
    calls = 0;
  const monitor = createSetupMonitor({
    refresh: () => {
      calls++;
    },
    visible: () => visible,
    windowTarget: new Target(),
    documentTarget: new Target(),
    now: timer.now,
    schedule: timer.schedule,
    cancel: timer.cancel,
    interval: 10,
    duration: 20,
  });
  monitor.start();
  await settle();
  timer.advance(20);
  monitor.start();
  await settle();
  assert.equal(calls, 1);
  visible = false;
  monitor.start();
  visible = true;
  monitor.start();
  await settle();
  assert.equal(calls, 2);
  monitor.destroy();
});
