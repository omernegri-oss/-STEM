// Supermarket Tycoons – client entry point: menus, lobby, networking glue and the main loop.
import * as THREE from 'three';
import { PLAYER_COLORS, PLAYER_ROLES, PRODUCT_MAP, FURNITURE, LIGHTS, fmtMoney } from '/shared/data.js';
import { Net } from './net.js';
import { createScene } from './scene.js';
import { World } from './world.js';
import { Actors } from './actors.js';
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
if (!prefs.name) prefs.name = ['Alex', 'Sam', 'Robin', 'Jules', 'Kai', 'Noa', 'Charlie'][Math.floor(Math.random() * 7)];

// ----------------------------------------------------------------------------------- 3D setup
const canvas = $('game'); canvas.tabIndex = 0;
let lowGfx = /[?&]low/.test(location.search);
try { if (localStorage.getItem('st_gfx') === 'low') lowGfx = true; } catch {}
const S = createScene(canvas, { low: lowGfx });
const world = new World(S.scene);
const actors = new Actors(S.scene);
const fx = new FX(S.scene);
const input = new Input(canvas);
const me = new LocalPlayer();
const rig = new CameraRig(S.camera);
const net = new Net();
let envKey = '';
S.buildEnvironment(12, 9);
world.set({ name: 'Supermarket Tycoons', w: 12, d: 9, doorX: 5, floor: 'checker', wall: 'cream', furniture: demoFurniture(), boxes: [], dirt: [], prices: {} });

const ui = new UI({ G, net, onPanel: (p) => togglePanel(p) });
const gfxBtn = $('h-gfx');
const syncGfx = () => { gfxBtn.textContent = lowGfx ? '🖥️ Low' : '🖥️ High'; gfxBtn.title = 'Graphics quality (click to toggle)'; };
gfxBtn.onclick = () => { lowGfx = !lowGfx; try { localStorage.setItem('st_gfx', lowGfx ? 'low' : 'high'); } catch {} S.setQuality(lowGfx); syncGfx(); };
syncGfx();
const toggleHelp = (on) => $('help').classList.toggle('hidden', on === undefined ? undefined : !on);
$('h-help').onclick = () => toggleHelp();
$('h-exit').onclick = () => { if (confirm('Leave this store? Your team keeps playing and progress is saved.')) { net.send({ t: 'leave' }); G.code = ''; setTimeout(() => location.reload(), 150); } };
$('help-close').onclick = () => toggleHelp(false);
window.__dbg = { net, me, rig, ui, world, S };
const build = new BuildMode({ scene: S.scene, camera: S.camera, world, net, G, ui, rig });
window.__dbg.build = build;

function togglePanel(p) {
  if (!G.started) return;
  if (p === 'build') { ui.closePanel(); build.toggle(me.x, me.z); syncDock(); return; }
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
$('l-leave').onclick = () => { net.send({ t: 'leave' }); G.code = ''; showScreen('menu'); refreshLists(); };
$('l-start').onclick = () => net.send({ t: 'start' });
$('l-roles').innerHTML = Object.entries(PLAYER_ROLES).map(([k, r]) => `<button data-role="${k}" title="${esc(r.desc)}">${r.icon} ${esc(r.name)}</button>`).join('');
$('l-roles').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; prefs.role = b.dataset.role; savePrefs(); net.send({ t: 'lobby', role: prefs.role }); };

