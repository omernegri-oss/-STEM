// Supermarket – client entry point: menus, lobby, networking glue and the main loop.
import * as THREE from 'three';
import { PLAYER_COLORS, PLAYER_ROLES, PRODUCT_MAP, FURNITURE, LIGHTS, FLOOR_H, fmtMoney, shelfPrice } from '/shared/data.js';
import { heightAt } from '/shared/grid.js';
import { slotCap } from '/shared/data.js';
import { Net } from './net.js';
import { OnlineHost, OnlineNet, localServerSocket, onlineAvailable } from './online.js';
import { createScene } from './scene.js';
import { prewarmTextures } from './textures.js';
import { initTelemetry, reportBug, telemetryAllowed, setTelemetry } from './telemetry.js';
import { World } from './world.js';
import { Actors, carryModel } from './actors.js';
import { makeBaton, makeCart } from './models.js';
import { FX } from './fx.js';
import { Input, LocalPlayer, CameraRig, findInteraction, keyName } from './player.js';
import { BuildMode } from './build.js';
import { UI, esc } from './ui.js';
import { initAudio, play, audio, setVolumes } from './audio.js';
import { svg, setIcon, ROLE_ICON } from './icons.js';

const $ = (id) => document.getElementById(id);
const G = { me: null, code: '', world: null, meta: null, snap: null, players: [], started: false, host: false };
window.__G = G; // handy for debugging & automated tests

// ----------------------------------------------------------------------------------- profile
const prefs = { name: '', color: PLAYER_COLORS[0], role: 'manager' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('st_prefs') || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem('st_prefs', JSON.stringify(prefs)); } catch {} };
if (!prefs.name) prefs.name = ['Alex', 'Sam', 'Robin', 'Jules', 'Kai', 'Noa', 'Charlie'][Math.floor(Math.random() * 7)];

// ----------------------------------------------------------------------------------- 3D setup
// signs and packaging are drawn on canvases: wait (briefly) for the bundled fonts first
await Promise.race([
  Promise.all([...['700 20px "Barlow Condensed"', '600 20px Barlow', '700 20px Barlow', '900 20px "Playfair Display"', '20px "Archivo Black"', '20px Pacifico'].map(f => document.fonts.load(f)),
    ...['500 20px Heebo', '700 20px Heebo', '800 20px Heebo'].map(f => document.fonts.load(f, 'אבג'))]).catch(() => {}),
  new Promise(r => setTimeout(r, 2500)),
]);
const canvas = $('game'); canvas.tabIndex = 0;
// graphics quality: low / medium (default) / high. The player's own choice is remembered; without one, weak
// devices start in low, and the game steps down by itself if it runs slowly
const GFX = ['low', 'medium', 'high'];
let gfxChoice = null; try { gfxChoice = localStorage.getItem('st_gfx'); } catch {}
if (!GFX.includes(gfxChoice)) gfxChoice = null;
let gfx = gfxChoice || 'medium';
if (/[?&]low/.test(location.search)) gfx = 'low';
else if (!gfxChoice && (matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4))) gfx = 'low';
let gfxAuto = true; try { gfxAuto = localStorage.getItem('st_gfx_auto') !== '0'; } catch {}
const S = createScene(canvas, { quality: gfx });
prewarmTextures();
const world = new World(S.scene);
const actors = new Actors(S.scene);
const fx = new FX(S.scene);
const input = new Input(canvas);
const me = new LocalPlayer();
const rig = new CameraRig(S.camera);
try { rig.fps = localStorage.getItem('st_cam') !== 'tps'; } catch {}
// first-person view model: whatever you hold, in front of the camera
const viewModel = new THREE.Group(); S.camera.add(viewModel); viewModel.position.set(0.18, -0.36, -0.62);
const fist = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: 0xeac09a, roughness: 0.6 }));
fist.scale.set(1, 0.9, 1.3); fist.position.set(0.12, 0.05, 0.1); fist.visible = false; viewModel.add(fist);
let viewKey = '', punchT = 0, batonT = 0;
const batonVM = makeBaton(); batonVM.visible = false; viewModel.add(batonVM);
// first person: the shopping cart you push, on the floor in front of you (follows where you face, not where you look)
const cartVM = new THREE.Group(); cartVM.visible = false; S.scene.add(cartVM);
let cartVMKey = null;
function syncCartVM() {
  const on = !!(G.cart && rig.fps && !build.active && G.started);
  cartVM.visible = on; if (!on) return;
  const key = (G.carry || []).join(',');
  if (key !== cartVMKey) {
    cartVMKey = key; cartVM.clear();
    const c = makeCart(); c.position.set(0, 0, 0.95); cartVM.add(c);
    (G.carry || []).forEach((pid, i, arr) => { const b = carryModel(pid); b.scale.setScalar(0.8); b.position.set((i % 2 ? 0.11 : -0.11) * (arr.length > 1 ? 1 : 0), 0.53 + Math.floor(i / 2) * 0.3, 0.95 + (i % 2 ? -0.12 : 0.14)); cartVM.add(b); });
  }
  cartVM.position.set(me.x, me.y || 0, me.z); cartVM.rotation.y = me.rot;
}
function syncViewModel() {
  syncCartVM();
  if (G.cart) { for (const c of [...viewModel.children]) if (c !== fist && c !== batonVM) viewModel.remove(c); batonVM.visible = false; viewKey = 'cart'; return; }
  const top = (G.carry || []).at(-1) || '';
  const key = (rig.fps && !build.active ? 'fps' : '') + top + (G.carry || []).length + (G.baton ? 'b' : '');
  if (key === viewKey) return; viewKey = key;
  for (const c of [...viewModel.children]) if (c !== fist && c !== batonVM) viewModel.remove(c);
  batonVM.visible = !!(rig.fps && !build.active && G.baton && !top);
  if (!rig.fps || build.active || !top) return;
  const m = carryModel(top); m.position.set(-0.18, -0.05, -0.05); m.rotation.y = Math.PI; viewModel.add(m);
  for (const sd of [-1, 1]) { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: 0xeac09a, roughness: 0.6 })); a.rotation.x = Math.PI / 2.4; a.position.set(-0.18 + sd * 0.24, -0.02, 0.12); viewModel.add(a); }
}
function setCamMode(fpsOn) { rig.fps = fpsOn; try { localStorage.setItem('st_cam', fpsOn ? 'fps' : 'tps'); } catch {} if (!fpsOn && document.pointerLockElement) document.exitPointerLock(); viewKey = ''; }
canvas.addEventListener('click', () => { if (G.started && rig.fps && !build.active && !ui.panel && !document.pointerLockElement && $('hud') && !$('hud').classList.contains('hidden')) canvas.requestPointerLock?.(); });
// Where the store runs: the static web version runs the authoritative server inside the page; the desktop app
// (and `npm start`) talk to a game server over a WebSocket. A player who joins a friend online by store code
// reloads into OnlineNet, which talks to the friend's computer over WebRTC (client/js/online.js).
let onlineJoin = null;
try { onlineJoin = JSON.parse(sessionStorage.getItem('st_online_join') || 'null'); sessionStorage.removeItem('st_online_join'); } catch {}
const net = onlineJoin ? new OnlineNet(onlineJoin.code) : window.ST_STATIC ? new (await import('./localserver.js')).LocalNet() : new Net();
// the host side: while you are in your own store, friends can join it online with its code
const host = new OnlineHost(window.ST_STATIC ? () => net.openRemote() : localServerSocket);
const ownServer = window.ST_STATIC || window.desktopApp; // the store runs on this computer (no shared server)
if (ownServer) document.querySelector('label.check')?.classList.add('hidden');
if (!onlineAvailable()) $('m-online-note').textContent = 'Online play is not available in this browser.';
let envKey = '';
S.buildEnvironment(12, 9);
world.set({ name: 'Supermarket', w: 12, d: 9, doorX: 5, floor: 'checker', wall: 'cream', furniture: demoFurniture(), boxes: [], dirt: [], prices: {} });

