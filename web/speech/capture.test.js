import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, createSpeechCapture } from './capture.js';

test('browser PCM becomes bounded 16 kHz mono PCM16 WAV with correct duration', () => {
  const wav = encodeWav([new Float32Array(48000).fill(0.25)], 48000),
    v = new DataView(wav.buffer);
  assert.equal(wav.length, 32044);
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getInt16(44, true), 8192);
});
test('PCM clipping and nonfinite inputs cannot make malformed sample values', () => {
  const wav = encodeWav([new Float32Array([-2, 2, NaN, Infinity])], 16000),
    v = new DataView(wav.buffer);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true)),
    [-32768, 32767, 0, 0],
  );
  assert.throws(() => encodeWav([], 16000));
  assert.throws(() => encodeWav([new Float32Array(16000 * 121)], 16000));
});
test('releasing while the microphone permission is pending never starts recording later', async () => {
  let grant,
    stops = 0,
    uploads = 0,
    contexts = 0;
  const states = [];
  class Context {
    constructor() {
      contexts++;
      this.sampleRate = 16000;
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  const capture = createSpeechCapture({
    AudioContextClass: Context,
    WorkletNodeClass: class {},
    mediaDevices: {
      getUserMedia: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
    },
    fetcher: () => {
      uploads++;
    },
    onState: (value) => states.push(value.state),
  });
  const started = capture.start();
  assert.equal(capture.state, 'requesting');
  await capture.stop();
  grant({ getTracks: () => [{ stop: () => stops++ }] });
  await started;
  assert.equal(capture.state, 'idle');
  assert.equal(stops, 1);
  assert.equal(uploads, 0);
  assert.equal(contexts, 1);
  assert.equal(states.includes('recording'), false);
});
test('permission denial gives an actionable error and makes no transcription request', async () => {
  let uploads = 0;
  class Context {
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  const messages = [];
  const capture = createSpeechCapture({
    AudioContextClass: Context,
    WorkletNodeClass: class {},
    mediaDevices: {
      getUserMedia: async () => {
        throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
      },
    },
    fetcher: () => uploads++,
    onState: (value) => messages.push(value),
  });
  await capture.start();
  assert.equal(capture.state, 'error');
  assert.match(messages.at(-1).message, /not granted/);
  assert.equal(uploads, 0);
});

test('cancel during worklet flush invalidates buffered audio and never transcribes', async () => {
  let uploads = 0,
    acquisitions = 0,
    worklet;
  class Context {
    constructor() {
      this.sampleRate = 16000;
      this.audioWorklet = { addModule: async () => {} };
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
    createMediaStreamSource() {
      return { connect() {}, disconnect() {} };
    }
    createGain() {
      return { gain: { value: 1 }, connect() {}, disconnect() {} };
    }
  }
  class Worklet {
    constructor() {
      this.port = {
        postMessage: (message) => {
          if (message === 'flush') {
            /* The fake worklet deliberately produces no final audio chunk. */
          }
        },
        onmessage: null,
      };
      worklet = this;
    }
    connect() {}
    disconnect() {}
  }
  const track = { addEventListener() {}, stop() {} };
  const capture = createSpeechCapture({
    AudioContextClass: Context,
    WorkletNodeClass: Worklet,
    mediaDevices: {
      getUserMedia: async () => {
        acquisitions++;
        return { getTracks: () => [track] };
      },
    },
    fetcher: () => {
      uploads++;
    },
  });
  await capture.start();
  assert.equal(capture.state, 'recording');
  const stopping = capture.stop();
  await Promise.resolve();
  assert.equal(capture.state, 'stopping');
  await capture.stop({ cancel: true });
  assert.equal(capture.state, 'stopping');
  await capture.start();
  assert.equal(acquisitions, 1);
  worklet.port.onmessage({ data: { flushed: true } });
  await stopping;
  assert.equal(capture.state, 'idle');
  assert.equal(uploads, 0);
});
