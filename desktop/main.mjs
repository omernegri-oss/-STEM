// Desktop version: an Electron window around the game. The game server runs inside this process on 127.0.0.1,
// so the host's store lives here. Friends join over the internet with the store code (WebRTC, see client/js/online.js).
import { app, BrowserWindow, ipcMain, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Supermarket'); // fixes the save folder: %APPDATA%/Supermarket, ~/Library/Application Support/Supermarket, ~/.config/Supermarket
// some Linux systems can't start Chromium's sandbox; the game only shows its own local pages
if (process.platform === 'linux' && process.argv.includes('--no-sandbox')) app.commandLine.appendSwitch('no-sandbox');

// ---------------------------------------------------------------------------------- errors: never fail silently
const LOG = path.join(app.getPath('userData'), 'error-log.txt');
function logError(where, err) {
  const text = `[${new Date().toISOString()}] ${where}: ${err && err.stack || err}\n`;
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, text); } catch {}
  return text;
}
let fatalShown = false;
function fatal(where, err) {
  const text = logError(where, err);
  if (fatalShown) return; fatalShown = true;
  const show = () => { dialog.showErrorBox('Supermarket could not start', `${text}\nThis message is also saved in:\n${LOG}`); app.exit(1); };
  if (app.isReady()) show(); else app.whenReady().then(show);
}
process.on('uncaughtException', (e) => fatal('Error', e));
process.on('unhandledRejection', (e) => logError('Unhandled', e));

// one copy only: a second launch brings the running window to the front
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------------------------------------------------------------------------------- game server
let server = null, port = 0;
try {
  process.env.SAVES_DIR = path.join(app.getPath('userData'), 'saves');
  const { startServer } = await import('../server/index.js');
  server = startServer(0, { host: '127.0.0.1', quiet: true });
  port = await Promise.race([server.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('The game server did not start within 20 seconds.')), 20000))]);
} catch (e) { fatal('Starting the game server', e); }

// ---------------------------------------------------------------------------------- page bridge
let win = null;
ipcMain.on('app-info', (e) => { e.returnValue = { port, version: app.getVersion() }; });
ipcMain.on('app-quit', () => app.quit());
ipcMain.on('app-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

function createWindow() {
  if (!port) return;
  Menu.setApplicationMenu(null);
  const windowed = process.argv.includes('--windowed');
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, show: true, fullscreen: !windowed, backgroundColor: '#10161d', title: 'Supermarket',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  // F11 toggles fullscreen; links to other sites open in the normal browser
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.on('render-process-gone', (e, d) => { logError('Page crashed', d.reason); if (d.reason !== 'clean-exit' && win) win.reload(); });
  win.webContents.on('did-fail-load', (e, code, desc) => logError('Page failed to load', `${code} ${desc}`));
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(createWindow).catch((e) => fatal('Opening the window', e));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server && server.saveAll(); } catch {} });
