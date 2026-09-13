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
    this.gains = [];
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
    const gain = {
      ramps: [],
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime(value) {
          gain.ramps.push(value);
        },
      },
      connect() {},
      disconnect() {},
    };
    this.gains.push(gain);
    return gain;
  }
}

function environment({ enabled = true, muted = false, gesture = true, volume = 0.5 } = {}) {
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
      volume: () => volume,
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
    setVolume(value) {
      volume = value;
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

test('test sound prepares and plays immediately from its user gesture', async () => {
  const sound = environment({ volume: 1 });
  assert.equal(await sound.controller.playTest(), true);
  assert.equal(sound.controller.sent(), true);
  assert.equal(sound.controller.complete(), true);
  assert.equal(FakeAudioContext.instances[0].oscillators.length, 5);
  sound.controller.destroy();
});

test('test sound waits for its own resume before playing once', async () => {
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
  const sound = createInterfaceSound({
    enabled: () => true,
    AudioContext: SuspendedContext,
    isUserGesture: () => true,
  });
  const playing = sound.playTest();
  assert.equal(SuspendedContext.instances[0].oscillators.length, 0);
  resume();
  assert.equal(await playing, true);
  assert.equal(SuspendedContext.instances[0].oscillators.length, 2);
  sound.destroy();
});

test('a pending test sound is dropped after mute, hide, or destroy', async () => {
  for (const cancelledBy of ['mute', 'hide', 'destroy']) {
    let muted = false;
    let resume;
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
    const sound = createInterfaceSound({
      enabled: () => true,
      muted: () => muted,
      AudioContext: SuspendedContext,
      document,
      isUserGesture: () => true,
    });
    const playing = sound.playTest();
    if (cancelledBy === 'mute') {
      muted = true;
      sound.sync();
    } else if (cancelledBy === 'hide') {
      document.visibilityState = 'hidden';
      listeners.get('visibilitychange')();
    } else sound.destroy();
    resume();
    assert.equal(await playing, false, cancelledBy);
    assert.equal(SuspendedContext.instances[0].oscillators.length, 0, cancelledBy);
    if (cancelledBy !== 'destroy') sound.destroy();
  }
});

test('sync immediately stops active audio after mute or opt-out', () => {
  const sound = environment();
  assert.equal(sound.controller.prepare(), true);
  assert.equal(sound.controller.play('workspace'), true);
  const context = FakeAudioContext.instances[0];
  sound.setMuted(true);
  assert.equal(sound.controller.sync(), false);
  assert.equal(
    context.oscillators.every((oscillator) => oscillator.stopped),
    true,
  );

  sound.setMuted(false);
  sound.setEnabled(false);
  assert.equal(sound.controller.play('ready'), false);
  assert.equal(context.oscillators.length, 2);
  sound.controller.destroy();
});

test('a closed context is replaced only by the next user gesture without replay', () => {
  const sound = environment();
  assert.equal(sound.controller.prepare(), true);
  const first = FakeAudioContext.instances[0];
  first.state = 'closed';
  assert.equal(sound.controller.play('confirmed'), false);
  assert.equal(first.oscillators.length, 0);
  assert.equal(sound.controller.prepare(), true);
  assert.equal(FakeAudioContext.instances.length, 2);
  assert.equal(sound.controller.confirm(), true);
  sound.controller.destroy();
});

test('volume is clamped and zero volume suppresses playback', () => {
  const loud = environment({ volume: 5 });
  assert.equal(loud.controller.prepare(), true);
  assert.equal(loud.controller.confirm(), true);
  assert.equal(FakeAudioContext.instances[0].gains[0].ramps[0], 0.05);
  loud.controller.destroy();

  const silent = environment({ volume: 0 });
  assert.equal(silent.controller.prepare(), false);
  assert.equal(FakeAudioContext.instances.length, 0);
  silent.controller.destroy();
});
