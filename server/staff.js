// Employee AI: cashiers, shelf stockers, cleaners, butchers and deli clerks visibly doing their jobs.
import { FURNITURE, SHIFTS, PRODUCT_MAP } from '../shared/data.js';
import { clamp } from './game.js';

export function staffPresent(game, st) {
  const s = game.s;
  if (st.absent) return false;
  if (s.phase === 'closing') return st.present; // stay until the last customer leaves
  if (s.phase !== 'open') return false;
  const sh = SHIFTS[st.shift];
  return s.minute >= sh.start * 60 && s.minute < sh.end * 60;
}

function eff(game, st) {
  const skill = 1 + (st.skill - 1) * 0.1;
  return st.speed * skill * (0.6 + 0.4 * st.happiness / 100);
}

function say(st, t, dur = 2) { st.thought = t; st.thoughtT = dur; }

// Build a list of world points from the staff member's position to (wx, wz), handling the door.
function moveTo(game, st, wx, wz) {
  const s = game.s, g = game.grid;
  const inside = st.z < s.d, tIn = wz < s.d;
  const doorIn = [s.doorX + 1, s.d - 0.5], doorOut = [s.doorX + 1, s.d + 1.2];
  let pts = [];
  const astar = (sx, sz, tx, tz) => {
    let fx = Math.floor(tx), fz = Math.floor(tz);
    if (g.isBlocked(fx, fz)) { const n = g.nearestFree(fx, fz); if (!n) return null; [fx, fz] = n; }
    const p = g.path(sx, sz, fx, fz);
    return p ? p.map(([x, z]) => [x + 0.5, z + 0.5]) : null;
  };
  if (inside && tIn) {
    const p = astar(st.x, st.z, wx, wz); if (!p) return false;
    pts = p;
  } else if (inside && !tIn) {
    const p = astar(st.x, st.z, doorIn[0], doorIn[1]); if (!p) return false;
    pts = [...p, doorIn, doorOut, [wx, wz]];
  } else if (!inside && tIn) {
    const p = astar(doorIn[0], doorIn[1], wx, wz); if (!p) return false;
    pts = [doorOut, doorIn, ...p];
  } else pts = [[wx, wz]];
  // final exact point when target is a free-floating spot (boxes)
  st.route = pts; st.dest = [wx, wz]; st.pathVer = game.gridVersion;
  return true;
}

function step(game, st, dt) {
  if (st.route && st.route.length && st.pathVer !== game.gridVersion && st.dest) {
    if (!moveTo(game, st, st.dest[0], st.dest[1])) { st.route = null; st.state = 'idle'; st.task = null; return false; }
  }
  if (!st.route || !st.route.length) { st.moving = false; return true; }
  const [tx, tz] = st.route[0];
  const dx = tx - st.x, dz = tz - st.z; const d = Math.hypot(dx, dz);
  let sp = 2.4 * Math.min(1.4, eff(game, st));
  if (st.role === 'stocker' && game.s.upgrades.trolleys) sp *= 1.3;
  const stp = sp * dt;
  if (d <= stp) { st.x = tx; st.z = tz; st.route.shift(); }
  else { st.x += dx / d * stp; st.z += dz / d * stp; st.rot = Math.atan2(dx, dz); }
  st.moving = true;
  return !st.route.length;
}

function faceFixture(st, f) {
  const def = FURNITURE[f.type];
  const w = f.rot % 2 === 0 ? def.w : def.d, d = f.rot % 2 === 0 ? def.d : def.w;
  st.rot = Math.atan2(f.x + w / 2 - st.x, f.z + d / 2 - st.z);
}

export function updateStaff(game, dt, dMin) {
  const s = game.s;
  for (const st of s.staff) {
    if (st.thoughtT > 0) { st.thoughtT -= dt; if (st.thoughtT <= 0) st.thought = ''; }
    const should = staffPresent(game, st);
    if (should && !st.present) {
      st.present = true; st.x = s.doorX + 1; st.z = s.d - 0.5; st.rot = Math.PI;
      st.state = 'idle'; st.route = null; st.task = null; st.post = null; st.carry = null; st.timer = 0;
      say(st, '👋', 2);
    }
    if (!should && st.present && st.state !== 'goHome') {
      if (st.carry) { game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired); st.carry = null; }
      releaseClaims(game, st);
      st.post = null; st.state = 'goHome';
      moveTo(game, st, s.doorX + 1, s.d - 0.5);
    }
    if (!st.present) continue;
    if (st.state === 'goHome') {
      if (step(game, st, dt)) { st.present = false; st.state = 'idle'; }
      continue;
    }
    if (st.happiness < 30 && Math.random() < 0.002) say(st, '😩', 2);
    switch (st.role) {
      case 'cashier': cashier(game, st, dt); break;
      case 'butcher': counterWorker(game, st, dt, 'meat'); break;
      case 'deli': counterWorker(game, st, dt, 'deli'); break;
      case 'stocker': stocker(game, st, dt); break;
      case 'cleaner': cleaner(game, st, dt); break;
    }
  }
}

