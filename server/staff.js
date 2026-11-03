// Employee AI: cashiers, shelf stockers, cleaners, butchers and deli clerks visibly doing their jobs.
import { FURNITURE, SHIFTS, PRODUCT_MAP } from '../shared/data.js';
import { route } from '../shared/grid.js';
import { clamp, DOOR_TYPES } from './game.js';

export function staffPresent(game, st) {
  const s = game.s;
  if (st.absent) return false;
  if (s.phase === 'closing') return st.present;
  if (s.phase !== 'open') return false;
  const sh = SHIFTS[st.shift];
  return s.minute >= sh.start * 60 && s.minute < sh.end * 60;
}

function eff(game, st) {
  const skill = 1 + (st.skill - 1) * 0.1;
  return st.speed * skill * (0.6 + 0.4 * st.happiness / 100);
}

// Build a list of [x, z, floor] points from the employee to (wx, wz) on floor wf, handling the door & stairs.
function moveTo(game, st, wx, wz, wf = 0) {
  const s = game.s;
  const inside = st.z < s.d || (st.floor || 0) > 0, tIn = wz < s.d || wf > 0;
  const doorIn = [s.doorX + 1, s.d - 0.5, 0], doorOut = [s.doorX + 1, s.d + 1.2, 0];
  const r = (sx, sz, sf, tx, tz, tf) => {
    let fx = Math.floor(tx), fz = Math.floor(tz);
    const g = game.gridOf(tf);
    if (g.isBlocked(fx, fz)) { const n = g.nearestFree(fx, fz); if (!n) return null; [fx, fz] = n; }
    return route(game.grids, { x: sx, z: sz, floor: sf }, { x: fx, z: fz, floor: tf });
  };
  let pts;
  if (inside && tIn) pts = r(st.x, st.z, st.floor || 0, wx, wz, wf);
  else if (inside && !tIn) { const p = r(st.x, st.z, st.floor || 0, doorIn[0], doorIn[1], 0); if (!p) return false; pts = [...p, doorIn, doorOut, [wx, wz, 0]]; }
  else if (!inside && tIn) { const p = r(doorIn[0], doorIn[1], 0, wx, wz, wf); if (!p) return false; pts = [doorOut, doorIn, ...p]; }
  else pts = [[wx, wz, 0]];
  if (!pts) return false;
  if (tIn && pts.length && Math.hypot(pts.at(-1)[0] - wx, pts.at(-1)[1] - wz) < 0.8) pts.push([wx, wz, wf]);
  st.route = pts; st.dest = [wx, wz, wf]; st.pathVer = game.gridVersion;
  return true;
}

function step(game, st, dt) {
  if (st.route && st.route.length && st.pathVer !== game.gridVersion && st.dest) {
    if (!moveTo(game, st, ...st.dest)) { st.route = null; st.state = 'idle'; st.task = null; return false; }
  }
  if (!st.route || !st.route.length) { st.moving = false; return true; }
  const [tx, tz, tf] = st.route[0];
  const dx = tx - st.x, dz = tz - st.z; const d = Math.hypot(dx, dz);
  let sp = 2.4 * Math.min(1.4, eff(game, st));
  if (st.role === 'stocker' && game.s.upgrades.trolleys) sp *= 1.3;
  const stp = sp * dt;
  if (d <= stp) { st.x = tx; st.z = tz; if (tf !== undefined) st.floor = tf; st.route.shift(); }
  else { st.x += dx / d * stp; st.z += dz / d * stp; st.rot = Math.atan2(dx, dz); }
  st.moving = true;
  return !st.route.length;
}

function faceFixture(st, f) {
  const def = FURNITURE[f.type];
  const w = f.rot % 2 === 0 ? def.w : def.d, d = f.rot % 2 === 0 ? def.d : def.w;
  st.rot = Math.atan2(f.x + w / 2 - st.x, f.z + d / 2 - st.z);
}
function facePoint(st, x, z) { st.rot = Math.atan2(x - st.x, z - st.z); }
function freeFront(game, f) { const g = game.gridOf(f.floor); return f._fronts.find(t => !g.isBlocked(t[0], t[1])) || f._front; }