const ui = new UI({ G, net, onPanel: (p) => togglePanel(p) });
// if the graphics card runs out of memory the browser drops the 3D context: save, then reload in low graphics
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  try { localStorage.setItem('st_gfx', 'low'); } catch {}
  reportBug('The 3D context was lost (graphics memory)', `graphics: ${gfx}`);
  try { net.room && net.room.save(); } catch {}
  const box = document.createElement('div'); box.id = 'gfx-lost';
  box.textContent = 'The graphics card ran out of memory. Your store is saved. Reloading in low graphics…';
  Object.assign(box.style, { position: 'fixed', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.85)', color: '#fff', font: '600 18px Nunito, system-ui, sans-serif', zIndex: 999, textAlign: 'center', padding: '24px' });
  document.body.appendChild(box);
  setTimeout(() => location.reload(), 1800);
});
// step the graphics down one level when the game runs too slowly on this device (can be turned off in Settings)
let perfT = 0, perfN = 0, slowWindows = 0, fpsNow = 0;
function setGfx(level, byPlayer) {
  gfx = level; S.setQuality(level);
  if (byPlayer) gfxChoice = level;
  try { localStorage.setItem('st_gfx', level); } catch {}
  syncSettings();
}
function watchPerf(dt) {
  perfT += dt; perfN++;
  if (perfT < 2) return;
  fpsNow = perfN / perfT;
  const el = $('fps'); if (el && !el.hidden) el.textContent = Math.round(fpsNow) + ' FPS';
  perfT = 0; perfN = 0;
  if (gfx === 'low' || !gfxAuto) return;
  slowWindows = fpsNow < 24 ? slowWindows + 1 : 0;
  if (slowWindows >= 3) {
    slowWindows = 0;
    const next = GFX[GFX.indexOf(gfx) - 1];
    setGfx(next, false);
    ui.system(`Graphics set to ${next} so the game runs smoothly (change it in Settings).`);
  }
}
// ----------------------------------------------------------------------------------- settings
const settings = { sens: 1, sfxVol: 0.7, musicVol: 0.7, fps: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('st_settings') || '{}')); } catch {}
const saveSettings = () => { try { localStorage.setItem('st_settings', JSON.stringify(settings)); localStorage.setItem('st_gfx_auto', gfxAuto ? '1' : '0'); } catch {} };
function applySettings() {
  rig.sens = settings.sens;
  setVolumes(settings.sfxVol, settings.musicVol);
  $('fps').hidden = !settings.fps;
}
function syncSettings() {
  document.querySelectorAll('#set-gfx button').forEach(b => b.classList.toggle('sel', b.dataset.gfx === gfx));
  $('set-auto').checked = gfxAuto; $('set-fps').checked = settings.fps; $('set-stats').checked = telemetryAllowed();
  $('set-sens').value = settings.sens; $('set-sens-v').textContent = settings.sens.toFixed(1) + '×';
  $('set-sfx').value = Math.round(settings.sfxVol * 100); $('set-sfx-v').textContent = Math.round(settings.sfxVol * 100) + '%';
  $('set-music').value = Math.round(settings.musicVol * 100); $('set-music-v').textContent = Math.round(settings.musicVol * 100) + '%';
}
const toggleSettings = (on) => { const el = $('settings'); const show = on === undefined ? el.classList.contains('hidden') : on; el.classList.toggle('hidden', !show); if (show) { syncSettings(); if (document.pointerLockElement) document.exitPointerLock(); } };
$('set-gfx').onclick = (e) => { const b = e.target.closest('button'); if (b) setGfx(b.dataset.gfx, true); };
$('set-auto').onchange = (e) => { gfxAuto = e.target.checked; saveSettings(); };
$('set-fps').onchange = (e) => { settings.fps = e.target.checked; saveSettings(); applySettings(); };
$('set-stats').onchange = (e) => setTelemetry(e.target.checked);
$('set-sens').oninput = (e) => { settings.sens = +e.target.value; saveSettings(); applySettings(); syncSettings();
initTelemetry(() => ({ inStore: !!(G.code && G.started), where: G.started && G.code ? (net.online ? 'in a friend\'s store' : 'in own store') : G.code ? 'lobby' : 'menu' })); };
$('set-sfx').oninput = (e) => { initAudio(); settings.sfxVol = e.target.value / 100; saveSettings(); applySettings(); syncSettings(); };
$('set-sfx').onchange = () => play('click');
$('set-music').oninput = (e) => { initAudio(); settings.musicVol = e.target.value / 100; saveSettings(); applySettings(); syncSettings(); };
$('set-close').onclick = () => toggleSettings(false);
$('h-settings').onclick = () => toggleSettings();
$('m-settings').onclick = () => toggleSettings(true);
const toggleHelp = (on) => $('help').classList.toggle('hidden', on === undefined ? undefined : !on);
$('h-help').onclick = () => toggleHelp();
$('h-exit').onclick = async () => { if (await ui.ask('Leave this store? Your team keeps playing and progress is saved.', 'Leave')) { net.send({ t: 'leave' }); G.code = ''; host.stop(); setTimeout(() => location.reload(), 150); } };
$('help-close').onclick = () => toggleHelp(false);
// ----------------------------------------------------------------------------------- desktop app / downloads
const desk = window.desktopApp || null;
// desktop downloads: the newest GitHub release (fixed file names, see .github/workflows/desktop.yml)
const RELEASES = 'https://github.com/omernegri-oss/-STEM/releases/latest/download/';
if (!desk) {
  $('dl-win').href = RELEASES + 'Supermarket-windows-setup.exe';
  $('dl-mac').href = RELEASES + 'Supermarket-mac.zip';
  $('dl-linux').href = RELEASES + 'Supermarket-linux.tar.gz';
  for (const id of ['dl-win', 'dl-mac', 'dl-linux']) $(id).insertAdjacentHTML('afterbegin', svg('download', 16));
  $('dl-page').href = 'https://github.com/omernegri-oss/-STEM/releases/latest';
  for (const id of ['dl-win', 'dl-mac', 'dl-linux']) $(id).addEventListener('click', () => { $('dl-started').hidden = false; });
  $('m-download').hidden = false;
} else {
  document.body.classList.add('desktop');
  document.querySelectorAll('.desk-only').forEach(el => { el.hidden = false; });
  $('m-quit').onclick = () => desk.quit();
  $('m-fullscreen').onclick = () => desk.fullscreen();
}
// the website goes fullscreen when you start playing (browsers only allow it right after a click); Esc leaves it
function goFullscreen() {
  if (desk || navigator.webdriver || document.fullscreenElement || !document.documentElement.requestFullscreen || /[?&]windowed/.test(location.search)) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}