function releaseClaims(game, st) {
  for (const b of game.s.boxes) if (b._claim === st.id) b._claim = 0;
}

// --------------------------------------------------------------------- cashier
function cashier(game, st, dt) {
  const s = game.s;
  let f = st.post ? game.fixture(st.post) : null;
  if (!f || f.type !== 'checkout') {
    st.post = null;
    // pick a checkout no other cashier owns, preferring ones without a player
    const taken = new Set(s.staff.filter(o => o !== st && o.present && o.post).map(o => o.post));
    const free = game.fixtures('checkout').filter(c => !taken.has(c.id));
    free.sort((a, b) => (isPlayerAt(game, a) ? 1 : 0) - (isPlayerAt(game, b) ? 1 : 0));
    f = free[0];
    if (!f) { idle(game, st, dt); return; }
    st.post = f.id; st.state = 'toPost';
    moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5);
  }
  if (st.state === 'toPost' || st.state === 'idle') {
    if (st.state === 'idle') { st.state = 'toPost'; moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5); }
    if (step(game, st, dt)) { st.state = 'working'; faceFixture(st, f); st.timer = 0; }
    return;
  }
  if (st.state !== 'working') return;
  st.moving = false; faceFixture(st, f);
  if (isPlayerAt(game, f)) { if (!st.thoughtT) say(st, '🙂', 1); return; } // a player is running this till
  const c = game.customerAtRegister(f);
  if (!c) return;
  const rate = eff(game, st) * (f.upg ? 1.5 : 1);
  st.timer += dt * rate;
  const per = 0.85;
  if (c.scanned < c.basket.length) {
    if (st.timer >= per) { st.timer = 0; c.scanned++; game.sound('beep', f.x, f.z); }
  } else if (st.timer >= 0.9) {
    st.timer = 0; st.served++;
    game.completeCheckout(c, f, st);
  }
}

function isPlayerAt(game, f) {
  for (const p of game.players.values()) if (p.station === f.id) return true;
  return false;
}

// --------------------------------------------------------------------- butcher / deli
function counterWorker(game, st, dt, cat) {
  const s = game.s;
  let f = st.post ? game.fixture(st.post) : null;
  if (!f || FURNITURE[f.type].cat !== cat) {
    st.post = null;
    const taken = new Set(s.staff.filter(o => o !== st && o.present && o.post).map(o => o.post));
    f = s.furniture.find(x => FURNITURE[x.type].cat === cat && FURNITURE[x.type].kind === 'counter' && !taken.has(x.id));
    if (!f) { idle(game, st, dt); return; }
    st.post = f.id; st.state = 'toPost';
    moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5);
  }
  if (st.state === 'toPost' || st.state === 'idle') {
    if (st.state === 'idle') { st.state = 'toPost'; moveTo(game, st, f._back[0] + 0.5, f._back[1] + 0.5); }
    if (step(game, st, dt)) { st.state = 'working'; faceFixture(st, f); st.timer = 0; }
    return;
  }
  if (st.state !== 'working') return;
  st.moving = false; faceFixture(st, f);
  if (isPlayerAt(game, f)) return;
  const c = game.customerAtCounter(f);
  const rt = game.rt.get(f.id);
  if (!c) { if (rt) rt.progress = 0; return; }
  const need = FURNITURE[f.type].presses * 0.6;
  st.timer += dt * eff(game, st) * (f.upg ? 1.4 : 1);
  if (rt) rt.progress = Math.floor(st.timer / need * FURNITURE[f.type].presses);
  if (Math.floor((st.timer - dt) / 0.6) !== Math.floor(st.timer / 0.6)) game.sound(cat === 'meat' ? 'chop' : 'slice', f.x, f.z);
  if (st.timer >= need) {
    st.timer = 0; st.served++; if (rt) rt.progress = 0;
    game.serveCounter(f, c, { skill: st.skill, name: st.name });
  }
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

