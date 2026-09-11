'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed preload: no filesystem, process, raw IPC, or generic command bridge.
if (
  location.origin === 'http://127.0.0.1:8765' &&
  ['/home/', '/home/index.html'].includes(location.pathname)
) {
  contextBridge.exposeInMainWorld(
    'eiloDesktop',
    Object.freeze({
      openActivityConnection() {
        return ipcRenderer.invoke('eilo:open-activity-connection');
      },
      openAccountAuthorization() {
        return ipcRenderer.invoke('eilo:account-authorization');
      },
      openContextSource(contextId, sourceId) {
        return [contextId, sourceId].every(
          (id) => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(id),
        )
          ? ipcRenderer.invoke('eilo:context-source', contextId, sourceId)
          : Promise.resolve(false);
      },
      openContextPermission(kind) {
        return ['text', 'visual'].includes(kind)
          ? ipcRenderer.invoke('eilo:context-permission', kind)
          : Promise.resolve(false);
      },
      openGoogleAuthorization(url) {
        return typeof url === 'string' && url.length < 5000
          ? ipcRenderer.invoke('eilo:google-authorization', url)
          : Promise.resolve(false);
      },
      openBriefingAuthorization(url) {
        return typeof url === 'string' && url.length < 5000
          ? ipcRenderer.invoke('eilo:briefing-authorization', url)
          : Promise.resolve(false);
      },
      openBriefingSource(runId, sourceId) {
        return typeof runId === 'string' &&
          /^[A-Za-z0-9_.:-]{1,96}$/.test(runId) &&
          typeof sourceId === 'string' &&
          /^S[0-9]{1,3}$/.test(sourceId)
          ? ipcRenderer.invoke('eilo:briefing-source', runId, sourceId)
          : Promise.resolve(false);
      },
      getCheckInNotifications() {
        return ipcRenderer.invoke('eilo:check-in-notification-status');
      },
      setCheckInNotifications(enabled) {
        return typeof enabled === 'boolean'
          ? ipcRenderer.invoke('eilo:set-check-in-notifications', enabled)
          : ipcRenderer.invoke('eilo:check-in-notification-status');
      },
      onOpenCheckIn(callback) {
        if (typeof callback !== 'function') return () => {};
        const listener = (_event, target) => {
          const keys = ['conversationId', 'messageId', 'eventId'];
          if (
            !target ||
            !keys.every(
              (key) =>
                typeof target[key] === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(target[key]),
            )
          )
            return;
          callback(Object.fromEntries(keys.map((key) => [key, target[key]])));
        };
        ipcRenderer.on('eilo:open-check-in', listener);
        ipcRenderer.send('eilo:home-ready');
        return () => ipcRenderer.removeListener('eilo:open-check-in', listener);
      },
    }),
  );
}
