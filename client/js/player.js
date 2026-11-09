// Local player movement (client-predicted), third-person camera, input, and context-sensitive interaction.
import * as THREE from 'three';
import { FURNITURE, PRODUCT_MAP, CATEGORIES, stairInfo, slotCap, fitsFixture } from '/shared/data.js';
import { resolveCollision, dims, center, heightAt, deptSpots } from '/shared/grid.js';

// The key by its place on the keyboard, so WASD and every shortcut work with any layout (Hebrew, Russian,
// French AZERTY...): on a Hebrew keyboard the W key types a Hebrew letter, but its code is still 'KeyW'.
export function keyName(e) {
  const c = e.code || '';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (c === 'Space') return ' ';
  if (c === 'Slash' && e.shiftKey) return '?';
  return (e.key || '').toLowerCase();
}

export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, down: false, button: -1, dragging: false, dx: 0, dy: 0, lx: 0, ly: 0, wheel: 0, clicked: null, locked: false };
    document.addEventListener('pointerlockchange', () => { this.mouse.locked = document.pointerLockElement === canvas; });
    this.canvas = canvas;
    // typing in a visible text box (chat, a price): the game ignores keys. A hidden box (the store-name field after
    // naming, a menu field) must not swallow WASD
    const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT') && a.offsetParent !== null; };
    this.typing = typing;
    addEventListener('keydown', (e) => {
      if (typing()) return;
      const k = keyName(e);
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['tab', ' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(keyName(e)); this.keys.delete((e.key || '').toLowerCase()); });
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      const a = document.activeElement; if (a && a !== canvas && a.blur) a.blur(); // clicking the game takes the keys back from any text box
      if (this.mouse.locked) { this.mouse.clicked = { button: e.button, x: innerWidth / 2, y: innerHeight / 2 }; return; }
      this.mouse.down = true; this.mouse.button = e.button; this.mouse.sx = e.clientX; this.mouse.sy = e.clientY; this.mouse.dragging = false;
      canvas.focus();
    });
    addEventListener('mouseup', (e) => {
      if (this.mouse.down && !this.mouse.dragging && e.target === canvas) this.mouse.clicked = { button: e.button, x: e.clientX, y: e.clientY };
      this.mouse.down = false; this.mouse.dragging = false;
    });
    addEventListener('mousemove', (e) => {
      if (this.mouse.locked) { this.mouse.lx += e.movementX; this.mouse.ly += e.movementY; this.mouse.nx = 0; this.mouse.ny = 0; return; }
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.mouse.nx = (e.clientX / innerWidth) * 2 - 1; this.mouse.ny = -(e.clientY / innerHeight) * 2 + 1;
      if (this.mouse.down) {
        if (Math.hypot(e.clientX - this.mouse.sx, e.clientY - this.mouse.sy) > 6) this.mouse.dragging = true;
        if (this.mouse.dragging) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; }
      }
    });
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  down(k) { return this.keys.has(k); }
  hit(k) { return this.pressed.has(k); }
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.lx = 0; this.mouse.ly = 0; this.mouse.wheel = 0; this.mouse.clicked = null; }
}

