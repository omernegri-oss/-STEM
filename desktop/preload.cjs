// Gives the game page a tiny API for desktop-only buttons (window.desktopApp). Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('app-info');
contextBridge.exposeInMainWorld('desktopApp', {
  info,
  quit: () => ipcRenderer.send('app-quit'),
  fullscreen: () => ipcRenderer.send('app-fullscreen'),
});
