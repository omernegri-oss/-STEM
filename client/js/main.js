// Supermarket – client entry point: menus, lobby, networking glue and the main loop.
import * as THREE from 'three';
import { PLAYER_COLORS, PLAYER_ROLES, PRODUCT_MAP, FURNITURE, LIGHTS, FLOOR_H, fmtMoney } from '/shared/data.js';
import { heightAt } from '/shared/grid.js';
import { slotCap } from '/shared/data.js';
import { Net } from './net.js';
import { createScene } from './scene.js';
import { World } from './world.js';
import { Actors, carryModel } from './actors.js';
import { FX } from './fx.js';
import { Input, LocalPlayer, CameraRig, findInteraction } from './player.js';
import { BuildMode } from './build.js';
import { UI, esc } from './ui.js';
import { initAudio, play, audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const G = { me: null, code: '', world: null, meta: null, snap: null, players: [], started: false, host: false };
window.__G = G; // handy for debugging & automated tests

// ----------------------------------------------------------------------------------- profile
const prefs = { name: '', color: PLAYER_COLORS[0], role: 'manager' };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('st_prefs') || '{}')); } catch {}
const savePrefs = () => { try { localStorage.setItem('st_prefs', JSON.stringify(prefs)); } catch {} };
if (!prefs.name && window.steamDesk?.info?.available) prefs.name = String(window.steamDesk.info.name || '').slice(0, 16);
if (!prefs.name) prefs.name = ['Alex', 'Sam', 'Robin', 'Jules', 'Kai', 'Noa', 'Charlie'][Math.floor(Math.random() * 7)];

// ----------------------------------------------------------------------------------- 3D setup
const canvas = $('game'); canvas.tabIndex = 0;
let lowGfx = /[?&]low/.test(location.search);
let gfxChoice = null; try { gfxChoice = localStorage.getItem('st_gfx'); } catch {}
if (gfxChoice === 'low') lowGfx = true;
// phones, tablets and low-memory computers start in low graphics unless the player picked high themselves
if (!gfxChoice && (matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4))) lowGfx = true;
const S = createScene(canvas, { low: lowGfx });
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
let viewKey = '', punchT = 0;
function syncViewModel() {
  const top = (G.carry || []).at(-1) || '';
  const key = (rig.fps && !build.active ? 'fps' : '') + top + (G.carry || []).length;
  if (key === viewKey) return; viewKey = key;
  for (const c of [...viewModel.children]) if (c !== fist) viewModel.remove(c);
  if (!rig.fps || build.active || !top) return;
  const m = carryModel(top); m.position.set(-0.18, -0.05, -0.05); m.rotation.y = Math.PI; viewModel.add(m);
  for (const sd of [-1, 1]) { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.32, 4, 8), new THREE.MeshStandardMaterial({ color: 0xeac09a, roughness: 0.6 })); a.rotation.x = Math.PI / 2.4; a.position.set(-0.18 + sd * 0.24, -0.02, 0.12); viewModel.add(a); }
}
function setCamMode(fpsOn) { rig.fps = fpsOn; try { localStorage.setItem('st_cam', fpsOn ? 'fps' : 'tps'); } catch {} if (!fpsOn && document.pointerLockElement) document.exitPointerLock(); viewKey = ''; }
canvas.addEventListener('click', () => { if (G.started && rig.fps && !build.active && !ui.panel && !document.pointerLockElement && $('hud') && !$('hud').classList.contains('hidden')) canvas.requestPointerLock?.(); });
// The static web version (no game server) runs the authoritative server inside the page.
const net = window.ST_STATIC ? new (await import('./localserver.js')).LocalNet() : new Net();
if (window.ST_STATIC) {
  document.querySelector('.join-row')?.classList.add('hidden');
  document.querySelector('label.check')?.classList.add('hidden');
  const note = document.createElement('p'); note.className = 'help';
  note.innerHTML = window.ST_MP_URL ? `Web version: you play in your browser (saved on this device). <b>Play with friends</b> on the <a href="${window.ST_MP_URL}">multiplayer server</a>.` : 'Web version: you play in your browser and your store is saved on this device.';
  document.querySelector('.menu-actions')?.appendChild(note);
}
let envKey = '';
S.buildEnvironment(12, 9);
world.set({ name: 'Supermarket', w: 12, d: 9, doorX: 5, floor: 'checker', wall: 'cream', furniture: demoFurniture(), boxes: [], dirt: [], prices: {} });

