// Desktop (Steam) version: an Electron window around the game. The game server runs inside this process on
// 127.0.0.1, so the host's store lives here and friends join over Steam networking (see steam.mjs / p2p.mjs).
import { app, BrowserWindow, ipcMain, shell, Menu } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.setName('Supermarket');
// Steam's Linux runtime (also on Steam Deck) runs games in a container where Chromium's sandbox can't start.
// The game only shows its own local pages, so it is safe to turn it off there.
if (process.platform === 'linux' && (process.env.SteamAppId || process.env.SteamGameId || process.env.STEAM_COMPAT_DATA_PATH || process.argv.includes('--no-sandbox'))) app.commandLine.appendSwitch('no-sandbox'); // fixes the save folder: %APPDATA%/Supermarket, ~/Library/Application Support/Supermarket, ~/.config/Supermarket
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'steam-config.json'), 'utf8'));
const APP_ID = +process.env.STEAM_APP_ID || config.appId;
const TEST_APP_ID = 480; // Valve's public test app ("Spacewar"); replace with your own App ID in steam-config.json
const NO_STEAM = process.argv.includes('--no-steam') || process.env.SUPERMARKET_NO_STEAM === '1';

// ---------------------------------------------------------------------------------- Steam
let sw = null, steamworks = null, steamOff = NO_STEAM ? 'disabled' : '';
if (!NO_STEAM) {
  try {
    steamworks = require('steamworks.js');
    // a store build started outside Steam relaunches through Steam (not for the test app id)
    if (app.isPackaged && APP_ID !== TEST_APP_ID && steamworks.restartAppIfNecessary(APP_ID)) { app.exit(0); }
    sw = steamworks.init(APP_ID);
    steamworks.electronEnableSteamOverlay();
  } catch (e) {
    console.log('Steam not available, playing offline:', e.message);
    sw = null; steamOff = 'Steam not available: ' + e.message;
  }
}

// ---------------------------------------------------------------------------------- game server
process.env.SAVES_DIR = path.join(app.getPath('userData'), 'saves');
const { startServer, attachSocket } = await import('../server/index.js');
const { SteamService } = await import('./steam.mjs');

let win = null;
const steam = new SteamService(sw, {
  attachSocket,
  onJoin: (d) => { if (win) { win.webContents.send('steam-join', d); if (win.isMinimized()) win.restore(); win.focus(); } },
});
const server = startServer(0, { host: '127.0.0.1', quiet: true, routes: { '/steam-relay': (ws) => steam.pipe(ws) } });
const port = await server.ready;

// launched with "+connect_lobby <id>" (accepting an invite while the game was closed)
function lobbyFromArgs(argv) { const i = argv.indexOf('+connect_lobby'); return i >= 0 ? argv[i + 1] : null; }
const startLobby = lobbyFromArgs(process.argv);

// ---------------------------------------------------------------------------------- page bridge
ipcMain.on('steam-info', (e) => { e.returnValue = { ...steam.info(), port, version: app.getVersion(), offline: steamOff }; });
ipcMain.handle('steam-host', (e, { code, store }) => steam.host(code, store).catch(err => { console.log('lobby failed', err); return null; }));
ipcMain.handle('steam-invite', () => steam.invite());
ipcMain.handle('steam-leave', () => steam.leave());
ipcMain.on('steam-store-name', (e, name) => steam.setStoreName(name));
ipcMain.on('steam-achievement', (e, id) => steam.achievement(id));
ipcMain.on('app-quit', () => app.quit());
ipcMain.on('app-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#10161d', title: 'Supermarket',
    fullscreen: !!(sw && (() => { try { return sw.utils.isSteamRunningOnSteamDeck(); } catch { return false; } })()),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  // F11 toggles fullscreen; links to other sites open in the normal browser
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}/`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.loadURL(`http://127.0.0.1:${port}/`);
  if (startLobby) win.webContents.once('did-finish-load', () => steam.join(startLobby).catch(e => console.log('join failed', e)));
  win.on('closed', () => { win = null; });
}

// one window only: a second launch (e.g. accepting an invite from Steam) hands its lobby to this one
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', (e, argv) => {
  const lobby = lobbyFromArgs(argv); if (lobby) steam.join(lobby).catch(err => console.log('join failed', err));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { try { server.saveAll(); } catch {} steam.leave(); });