export function updateStaff(game, dt, dMin) {
  const s = game.s;
  for (const st of s.staff) {
    if (st.thoughtT > 0) { st.thoughtT -= dt; if (st.thoughtT <= 0) st.thought = ''; }
    const should = staffPresent(game, st);
    if (should && !st.present) {
      st.present = true; st.x = s.doorX + 1; st.z = s.d - 0.5; st.rot = Math.PI; st.floor = 0;
      st.state = 'idle'; st.route = null; st.task = null; st.post = null; st.carry = null; st.timer = 0;
    }
    if (!should && st.present && st.state !== 'goHome') {
      if (st.carry && st.carry.pid) game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired, st.floor || 0);
      st.carry = null;
      releaseClaims(game, st);
      st.post = null; st.state = 'goHome';
      moveTo(game, st, s.doorX + 1, s.d - 0.5, 0);
    }
    if (!st.present) continue;
    if (st.stunT > 0) { st.stunT -= dt; st.moving = false; continue; }
    if (st.state === 'goHome') { if (step(game, st, dt)) { st.present = false; st.state = 'idle'; } continue; }
    switch (st.role) {
      case 'cashier': cashier(game, st, dt); break;
      case 'butcher': deptWorker(game, st, dt, 'meat'); break;
      case 'deli': deptWorker(game, st, dt, 'deli'); break;
      case 'stocker': stocker(game, st, dt); break;
      case 'cleaner': cleaner(game, st, dt); break;
    }
  }
}

function releaseClaims(game, st) { for (const b of game.s.boxes) if (b._claim === st.id) b._claim = 0; }
function isPlayerAt(game, f) { for (const p of game.players.values()) if (p.station === f.id) return true; return false; }

// --------------------------------------------------------------------- cashier
function cashier(game, st, dt) {
  const s = game.s;
  let f = st.post ? game.fixture(st.post) : null;
  if (!f || f.type !== 'checkout') {
    st.post = null;
    const taken = new Set(s.staff.filter(o => o !== st && o.present && o.post).map(o => o.post));
    const free = game.fixtures('checkout').filter(c => !taken.has(c.id));
    free.sort((a, b) => (isPlayerAt(game, a) ? 1 : 0) - (isPlayerAt(game, b) ? 1 : 0));
    f = free[0];
    if (!f) { idle(game, st, dt); return; }
    st.post = f.id; st.state = 'toPost';
    moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5, f.floor || 0);
  }
  if (st.state === 'toPost' || st.state === 'idle') {
    if (st.state === 'idle') { st.state = 'toPost'; moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5, f.floor || 0); }
    if (step(game, st, dt)) { st.state = 'working'; faceFixture(st, f); st.timer = 0; }
    return;
  }
  if (st.state !== 'working') return;
  st.moving = false; faceFixture(st, f);
  if (isPlayerAt(game, f)) return;
  const c = game.customerAtRegister(f);
  if (!c) return;
  st.timer += dt * eff(game, st) * (f.upg ? 1.5 : 1);
  if (c.scanned < c.basket.length) {
    if (st.timer >= 0.85) { st.timer = 0; c.scanned++; game.sound('beep', f.x, f.z); }
  } else if (st.timer >= 0.9) { st.timer = 0; st.served++; game.completeCheckout(c, f, st); }
}