const ui = new UI({ G, net, onPanel: (p) => togglePanel(p) });
const gfxBtn = $('h-gfx');
// if the graphics card runs out of memory the browser drops the 3D context: save, then reload in low graphics
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  try { localStorage.setItem('st_gfx', 'low'); } catch {}
  try { net.room && net.room.save(); } catch {}
  const box = document.createElement('div'); box.id = 'gfx-lost';
  box.textContent = 'The graphics card ran out of memory. Your store is saved. Reloading in low graphics…';
  Object.assign(box.style, { position: 'fixed', inset: '0', display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,.85)', color: '#fff', font: '600 18px Nunito, system-ui, sans-serif', zIndex: 999, textAlign: 'center', padding: '24px' });
  document.body.appendChild(box);
  setTimeout(() => location.reload(), 1800);
});
// auto-switch to low graphics if high graphics runs too slowly on this device
let perfT = 0, perfN = 0, slowWindows = 0;
function watchPerf(dt) {
  if (lowGfx || gfxChoice === 'high') return;
  perfT += dt; perfN++;
  if (perfT < 4) return;
  const fps = perfN / perfT; perfT = 0; perfN = 0;
  slowWindows = fps < 24 ? slowWindows + 1 : 0;
  if (slowWindows >= 2) {
    lowGfx = true; S.setQuality(true); syncGfx();
    try { localStorage.setItem('st_gfx', 'low'); } catch {}
    ui.system('🔅 Switched to low graphics so the game runs smoothly (🔆 button to switch back).');
  }
}
const syncGfx = () => { gfxBtn.textContent = lowGfx ? '🔅' : '🔆'; gfxBtn.title = `Graphics: ${lowGfx ? 'Low' : 'High'} (click to toggle)`; };
gfxBtn.onclick = () => { lowGfx = !lowGfx; gfxChoice = lowGfx ? 'low' : 'high'; try { localStorage.setItem('st_gfx', lowGfx ? 'low' : 'high'); } catch {} S.setQuality(lowGfx); syncGfx(); };
syncGfx();
const toggleHelp = (on) => $('help').classList.toggle('hidden', on === undefined ? undefined : !on);
$('h-help').onclick = () => toggleHelp();
$('h-exit').onclick = async () => { if (await ui.ask('Leave this store? Your team keeps playing and progress is saved.', 'Leave')) { net.send({ t: 'leave' }); G.code = ''; steam?.leave(); setTimeout(() => location.reload(), 150); } };
$('help-close').onclick = () => toggleHelp(false);
// ----------------------------------------------------------------------------------- Steam (desktop app)
const steam = window.steamDesk || null;
const steamOn = !!(steam && steam.info && steam.info.available);
if (steam) {
  document.body.classList.add('desktop');
  document.querySelectorAll('.desk-only').forEach(el => { el.hidden = false; });
  if (!steamOn) $('m-steam-note').textContent = 'Steam is not running, so inviting friends is off. Start Steam to play together.';
  $('m-quit').onclick = () => steam.quit();
  $('m-fullscreen').onclick = () => steam.fullscreen();
  // accepting an invite: reload into the friend's store through the local Steam relay
  steam.onJoin((d) => {
    try { if (G.code) net.send({ t: 'leave' }); } catch {}
    try { sessionStorage.setItem('st_steam_join', JSON.stringify(d)); } catch {}
    location.reload();
  });
}
const invite = async () => { if (!(await steam.invite())) ui.error('Open a store first, then invite friends.'); };
if (steamOn) { $('l-invite').hidden = false; $('h-invite').hidden = false; $('l-invite').onclick = invite; $('h-invite').onclick = invite; }
let steamLobbyFor = '', steamStoreName = '';
const reportedAch = new Set();
function steamSync() {
  if (!steamOn) return;
  // the host's store gets a friends-only Steam lobby so friends can join from invites or the friends list
  if (G.host && G.code && steamLobbyFor !== G.code && !net.path) { steamLobbyFor = G.code; steam.host(G.code, G.meta?.name || ''); }
  const name = G.meta?.name; if (G.host && name && name !== steamStoreName) { steamStoreName = name; steam.storeName(name); }
  // store achievements count for everyone playing in the store
  for (const id of Object.keys(G.meta?.achievements || {})) if (!reportedAch.has(id)) { reportedAch.add(id); steam.achievement(id); }
}
let steamJoin = null; try { steamJoin = JSON.parse(sessionStorage.getItem('st_steam_join') || 'null'); sessionStorage.removeItem('st_steam_join'); } catch {}
if (steamJoin) setTimeout(async () => {
  net.path = '/steam-relay';
  loading(true, `Joining ${steamJoin.hostName}'s store…`);
  try { await net.connect(); } catch { loading(true, 'Could not reach your friend. Returning to the menu…'); setTimeout(() => location.reload(), 2500); return; }
  loading(false); initAudio();
  net.send({ t: 'join', code: steamJoin.code, name: prefs.name, color: prefs.color });
}, 0);
window.__dbg = { net, me, rig, ui, world, S };
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
  if (net.open) return;
  loading(true);
  try { await net.connect(); } catch { loading(true, 'Could not reach the server. Is it running?'); throw new Error('no server'); }
  loading(false);
}
async function refreshLists() { try { await ensureNet(); net.send({ t: 'list' }); } catch {} }
$('m-create').onclick = async () => { initAudio(); await ensureNet(); net.send({ t: 'create', name: prefs.name || 'Player', color: prefs.color, isPublic: $('m-public').checked }); };
$('m-join').onclick = async () => { initAudio(); const code = $('m-code').value.trim().toUpperCase(); if (code.length < 4) return ui.error('Enter a 5-letter code'); await ensureNet(); net.send({ t: 'join', code, name: prefs.name || 'Player', color: prefs.color }); };
$('m-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('m-join').click(); });
$('m-rooms').onclick = async (e) => { const b = e.target.closest('[data-join]'); if (!b) return; initAudio(); await ensureNet(); net.send({ t: 'join', code: b.dataset.join, name: prefs.name, color: prefs.color }); };
$('m-saves').onclick = async (e) => { const b = e.target.closest('[data-load]'); if (!b) return; initAudio(); await ensureNet(); net.send({ t: 'create', load: b.dataset.load, name: prefs.name, color: prefs.color, isPublic: $('m-public').checked }); };
setInterval(() => { if (!$('menu').classList.contains('hidden')) refreshLists(); }, 4000);
refreshLists();

// lobby
$('l-copy').onclick = () => { navigator.clipboard?.writeText(G.code); ui.toast('Invite code copied!', 'info', '📋'); };
$('l-leave').onclick = () => { net.send({ t: 'leave' }); G.code = ''; steam?.leave(); if (net.path) { location.reload(); return; } showScreen('menu'); refreshLists(); };
$('l-start').onclick = () => net.send({ t: 'start' });
$('l-roles').innerHTML = Object.entries(PLAYER_ROLES).map(([k, r]) => `<button data-role="${k}" title="${esc(r.desc)}">${r.icon} ${esc(r.name)}</button>`).join('');
$('l-roles').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; prefs.role = b.dataset.role; savePrefs(); net.send({ t: 'lobby', role: prefs.role }); };

