'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

function load() {
  const ipcRenderer = new EventEmitter();
  const sent = [];
  ipcRenderer.send = (...value) => sent.push(value);
  const exposed = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'overlay-preload.cjs'), 'utf8'), {
    require(name) {
      if (name === 'electron') {
        return {
          contextBridge: { exposeInMainWorld: (_name, value) => Object.assign(exposed, value) },
          ipcRenderer,
        };
      }
      throw new Error('unexpected require');
    },
  });
  return { ipcRenderer, exposed, sent };
}

test('overlay bridge accepts only bounded delivered check-ins and exposes no generic IPC', () => {
  const { ipcRenderer, exposed, sent } = load();
  const received = [];
  exposed.onCheckIn((value) => received.push(value));
  ipcRenderer.emit(
    'eilo:overlay-check-in',
    {},
    {
      conversationId: 'c1',
      messageId: 'm1',
      eventId: 'e1',
      text: 'A private check-in.',
    },
  );
  ipcRenderer.emit(
    'eilo:overlay-check-in',
    {},
    {
      conversationId: 'c1',
      messageId: 'm1',
      eventId: 'e1',
      text: 'x'.repeat(601),
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(received)), [
    { conversationId: 'c1', messageId: 'm1', eventId: 'e1', text: 'A private check-in.' },
  ]);
  exposed.ready();
  exposed.open();
  exposed.dismiss();
  assert.deepEqual(sent, [['eilo:overlay-ready'], ['eilo:overlay-open'], ['eilo:overlay-dismiss']]);
  assert.deepEqual(ipcRenderer.eventNames().sort(), ['eilo:overlay-check-in']);
});