// ----------------------------------------------------------------------------------- network
net.on('rooms', (m) => {
  $('m-rooms').innerHTML = m.rooms.length ? m.rooms.map(r => `<div class="item"><span><b>${esc(r.name)}</b><small>${r.players}/${r.max} players · ${r.started ? 'Day ' + r.day : 'in lobby'}</small></span><button class="btn small primary" data-join="${r.code}">Join</button></div>`).join('') : '<i>No open stores — create one!</i>';
  $('m-saves').innerHTML = m.saves.length ? m.saves.map(s => `<div class="item"><span><b>${esc(s.name)}</b><small>Day ${s.day} · Lv ${s.level} · ${fmtMoney(s.cash)}</small></span><button class="btn small" data-load="${s.code}">Continue</button></div>`).join('') : '<i>None yet</i>';
});
net.on('err', (m) => ui.error(m.text));
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
  const prev = G.meta; G.meta = m.meta; ui.markDirty();
  if (build.active && (!prev || prev.cash !== m.meta.cash || prev.level !== m.meta.level)) build.render();
  ui.updateHud();
});
let firstSnap = true;
net.on('s', (s) => {
  G.snap = s;
  const mine = s.P.find(p => p[0] === G.me);
  if (mine) {
    if (firstSnap) { me.x = mine[1]; me.z = mine[2]; me.rot = mine[3]; firstSnap = false; }
    G.carry = mine[5]; G.station = mine[6];
  }
  actors.applySnapshot(s, G.me, me);
  world.setCheckouts(s.K);
});
net.on('chat', (m) => { ui.chat(m.from, m.color, m.text); play('pop'); });
net.on('close', () => { if (G.code) { loading(true, 'Disconnected from server. Refresh the page to reconnect.'); } });

net.on('fx', (m) => {
  switch (m.k) {
    case 'toast': ui.toast(m.text, m.kind, m.icon); if (m.kind === 'bad') play('error'); break;
    case 'info': ui.toast(m.text, 'info', 'ℹ️'); break;
    case 'err': ui.error(m.text); break;
    case 'snd': play(m.name, m.x, m.z); break;
    case 'float': fx.float(m.text, m.x, m.z, m.color); if (m.text.startsWith('+$')) fx.burst(m.x, 1.2, m.z, 6, [0xfacc15, 0x22c55e], 1.5); break;
    case 'levelup': ui.showLevelUp(m.level, m.unlocks); play('levelup'); fx.burst(me.x, 2, me.z, 40); break;
    case 'goal': ui.toast(`Goal complete: ${m.text}${m.reward ? ` (+${fmtMoney(m.reward)})` : ''}`, 'good', '🎯'); fx.burst(me.x, 2, me.z, 20); break;
    case 'ach': ui.toast(`Achievement unlocked: ${m.name} — ${m.desc}`, 'good', m.icon); play('fanfare'); break;
    case 'event': ui.showEvent(m); break;
    case 'report': ui.showReport(m.report); break;
    case 'delivery': fx.truck(m.x, m.z, m.supplier); setTimeout(() => play('honk', m.x, m.z), 2200); break;
    case 'stocked': {
      const e = world.furn.get(m.id); if (!e) break;
      const src = m.by > 0 ? actors.players.get(m.by) : actors.staff.get(-m.by);
      const p = PRODUCT_MAP[m.pid];
      if (src && p) fx.fly(p.shape, p.color, src, e.group.position, m.n);
      play('pop', e.group.position.x, e.group.position.z); setTimeout(() => play('pop', e.group.position.x, e.group.position.z), 90);
      break;
    }
    case 'placed': fx.burst(m.x + 1, 0.4, m.z + 0.5, 12, [0xffffff, 0xe2e8f0, 0xfde68a], 2); break;
    case 'named': ui.toast(`Welcome to ${m.name}!`, 'good', '🎉'); fx.burst(me.x, 2.5, me.z, 60); break;
    case 'expanded': fx.burst(me.x, 3, me.z, 60); break;
    case 'bankrupt': play('dayend'); break;
    case 'ping': fx.ping(m.x, m.z, m.color, m.name); play('ping', m.x, m.z); break;
    case 'take': break;
  }
});

function enterGame() {
  showScreen('hud');
  ui.updateHud(); ui.renderTasks();
  canvas.focus();
  setTimeout(() => ui.toast('Tip: WASD to move, drag the mouse to look around, E to interact. Press ? for help.', 'info', '🎮'), 800);
  try { if (!localStorage.getItem('st_seen_help')) { toggleHelp(true); localStorage.setItem('st_seen_help', '1'); } } catch {}
}