for (const id of ['m-create', 'm-join', 'm-rooms', 'm-saves']) $(id).addEventListener('click', (e) => { if (e.target.closest('button')) goFullscreen(); }, true);
// after joining a friend (the page reloads) the first click in the store goes fullscreen
let fsAsked = false; canvas.addEventListener('click', () => { if (!fsAsked && onlineJoin) { fsAsked = true; goFullscreen(); } });
// ----------------------------------------------------------------------------------- online play by store code
const ONLINE_TEXT = {
  connecting: () => 'Opening your store to friends online…',
  online: () => host.friends ? `Online: ${host.friends} friend${host.friends > 1 ? 's' : ''} connected through the internet.` : 'Online: friends join from anywhere by typing this code and pressing Join with code. Keep this game open while they play.',
  error: (d) => `Online play is off: ${d || 'could not reach the online service.'} Friends can't join right now.`,
};
host.onStatus = (st, detail) => {
  const el = $('l-online'); if (!el) return;
  if (net.online) { el.textContent = 'Connected to your friend\'s store over the internet.'; el.className = 'online-status ok'; return; }
  el.textContent = ONLINE_TEXT[st] ? ONLINE_TEXT[st](detail) : ''; el.className = `online-status${st === 'online' ? ' ok' : st === 'error' ? ' bad' : ''}`;
};
// open your store for online friends once you are its host (the guest who joined online never hosts)
function onlineSync() {
  if (net.online) { host.onStatus('online'); return; }
  if (G.host && G.code) host.start(G.code);
}
// joining a friend online: reload the page into OnlineNet with the code
function joinOnline(code) {
  if (!onlineAvailable()) return ui.error('Online play is not available in this browser.');
  try { sessionStorage.setItem('st_online_join', JSON.stringify({ code })); } catch {}
  location.reload();
}
if (onlineJoin) setTimeout(async () => {
  loading(true, `Connecting to store ${onlineJoin.code}…`);
  net.onStage = (text) => loading(true, text); // each step of the connection, so a slow one doesn't look stuck
  try { await net.connect(); } catch (e) {
    // a wrong code is the player's typo, not a fault; anything else is worth knowing about
    if (!/No store with code/.test(e.message || '')) reportBug('Joining a friend failed: ' + (e.message || 'unknown'), 'online join');
    loading(true, `${e.message || 'Could not connect.'} Returning to the menu…`); setTimeout(() => location.reload(), 6000); return;
  }
  loading(false); initAudio();
  net.send({ t: 'join', code: onlineJoin.code, name: prefs.name || 'Player', color: prefs.color });
}, 0);
// line icons on the top bar, dock and menu buttons
for (const [id, ic] of [['h-sfx', 'speaker'], ['h-music', 'music'], ['h-settings', 'settings'], ['h-help', 'help'], ['h-exit', 'exit']]) setIcon($(id), ic, 16);
setIcon(document.querySelector('[data-speed="0"]'), 'pause', 14);
for (const [p, ic] of [['build', 'layout'], ['inventory', 'box'], ['finance', 'chart'], ['stats', 'award']]) setIcon(document.querySelector(`#dock [data-panel="${p}"] i`), ic, 22);
window.__dbg = { net, me, rig, ui, world, S, fx, actors };
const build = new BuildMode({ scene: S.scene, camera: S.camera, world, net, G, ui, rig });
window.__dbg.build = build;

