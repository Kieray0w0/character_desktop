'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
const latest = new Map();
let pendingSettings = false;

function deliver(callback, event) {
  try { callback(event); } catch { console.error('desktop.onEvent callback failed'); }
}

ipcRenderer.on('desktop:event', (_ipcEvent, event) => {
  if (!event || !['state', 'visibility', 'settings', 'settings-data', 'settings-visibility',
    'settings-command', 'settings-preview'].includes(event.type)) return;
  if (event.type === 'settings') pendingSettings = listeners.size === 0;
  else if (!['settings-command', 'settings-preview'].includes(event.type)) latest.set(event.type, event);
  for (const callback of listeners) deliver(callback, event);
});

// Drag initiation belongs to the page: call moveStart only after its 5px pointer
// threshold, then moveEnd on pointerup/cancel. No renderer coordinates cross IPC.
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  getState: () => ipcRenderer.invoke('desktop:getState'),
  setTopmost: value => {
    if (typeof value !== 'boolean') return Promise.reject(new TypeError('topmost must be boolean'));
    return ipcRenderer.invoke('desktop:setTopmost', value);
  },
  setScale: value => {
    if (!Number.isFinite(value)) return Promise.reject(new TypeError('scale must be finite'));
    return ipcRenderer.invoke('desktop:setScale', value);
  },
  hide: () => ipcRenderer.invoke('desktop:hide'),
  quit: () => ipcRenderer.send('desktop:quit'),
  moveStart: () => ipcRenderer.send('desktop:moveStart'),
  moveEnd: () => ipcRenderer.send('desktop:moveEnd'),
  resizeStart: corner => {
    if (['nw', 'ne', 'sw', 'se'].includes(corner)) ipcRenderer.send('desktop:resizeStart', corner);
  },
  resizeEnd: () => ipcRenderer.send('desktop:resizeEnd'),
  openSettings: () => ipcRenderer.invoke('desktop:openSettings'),
  closeSettings: () => ipcRenderer.invoke('desktop:closeSettings'),
  getSettings: () => ipcRenderer.invoke('desktop:getSettings'),
  openWebsite: () => ipcRenderer.invoke('desktop:openWebsite'),
  publishSettings: snapshot => ipcRenderer.send('desktop:publishSettings', snapshot),
  settingsCommand: command => ipcRenderer.send('desktop:settingsCommand', command),
  publishPreview: (dataURL, epoch) => ipcRenderer.send('desktop:publishPreview', dataURL, epoch),
  onEvent: callback => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    listeners.add(callback);
    queueMicrotask(() => {
      if (!listeners.has(callback)) return;
      for (const event of latest.values()) deliver(callback, event);
      if (pendingSettings) {
        pendingSettings = false;
        deliver(callback, { type: 'settings' });
      }
    });
    return () => { listeners.delete(callback); };
  },
}));

for (const event of ['blur', 'pagehide', 'pointerup', 'pointercancel', 'mouseup']) {
  window.addEventListener(event, () => {
    ipcRenderer.send('desktop:moveEnd');
    ipcRenderer.send('desktop:resizeEnd');
  });
}