function rackWithSpace(game) {
  return game.s.furniture.find(f => f.boxes && f.boxes.length < FURNITURE.rack.boxes + (f.upg ? 4 : 0));
}

function stocker(game, st, dt) {
  const s = game.s;
  st.timer -= dt;
  switch (st.state) {
    case 'idle': case 'toPost': case 'working': {
      if (st.timer > 0) { if (st.wander) step(game, st, dt); return; }
      st.timer = 0.8; st.wander = false;
      releaseClaims(game, st);
      // 1) clear expired stock
      const exp = s.furniture.find(f => f.slots && f.slots.some(sl => sl.expired && sl.qty > 0));
      if (exp && exp._front) {
        const t = exp._fronts.find(t => !game.grid.isBlocked(t[0], t[1])) || exp._front;
        if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5)) { st.task = { type: 'expired', fid: exp.id }; st.state = 'toFixture'; return; }
      }
      // 2) floor boxes (delivery area first) -> shelves, or to the rack
      const floor = s.boxes.filter(b => !b.expired && !b._claim && b.y === topOf(s, b))
        .sort((a, b) => b.z - a.z);
      for (const b of floor) {
        const target = stockTarget(game, b.pid, false);
        const rack = target ? null : (b.z >= s.d ? rackWithSpace(game) : null);
        if (!target && !rack) continue;
        if (moveTo(game, st, b.x, b.z)) {
          b._claim = st.id;
          st.task = { type: 'floor', box: b.id, fid: target ? target.id : null, rack: rack ? rack.id : null };
          st.state = 'toBox'; return;
        }
      }
      // 3) rack back-stock -> low shelves
      for (const r of s.furniture.filter(f => f.boxes && f.boxes.length)) {
        for (const b of r.boxes) {
          if (b.expired) continue;
          const target = stockTarget(game, b.pid, true);
          if (!target) continue;
          const t = r._fronts.find(t => !game.grid.isBlocked(t[0], t[1])) || r._front;
          if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5)) { st.task = { type: 'rack', rid: r.id, pid: b.pid, fid: target.id }; st.state = 'toBox'; return; }
        }
      }
      // nothing to do: idle near storage
      if (!st.thoughtT && Math.random() < 0.3) say(st, '🙂', 1.5);
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
        game.sound('pickup', st.x, st.z);
      } else {
        const r = game.fixture(t.rid);
        const i = r && r.boxes ? r.boxes.findIndex(b => b.pid === t.pid) : -1;
        if (i < 0) { st.state = 'idle'; return; }
        st.carry = r.boxes.splice(i, 1)[0];
        game.sound('pickup', st.x, st.z);
      }
      game.dirtyWorld();
      goWithCarry(game, st, t.fid ? game.fixture(t.fid) : null, t.rack ? game.fixture(t.rack) : null);
      return;
    }
    case 'toFixture': {
      if (!step(game, st, dt)) return;
      const f = game.fixture(st.task.fid);
      if (!f) { st.state = st.carry ? 'reroute' : 'idle'; return; }
      faceFixture(st, f);
      st.state = st.task.type === 'expired' ? 'clearing' : 'stocking'; st.timer = 0.4;
      return;
    }
    case 'clearing': {
      st.moving = false;
      if (st.timer > 0) return;
      const f = game.fixture(st.task.fid);
      if (f) {
        let n = 0; for (const sl of f.slots) if (sl.expired && sl.qty) { n += sl.qty; sl.qty = 0; sl.expired = false; }
        if (n) { s.ledger.waste += n; game.sound('trash', f.x, f.z); game.dirtyWorld(); say(st, '🧹', 1.5); }
      }
      st.state = 'idle'; st.timer = 0.3;
      return;
    }
    case 'stocking': {
      st.moving = false;
      if (st.timer > 0) return;
      const f = game.fixture(st.task.fid);
      if (!f || !st.carry) { st.state = st.carry ? 'reroute' : 'idle'; return; }
      const r = game.stockInto(f, st.carry, 1);
      if (r.error) { st.state = 'reroute'; return; }
      st.served += 0.2;
      game.fx({ k: 'stocked', id: f.id, n: r.n, pid: st.carry.pid, by: -st.id });
      game.dirtyWorld();
      st.timer = 0.32 / Math.min(1.6, eff(game, st)) / (game.s.upgrades.trolleys ? 1.25 : 1);
      if (st.carry.qty <= 0) { st.carry = null; st.state = 'idle'; st.timer = 0.3; say(st, '✅', 1); }
      return;
    }
    case 'reroute': {
      // still holding stock: try another shelf, then the rack, else drop it
      const target = st.carry ? stockTarget(game, st.carry.pid, false) : null;
      if (!st.carry) { st.state = 'idle'; return; }
      goWithCarry(game, st, target, target ? null : rackWithSpace(game));
      return;
    }
    case 'toRack': {
      if (!step(game, st, dt)) return;
      const r = game.fixture(st.task.rack);
      if (r && r.boxes && r.boxes.length < FURNITURE.rack.boxes + (r.upg ? 4 : 0)) { r.boxes.push(st.carry); game.sound('drop', r.x, r.z); }
      else game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired);
      st.carry = null; st.state = 'idle'; st.timer = 0.3; game.dirtyWorld();
      return;
    }
  }
}