// --------------------------------------------------------------------- butcher / deli: fridge -> station -> counter
function deptWorker(game, st, dt, cat) {
  const s = game.s;
  let f = st.post ? game.fixture(st.post) : null;
  if (!f || FURNITURE[f.type].cat !== cat) {
    st.post = null;
    const taken = new Set(s.staff.filter(o => o !== st && o.present && o.post).map(o => o.post));
    f = s.furniture.find(x => FURNITURE[x.type].cat === cat && FURNITURE[x.type].kind === 'counter' && !taken.has(x.id));
    if (!f) { idle(game, st, dt); return; }
    st.post = f.id; st.state = 'toPost'; st.task = null;
    moveTo(game, st, ...f._spots.counterSpot, f.floor || 0);
  }
  const sp = f._spots, fl = f.floor || 0;
  if (st.state === 'toPost' || st.state === 'idle') {
    if (st.state === 'idle') { st.state = 'toPost'; moveTo(game, st, ...sp.counterSpot, fl); }
    if (step(game, st, dt)) { st.state = 'working'; facePoint(st, ...sp.counter); st.timer = 0; }
    return;
  }
  const t = st.task;
  if (!t) {
    st.moving = false; facePoint(st, ...sp.counter);
    if (playerInAisle(game, f)) return; // a player is running the counter
    const c = game.customerAtCounter(f);
    if (!c) return;
    st.task = { stage: 'toFridge', cid: c.id }; moveTo(game, st, ...sp.fridgeSpot, fl); st.state = 'dept';
    return;
  }
  const cust = game.customers.find(x => x.id === t.cid);
  const back = () => { st.task = null; st.carry = null; st.state = 'toPost'; moveTo(game, st, ...sp.counterSpot, fl); };
  switch (t.stage) {
    case 'toFridge':
      if (!step(game, st, dt)) return;
      facePoint(st, ...sp.fridge); t.stage = 'taking'; st.timer = 0.8; game.sound('fridgeOpen', f.x, f.z);
      return;
    case 'taking': {
      st.timer -= dt; st.moving = false; if (st.timer > 0) return;
      if (!cust || cust.state !== 'counterServe') { back(); return; }
      const slot = f.slots.find(sl => sl.pid === cust.counterReq.pid && sl.qty > 0 && !sl.expired);
      if (!slot) { game.counterOutOfStock(f, cust); back(); return; }
      t.qty = Math.min(cust.counterReq.qty, slot.qty); slot.qty -= t.qty; t.pid = slot.pid;
      st.carry = { dept: 'raw', pid: t.pid };
      game.dirtyWorld();
      t.stage = 'toStation'; moveTo(game, st, ...sp.stationSpot, fl);
      return;
    }
    case 'toStation':
      if (!step(game, st, dt)) return;
      facePoint(st, ...sp.station); t.stage = 'cutting'; st.timer = 0;
      return;
    case 'cutting': {
      st.moving = false;
      const need = FURNITURE[f.type].presses * 0.6;
      const before = st.timer;
      st.timer += dt * eff(game, st) * (f.upg ? 1.4 : 1);
      if (Math.floor(before / 0.6) !== Math.floor(st.timer / 0.6)) game.sound(cat === 'meat' ? 'chop' : 'slice', f.x, f.z);
      if (st.timer < need) return;
      st.carry = { dept: 'pack', pid: t.pid };
      t.stage = 'toCounter'; moveTo(game, st, ...sp.counterSpot, fl);
      return;
    }
    case 'toCounter':
      if (!step(game, st, dt)) return;
      facePoint(st, ...sp.counter);
      st.carry = null;
      if (cust && cust.state === 'counterServe' && cust.counterReq.pid === t.pid) { st.served++; game.serveCounter(f, cust, { skill: st.skill, name: st.name }, t.qty); }
      else { const sl = f.slots.find(sl => sl.pid === t.pid) || f.slots.find(sl => sl.qty === 0); if (sl) { sl.pid = t.pid; sl.qty += t.qty; } }
      st.task = null; st.state = 'working';
      return;
  }
}
function playerInAisle(game, f) {
  const sp = f._spots;
  for (const p of game.players.values()) {
    if ((p.floor || 0) !== (f.floor || 0)) continue;
    if ([sp.fridgeSpot, sp.stationSpot, sp.counterSpot].some(([x, z]) => Math.hypot(p.x - x, p.z - z) < 0.7)) return true;
  }
  return false;
}

// --------------------------------------------------------------------- stocker
function stockTarget(game, pid, onlyLow) {
  const p = PRODUCT_MAP[pid];
  let best = null, bestScore = -1;
  for (const f of game.s.furniture) {
    const def = FURNITURE[f.type];
    if (!f.slots || def.cat !== p.cat) continue;
    for (const sl of f.slots) {
      let score = -1;
      if (sl.pid === pid && !sl.expired && sl.qty < def.cap) {
        const fill = sl.qty / def.cap;
        if (onlyLow && fill > 0.5) continue;
        score = 10 - fill * 8;
      } else if (sl.qty === 0 && sl.pid === null) score = 3;
      else if (sl.qty === 0 && sl.pid !== pid && !onlyLow) score = 1;
      if (score > bestScore) { bestScore = score; best = f; }
    }
  }
  return best;
}
function rackWithSpace(game) { return game.s.furniture.find(f => f.boxes && f.boxes.length < FURNITURE.rack.boxes + (f.upg ? 4 : 0)); }
function topOf(s, b) {
  let top = 0;
  for (const o of s.boxes) if ((o.floor || 0) === (b.floor || 0) && Math.abs(o.x - b.x) < 0.35 && Math.abs(o.z - b.z) < 0.35) top = Math.max(top, o.y);
  return top;
}