// ----------------------------------------------------------------------------------- network
net.on('rooms', (m) => {
  $('m-rooms').innerHTML = m.rooms.length ? m.rooms.map(r => `<div class="item"><span><b>${esc(r.name)}</b><small>${r.players}/${r.max} players · ${r.started ? 'Day ' + r.day : 'in lobby'}</small></span><button class="btn small primary" data-join="${r.code}">Join</button></div>`).join('') : '<i>No open stores — create one!</i>';
  $('m-saves').innerHTML = m.saves.length ? m.saves.map(s => `<div class="item"><span><b>${esc(s.name)}</b><small>Day ${s.day} · Lv ${s.level} · ${fmtMoney(s.cash)}</small></span><button class="btn small" data-load="${s.code}">Continue</button></div>`).join('') : '<i>None yet</i>';
});
net.on('err', (m) => { ui.error(m.text); if (net.path && !G.code) { loading(true, m.text + ' Returning to the menu…'); setTimeout(() => location.reload(), 2500); } });
net.on('joined', (m) => {
  G.me = m.id; G.code = m.code; G.started = m.started;
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
    return p ? `<div class="lp"><span class="dot" style="background:${esc(p.color)}">${PLAYER_ROLES[p.role]?.icon || '🙂'}</span><span>${esc(p.name)}${p.host ? ' 👑' : ''}${p.id === G.me ? ' (you)' : ''}<small>${esc(PLAYER_ROLES[p.role]?.name || '')}</small></span></div>` : '<div class="lp empty"><span class="dot" style="background:#cbd5e1">+</span><span>Waiting for player…<small>Share the code!</small></span></div>';
  }).join('');
  document.querySelectorAll('#l-roles button').forEach(b => b.classList.toggle('sel', mine && b.dataset.role === mine.role));
  $('l-start').classList.toggle('hidden', !G.host);
  $('l-wait').textContent = G.host ? 'You are the host. Start when your team is ready (others can also join later).' : 'Waiting for the host to start…';
  if (m.started && !G.started) { G.started = true; }
  if (m.started && $('hud').classList.contains('hidden') && G.code) enterGame();
  steamSync();
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
  const prev = G.meta; G.meta = m.meta; ui.markDirty(); maybeFirstHelp(); steamSync();
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
    if ((G.carry || []).at(-1) !== prevTop) G.deptProgress = 0;
  }
  actors.applySnapshot(s, G.me, me);
  world.setCheckouts(s.K);
});
net.on('chat', (m) => { ui.chat(m.from, m.color, m.text); play('pop'); });
net.on('close', () => {
  if (net.path) { loading(true, 'The host closed the store or the connection was lost. Returning to the menu…'); setTimeout(() => location.reload(), 3000); return; }
  if (G.code) { loading(true, 'Disconnected from server. Refresh the page to reconnect.'); }
});