export class LocalPlayer {
  constructor() { this.x = 6; this.z = 6; this.rot = Math.PI; this.moving = false; this.vx = 0; this.vz = 0; this.floor = 0; this.stunUntil = 0; this.kx = 0; this.kz = 0; }
  knock(dx, dz, ms = 2000) { this.kx = dx; this.kz = dz; this.stunUntil = performance.now() + ms; }
  get stunned() { return performance.now() < this.stunUntil; }
  update(dt, input, yaw, world, carryN) {
    let mx = 0, mz = 0;
    if (!input.typing() && !this.stunned) {
      if (input.down('w') || input.down('arrowup')) mz -= 1;
      if (input.down('s') || input.down('arrowdown')) mz += 1;
      if (input.down('a') || input.down('arrowleft')) mx -= 1;
      if (input.down('d') || input.down('arrowright')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    let speed = input.down('shift') ? 6.2 : 4.4;
    if (carryN > 1) speed *= 0.85;
    let tvx = 0, tvz = 0;
    if (len > 0) {
      mx /= len; mz /= len;
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const wx = mx * c + mz * s, wz = -mx * s + mz * c;
      tvx = wx * speed; tvz = wz * speed;
      let d = Math.atan2(wx, wz) - this.rot; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.rot += d * Math.min(1, dt * 14);
    }
    const acc = 1 - Math.exp(-dt * 14);
    this.vx += (tvx - this.vx) * acc; this.vz += (tvz - this.vz) * acc;
    // knockback impulse from a punch
    this.kx *= Math.exp(-dt * 6); this.kz *= Math.exp(-dt * 6);
    let nx = this.x + (this.vx + this.kx) * dt, nz = this.z + (this.vz + this.kz) * dt;
    const st = world && world.state && (world.state.floors || 1) > 1 ? stairInfo(world.state.w) : null;
    const inLane = (x) => st && x >= st.x && x < st.x + 2;
    const clampLane = (x) => Math.max(st.x + 0.3, Math.min(st.x + 1.7, x));
    if (st && this.floor === 0 && inLane(this.x) && ((this.z >= st.z0 && this.z < st.z1) || (this.z >= st.z1 && nz < st.z1 && inLane(nx)))) {
      // on the stairs (or stepping onto them from the bottom)
      nx = clampLane(nx);
      if (nz < st.z0) { this.floor = 1; nz = Math.max(nz, st.z0 - 0.95); }
    } else if (st && this.floor === 1 && inLane(this.x) && this.z < st.z0 && nz >= st.z0 && inLane(nx)) {
      this.floor = 0; nx = clampLane(nx); // stepping down into the stairwell
    } else if (world) {
      [nx, nz] = resolveCollision(world.gridFor(this.floor), nx, nz, 0.28);
    }
    this.moving = Math.hypot(nx - this.x, nz - this.z) > 0.3 * dt;
    this.x = nx; this.z = nz;
  }
}

export class CameraRig {
  constructor(camera) { this.camera = camera; this.yaw = 0; this.pitch = 0.95; this.dist = 11; this.target = new THREE.Vector3(6, 0, 6); this.cur = new THREE.Vector3(6, 0, 6); this.build = false; this.fps = true; this.look = 0; this.bob = 0; }
  update(dt, input, focus) {
    const m = input.mouse;
    if (this.fps && !this.build && focus.fpsReady) {
      // first person: look with the (pointer-locked) mouse, eye height 1.62 m, gentle head bob
      const dx = m.locked ? m.lx : (m.dragging ? m.dx : 0), dy = m.locked ? m.ly : (m.dragging ? m.dy : 0);
      this.yaw -= dx * 0.0024; this.look = Math.max(-1.35, Math.min(1.3, this.look - dy * 0.0022));
      if (!input.typing()) { if (input.down('z')) this.yaw += dt * 1.8; if (input.down('c')) this.yaw -= dt * 1.8; }
      this.bob += focus.moving ? dt * 9 : 0;
      const eye = (focus.y || 0) + 1.62 + (focus.moving ? Math.sin(this.bob) * 0.025 : 0);
      this.camera.fov = 72; this.camera.updateProjectionMatrix();
      this.camera.position.set(focus.x, eye, focus.z);
      const cp = Math.cos(this.look);
      this.camera.lookAt(focus.x - Math.sin(this.yaw) * cp, eye + Math.sin(this.look), focus.z - Math.cos(this.yaw) * cp);
      this.applyShake(dt);
      this.cur.set(focus.x, eye, focus.z);
      return;
    }
    if (this.camera.fov !== 48) { this.camera.fov = 48; this.camera.updateProjectionMatrix(); }
    if (m.dragging && (m.button === 2 || m.button === 1 || (m.button === 0 && !this.build))) {
      this.yaw -= m.dx * 0.006; this.pitch = Math.min(1.35, Math.max(0.35, this.pitch + m.dy * 0.004));
    }
    if (!input.typing()) {
      if (input.down('z')) this.yaw += dt * 1.8;
      if (input.down('c')) this.yaw -= dt * 1.8;
    }
    if (m.wheel) this.dist = Math.min(this.build ? 40 : 22, Math.max(4.5, this.dist * (1 + m.wheel * 0.1)));
    this.target.set(focus.x, (focus.y || 0) + 1.1, focus.z);
    this.cur.lerp(this.target, 1 - Math.exp(-dt * 10));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(this.cur.x + Math.sin(this.yaw) * cp * this.dist, this.cur.y + sp * this.dist, this.cur.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.cur);
    this.applyShake(dt);
  }
  // after a punch: the view jolts and sways for a moment
  applyShake(dt) {
    if (!(this.shake > 0)) return;
    this.shake = Math.max(0, this.shake - dt);
    const a = this.shake * this.shake, t = performance.now() / 1000;
    this.camera.rotateZ(Math.sin(t * 9) * 0.09 * a);
    this.camera.rotateX(Math.sin(t * 13) * 0.04 * a);
  }
}

// Decide what pressing E would do right now. Returns { label, action, repeat, warn, station }.
const DOORS = new Set(['fridge', 'freezer_upright', 'freezer']);
export function findInteraction(G, world, me, carry, station, fps = false) {
  const W = G.world; if (!W) return null;
  const fl = me.floor || 0;
  const fx = Math.sin(me.rot), fz = Math.cos(me.rot);
  const byId = (id) => W.furniture.find(f => f.id === id);
  const furn = W.furniture.filter(f => (f.floor || 0) === fl);
  const top = carry[carry.length - 1] || '';
  const isFBox = top.startsWith('f:'), dept = top.startsWith('raw:') ? 'raw' : top.startsWith('pack:') ? 'pack' : null;
  const prodPid = top && !isFBox && !dept ? top : null;
  // 1) running a checkout
  if (station) {
    const f = byId(station);
    if (f && f.type === 'checkout') {
      const k = (G.snap?.K || []).find(k => k[0] === f.id);
      if (k && k[1]) {
        const [, cid, scanned, total, pids, , , payBy, tendered, due] = k;
        if (scanned < total || !payBy) return { label: `Scan the products (click them or E) ${scanned}/${total}`, action: { a: 'work' }, repeat: true, station: { kind: 'checkout', scanned, total, pids } };
        const pay = { kind: 'checkout', scanned, total, pids, pay: true, cid, payBy, tendered, due };
        return payBy === 'cash'
          ? { label: `Total $${due.toFixed(2)} · the customer hands you $${tendered.toFixed(2)} cash · E: open the cash drawer`, action: { a: '_pay', ...pay }, station: pay }
          : { label: `Total $${due.toFixed(2)} · the customer pays by card · E: card terminal`, action: { a: '_pay', ...pay }, station: pay };
      }
      return { label: 'Waiting for customers… (walk away to leave)', action: null, station: { kind: 'checkout', idle: true, queue: k ? k[5] : 0 } };
    }
  }
  // 2) butcher / deli aisle: fridge -> station -> counter
  for (const f of furn) {
    if (FURNITURE[f.type].kind !== 'counter') continue;
    const sp = deptSpots(f);
    const dist = (p) => Math.hypot(p[0] - me.x, p[1] - me.z);
    const spots = [['fridge', sp.fridgeSpot], ['station', sp.stationSpot], ['counter', sp.counterSpot]].filter(([, p]) => dist(p) < 0.62);
    if (!spots.length) continue;
    const [where] = spots.sort((a, b) => dist(a[1]) - dist(b[1]))[0];
    const n = (G.snap?.N || []).find(n => n[0] === f.id);
    const req = n && n[1] ? { pid: n[2], qty: n[3] } : null;
    const reqP = req && PRODUCT_MAP[req.pid];
    const def = FURNITURE[f.type];
    const info = { kind: 'dept', req, dept, presses: def.presses, progress: G.deptProgress || 0, where, meat: f.type === 'butcher' };
    if (where === 'fridge') {
      if (prodPid && PRODUCT_MAP[prodPid].cat === def.cat) return { label: `Stock ${PRODUCT_MAP[prodPid].name} into the fridge`, action: { a: 'stock', id: f.id, n: 3 }, repeat: true, station: info };
      if (dept) return { label: '↩ Put it back in the fridge', action: { a: 'deptReturn', id: f.id }, station: info };
      if (!carry.length && req) return { label: `Open the fridge & take ${req.qty}× ${reqP.name}`, action: { a: 'deptTake', id: f.id }, station: info };
      if (!carry.length) return { label: 'No orders waiting — customers order at the front counter', action: null, station: info };
    }
    if (where === 'station') {
      if (dept === 'raw') return { label: `${f.type === 'butcher' ? 'Cut' : 'Slice'} & wrap (hold E)`, action: { a: 'deptCut', id: f.id }, repeat: true, station: info, cutting: true };
      if (dept === 'pack') return { label: 'Wrapped! Bring it to the counter', action: null, station: info };
      return { label: 'Take the product from the fridge first', action: null, station: info };
    }
    if (where === 'counter') {
      if (dept === 'pack') return { label: req ? `Hand ${reqP.name} to the customer` : 'Nobody is waiting', action: req ? { a: 'deptServe', id: f.id } : null, station: info };
      return { label: req ? `Customer wants ${req.qty}× ${reqP.name} (${reqP.unit}) — get it from the fridge` : 'Waiting for customers…', action: null, station: info };
    }
  }
  // 3) step behind a checkout
  if (!carry.length) {
    for (const f of furn) {
      if (f.type !== 'checkout') continue;
      const bt = backTileOf(f);
      if (Math.hypot(bt[0] + 0.5 - me.x, bt[1] + 0.5 - me.z) < 0.8) {
        const busy = (G.snap?.P || []).some(p => p[0] !== G.me && p[6] === f.id);
        if (!busy) return { label: 'Work the register', action: { a: 'station', id: f.id } };
      }
    }
  }
  const reach = (f) => world.fixtureDistance(f, me.x, me.z);
  const facing = (f) => { const [cx, cz] = center(f.type, f.x, f.z, f.rot); const dx = cx - me.x, dz = cz - me.z; const d = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / d; };
  const near = furn.filter(f => fps ? reach(f) < 1.35 && facing(f) > 0.5 : reach(f) < 0.95 && facing(f) > -0.1).sort((a, b) => fps ? facing(b) - facing(a) + (reach(a) - reach(b)) * 0.5 : reach(a) - reach(b) - (facing(a) - facing(b)) * 0.3);
  // 4) the computer
  const comp = near.find(f => f.type === 'computer');
  if (comp && !isFBox) return { label: 'Use the computer', action: { a: '_computer' } };
  if (isFBox) return { label: `Place the ${FURNITURE[top.slice(2)].name}  ·  Q drop`, action: { a: '_place' } };
  if (dept) return { label: 'Bring it to the department station', action: null };
  if (prodPid) {
    const p = PRODUCT_MAP[prodPid];
    for (const f of near) {
      const def = FURNITURE[f.type];
      if (f.slots && def.kind !== 'counter') {
        if (fitsFixture(p.id, f.type)) {
          if (DOORS.has(f.type) && !f.open) return { label: `Open the ${def.name}`, action: { a: 'door', id: f.id } };
          const free = f.slots.some(s => (s.pid === prodPid && s.qty < slotCap(f.type, prodPid) && !s.expired) || s.qty === 0);
          if (!free) return { label: `${def.name} is full${DOORS.has(f.type) ? '  ·  [X] close door' : ''}`, action: null, warn: true, alt: DOORS.has(f.type) ? { a: 'door', id: f.id } : null };
          return { label: `Stock ${p.name}${DOORS.has(f.type) ? '  ·  [X] close door' : ''}`, action: { a: 'stock', id: f.id, n: 3 }, repeat: true, alt: DOORS.has(f.type) ? { a: 'door', id: f.id } : null };
        }
        const need = CATEGORIES[p.cat];
        return { label: `${p.name} needs a ${FURNITURE[need.fixtures[0]].name}`, action: null, warn: true };
      }
      if (def.kind === 'rack') return { label: 'Store box on rack', action: { a: 'rackPut', id: f.id } };
      if (f.type === 'bin') return { label: 'Throw box away', action: { a: 'trash', id: f.id } };
    }
    if (carry.length < (G.meta?.carryCap || 1)) {
      const b = nearestBox(world, me, fps);
      if (b && b.pid) return { label: `Pick up another box (${PRODUCT_MAP[b.pid].name})`, action: { a: 'pickup', id: b.id } };
    }
    return null;
  }
  // empty hands
  const b = nearestBox(world, me, fps);
  if (b) {
    if (b.ftype) return { label: `Pick up ${FURNITURE[b.ftype].name} box`, action: { a: 'pickup', id: b.id } };
    const p = PRODUCT_MAP[b.pid]; const bb = W.boxes.find(x => x.id === b.id);
    return { label: `Pick up ${p.name} (${bb ? bb.qty : '?'})${b.expired ? ' — EXPIRED' : ''}`, action: { a: 'pickup', id: b.id }, warn: b.expired };
  }
  const d = W.dirt.find(d => (d.floor || 0) === fl && Math.hypot(d.x - me.x, d.z - me.z) < 1.1);
  if (d) return { label: `Clean up mess (${d.hp ?? 3} scrubs)`, action: { a: 'clean', id: d.id }, repeat: true };
  for (const f of near) {
    const def = FURNITURE[f.type];
    if (f.broken) return { label: `Repair ${def.name} (${f.repair || 0}/6)  ·  [X] call technician $180`, action: { a: 'repair', id: f.id }, repeat: true, alt: { a: 'callTech', id: f.id } };
    if (f.slots && f.slots.some(s => s.expired && s.qty > 0)) {
      if (DOORS.has(f.type) && !f.open) return { label: `Open the ${def.name}`, action: { a: 'door', id: f.id } };
      return { label: `Clear expired items`, action: { a: 'clearExpired', id: f.id } };
    }
    if (DOORS.has(f.type)) return { label: `${f.open ? 'Close' : 'Open'} the ${def.name}`, action: { a: 'door', id: f.id } };
    if (f.boxes && f.boxes.length) return { label: `Take box from rack (${f.boxes.length})`, action: { a: 'rackTake', id: f.id } };
  }
  return null;
}

function backTileOf(f) {
  const [w, d] = dims(f.type, f.rot);
  const FACE = [[0, 1], [1, 0], [0, -1], [-1, 0]][f.rot];
  const tiles = [];
  if (FACE[1] === 1) for (let i = 0; i < w; i++) tiles.push([f.x + i, f.z - 1]);
  else if (FACE[1] === -1) for (let i = 0; i < w; i++) tiles.push([f.x + i, f.z + d]);
  else if (FACE[0] === 1) for (let j = 0; j < d; j++) tiles.push([f.x - 1, f.z + j]);
  else for (let j = 0; j < d; j++) tiles.push([f.x + w, f.z + j]);
  return tiles[Math.floor((tiles.length - 1) / 2)];
}
export { backTileOf };

function nearestBox(world, me, fps = false) {
  let best = null, bd = fps ? 1.7 : 1.25;
  const fx = Math.sin(me.rot), fz = Math.cos(me.rot);
  for (const b of world.boxList) {
    if (b.id < 0 || (b.floor || 0) !== (me.floor || 0)) continue;
    if (fps) { const dx = b.x - me.x, dz = b.z - me.z, dd = Math.hypot(dx, dz) || 1; if ((dx * fx + dz * fz) / dd < 0.55) continue; }
    const d = Math.hypot(b.x - me.x, b.z - me.z) - b.y * 0.01;
    if (d < bd || (best && Math.abs(d - bd) < 0.05 && b.y > best.y)) { if (d < bd) bd = d; best = b; }
  }
  // prefer top of the stack at that spot
  if (best) {
    const top = world.boxList.filter(b => b.id >= 0 && (b.floor || 0) === (me.floor || 0) && Math.abs(b.x - best.x) < 0.3 && Math.abs(b.z - best.z) < 0.3).sort((a, b) => b.y - a.y)[0];
    if (top) best = top;
  }
  return best;
}