function stocker(game, st, dt) {
  const s = game.s;
  st.timer -= dt;
  switch (st.state) {
    case 'idle': case 'toPost': case 'working': {
      if (st.timer > 0) { step(game, st, dt); return; }
      st.timer = 0.8;
      releaseClaims(game, st);
      const exp = s.furniture.find(f => f.slots && f.slots.some(sl => sl.expired && sl.qty > 0));
      if (exp && exp._front) {
        const t = freeFront(game, exp);
        if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5, exp.floor || 0)) { st.task = { type: 'expired', fid: exp.id }; st.state = 'toFixture'; return; }
      }
      const floor = s.boxes.filter(b => b.pid && !b.expired && !b._claim && b.y === topOf(s, b)).sort((a, b) => b.z - a.z);
      for (const b of floor) {
        const target = stockTarget(game, b.pid, false);
        const rack = target ? null : (b.z >= s.d ? rackWithSpace(game) : null);
        if (!target && !rack) continue;
        if (moveTo(game, st, b.x, b.z, b.floor || 0)) {
          b._claim = st.id;
          st.task = { type: 'floor', box: b.id, fid: target ? target.id : null, rack: rack ? rack.id : null };
          st.state = 'toBox'; return;
        }
      }
      for (const r of s.furniture.filter(f => f.boxes && f.boxes.length)) {
        for (const b of r.boxes) {
          if (b.expired) continue;
          const target = stockTarget(game, b.pid, true);
          if (!target) continue;
          const t = freeFront(game, r);
          if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5, r.floor || 0)) { st.task = { type: 'rack', rid: r.id, pid: b.pid, fid: target.id }; st.state = 'toBox'; return; }
        }
      }
      return;
    }
    case 'toBox': {
      if (!step(game, st, dt)) return;
      const t = st.task;
      if (t.type === 'floor') {
        const b = s.boxes.find(b => b.id === t.box);
        if (!b) { st.state = 'idle'; return; }
        game.removeBox(b);
        st.carry = { pid: b.pid, qty: b.qty, exp: b.exp, expired: b.expired };
      } else {
        const r = game.fixture(t.rid);
        const i = r && r.boxes ? r.boxes.findIndex(b => b.pid === t.pid) : -1;
        if (i < 0) { st.state = 'idle'; return; }
        st.carry = r.boxes.splice(i, 1)[0];
      }
      game.sound('pickup', st.x, st.z);
      game.dirtyWorld();
      goWithCarry(game, st, t.fid ? game.fixture(t.fid) : null, t.rack ? game.fixture(t.rack) : null);
      return;
    }
    case 'toFixture': {
      if (!step(game, st, dt)) return;
      const f = game.fixture(st.task.fid);
      if (!f) { st.state = st.carry ? 'reroute' : 'idle'; return; }
      faceFixture(st, f);
      if (DOOR_TYPES.has(f.type) && !f.open) { f.open = true; st.openedDoor = f.id; game.sound('fridgeOpen', f.x, f.z); game.dirtyWorld(); }
      st.state = st.task.type === 'expired' ? 'clearing' : 'stocking'; st.timer = 0.4;
      return;
    }
    case 'clearing': {
      st.moving = false;
      if (st.timer > 0) return;
      const f = game.fixture(st.task.fid);
      if (f) {
        let n = 0; for (const sl of f.slots) if (sl.expired && sl.qty) { n += sl.qty; sl.qty = 0; sl.expired = false; }
        if (n) { s.ledger.waste += n; game.sound('trash', f.x, f.z); game.dirtyWorld(); }
      }
      closeDoor(game, st);
      st.state = 'idle'; st.timer = 0.3;
      return;
    }
    case 'stocking': {
      st.moving = false;
      if (st.timer > 0) return;
      const f = game.fixture(st.task.fid);
      if (!f || !st.carry) { closeDoor(game, st); st.state = st.carry ? 'reroute' : 'idle'; return; }
      const r = game.stockInto(f, st.carry, 1);
      if (r.error) { closeDoor(game, st); st.state = 'reroute'; return; }
      st.served += 0.2;
      game.fx({ k: 'stocked', id: f.id, n: r.n, pid: st.carry.pid, by: -st.id });
      game.dirtyWorld();
      st.timer = 0.32 / Math.min(1.6, eff(game, st)) / (game.s.upgrades.trolleys ? 1.25 : 1);
      if (st.carry.qty <= 0) { st.carry = null; closeDoor(game, st); st.state = 'idle'; st.timer = 0.3; }
      return;
    }
    case 'reroute': {
      if (!st.carry) { st.state = 'idle'; return; }
      const target = stockTarget(game, st.carry.pid, false);
      goWithCarry(game, st, target, target ? null : rackWithSpace(game));
      return;
    }
    case 'toRack': {
      if (!step(game, st, dt)) return;
      const r = game.fixture(st.task.rack);
      if (r && r.boxes && r.boxes.length < FURNITURE.rack.boxes + (r.upg ? 4 : 0)) { r.boxes.push(st.carry); game.sound('drop', r.x, r.z); }
      else game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired, st.floor || 0);
      st.carry = null; st.state = 'idle'; st.timer = 0.3; game.dirtyWorld();
      return;
    }
  }
}
function closeDoor(game, st) {
  if (!st.openedDoor) return;
  const f = game.fixture(st.openedDoor); st.openedDoor = null;
  if (f && f.open) { f.open = false; game.sound('fridgeClose', f.x, f.z); game.dirtyWorld(); }
}

