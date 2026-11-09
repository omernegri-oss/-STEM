// Desktop version: an Electron window around the game. The game server runs inside this process on 127.0.0.1,
// so the host's store lives here. Friends join over the internet with the store code (WebRTC, see client/js/online.js).
import { app, BrowserWindow, ipcMain, shell, Menu, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
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
// every start writes its steps here, so a start that goes wrong can be looked at (%APPDATA%\Supermarket on Windows)
const START_LOG = path.join(app.getPath('userData'), 'startup-log.txt');
const t0 = Date.now();
function step(text) { try { fs.mkdirSync(path.dirname(START_LOG), { recursive: true }); fs.appendFileSync(START_LOG, `+${Date.now() - t0}ms ${text}\n`); } catch {} }
try { fs.mkdirSync(path.dirname(START_LOG), { recursive: true }); fs.writeFileSync(START_LOG, `Supermarket ${app.getVersion()} started ${new Date().toISOString()} on ${process.platform} ${process.getSystemVersion?.() || ''} (${process.arch})\n`); } catch {}

// graphics drivers that crash: after a crash, the next start uses software graphics (slower, but it runs)
const SAFE_GFX = path.join(app.getPath('userData'), 'safe-graphics');
const safeGfx = fs.existsSync(SAFE_GFX) || process.argv.includes('--safe-graphics');
if (safeGfx) { app.disableHardwareAcceleration(); step('safe graphics (no GPU)'); }
let gpuCrashes = 0;
app.on('child-process-gone', (e, d) => {
  logError('Process gone', `${d.type} ${d.reason} ${d.exitCode}`); step(`process gone: ${d.type} ${d.reason}`);
  if (d.type === 'GPU' && d.reason !== 'clean-exit' && !safeGfx && ++gpuCrashes >= 2) {
    try { fs.writeFileSync(SAFE_GFX, 'The graphics driver crashed; delete this file to try the graphics card again.'); } catch {}
    app.relaunch(); app.exit(0);
  }
});

// one copy only. Another copy holding the lock is often one stuck in the background with no window: offer to close
// it and start again, instead of quietly doing nothing (a second launch otherwise brings the running window to the front)
if (!app.requestSingleInstanceLock()) {
  step('another copy is running');
  await app.whenReady();
  const choice = dialog.showMessageBoxSync({
    type: 'question', title: 'Supermarket', buttons: ['Close it and start again', 'Cancel'], defaultId: 0, cancelId: 1,
    message: 'Supermarket is already running.',
    detail: "If you can't see its window, it is stuck in the background. Close it and start the game again?",
  });
  if (choice === 0) restartFresh();
  app.exit(0);
}
// close every running copy of the game, then start it again (runs after this process has exited)
function restartFresh() {
  const exe = process.execPath, name = path.basename(exe);
  step('closing the other copy and restarting');
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/d', '/c', `ping -n 2 127.0.0.1 >nul & taskkill /F /IM "${name}" >nul 2>&1 & ping -n 2 127.0.0.1 >nul & start "" "${exe}"`],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else {
    const target = process.platform === 'darwin' ? exe.replace(/\/Contents\/MacOS\/.*$/, '') : exe;
    const again = process.platform === 'darwin' ? `open "${target}"` : `"${target}" &`;
    spawn('sh', ['-c', `sleep 1; pkill -x "${name}"; sleep 1; ${again}`], { detached: true, stdio: 'ignore' }).unref();
  }
}
step('single copy ok');

// ---------------------------------------------------------------------------------- game server
let server = null, port = 0;
try {
  process.env.SAVES_DIR = path.join(app.getPath('userData'), 'saves');
  const { startServer } = await import('../server/index.js');
  server = startServer(0, { host: '127.0.0.1', quiet: true });
  port = await Promise.race([server.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('The game server did not start within 20 seconds.')), 20000))]);
  step(`game server on port ${port}`);
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
  win.webContents.on('did-finish-load', () => step('page loaded'));
  win.loadURL(`http://127.0.0.1:${port}/`);
  step('window open');
  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(createWindow).catch((e) => fatal('Opening the window', e));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server && server.saveAll(); } catch {} });