function topOf(s, b) {
  let top = 0;
  for (const o of s.boxes) if (Math.abs(o.x - b.x) < 0.35 && Math.abs(o.z - b.z) < 0.35) top = Math.max(top, o.y);
  return top;
}

function goWithCarry(game, st, f, rack) {
  if (f) {
    const t = f._fronts.find(t => !game.grid.isBlocked(t[0], t[1])) || f._front;
    if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5)) { st.task = { type: 'stock', fid: f.id }; st.state = 'toFixture'; return; }
  }
  if (rack) {
    const t = rack._fronts.find(t => !game.grid.isBlocked(t[0], t[1])) || rack._front;
    if (moveTo(game, st, t[0] + 0.5, t[1] + 0.5)) { st.task = { type: 'rack', rack: rack.id }; st.state = 'toRack'; return; }
  }
  // nowhere to put it: set it down inside near the entrance
  if (st.carry) { game.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, st.carry.expired); st.carry = null; game.dirtyWorld(); }
  st.state = 'idle'; st.timer = 2;
}

// --------------------------------------------------------------------- cleaner
function cleaner(game, st, dt) {
  const s = game.s;
  st.timer -= dt;
  if (st.state === 'toDirt') {
    const d = s.dirt.find(d => d.id === st.task);
    if (!d) { st.state = 'idle'; return; }
    if (step(game, st, dt)) { st.state = 'cleaning'; st.timer = 1.6 / Math.min(1.6, eff(game, st)); st.rot = Math.atan2(d.x - st.x, d.z - st.z); }
    return;
  }
  if (st.state === 'cleaning') {
    st.moving = false;
    if (Math.random() < 0.05) game.sound('scrub', st.x, st.z);
    if (st.timer > 0) return;
    const d = s.dirt.find(d => d.id === st.task);
    if (d) { s.dirt = s.dirt.filter(x => x !== d); game.sound('sparkle', d.x, d.z); game.dirtyWorld(); st.served++; say(st, '✨', 1); }
    st.state = 'idle'; st.timer = 0.2;
    return;
  }
  if (st.timer > 0) { step(game, st, dt); return; }
  st.timer = 0.6;
  const claimed = new Set(s.staff.filter(o => o !== st && o.role === 'cleaner' && o.state === 'toDirt').map(o => o.task));
  const list = s.dirt.filter(d => !claimed.has(d.id)).sort((a, b) => Math.hypot(a.x - st.x, a.z - st.z) - Math.hypot(b.x - st.x, b.z - st.z));
  for (const d of list) {
    if (moveTo(game, st, Math.floor(d.x) + 0.5, Math.floor(d.z) + 0.5)) { st.task = d.id; st.state = 'toDirt'; return; }
  }
  idle(game, st, dt);
}

function idle(game, st, dt) {
  st.state = 'idle';
  if (st.route && st.route.length) { step(game, st, dt); return; }
  st.moving = false;
  if (Math.random() < 0.004) {
    const x = Math.floor(Math.random() * game.s.w), z = Math.floor(Math.random() * (game.s.d - 1));
    if (!game.grid.isBlocked(x, z)) moveTo(game, st, x + 0.5, z + 0.5);
  }
  if (!st.thoughtT && Math.random() < 0.003) say(st, '💭', 1.5);
}

export { clamp };
