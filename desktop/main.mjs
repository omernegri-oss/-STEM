// Desktop version: an Electron window around the game. The game server runs inside this process on 127.0.0.1,
// so the host's store lives here. Friends join over the internet with the store code (WebRTC, see client/js/online.js).
import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Supermarket'); // fixes the save folder: %APPDATA%/Supermarket, ~/Library/Application Support/Supermarket, ~/.config/Supermarket
// some Linux systems can't start Chromium's sandbox; the game only shows its own local pages
if (process.platform === 'linux' && process.argv.includes('--no-sandbox')) app.commandLine.appendSwitch('no-sandbox');

// ---------------------------------------------------------------------------------- game server
process.env.SAVES_DIR = path.join(app.getPath('userData'), 'saves');
const { startServer } = await import('../server/index.js');
const server = startServer(0, { host: '127.0.0.1', quiet: true });
const port = await server.ready;

// ---------------------------------------------------------------------------------- page bridge
let win = null;
ipcMain.on('app-info', (e) => { e.returnValue = { port, version: app.getVersion() }; });
ipcMain.on('app-quit', () => app.quit());
ipcMain.on('app-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#10161d', title: 'Supermarket',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // F11 toggles fullscreen; links to other sites open in the normal browser
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.on('closed', () => { win = null; });
}

// one window only
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server.saveAll(); } catch {} });