// ----------------------------------------------------------------------------------- key commands
const PANEL_KEYS = { b: 'build', o: 'orders', i: 'inventory', p: 'prices', h: 'staff', f: 'finance', u: 'upgrades', k: 'stats' };
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
  if (build.active && ['u', 'x', 'm', 'r'].includes(k) && k !== 'b') return; // build-mode shortcuts
  if (PANEL_KEYS[k] && G.meta?.phase !== 'naming') { togglePanel(PANEL_KEYS[k]); e.preventDefault(); return; }
  if (EMOTES[k]) { net.send({ t: 'emote', e: EMOTES[k] }); return; }
  if (k === 'g' && !build.active) {
    const ray = new THREE.Raycaster(); ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, S.camera);
    const p = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) net.send({ t: 'ping', x: p.x, z: p.z });
  }
});
addEventListener('mousedown', () => initAudio());

// ----------------------------------------------------------------------------------- main loop
let last = performance.now(), sendT = 0, holdT = 0, tasksT = 0, lastInter = null, stepT = 0;
let currentInter = null;
function frame(now) {
  window.__frames = (window.__frames || 0) + 1;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const inGame = G.started && G.world && !$('hud').classList.contains('hidden');
  if (inGame) {
    if (!build.active) {
      const blockMove = G.meta?.phase === 'naming';
      if (!blockMove) me.update(dt, input, rig.yaw, world.grid, (G.carry || []).length);
      rig.update(dt, input, me);
    } else {
      build.update(dt, input);
      rig.update(dt, input, build.focus);
    }
    audio.listener.x = me.x; audio.listener.z = me.z;
    if (me.moving) { stepT += dt; if (stepT > 0.32) { stepT = 0; play('step'); } }
    // send our position
    sendT += dt;
    if (sendT > 1 / 15) { sendT = 0; net.send({ t: 'p', x: +me.x.toFixed(2), z: +me.z.toFixed(2), rot: +me.rot.toFixed(2), anim: me.moving ? 1 : 0 }); }
    // interaction
    currentInter = build.active ? null : findInteraction(G, world, me, G.carry || [], G.station);
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
    if (carry.length && !build.active) { const t = `Carrying: ${carry.map(pid => PRODUCT_MAP[pid]?.icon).join(' ')}  ·  Q drop`; if (ce.textContent !== t) ce.textContent = t; ce.classList.remove('hidden'); } else ce.classList.add('hidden');
    if (!input.typing() && !build.active) {
      if (currentInter && currentInter.action) {
        if (input.hit('e') || input.hit(' ')) { net.act(currentInter.action.a, currentInter.action); holdT = now; }
        else if ((input.down('e') || input.down(' ')) && currentInter.repeat && now - holdT > 190) { holdT = now; net.act(currentInter.action.a, currentInter.action); }
      }
      if (currentInter && currentInter.alt && input.hit('x')) net.act(currentInter.alt.a, currentInter.alt);
      if (input.hit('q')) net.act('drop');
    }
    tasksT += dt; if (tasksT > 0.5) { tasksT = 0; ui.renderTasks(); ui.updateHud(); }
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
  world.update(dt, actors.positions(), S.camera, inGame ? me : null);
  fx.update(dt);
  S.renderer.render(S.scene, S.camera);
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A pretty little store for the main-menu background.
function demoFurniture() {
  const mk = (id, type, x, z, rot, fill) => {
    const def = FURNITURE[type];
    const f = { id, type, x, z, rot, upg: false, broken: false };
    if (def.slots) f.slots = Array.from({ length: def.slots }, (_, i) => fill ? { pid: fill[i % fill.length], qty: def.cap - (i * 3) % 5, exp: 99, expired: false } : { pid: null, qty: 0 });
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