function goWithCarry(game, st, f, rack) {
  if (f) { const t = freeFront(game, f); if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5, f.floor || 0)) { st.task = { type: 'stock', fid: f.id }; st.state = 'toFixture'; return; } }
  if (rack) { const t = freeFront(game, rack); if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5, rack.floor || 0)) { st.task = { type: 'rack', rack: rack.id }; st.state = 'toRack'; return; } }
  if (st.carry) { game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired, st.floor || 0); st.carry = null; game.dirtyWorld(); }
  st.state = 'idle'; st.timer = 2;
}

// --------------------------------------------------------------------- cleaner
function cleaner(game, st, dt) {
  const s = game.s;
  st.timer -= dt;
  if (st.state === 'toDirt') {
    const d = s.dirt.find(d => d.id === st.task);
    if (!d) { st.state = 'idle'; return; }
    if (step(game, st, dt)) { st.state = 'cleaning'; st.timer = 1.6 / Math.min(1.6, eff(game, st)); facePoint(st, d.x, d.z); }
    return;
  }
  if (st.state === 'cleaning') {
    st.moving = false;
    if (Math.random() < 0.05) game.sound('scrub', st.x, st.z);
    if (st.timer > 0) return;
    const d = s.dirt.find(d => d.id === st.task);
    if (d) { s.dirt = s.dirt.filter(x => x !== d); game.sound('sparkle', d.x, d.z); game.dirtyWorld(); st.served++; }
    st.state = 'idle'; st.timer = 0.2;
    return;
  }
  if (st.timer > 0) { step(game, st, dt); return; }
  st.timer = 0.6;
  const claimed = new Set(s.staff.filter(o => o !== st && o.role === 'cleaner' && o.state === 'toDirt').map(o => o.task));
  const cost = (d) => Math.hypot(d.x - st.x, d.z - st.z) + ((d.floor || 0) !== (st.floor || 0) ? 10 : 0);
  const list = s.dirt.filter(d => !claimed.has(d.id)).sort((a, b) => cost(a) - cost(b));
  for (const d of list) if (moveTo(game, st, Math.floor(d.x) + 0.5, Math.floor(d.z) + 0.5, d.floor || 0)) { st.task = d.id; st.state = 'toDirt'; return; }
  idle(game, st, dt);
}

function idle(game, st, dt) {
  st.state = 'idle';
  if (st.route && st.route.length) { step(game, st, dt); return; }
  st.moving = false;
  if (Math.random() < 0.004) {
    const x = Math.floor(Math.random() * game.s.w), z = Math.floor(Math.random() * (game.s.d - 1));
    if (!game.grid.isBlocked(x, z)) moveTo(game, st, x + 0.5, z + 0.5, 0);
  }
}

export { clamp };
