// Local player movement (client-predicted), third-person camera, input, and context-sensitive interaction.
import * as THREE from 'three';
import { FURNITURE, PRODUCT_MAP, CATEGORIES } from '/shared/data.js';
import { resolveCollision, dims, center } from '/shared/grid.js';

export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.pressed = new Set();
    this.mouse = { x: 0, y: 0, nx: 0, ny: 0, down: false, button: -1, dragging: false, dx: 0, dy: 0, wheel: 0, clicked: null };
    this.canvas = canvas;
    const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'); };
    this.typing = typing;
    addEventListener('keydown', (e) => {
      if (typing()) return;
      const k = e.key.toLowerCase();
      if (!this.keys.has(k)) this.pressed.add(k);
      this.keys.add(k);
      if (['tab', ' ', 'arrowup', 'arrowdown'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.mouse.down = true; this.mouse.button = e.button; this.mouse.sx = e.clientX; this.mouse.sy = e.clientY; this.mouse.dragging = false;
      canvas.focus();
    });
    addEventListener('mouseup', (e) => {
      if (this.mouse.down && !this.mouse.dragging && e.target === canvas) this.mouse.clicked = { button: e.button, x: e.clientX, y: e.clientY };
      this.mouse.down = false; this.mouse.dragging = false;
    });
    addEventListener('mousemove', (e) => {
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
  endFrame() { this.pressed.clear(); this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.clicked = null; }
}

export class LocalPlayer {
  constructor() { this.x = 6; this.z = 6; this.rot = Math.PI; this.moving = false; this.vx = 0; this.vz = 0; this.stepT = 0; }
  update(dt, input, yaw, grid, carryN) {
    let mx = 0, mz = 0;
    if (!input.typing()) {
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
      // rotate input by camera yaw
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const wx = mx * c + mz * s, wz = -mx * s + mz * c;
      tvx = wx * speed; tvz = wz * speed;
      const target = Math.atan2(wx, wz);
      let d = target - this.rot; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.rot += d * Math.min(1, dt * 14);
    }
    const acc = 1 - Math.exp(-dt * 14);
    this.vx += (tvx - this.vx) * acc; this.vz += (tvz - this.vz) * acc;
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    if (grid) [nx, nz] = resolveCollision(grid, nx, nz, 0.28);
    this.moving = Math.hypot(nx - this.x, nz - this.z) > 0.3 * dt;
    this.x = nx; this.z = nz;
  }
}

export class CameraRig {
  constructor(camera) { this.camera = camera; this.yaw = 0; this.pitch = 0.95; this.dist = 11; this.target = new THREE.Vector3(6, 0, 6); this.cur = new THREE.Vector3(6, 0, 6); this.build = false; }
  update(dt, input, focus) {
    const m = input.mouse;
    if (m.dragging && (m.button === 2 || m.button === 1 || (m.button === 0 && !this.build))) {
      this.yaw -= m.dx * 0.006; this.pitch = Math.min(1.35, Math.max(0.35, this.pitch + m.dy * 0.004));
    }
    if (!input.typing()) {
      if (input.down('z')) this.yaw += dt * 1.8;
      if (input.down('c')) this.yaw -= dt * 1.8;
    }
    if (m.wheel) this.dist = Math.min(this.build ? 40 : 22, Math.max(4.5, this.dist * (1 + m.wheel * 0.1)));
    this.target.set(focus.x, 0.8, focus.z);
    this.cur.lerp(this.target, 1 - Math.exp(-dt * 10));
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(this.cur.x + Math.sin(this.yaw) * cp * this.dist, this.cur.y + sp * this.dist, this.cur.z + Math.cos(this.yaw) * cp * this.dist);
    this.camera.lookAt(this.cur);
  }
}

// Decide what pressing E would do right now. Returns { label, action, repeat, warn, hint }.
export function findInteraction(G, world, me, carry, station) {
  const W = G.world; if (!W) return null;
  const fx = Math.sin(me.rot), fz = Math.cos(me.rot);
  const byId = (id) => W.furniture.find(f => f.id === id);
  // 1) operating a station
  if (station) {
    const f = byId(station);
    if (f) {
      const def = FURNITURE[f.type];
      if (def.kind === 'checkout') {
        const k = (G.snap?.K || []).find(k => k[0] === f.id);
        if (k && k[1]) {
          const [, , scanned, total, pids] = k;
          if (scanned < total) return { label: `Scan item ${scanned + 1}/${total}`, action: { a: 'work' }, repeat: true, station: { kind: 'checkout', scanned, total, pids } };
          const sum = pids.reduce((a, pid) => a + (W.prices[pid] || PRODUCT_MAP[pid].price) * (W.saleActive ? 0.85 : 1), 0);
          return { label: `💳 Take payment ($${sum.toFixed(2)})`, action: { a: 'work' }, repeat: false, station: { kind: 'checkout', scanned, total, pids, pay: true } };
        }
        return { label: 'Waiting for customers… (walk away to leave)', action: null, station: { kind: 'checkout', idle: true, queue: k ? k[5] : 0 } };
      }
      if (def.kind === 'counter') {
        const n = (G.snap?.N || []).find(n => n[0] === f.id);
        if (n && n[1]) {
          const [, , pid, qty, progress] = n; const p = PRODUCT_MAP[pid];
          return { label: `${f.type === 'butcher' ? '🔪 Cut' : '🥄 Prepare'} ${qty}× ${p.name} (${p.unit})`, action: { a: 'work' }, repeat: true, station: { kind: 'counter', pid, qty, progress, presses: def.presses } };
        }
        return { label: 'Waiting for customers… (walk away to leave)', action: null, station: { kind: 'counter', idle: true } };
      }
    }
  }
  // 2) step behind a checkout / counter
  if (!carry.length || true) {
    for (const f of W.furniture) {
      const def = FURNITURE[f.type];
      if (def.kind !== 'checkout' && def.kind !== 'counter') continue;
      const bt = backTileOf(f);
      if (Math.hypot(bt[0] + 0.5 - me.x, bt[1] + 0.5 - me.z) < 0.8) {
        const busy = (G.snap?.P || []).some(p => p[0] !== G.me && p[6] === f.id);
        if (busy) continue;
        return { label: def.kind === 'checkout' ? '💵 Work the register' : `${f.type === 'butcher' ? '🔪' : '🧀'} Work the ${def.name}`, action: { a: 'station', id: f.id } };
      }
    }
  }
  const reach = (f) => world.fixtureDistance(f, me.x, me.z);
  const facing = (f) => { const [cx, cz] = center(f.type, f.x, f.z, f.rot); const dx = cx - me.x, dz = cz - me.z; const d = Math.hypot(dx, dz) || 1; return (dx * fx + dz * fz) / d; };
  const near = W.furniture.filter(f => reach(f) < 0.95 && facing(f) > -0.1).sort((a, b) => reach(a) - reach(b) - (facing(a) - facing(b)) * 0.3);
  if (carry.length) {
    const pid = carry[carry.length - 1]; const p = PRODUCT_MAP[pid];
    for (const f of near) {
      const def = FURNITURE[f.type];
      if (f.slots) {
        if (def.cat === p.cat) {
          const free = f.slots.some(s => (s.pid === pid && s.qty < def.cap && !s.expired) || s.qty === 0);
          if (!free) return { label: `${def.name} is full`, action: null, warn: true };
          return { label: `📥 Stock ${p.icon} ${p.name} → ${def.name}`, action: { a: 'stock', id: f.id, n: 3 }, repeat: true };
        }
        const need = CATEGORIES[p.cat];
        return { label: `${p.name} needs a ${need.icon} ${FURNITURE[need.fixtures[0]].name}`, action: null, warn: true };
      }
      if (def.kind === 'rack') return { label: '🗃️ Store box on rack', action: { a: 'rackPut', id: f.id } };
      if (f.type === 'bin') return { label: '🗑️ Throw box away', action: { a: 'trash', id: f.id } };
    }
    if (carry.length < (G.meta?.carryCap || 1)) {
      const b = nearestBox(world, me);
      if (b) return { label: `📦 Pick up another box (${PRODUCT_MAP[b.pid].name})`, action: { a: 'pickup', id: b.id } };
    }
    return null;
  }
  // empty hands
  const b = nearestBox(world, me);
  if (b) { const p = PRODUCT_MAP[b.pid]; const bb = W.boxes.find(x => x.id === b.id); return { label: `📦 Pick up ${p.icon} ${p.name} (${bb ? bb.qty : '?'})${b.expired ? ' — EXPIRED' : ''}`, action: { a: 'pickup', id: b.id }, warn: b.expired }; }
  const d = W.dirt.find(d => Math.hypot(d.x - me.x, d.z - me.z) < 1.1);
  if (d) return { label: `🧽 Clean up mess (${d.hp ?? 3} scrubs)`, action: { a: 'clean', id: d.id }, repeat: true };
  for (const f of near) {
    const def = FURNITURE[f.type];
    if (f.broken) return { label: `🔧 Repair ${def.name} (${f.repair || 0}/6)  ·  [X] Call technician $180`, action: { a: 'repair', id: f.id }, repeat: true, alt: { a: 'callTech', id: f.id } };
    if (f.slots && f.slots.some(s => s.expired && s.qty > 0)) return { label: `🤢 Clear expired items from ${def.name}`, action: { a: 'clearExpired', id: f.id } };
    if (f.boxes && f.boxes.length) return { label: `🗃️ Take box from rack (${f.boxes.length})`, action: { a: 'rackTake', id: f.id } };
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

function nearestBox(world, me) {
  let best = null, bd = 1.25;
  for (const b of world.boxList) {
    if (b.id < 0) continue;
    const d = Math.hypot(b.x - me.x, b.z - me.z) - b.y * 0.01;
    if (d < bd || (best && Math.abs(d - bd) < 0.05 && b.y > best.y)) { if (d < bd) bd = d; best = b; }
  }
  // prefer top of the stack at that spot
  if (best) {
    const top = world.boxList.filter(b => b.id >= 0 && Math.abs(b.x - best.x) < 0.3 && Math.abs(b.z - best.z) < 0.3).sort((a, b) => b.y - a.y)[0];
    if (top) best = top;
  }
  return best;
}
