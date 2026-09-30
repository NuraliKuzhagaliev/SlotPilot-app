'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// This bridge exists only in our local shell, never in the server's renderer.
contextBridge.exposeInMainWorld('slotpilotDesktop', Object.freeze({
  command: command => ipcRenderer.invoke('desktop:command', command),
  onState: listener => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('desktop:state', handler);
    return () => ipcRenderer.removeListener('desktop:state', handler);
  },
}));
