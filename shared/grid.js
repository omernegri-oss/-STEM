// Grid geometry & pathfinding shared by server (NPC AI, validation) and client (preview, collision).
//
// Coordinate system: tile (x, z) covers world [x, x+1] x [z, z+1]. Interior is 0<=x<W, 0<=z<D.
// Row z=D is the storefront wall (only the 2 door tiles are open). Rows D+1 .. D+OUTSIDE_ROWS-1 are
// the sidewalk / delivery area outside. Back wall at z=0, side walls at x=0 and x=W.
import { FURNITURE, OUTSIDE_ROWS } from './data.js';

// rotation r -> facing direction (the "front" of a fixture, where customers stand)
export const FACING = [[0, 1], [1, 0], [0, -1], [-1, 0]];

export function dims(type, rot) {
  const f = FURNITURE[type];
  return (rot % 2 === 0) ? [f.w, f.d] : [f.d, f.w];
}

export function footprint(type, x, z, rot) {
  const [w, d] = dims(type, rot);
  const tiles = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) tiles.push([x + i, z + j]);
  return tiles;
}

// center of the footprint in world coords
export function center(type, x, z, rot) {
  const [w, d] = dims(type, rot);
  return [x + w / 2, z + d / 2];
}

// tiles directly in front of the fixture (customer side)
export function frontTiles(type, x, z, rot) {
  const [w, d] = dims(type, rot);
  const [fx, fz] = FACING[rot];
  const out = [];
  if (fz === 1) for (let i = 0; i < w; i++) out.push([x + i, z + d]);
  else if (fz === -1) for (let i = 0; i < w; i++) out.push([x + i, z - 1]);
  else if (fx === 1) for (let j = 0; j < d; j++) out.push([x + w, z + j]);
  else for (let j = 0; j < d; j++) out.push([x - 1, z + j]);
  return out;
}

// tiles directly behind the fixture (staff side for checkouts / counters)
export function backTiles(type, x, z, rot) {
  const [w, d] = dims(type, rot);
  const [fx, fz] = FACING[rot];
  const out = [];
  if (fz === 1) for (let i = 0; i < w; i++) out.push([x + i, z - 1]);
  else if (fz === -1) for (let i = 0; i < w; i++) out.push([x + i, z + d]);
  else if (fx === 1) for (let j = 0; j < d; j++) out.push([x - 1, z + j]);
  else for (let j = 0; j < d; j++) out.push([x + w, z + j]);
  return out;
}

export function needsBack(type) {
  const k = FURNITURE[type].kind;
  return k === 'checkout' || k === 'counter';
}

// The single "service" tiles of a fixture: where the customer stands, where the operator stands.
export function serviceTiles(f) {
  const fr = frontTiles(f.type, f.x, f.z, f.rot);
  const bk = backTiles(f.type, f.x, f.z, f.rot);
  const mid = Math.floor((fr.length - 1) / 2);
  return { front: fr[mid], back: bk[mid], fronts: fr, backs: bk };
}

export class Grid {
  constructor(W, D, doorX) {
    this.W = W; this.D = D; this.doorX = doorX;
    this.H = D + OUTSIDE_ROWS; // total rows incl. wall + outside
    this.blocked = new Uint8Array(W * this.H);
    this.owner = new Int32Array(W * this.H).fill(-1);
    this.resetWalls();
  }
  idx(x, z) { return z * this.W + x; }
  inBounds(x, z) { return x >= 0 && z >= 0 && x < this.W && z < this.H; }
  isInterior(x, z) { return x >= 0 && z >= 0 && x < this.W && z < this.D; }
  isDoor(x, z) { return z === this.D && (x === this.doorX || x === this.doorX + 1); }
  resetWalls() {
    this.blocked.fill(0); this.owner.fill(-1);
    for (let x = 0; x < this.W; x++) if (!this.isDoor(x, this.D)) this.blocked[this.idx(x, this.D)] = 2;
  }
  isBlocked(x, z) {
    if (!this.inBounds(x, z)) return true;
    return this.blocked[this.idx(x, z)] !== 0;
  }
  build(furniture) {
    this.resetWalls();
    for (const f of furniture) this.mark(f, 1);
  }
  mark(f, v) {
    for (const [tx, tz] of footprint(f.type, f.x, f.z, f.rot)) {
      if (!this.inBounds(tx, tz)) continue;
      this.blocked[this.idx(tx, tz)] = v;
      this.owner[this.idx(tx, tz)] = v ? f.id : -1;
    }
  }
  ownerAt(x, z) { return this.inBounds(x, z) ? this.owner[this.idx(x, z)] : -1; }

  // Can a fixture be placed here? Returns { ok, reason }.
  canPlace(furniture, type, x, z, rot, ignoreId = null) {
    const tiles = footprint(type, x, z, rot);
    for (const [tx, tz] of tiles) {
      if (!this.isInterior(tx, tz)) return { ok: false, reason: 'Must be inside the store' };
      if (tz >= this.D - 1 && (tx === this.doorX || tx === this.doorX + 1)) return { ok: false, reason: 'Keep the entrance clear' };
      const o = this.ownerAt(tx, tz);
      if (o !== -1 && o !== ignoreId) return { ok: false, reason: 'Space is occupied' };
    }
    // Build a hypothetical grid and check every fixture's service tiles remain reachable.
    const g = new Grid(this.W, this.D, this.doorX);
    const list = furniture.filter(f => f.id !== ignoreId).concat([{ id: -99, type, x, z, rot }]);
    g.build(list);
    const reach = g.floodFrom(this.doorX, this.D - 1);
    for (const f of list) {
      const fr = frontTiles(f.type, f.x, f.z, f.rot);
      if (!fr.some(([a, b]) => g.isInterior(a, b) && reach[g.idx(a, b)])) {
        return { ok: false, reason: f.id === -99 ? 'Front must face an open aisle' : 'Would block access to another fixture' };
      }
      if (needsBack(f.type)) {
        const bk = backTiles(f.type, f.x, f.z, f.rot);
        if (!bk.some(([a, b]) => g.isInterior(a, b) && reach[g.idx(a, b)])) {
          return { ok: false, reason: f.id === -99 ? 'Staff need room behind it' : 'Would block a staff position' };
        }
      }
    }
    return { ok: true };
  }

