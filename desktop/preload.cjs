// Gives the game page a small, safe API for Steam features (window.steamDesk). Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');
const info = ipcRenderer.sendSync('steam-info');
contextBridge.exposeInMainWorld('steamDesk', {
  info,
  host: (code, store) => ipcRenderer.invoke('steam-host', { code: String(code), store: String(store || '') }),
  invite: () => ipcRenderer.invoke('steam-invite'),
  leave: () => ipcRenderer.invoke('steam-leave'),
  storeName: (name) => ipcRenderer.send('steam-store-name', String(name || '')),
  achievement: (id) => ipcRenderer.send('steam-achievement', String(id)),
  onJoin: (fn) => ipcRenderer.on('steam-join', (e, d) => fn(d)),
  quit: () => ipcRenderer.send('app-quit'),
  fullscreen: () => ipcRenderer.send('app-fullscreen'),
});