function togglePanel(p) {
  if (!G.started) return;
  if (document.pointerLockElement) document.exitPointerLock();
  if (p === 'build') { ui.closePanel(); build.toggle(me); syncDock(); return; }
  if (build.active) build.exit();
  ui.openPanel(p); syncDock();
}
function syncDock() { document.querySelector('#dock button[data-panel="build"]').classList.toggle('sel', build.active); }

// ----------------------------------------------------------------------------------- menu
function renderColors(el, sel, onPick) {
  el.innerHTML = PLAYER_COLORS.map(c => `<button style="background:${c}" class="${c === sel ? 'sel' : ''}" data-c="${c}"></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button'); if (b) onPick(b.dataset.c); };
}
$('m-name').value = prefs.name;
$('m-name').addEventListener('input', e => { prefs.name = e.target.value.slice(0, 16); savePrefs(); });
function pickColor(c) { prefs.color = c; savePrefs(); renderColors($('m-colors'), c, pickColor); }
renderColors($('m-colors'), prefs.color, pickColor);

function showScreen(id) { for (const s of ['menu', 'lobby']) $(s).classList.toggle('hidden', s !== id); $('hud').classList.toggle('hidden', id !== 'hud'); }
function loading(on, text = 'Connecting…') { $('loading').classList.toggle('hidden', !on); $('loading').querySelector('p').textContent = text; }

async function ensureNet() {
  if (net.open || net.online) return;
  loading(true);
  try { await net.connect(); } catch { loading(true, 'Could not reach the server. Is it running?'); throw new Error('no server'); }
  loading(false);
}
async function refreshLists() { if (net.online) return; try { await ensureNet(); net.send({ t: 'list' }); } catch {} }
$('m-create').onclick = async () => { initAudio(); await ensureNet(); net.send({ t: 'create', name: prefs.name || 'Player', color: prefs.color, isPublic: $('m-public').checked }); };
$('m-join').onclick = async () => {
  initAudio(); const code = $('m-code').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) return ui.error('Enter the 5-letter store code');
  // your own computer has no friends' stores: go online. A shared game server first looks for the store itself.
  if (ownServer) return joinOnline(code);
  pendingJoin = code; await ensureNet(); net.send({ t: 'join', code, name: prefs.name || 'Player', color: prefs.color });
};
let pendingJoin = '';
$('m-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('m-join').click(); });
$('m-rooms').onclick = async (e) => { const b = e.target.closest('[data-join]'); if (!b) return; initAudio(); await ensureNet(); net.send({ t: 'join', code: b.dataset.join, name: prefs.name, color: prefs.color }); };
$('m-saves').onclick = async (e) => { const b = e.target.closest('[data-load]'); if (!b) return; initAudio(); await ensureNet(); net.send({ t: 'create', load: b.dataset.load, name: prefs.name, color: prefs.color, isPublic: $('m-public').checked }); };
setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshLists(); }, 4000);
refreshLists();

// lobby
$('l-copy').onclick = () => { navigator.clipboard?.writeText(G.code); ui.toast('Store code copied. Send it to your friends.', 'info', ''); };
$('l-leave').onclick = () => { net.send({ t: 'leave' }); G.code = ''; host.stop(); if (net.online) { location.reload(); return; } showScreen('menu'); refreshLists(); };
$('l-start').onclick = () => net.send({ t: 'start' });
$('l-roles').innerHTML = Object.entries(PLAYER_ROLES).map(([k, r]) => `<button data-role="${k}" title="${esc(r.desc)}">${svg(ROLE_ICON[k] || 'users', 16)} ${esc(r.name)}</button>`).join('');
$('l-roles').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; prefs.role = b.dataset.role; savePrefs(); net.send({ t: 'lobby', role: prefs.role }); };

// ----------------------------------------------------------------------------------- network
net.on('rooms', (m) => {
  $('m-rooms').innerHTML = m.rooms.length ? m.rooms.map(r => `<div class="item"><span><b>${esc(r.name)}</b><small>${r.players}/${r.max} players · ${r.started ? 'Day ' + r.day : 'in lobby'}</small></span><button class="btn small primary" data-join="${r.code}">Join</button></div>`).join('') : '<i>No open stores — create one!</i>';
  $('m-saves').innerHTML = m.saves.length ? m.saves.map(s => `<div class="item"><span><b>${esc(s.name)}</b><small>Day ${s.day} · Lv ${s.level} · ${fmtMoney(s.cash)}</small></span><button class="btn small" data-load="${s.code}">Continue</button></div>`).join('') : '<i>None yet</i>';
});
net.on('err', (m) => {
  // not a store on this game server: try a friend's store online
  if (pendingJoin && !G.code && /No store with that code/.test(m.text) && onlineAvailable()) { const c = pendingJoin; pendingJoin = ''; joinOnline(c); return; }
  pendingJoin = '';
  ui.error(m.text);
  if (net.online && !G.code) { loading(true, m.text + ' Returning to the menu…'); setTimeout(() => location.reload(), 2500); }
});
net.on('joined', (m) => {
  pendingJoin = ''; G.me = m.id; G.code = m.code; G.started = m.started;
  net.send({ t: 'lobby', role: prefs.role });
  if (!m.started) showScreen('lobby');
});
net.on('lobby', (m) => {
  G.code = m.code;
  const mine = m.players.find(p => p.id === G.me); G.host = !!(mine && mine.host);
  $('l-code').textContent = m.code;
  $('l-sub').textContent = m.loaded ? `Continuing "${m.storeName}" — Day ${m.day}` : 'A brand-new, completely empty supermarket awaits.';
  $('l-players').innerHTML = [0, 1, 2, 3].map(i => {
    const p = m.players[i];
    return p ? `<div class="lp"><span class="dot" style="background:${esc(p.color)}">${svg(ROLE_ICON[p.role] || 'users', 15)}</span><span>${esc(p.name)}${p.host ? ' ' : ''}${p.id === G.me ? ' (you)' : ''}<small>${esc(PLAYER_ROLES[p.role]?.name || '')}</small></span></div>` : '<div class="lp empty"><span class="dot" style="background:#cbd5e1">+</span><span>Waiting for player…<small>Share the code!</small></span></div>';
  }).join('');
  document.querySelectorAll('#l-roles button').forEach(b => b.classList.toggle('sel', mine && b.dataset.role === mine.role));
  $('l-start').classList.toggle('hidden', !G.host);
  $('l-wait').textContent = G.host ? 'You are the host. Start when your team is ready (others can also join later).' : 'Waiting for the host to start…';
  if (m.started && !G.started) { G.started = true; }
  if (m.started && $('hud').classList.contains('hidden') && G.code) enterGame();
  onlineSync();
});
net.on('pl', (m) => { G.players = m.players; actors.setPlayersInfo(m.players); });
net.on('w', (m) => {
  const w = m.world; G.world = w;
  const key = `${w.w}x${w.d}`;
  if (key !== envKey) { envKey = key; S.buildEnvironment(w.w, w.d); if (build.active) build.showGrid(true); }
  world.set(w);
  ui.markDirty(); if (build.active) build.render();
  if (!G.started) { G.started = true; enterGame(); }
});
net.on('m', (m) => {
  const prev = G.meta; G.meta = m.meta; ui.markDirty(); maybeFirstHelp();
  if (build.active && (!prev || prev.cash !== m.meta.cash || prev.level !== m.meta.level)) build.render();
  ui.updateHud();
});
let firstSnap = true;
net.on('s', (s) => {
  G.snap = s;
  const mine = s.P.find(p => p[0] === G.me);
  if (mine) {
    if (firstSnap) { me.x = mine[1]; me.z = mine[2]; me.rot = mine[3]; me.floor = mine[8] || 0; firstSnap = false; }
    const prevTop = (G.carry || []).at(-1);
    G.carry = mine[5]; G.station = mine[6];
    // the server decides whether the baton is out (it goes away when you pick something up); right after
    // pressing 1 the local choice wins until the server has heard it
    if (performance.now() - (G.batonHold || 0) > 600) G.baton = !!mine[10];
    G.cart = !!mine[11]; G.topRaw = !!mine[12];
    if ((G.carry || []).at(-1) !== prevTop) G.deptProgress = 0;
  }
  actors.applySnapshot(s, G.me, me);
  world.setCheckouts(s.K);
});
net.on('chat', (m) => { ui.chat(m.from, m.color, m.text); play('pop'); });
net.on('close', () => {
  if (net.online) { loading(true, 'Your friend closed the store or the internet connection was lost. Returning to the menu…'); setTimeout(() => location.reload(), 3000); return; }
  if (G.code) { loading(true, 'Disconnected from server. Refresh the page to reconnect.'); }
});

net.on('fx', (m) => {
  switch (m.k) {
    case 'err': ui.error(m.text); break;
    case 'snd': play(m.name, m.x, m.z); break;
    case 'float': break; // money shows in the top bar (no floating numbers in the world)
    case 'levelup': ui.system(`Store level ${m.level}. New products and fixtures are available on the computer.`); play('levelup'); break;
    case 'report': ui.showReport(m.report); break;
    case 'delivery': ui.system(`Delivery from ${m.name} is at the loading zone.`); fx.truck(m.x, m.z, m.supplier); setTimeout(() => play('honk', m.x, m.z), 2200); break;
    case 'stocked': {
      const e = world.furn.get(m.id); if (!e) break;
      const src = m.by > 0 ? actors.players.get(m.by) : actors.staff.get(-m.by);
      const p = PRODUCT_MAP[m.pid];
      const yb = (e.data.floor || 0) * FLOOR_H;
      void src; void p; void yb;
      play('pop', e.group.position.x, e.group.position.z); setTimeout(() => play('pop', e.group.position.x, e.group.position.z), 90);
      break;
    }
    case 'placed': case 'named': case 'expanded': break;
    case 'bankrupt': play('dayend'); break;
    case 'ping': fx.ping(m.x, m.z, m.color, m.name); play('ping', m.x, m.z); break;
    case 'swing': actors.swing(m.id); break;
    case 'baked': ui.system(`${PRODUCT_MAP[m.pid]?.name || 'Bread'} is baked. Take it out of the oven.`); break;
    case 'thief': ui.error('A shoplifter is walking out without paying. Stop them before the door!'); play('alarm', m.x, m.z); break;
    case 'caught': ui.system(`${m.by} caught a shoplifter. ${fmtMoney(m.value)} of goods are back on the shelves.`); play('sparkle', m.x, m.z); break;
    case 'pow': play('punch', m.x, m.z); break;
    case 'knock': if (m.id === G.me) { me.knock(m.dx, m.dz, m.baton ? 3200 : 2000); rig.shake = m.baton ? 0.9 : 0.6; ui.error(m.baton ? `${m.by} hit you with a baton.` : `${m.by} punched you.`); } break;
  }
});

function enterGame() {
  showScreen('hud');
  ui.updateHud(); ui.renderSide();
  canvas.focus();
  helpPending = true; maybeFirstHelp();
}
// first-time help opens once the store has a name (never on top of the naming screen)
let helpPending = false;
function maybeFirstHelp() {
  if (!helpPending || !G.meta || G.meta.phase === 'naming') return;
  helpPending = false;
  try { if (!localStorage.getItem('st_seen_help')) { toggleHelp(true); localStorage.setItem('st_seen_help', '1'); } } catch {}
}

// ----------------------------------------------------------------------------------- key commands
const PANEL_KEYS = { b: 'build', i: 'inventory', m: 'finance', k: 'stats' };
// 1: baton out / away. 2-7: body gestures (sent as short codes, shown as animations)
const EMOTES = { 2: 'wave', 3: 'pnt', 4: 'thum', 5: 'shrg', 6: 'clap', 7: 'nod' };
function toggleBaton() {
  if (!G.baton && (G.carry || []).length) { ui.error('Put down what you are carrying first.'); return; }
  G.baton = !G.baton; G.batonHold = performance.now(); net.act('baton'); play('click');
}
function swingBaton() {
  if (batonT > 0) return;
  net.act('punch', { weapon: 'baton' }); actors.swing(G.me); batonT = 0.35; play('whoosh');
}
addEventListener('keydown', (e) => {
  initAudio();
  if (!G.started || $('hud').classList.contains('hidden')) return;
  if (input.typing()) return;
  const k = keyName(e);
  if (k === 'enter') { $('chat-input').focus(); e.preventDefault(); return; }
  if (k === '?' || k === 'f1') { toggleHelp(); e.preventDefault(); return; }
  if (k === 'escape') {
    if (!$('settings').classList.contains('hidden')) { toggleSettings(false); return; }
    if (!$('help').classList.contains('hidden')) { toggleHelp(false); return; }
    if (ui.panel) { ui.closePanel(); return; }
    return; // build mode handles its own escape
  }
  if (build.active && ['u', 'x', 'm', 'r', 'p'].includes(k)) return; // build-mode shortcuts
  if (k === 'f' && !build.active && G.meta?.phase !== 'naming') { net.act('punch'); actors.swing(G.me); punchT = 0.3; play('whoosh'); return; }
  if (k === 'v' && !build.active) { setCamMode(!rig.fps); return; }
  if (PANEL_KEYS[k] && G.meta?.phase !== 'naming') { togglePanel(PANEL_KEYS[k]); e.preventDefault(); return; }
  if (k === '1' && !build.active && G.meta?.phase !== 'naming') { toggleBaton(); return; }
  if (EMOTES[k]) { net.send({ t: 'emote', e: EMOTES[k] }); return; }
  if (k === 'g' && !build.active) {
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, S.camera);
    const p = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -me.floor * FLOOR_H), p)) net.send({ t: 'ping', x: p.x, z: p.z, floor: me.floor });
  }
});
addEventListener('mousedown', () => initAudio());

applySettings(); syncSettings();
// ----------------------------------------------------------------------------------- main loop
let last = performance.now(), sendT = 0, holdT = 0, tasksT = 0, lastInter = null, stepT = 0;
let currentInter = null, payGoneT = 0;
function frame(now) {
  window.__frames = (window.__frames || 0) + 1;
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt); last = now;
  const inGame = G.started && G.world && !$('hud').classList.contains('hidden');
  if (!document.hidden && rawDt < 1 && (inGame || settings.fps)) watchPerf(rawDt);
  if (inGame) {
    if (!build.active) {
      const blockMove = G.meta?.phase === 'naming';
      // walk by real elapsed time, so a slow computer doesn't make you crawl; collisions in small steps
      if (!blockMove) { let left = Math.min(rawDt, 0.25); while (left > 1e-4) { const step = Math.min(left, 0.04); me.update(step, input, rig.yaw, world, (G.carry || []).length); left -= step; } }
      me.y = heightAt(G.world.w, G.world.floors || 1, me.floor, me.x, me.z);
      me.fpsReady = true;
      rig.update(dt, input, me);
      if (rig.fps) me.rot = rig.yaw + Math.PI;
    } else {
      build.update(dt, input);
      rig.update(dt, input, build.focus);
    }
    audio.listener.x = me.x; audio.listener.z = me.z;
    if (me.moving) { stepT += dt; if (stepT > 0.32) { stepT = 0; play('step'); } }
    // send our position
    sendT += dt;
    if (sendT > 1 / 15) { sendT = 0; net.send({ t: 'p', x: +me.x.toFixed(2), z: +me.z.toFixed(2), rot: +me.rot.toFixed(2), anim: me.moving ? 1 : 0, floor: me.floor }); }
    const viewFloor = build.active ? build.floor : ((me.y || 0) > 1.8 ? 1 : 0);
    world.setViewFloor(viewFloor); actors.setDims(G.world.w, G.world.floors || 1, viewFloor);
    if (ui.panel && ui.isComputerTab(ui.panel)) { const c = G.world.furniture.find(f => f.type === 'computer' && (f.floor || 0) === me.floor && world.fixtureDistance(f, me.x, me.z) < 2.6); if (!c) ui.closePanel(); }
    // interaction
    const fpsView = rig.fps && !build.active;
    currentInter = build.active ? null : findInteraction(G, world, me, G.carry || [], G.station, fpsView);
    // aiming at a shelf price label (empty hands): E or click opens the price calculator
    aimedTag = null;
    if (!build.active && !G.station && !(G.carry || []).length && G.meta?.phase !== 'naming' && !ui.panel && (fpsView ? input.mouse.locked : true)) {
      aimedTag = aimTag(fpsView ? { x: 0, y: 0 } : { x: input.mouse.nx, y: input.mouse.ny }, fpsView);
      if (aimedTag) {
        const p = PRODUCT_MAP[aimedTag.pid], price = shelfPrice(G.world, p.id);
        currentInter = { label: `${p.name}  $${price.toFixed(2)}  ·  ${fpsView ? 'E or click' : 'E or click the label'}: price calculator`, action: { a: '_price', pid: p.id } };
      }
    }
    actors.hideLocal = fpsView; world.setCeilingVisible(fpsView);
    syncViewModel();
    if (batonT > 0) batonT -= dt;
    batonVM.position.set(0.2, -0.1 + (me.moving ? Math.sin(rig.bob * 2) * 0.01 : 0), -0.3);
    batonVM.rotation.set(0.55 - (batonT > 0 ? Math.sin((0.35 - batonT) / 0.35 * Math.PI) * 1.5 : 0), -0.25, 0);
    if (punchT > 0) { punchT -= dt; fist.visible = fpsView && !(G.carry || []).length; fist.position.z = 0.1 - Math.sin((0.3 - punchT) / 0.3 * Math.PI) * 0.35; } else fist.visible = false;
    viewModel.position.y = -0.36 + (me.moving ? Math.sin(rig.bob * 2) * 0.008 : 0);
    $('crosshair').classList.toggle('hidden', !fpsView || !input.mouse.locked);
    $('crosshair').classList.toggle('hot', !!(currentInter && currentInter.action));
    $('lookhint').classList.toggle('hidden', !fpsView || input.mouse.locked || !!ui.panel || $('chat-input') === document.activeElement);
    window.__dbg.lastInter = currentInter;
    const pr = $('prompt');
    if (currentInter && currentInter.label) {
      const html = `${currentInter.action ? '<kbd>E</kbd>' : ''}<span class="${currentInter.warn ? 'warn' : ''}">${esc(currentInter.label)}</span>`;
      if (pr.innerHTML !== html) pr.innerHTML = html;
      pr.classList.remove('hidden');
    } else pr.classList.add('hidden');
    ui.stationBar(currentInter);
    // the payment window closes by itself when that customer is done (or leaves)
    if (ui.payFor) { const k = (G.snap?.K || []).find(k => k[0] === G.station); if (!k || k[1] !== ui.payFor) { payGoneT ||= now; if (now - payGoneT > 800) ui.closePayment(k ? `customer ${k[1]} at the register now` : `no register (station ${G.station})`); } else payGoneT = 0; } else payGoneT = 0;
    const carry = G.carry || [];
    const ce = $('carry');
    world.setCartsInUse(((G.snap?.C || []).filter(c => c[8] & 1).length) + ((G.snap?.P || []).filter(p => p[11]).length));
    const nameOf = (c) => c.startsWith('f:') ? FURNITURE[c.slice(2)].name + ' (box)' : c.includes(':') ? `${c.startsWith('raw') ? 'Raw' : 'Wrapped'} ${PRODUCT_MAP[c.split(':')[1]]?.name}` : PRODUCT_MAP[c]?.name;
    if (carry.length && !build.active) { const t = `${G.cart ? 'In the cart' : 'Carrying'}: ${carry.map((c, i) => nameOf(c) + (G.topRaw && i === carry.length - 1 ? ' dough' : '')).join(', ')}  ·  Q ${G.cart ? 'take one out' : 'drop'}`; if (ce.textContent !== t) ce.textContent = t; ce.classList.remove('hidden'); } else ce.classList.add('hidden');
    me.cutting = !!(currentInter && currentInter.cutting && input.down('e'));
    const doAct = (a) => {
      if (a.a === '_pay') { if (document.pointerLockElement) document.exitPointerLock(); ui.payment(a); return; }
      if (a.a === '_price') { if (document.pointerLockElement) document.exitPointerLock(); ui.priceCalc(a.pid); return; }
      if (a.a === '_computer') { if (document.pointerLockElement) document.exitPointerLock(); ui.openComputer(); return; }
      if (a.a === '_place') { const top = (G.carry || []).at(-1); if (top && top.startsWith('f:')) { build.enter(me, top.slice(2)); syncDock(); } return; }
      if (a.a === 'deptCut') G.deptProgress = (G.deptProgress || 0) + 1;
      net.act(a.a, a);
    };
    if (!input.typing() && !build.active && !me.stunned) {
      if (currentInter && currentInter.action) {
        if (input.hit('e') || input.hit(' ')) { doAct(currentInter.action); holdT = now; }
        else if ((input.down('e') || input.down(' ')) && currentInter.repeat && now - holdT > 190) { holdT = now; doAct(currentInter.action); }
      }
      const click = input.mouse.clicked;
      // first person: left click = interact, right click = drop
      if (click && fpsView && input.mouse.locked && !(G.station && world.beltItems.length)) {
        if (click.button === 0 && G.baton && !(G.carry || []).length && G.meta?.phase !== 'naming') swingBaton();
        else if (click.button === 0 && currentInter && currentInter.action) doAct(currentInter.action);
        if (click.button === 2) net.act('drop');
      }
      if (click && click.button === 0 && !fpsView && G.baton && !(G.carry || []).length && G.meta?.phase !== 'naming' && !G.station) swingBaton();
      else if (click && click.button === 0 && !fpsView && aimedTag) doAct({ a: '_price', pid: aimedTag.pid });
      if (click && click.button === 0 && G.station && world.beltItems.length) {
        const ray = new THREE.Raycaster(); ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, S.camera);
        const hit = ray.intersectObjects(world.beltItems.filter(m => m.visible), false)[0];
        if (hit) { net.act('work'); hit.object.visible = false; } // it moves to the bagging area once the scan comes back
      }
      if (currentInter && currentInter.alt && input.hit('x')) net.act(currentInter.alt.a, currentInter.alt);
      if (input.hit('q')) net.act('drop');
    }
    tasksT += dt; if (tasksT > 0.5) { tasksT = 0; ui.renderSide(); ui.updateHud(); }
    ui.tickHud(dt);
    ui.maybeRender();
  } else {
    // menu: slow orbit around the demo store
    rig.yaw += dt * 0.08; rig.pitch = 0.75; rig.dist = 17;
    rig.update(dt, { mouse: { dragging: false, wheel: 0 }, typing: () => true, down: () => false }, { x: 6, z: 5 });
  }
  const ls = LIGHTS.find(l => l.id === G.world?.lighting) || LIGHTS[0];
  const lighting = S.updateLighting(G.snap ? G.snap.time : 11 * 60, G.snap ? G.snap.phase : 'open', ls.id, ls.color);
  void lighting;
  actors.update(dt, inGame ? me : null);
  const chars = actors.positions(); if (inGame) chars.push(me);
  world.update(dt, chars, S.camera, inGame ? me : null);
  fx.update(dt);
  S.render();
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// which shelf price label is under the crosshair (first person) or the mouse (third person)
let aimedTag = null;
const tagRay = new THREE.Raycaster(), tagPos = new THREE.Vector3();
const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
function aimTag(ndc, fps) {
  const tags = world.tagMeshes(); if (!tags.length) return null;
  tagRay.setFromCamera(ndc, S.camera); tagRay.far = fps ? 2.6 : 40;
  const hit = tagRay.intersectObjects(tags, false).find(h => shown(h.object));
  if (!hit) return null;
  hit.object.getWorldPosition(tagPos);
  if (!fps && Math.hypot(tagPos.x - me.x, tagPos.z - me.z) > 3.2) return null;
  return hit.object.userData.tag;
}

// A pretty little store for the main-menu background.
function demoFurniture() {
  const mk = (id, type, x, z, rot, fill) => {
    const def = FURNITURE[type];
    const f = { id, type, x, z, rot, upg: false, broken: false };
    if (def.slots) f.slots = Array.from({ length: def.slots }, (_, i) => fill ? { pid: fill[i % fill.length], qty: slotCap(type, fill[i % fill.length]) - (i * 3) % 5, exp: 99, expired: false } : { pid: null, qty: 0 });
    if (def.kind === 'rack') f.boxes = [{ pid: 'cereal' }, { pid: 'milk' }, { pid: 'soda' }];
    return f;
  };
  return [
    mk(1, 'shelf', 1, 1, 0, ['cereal', 'pasta', 'beans', 'chips']),
    mk(2, 'shelf', 4, 1, 0, ['soda', 'water', 'cookies', 'rice']),
    mk(3, 'fridge', 7, 0, 0, ['milk', 'yogurt', 'butter', 'eggs']),
    mk(4, 'freezer', 9, 3, 3, ['pizza', 'icecream']),
    mk(5, 'produce', 1, 4, 0, ['apples', 'bananas', 'tomatoes', 'lettuce']),
    mk(6, 'checkout', 7, 6, 0), mk(7, 'plant', 0, 7, 0), mk(8, 'plant', 11, 7, 0), mk(9, 'balloons', 4, 5, 0), mk(10, 'rack', 10, 0, 0),
  ];
}