net.on('fx', (m) => {
  switch (m.k) {
    case 'err': ui.error(m.text); break;
    case 'snd': play(m.name, m.x, m.z); break;
    case 'float': fx.float(m.text, m.x, m.z, m.color, (m.floor || 0) * FLOOR_H + 1.8); if (m.text.startsWith('+$')) fx.burst(m.x, (m.floor || 0) * FLOOR_H + 1.2, m.z, 6, [0xfacc15, 0x22c55e], 1.5); break;
    case 'levelup': ui.system(`⭐ Level ${m.level}! New products and furniture are available on the computer.`); play('levelup'); fx.burst(me.x, (me.y || 0) + 2, me.z, 40); break;
    case 'report': ui.showReport(m.report); break;
    case 'delivery': ui.system(`📦 A delivery from ${m.name} arrived at the loading area.`); fx.truck(m.x, m.z, m.supplier); setTimeout(() => play('honk', m.x, m.z), 2200); break;
    case 'stocked': {
      const e = world.furn.get(m.id); if (!e) break;
      const src = m.by > 0 ? actors.players.get(m.by) : actors.staff.get(-m.by);
      const p = PRODUCT_MAP[m.pid];
      const yb = (e.data.floor || 0) * FLOOR_H;
      if (src && p) fx.fly(p.shape, p.color, { x: src.x, z: src.z, y: yb }, { x: e.group.position.x, z: e.group.position.z, y: yb }, m.n);
      play('pop', e.group.position.x, e.group.position.z); setTimeout(() => play('pop', e.group.position.x, e.group.position.z), 90);
      break;
    }
    case 'placed': fx.burst(m.x + 1, (m.floor || 0) * FLOOR_H + 0.4, m.z + 0.5, 12, [0xffffff, 0xe2e8f0, 0xfde68a], 2); break;
    case 'named': fx.burst(me.x, 2.5, me.z, 60); break;
    case 'expanded': fx.burst(me.x, 3, me.z, 60); break;
    case 'bankrupt': play('dayend'); break;
    case 'ping': fx.ping(m.x, m.z, m.color, m.name); play('ping', m.x, m.z); break;
    case 'swing': actors.swing(m.id); break;
    case 'pow': fx.float('POW!', m.x, m.z, '#f97316', (m.floor || 0) * FLOOR_H + 1.6); fx.burst(m.x, (m.floor || 0) * FLOOR_H + 1.3, m.z, 10, [0xfacc15, 0xffffff, 0xf97316], 2.5); break;
    case 'knock': if (m.id === G.me) { me.knock(m.dx, m.dz); ui.error(`${m.by} punched you! 💫`); } break;
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
const EMOTES = { 1: '👋', 2: '😂', 3: '👍', 4: '❤️', 5: '😱', 6: '🎉' };
addEventListener('keydown', (e) => {
  initAudio();
  if (!G.started || $('hud').classList.contains('hidden')) return;
  if (input.typing()) return;
  const k = e.key.toLowerCase();
  if (k === 'enter') { $('chat-input').focus(); e.preventDefault(); return; }
  if (k === '?' || k === 'f1') { toggleHelp(); e.preventDefault(); return; }
  if (k === 'escape') {
    if (!$('help').classList.contains('hidden')) { toggleHelp(false); return; }
    if (ui.panel) { ui.closePanel(); return; }
    return; // build mode handles its own escape
  }
  if (build.active && ['u', 'x', 'm', 'r', 'p'].includes(k)) return; // build-mode shortcuts
  if (k === 'f' && !build.active && G.meta?.phase !== 'naming') { net.act('punch'); actors.swing(G.me); punchT = 0.3; play('whoosh'); return; }
  if (k === 'v' && !build.active) { setCamMode(!rig.fps); return; }
  if (PANEL_KEYS[k] && G.meta?.phase !== 'naming') { togglePanel(PANEL_KEYS[k]); e.preventDefault(); return; }
  if (EMOTES[k]) { net.send({ t: 'emote', e: EMOTES[k] }); return; }
  if (k === 'g' && !build.active) {
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, S.camera);
    const p = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -me.floor * FLOOR_H), p)) net.send({ t: 'ping', x: p.x, z: p.z, floor: me.floor });
  }
});
addEventListener('mousedown', () => initAudio());

