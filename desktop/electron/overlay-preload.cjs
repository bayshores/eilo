'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const validTarget = (value) =>
  value &&
  ['conversationId', 'messageId', 'eventId'].every(
    (key) => typeof value[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value[key]),
  ) &&
  typeof value.text === 'string' &&
  value.text.length > 0 &&
  value.text.length <= 600;

contextBridge.exposeInMainWorld(
  'eiloOverlay',
  Object.freeze({
    onCheckIn(callback) {
      if (typeof callback !== 'function') return () => {};
      const listener = (_event, value) => {
        if (!validTarget(value)) return;
        callback({
          conversationId: value.conversationId,
          messageId: value.messageId,
          eventId: value.eventId,
          text: value.text,
        });
      };
      ipcRenderer.on('eilo:overlay-check-in', listener);
      return () => ipcRenderer.removeListener('eilo:overlay-check-in', listener);
    },
    ready() {
      ipcRenderer.send('eilo:overlay-ready');
    },
    open() {
      ipcRenderer.send('eilo:overlay-open');
    },
    dismiss() {
      ipcRenderer.send('eilo:overlay-dismiss');
    },
  }),
);
