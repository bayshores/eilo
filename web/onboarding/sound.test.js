import assert from 'node:assert/strict';
import test from 'node:test';
import { createInterfaceSound } from './sound.js';

class FakeAudioContext {
  static instances = [];

  constructor() {
    this.currentTime = 1;
    this.destination = {};
    this.state = 'running';
    this.oscillators = [];
    FakeAudioContext.instances.push(this);
  }

  createOscillator() {
    const oscillator = {
      frequency: { setValueAtTime() {} },
      connect() {},
      disconnect: () => (oscillator.disconnected = true),
      start: () => (oscillator.started = true),
      stop: () => {
        oscillator.stopped = true;
        oscillator.onended?.();
      },
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain() {
    return {
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {},
      disconnect() {},
    };
  }
}

function environment({ enabled = true, muted = false, gesture = true } = {}) {
  FakeAudioContext.instances = [];
  const listeners = new Map();
  const document = {
    visibilityState: 'visible',
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
  };
  return {
    document,
    controller: createInterfaceSound({
      enabled: () => enabled,
      muted: () => muted,
      isUserGesture: () => gesture,
      document,
      AudioContext: FakeAudioContext,
    }),
    setEnabled(value) {
      enabled = value;
    },
    setMuted(value) {
      muted = value;
    },
    hide() {
      document.visibilityState = 'hidden';
      listeners.get('visibilitychange')();
    },
  };
}

test('interface sound is silent by default and when capture is muted', () => {
  const disabled = environment({ enabled: false });
  assert.equal(disabled.controller.play('workspace'), false);
  assert.equal(FakeAudioContext.instances.length, 0);

  const capture = environment({ muted: true });
  assert.equal(capture.controller.play('confirmed'), false);
  assert.equal(FakeAudioContext.instances.length, 0);
});

test('interface sound needs a current user gesture and supports unavailable audio safely', () => {
  const noGesture = environment({ gesture: false });
  assert.equal(noGesture.controller.prepare(), false);
  assert.equal(FakeAudioContext.instances.length, 0);

  const unavailable = createInterfaceSound({ enabled: () => true, AudioContext: undefined });
  assert.equal(unavailable.prepare(), false);
  unavailable.destroy();
});

test('interface sound cancels repeated cues and stops when the page becomes hidden', () => {
  const sound = environment();
  assert.equal(sound.controller.play('workspace'), false);
  assert.equal(sound.controller.prepare(), true);
  assert.equal(sound.controller.play('workspace'), true);
  const context = FakeAudioContext.instances[0];
  assert.equal(context.oscillators.length, 2);
  assert.equal(sound.controller.play('workspace'), true);
  assert.equal(context.oscillators.length, 4);
  assert.equal(
    context.oscillators.slice(0, 2).every((oscillator) => oscillator.stopped),
    true,
  );

  sound.hide();
  assert.equal(
    context.oscillators.slice(2).every((oscillator) => oscillator.stopped),
    true,
  );
  sound.setMuted(false);
  assert.equal(context.oscillators.length, 4);
  sound.controller.destroy();
});

test('prepared audio can play after an acknowledged async result', async () => {
  const sound = environment();
  assert.equal(sound.controller.prepare(), true);
  await Promise.resolve();
  assert.equal(sound.controller.play('confirmed'), true);
  assert.equal(FakeAudioContext.instances[0].oscillators.length, 2);
  sound.controller.destroy();
});

test('a suspended context does not play after the preference changes before resume', async () => {
  let resume;
  class SuspendedContext extends FakeAudioContext {
    constructor() {
      super();
      this.state = 'suspended';
    }

    resume() {
      return new Promise((resolve) => {
        resume = () => {
          this.state = 'running';
          resolve();
        };
      });
    }
  }
  FakeAudioContext.instances = [];
  let enabled = true;
  const sound = createInterfaceSound({
    enabled: () => enabled,
    AudioContext: SuspendedContext,
    isUserGesture: () => true,
  });
  assert.equal(sound.prepare(), true);
  enabled = false;
  resume();
  await Promise.resolve();
  assert.equal(sound.play('confirmed'), false);
  assert.equal(SuspendedContext.instances[0].oscillators.length, 0);
  sound.destroy();
});