// ----------------------------------------------------------------------------------- main loop
let last = performance.now(), sendT = 0, holdT = 0, tasksT = 0, lastInter = null, stepT = 0;
let currentInter = null;
function frame(now) {
  window.__frames = (window.__frames || 0) + 1;
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt); last = now;
  const inGame = G.started && G.world && !$('hud').classList.contains('hidden');
  if (inGame && !document.hidden && rawDt < 1) watchPerf(rawDt);
  if (inGame) {
    if (!build.active) {
      const blockMove = G.meta?.phase === 'naming';
      if (!blockMove) me.update(dt, input, rig.yaw, world, (G.carry || []).length);
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
    actors.hideLocal = fpsView; world.setCeilingVisible(fpsView);
    syncViewModel();
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
    const carry = G.carry || [];
    const ce = $('carry');
    const nameOf = (c) => c.startsWith('f:') ? FURNITURE[c.slice(2)].name + ' (box)' : c.includes(':') ? `${c.startsWith('raw') ? 'Raw' : 'Wrapped'} ${PRODUCT_MAP[c.split(':')[1]]?.name}` : PRODUCT_MAP[c]?.name;
    if (carry.length && !build.active) { const t = `Carrying: ${carry.map(nameOf).join(', ')}  ·  Q drop`; if (ce.textContent !== t) ce.textContent = t; ce.classList.remove('hidden'); } else ce.classList.add('hidden');
    me.cutting = !!(currentInter && currentInter.cutting && input.down('e'));
    const doAct = (a) => {
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
        if (click.button === 0 && currentInter && currentInter.action) doAct(currentInter.action);
        if (click.button === 2) net.act('drop');
      }
      if (click && click.button === 0 && G.station && world.beltItems.length) {
        const ray = new THREE.Raycaster(); ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, S.camera);
        const hit = ray.intersectObjects(world.beltItems, false)[0];
        if (hit) { net.act('work'); hit.object.position.x += 0.4; }
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
