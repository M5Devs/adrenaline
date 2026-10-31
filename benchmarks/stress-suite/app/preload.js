'use strict';

// Electron preload. Exposes the exact same `window.adrenaline` surface that the
// Adrenaline.js native layer injects via its init script, so the renderer
// workload (app/renderer.js) is byte-for-byte identical under both runtimes.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('adrenaline', {
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel, cb) => {
    ipcRenderer.on(channel, (_event, data) => cb(data));
  },
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
});