  floodFrom(sx, sz) {
    const seen = new Uint8Array(this.W * this.H);
    if (this.isBlocked(sx, sz)) return seen;
    const q = [[sx, sz]]; seen[this.idx(sx, sz)] = 1;
    while (q.length) {
      const [x, z] = q.pop();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (!this.inBounds(nx, nz) || this.isBlocked(nx, nz)) continue;
        const i = this.idx(nx, nz);
        if (seen[i]) continue;
        seen[i] = 1; q.push([nx, nz]);
      }
    }
    return seen;
  }

  // A* with 8-directional movement (no corner cutting). Returns array of [x,z] tiles or null.
  path(sx, sz, tx, tz) {
    sx = Math.floor(sx); sz = Math.floor(sz); tx = Math.floor(tx); tz = Math.floor(tz);
    if (!this.inBounds(tx, tz)) return null;
    if (this.isBlocked(sx, sz)) {
      // start inside something (furniture just placed on us) - find nearest free neighbour
      const n = this.nearestFree(sx, sz);
      if (!n) return null; sx = n[0]; sz = n[1];
    }
    if (this.isBlocked(tx, tz)) return null;
    if (sx === tx && sz === tz) return [[tx, tz]];
    const W = this.W, N = W * this.H;
    const g = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const s = this.idx(sx, sz), t = this.idx(tx, tz);
    g[s] = 0; heap.push(s, this.h(sx, sz, tx, tz));
    const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
    let iter = 0;
    while (heap.size && iter++ < 20000) {
      const cur = heap.pop();
      if (cur === t) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cz = (cur / W) | 0;
      for (const [dx, dz, c] of dirs) {
        const nx = cx + dx, nz = cz + dz;
        if (!this.inBounds(nx, nz) || this.isBlocked(nx, nz)) continue;
        if (dx && dz && (this.isBlocked(cx + dx, cz) || this.isBlocked(cx, cz + dz))) continue;
        const ni = this.idx(nx, nz);
        const ng = g[cur] + c;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; heap.push(ni, ng + this.h(nx, nz, tx, tz)); }
      }
    }
    if (came[t] === -1) return null;
    const out = [];
    for (let c = t; c !== s && c !== -1; c = came[c]) out.push([c % W, (c / W) | 0]);
    out.reverse();
    return out;
  }
  h(ax, az, bx, bz) { const dx = Math.abs(ax - bx), dz = Math.abs(az - bz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); }
  nearestFree(x, z) {
    for (let r = 1; r < 6; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (!this.isBlocked(x + dx, z + dz)) return [x + dx, z + dz];
    }
    return null;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const a = this.k, b = this.p; a.push(k); b.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (b[par] <= b[i]) break;
      [a[par], a[i]] = [a[i], a[par]]; [b[par], b[i]] = [b[i], b[par]]; i = par;
    }
  }
  pop() {
    const a = this.k, b = this.p; const top = a[0];
    const lk = a.pop(), lp = b.pop();
    if (a.length) {
      a[0] = lk; b[0] = lp; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && b[l] < b[m]) m = l;
        if (r < a.length && b[r] < b[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [b[m], b[i]] = [b[i], b[m]]; i = m;
      }
    }
    return top;
  }
}

// Client-side circle collision vs the store's solid tiles. Outside the grid (left/right of the
// store on the sidewalk) is open ground.
export function solidAt(grid, tx, tz) {
  if (tz < 0) return true;
  if (tz < grid.D) { if (tx < 0 || tx >= grid.W) return true; return grid.isBlocked(tx, tz); }
  if (tz === grid.D) {
    if (tx < 0 || tx >= grid.W) return false; // walking around the building corner outside
    return grid.isBlocked(tx, tz);
  }
  if (tz >= grid.D + OUTSIDE_ROWS + 3) return true;
  if (tx < -14 || tx >= grid.W + 14) return true;
  return false;
}

export function resolveCollision(grid, x, z, r = 0.3) {
  // the building's side walls extend to the storefront: block tiles at tz<D outside 0..W
  for (let pass = 0; pass < 2; pass++) {
    const tx0 = Math.floor(x - r), tx1 = Math.floor(x + r), tz0 = Math.floor(z - r), tz1 = Math.floor(z + r);
    for (let tx = tx0; tx <= tx1; tx++) for (let tz = tz0; tz <= tz1; tz++) {
      if (!solidAt(grid, tx, tz)) continue;
      // closest point on tile AABB
      const cx = Math.max(tx, Math.min(x, tx + 1)), cz = Math.max(tz, Math.min(z, tz + 1));
      let dx = x - cx, dz = z - cz; const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-8) {
        // centre inside tile: push out along the shallowest axis
        const l = x - tx, rr = tx + 1 - x, t = z - tz, b = tz + 1 - z;
        const m = Math.min(l, rr, t, b);
        if (m === l) x = tx - r; else if (m === rr) x = tx + 1 + r; else if (m === t) z = tz - r; else z = tz + 1 + r;
      } else {
        const d = Math.sqrt(d2); const push = r - d;
        x += dx / d * push; z += dz / d * push;
      }
    }
  }
  return [x, z];
}
