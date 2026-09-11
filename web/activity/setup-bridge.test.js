import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionSetupBridge } from './setup-bridge.js';

const extensionId = 'a'.repeat(32);

test('bridge sends only the two fixed metadata messages to the exact extension id', async () => {
  const calls = [];
  const runtime = {
    sendMessage(id, message, callback) {
      calls.push({ id, message });
      callback(
        message.type === 'eilo-setup-status'
          ? { installed: true, granted: false }
          : { opened: true },
      );
    },
    get permissions() {
      throw new Error('setup bridge must not request permissions');
    },
    get tabs() {
      throw new Error('setup bridge must not inspect tabs');
    },
  };
  const bridge = extensionSetupBridge({ runtime, extensionId });
  assert.deepEqual(await bridge.probe(), { installed: true, granted: false });
  assert.equal(await bridge.open(), true);
  assert.deepEqual(calls, [
    { id: extensionId, message: { type: 'eilo-setup-status' } },
    { id: extensionId, message: { type: 'eilo-open-setup' } },
  ]);
});

test('bridge rejects arbitrary or incomplete callback payloads', async () => {
  const values = [
    null,
    {},
    { installed: true },
    { installed: true, granted: 'yes' },
    { installed: true, granted: true, extra: 'ignored' },
  ];
  for (const value of values) {
    const bridge = extensionSetupBridge({
      extensionId,
      runtime: { sendMessage: (_id, _message, callback) => callback(value) },
    });
    const result = await bridge.probe();
    if (value?.installed === true && typeof value.granted === 'boolean')
      assert.deepEqual(result, { installed: true, granted: true });
    else assert.equal(result, null);
  }
  const open = extensionSetupBridge({
    extensionId,
    runtime: {
      sendMessage: (_id, _message, callback) => callback({ opened: 'true', secret: 'ignore' }),
    },
  });
  assert.equal(await open.open(), false);
});

test('bridge returns null or false for unavailable ids, runtime errors, thrown errors, and timeouts', async () => {
  const invalid = extensionSetupBridge({
    extensionId: 'not-an-extension-id',
    runtime: { sendMessage() {} },
  });
  assert.equal(invalid.available, false);
  assert.equal(invalid.setupURL, null);
  assert.equal(
    extensionSetupBridge({ extensionId }).setupURL,
    `chrome-extension://${extensionId}/popup.html`,
  );
  assert.equal(await invalid.probe(), null);
  assert.equal(await invalid.open(), false);

  const runtimeError = {
    lastError: { message: 'not connected' },
    sendMessage(_id, _message, callback) {
      callback({ installed: true, granted: true });
    },
  };
  assert.equal(await extensionSetupBridge({ extensionId, runtime: runtimeError }).probe(), null);

  const thrown = extensionSetupBridge({
    extensionId,
    runtime: {
      sendMessage() {
        throw new Error('bridge unavailable');
      },
    },
  });
  assert.equal(await thrown.open(), false);

  const previousTimeout = globalThis.setTimeout;
  const previousClear = globalThis.clearTimeout;
  let scheduled;
  globalThis.setTimeout = (callback) => {
    scheduled = callback;
    return 7;
  };
  globalThis.clearTimeout = () => {};
  try {
    const timeout = extensionSetupBridge({ extensionId, runtime: { sendMessage() {} } });
    const waiting = timeout.probe();
    scheduled();
    assert.equal(await waiting, null);
  } finally {
    globalThis.setTimeout = previousTimeout;
    globalThis.clearTimeout = previousClear;
  }
});
