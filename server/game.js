// Authoritative game simulation for one supermarket (one multiplayer room).
import {
  PRODUCTS, PRODUCT_MAP, SUPPLIERS, SUPPLIER_MAP, FURNITURE, FIXTURE_UPGRADES, EXPANSIONS, FLOORS, WALLS, LIGHTS,
  TEAM_UPGRADES, TEAM_UPGRADE_MAP, ROLES, SHIFTS, LEVEL_XP, MAX_LEVEL, levelForXp, ACHIEVEMENTS, GOALS,
  FIRST_NAMES, LAST_NAMES, EVENT_TYPES, STARTING_CASH, REAL_SECONDS_PER_MINUTE, OPEN_HOUR, CLOSE_HOUR,
  LAST_ENTRY_HOUR, fmtMoney, CATEGORIES,
} from '../shared/data.js';
import { Grid, footprint, frontTiles, backTiles, serviceTiles, FACING, center } from '../shared/grid.js';
import { updateCustomers, spawnCustomer, returnBasket, customerLeave } from './customers.js';
import { updateStaff, staffPresent } from './staff.js';

export const rnd = (a, b) => a + Math.random() * (b - a);
export const rndi = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = v => Math.round(v * 100) / 100;

function newLedger() {
  return { revenue: 0, cogs: 0, salaries: 0, rent: 0, power: 0, maint: 0, other: 0, bonus: 0, tips: 0,
    customers: 0, served: 0, angry: 0, lost: 0, satSum: 0, waste: 0, sold: {} };
}

export class Game {
  constructor(code, save = null, hooks = {}) {
    this.code = code;
    this.hooks = hooks; // { fx(msg), toast(text, kind), isNameTaken(name) }
    this.customers = [];
    this.pigeons = [];
    this.rt = new Map();          // fixture runtime: queues, operators, timers
    this.worldDirty = true;
    this.metaDirty = true;
    this.gridVersion = 0;
    this.lastAchCheck = 0;
    this.players = new Map();     // filled by Room (shared reference)
    this.minuteAcc = 0;
    if (save) this.load(save); else this.fresh();
    this.rebuildGrid();
  }

  fresh() {
    const e = EXPANSIONS[0];
    this.s = {
      version: 2, name: '', nameDraft: '', nameVotes: [], phase: 'naming',
      w: e.w, d: e.d, doorX: Math.floor(e.w / 2) - 1, expansion: 0,
      floor: 'white', wall: 'cream',
      furniture: [], boxes: [], dirt: [],
      prices: Object.fromEntries(PRODUCTS.map(p => [p.id, p.price])),
      cash: STARTING_CASH, day: 1, minute: 7 * 60, speed: 1, paused: false,
      xp: 0, level: 1, rep: 55,
      staff: [], candidates: [], orders: [],
      upgrades: {}, ownedFloors: ['white'], ownedWalls: ['cream'], lighting: 'standard', ownedLights: ['standard'],
      ledger: newLedger(), history: [], report: null,
      stats: { revenue: 0, customers: 0, sold: {}, playerCheckouts: 0, butcher: 0, deli: 0, angry: 0, vip: 0 },
      achievements: {}, goalIndex: 0, goalFlags: {},
      demand: {}, events: [], pendingSale: false, saleActive: false, eventLog: [],
      negativeDays: 0, nextId: 1, created: Date.now(),
    };
    this.refreshCandidates();
    this.s.challenge = this.makeChallenge();
  }

  load(save) {
    this.s = save;
    const fr = this.fresh.bind(this);
    // forward-compatible defaults
    const def = { ownedFloors: ['white'], ownedWalls: ['cream'], goalFlags: {}, eventLog: [], pigeons: [], lighting: 'standard', ownedLights: ['standard'] };
    for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
    if (this.s.phase === 'open' || this.s.phase === 'closing') this.s.phase = 'prep';
    this.s.paused = false;
    for (const st of this.s.staff) this.resetStaffRuntime(st);
    for (const b of this.s.boxes) delete b._claim;
    if (!this.s.challenge) this.s.challenge = this.makeChallenge();
    void fr;
  }

  serialize() {
    const s = { ...this.s };
    s.staff = this.s.staff.map(st => ({ id: st.id, name: st.name, role: st.role, skill: st.skill, speed: st.speed,
      salary: st.salary, happiness: st.happiness, shift: st.shift, seed: st.seed, hiredDay: st.hiredDay, absent: false, served: 0 }));
    s.orders = this.s.orders;
    return JSON.parse(JSON.stringify(s));
  }

  id() { return this.s.nextId++; }
  fx(msg) { this.hooks.fx && this.hooks.fx(msg); }
  toast(text, kind = 'info', icon = '') { this.fx({ k: 'toast', text, kind, icon }); }
  sound(name, x, z) { this.fx({ k: 'snd', name, x, z }); }
  float(text, x, z, color = '#16a34a') { this.fx({ k: 'float', text, x, z, color }); }
  dirtyWorld() { this.worldDirty = true; }
  dirtyMeta() { this.metaDirty = true; }

  // ------------------------------------------------------------------ grid
  rebuildGrid() {
    this.grid = new Grid(this.s.w, this.s.d, this.s.doorX);
    this.grid.build(this.s.furniture);
    this.gridVersion++;
    // service tiles + queue spots for every fixture
    for (const f of this.s.furniture) {
      const st = serviceTiles(f);
      f._front = st.front; f._back = st.back; f._fronts = st.fronts;
      if (!this.rt.has(f.id)) this.rt.set(f.id, { queue: [], timer: 0, progress: 0 });
      const kind = FURNITURE[f.type].kind;
      if (kind === 'checkout' || kind === 'counter' || kind === 'selfcheckout') f._queue = this.queueSpots(f);
    }
    for (const id of [...this.rt.keys()]) if (!this.fixture(id)) this.rt.delete(id);
  }

  queueSpots(f) {
    const [fx, fz] = FACING[f.rot];
    const [ox, oz] = f._front;
    const cands = [];
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const x = ox + dx, z = oz + dz;
      if (!this.grid.isInterior(x, z) || this.grid.isBlocked(x, z)) continue;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along < 0) continue;
      if (z >= this.s.d - 1 && (x === this.s.doorX || x === this.s.doorX + 1)) continue;
      cands.push({ x, z, score: along + lat * 1.7 });
    }
    cands.sort((a, b) => a.score - b.score);
    // the first must be the front tile
    const out = [[ox, oz]];
    for (const c of cands) if (!(c.x === ox && c.z === oz)) out.push([c.x, c.z]);
    return out.slice(0, 10);
  }

  fixture(id) { return this.s.furniture.find(f => f.id === id); }
  fixtures(kind) { return this.s.furniture.filter(f => FURNITURE[f.type].kind === kind); }

  // ------------------------------------------------------------------ derived values
  appeal() {
    let a = 0;
    for (const f of this.s.furniture) a += FURNITURE[f.type].appeal || 0;
    if (this.s.upgrades.led) a += 5;
    const fl = FLOORS.findIndex(x => x.id === this.s.floor);
    a += Math.max(0, fl) * 1.5;
    const wl = WALLS.findIndex(x => x.id === this.s.wall);
    a += wl > 0 ? 2 : 0;
    a += (LIGHTS.find(l => l.id === this.s.lighting) || LIGHTS[0]).appeal;
    a -= this.s.dirt.length;
    return Math.round(a);
  }
  carryCap() { return this.s.upgrades.palletjack ? 6 : this.s.upgrades.handtruck ? 3 : 1; }
  stars() { return clamp(this.s.rep / 20, 0, 5); }
  hasDept(cat) {
    return this.s.furniture.some(f => FURNITURE[f.type].cat === cat && f.slots && f.slots.some(sl => sl.qty > 0));
  }
  unlocked(level) { return this.s.level >= level; }
  price(pid) { return this.s.prices[pid] ?? PRODUCT_MAP[pid].price; }
  effPrice(pid) { return round2(this.price(pid) * (this.s.saleActive ? 0.85 : 1)); }
  eventActive(type) { return this.s.events.some(e => e.type === type && (e.until == null || this.s.minute < e.until)); }

  // ------------------------------------------------------------------ economy helpers
  spend(amount, field = 'other') {
    this.s.cash = round2(this.s.cash - amount);
    this.s.ledger[field] = round2((this.s.ledger[field] || 0) + amount);
    this.dirtyMeta();
  }
  earn(amount, field = 'revenue') {
    this.s.cash = round2(this.s.cash + amount);
    this.s.ledger[field] = round2((this.s.ledger[field] || 0) + amount);
    this.dirtyMeta();
  }
  addXp(v) {
    this.s.xp += Math.round(v);
    const lvl = Math.min(MAX_LEVEL, levelForXp(this.s.xp));
    if (lvl > this.s.level) {
      const from = this.s.level + 1;
      this.s.level = lvl;
      const unlocks = [];
      const inRange = (l) => l >= from && l <= lvl;
      for (const [k, f] of Object.entries(FURNITURE)) if (inRange(f.level)) unlocks.push(f.icon + ' ' + f.name);
      for (const p of PRODUCTS) if (inRange(p.level)) unlocks.push(p.icon + ' ' + p.name);
      for (const s of SUPPLIERS) if (inRange(s.level)) unlocks.push(s.icon + ' ' + s.name);
      for (const r of Object.values(ROLES)) if (inRange(r.level)) unlocks.push(r.icon + ' Hire ' + r.name);
      for (const u of TEAM_UPGRADES) if (inRange(u.level)) unlocks.push(u.icon + ' ' + u.name);
      for (const e of EXPANSIONS) if (inRange(e.level) && e.cost > 0) unlocks.push('📐 Expansion ' + e.w + '×' + e.d);
      if (unlocks.length > 14) { const n = unlocks.length - 13; unlocks.length = 13; unlocks.push(`…and ${n} more!`); }
      this.fx({ k: 'levelup', level: lvl, unlocks });
      this.refreshCandidates(true);
    }
    this.dirtyMeta();
  }

  // ------------------------------------------------------------------ actions from players
  act(player, m) {
    const s = this.s;
    const fail = (text) => { this.fx({ k: 'err', text, to: player.id }); return false; };
    const a = m.a;
    if (s.phase === 'bankrupt' && a !== 'chat' && a !== 'restart') return fail('The store is bankrupt.');
    if (s.phase === 'naming' && !['nameDraft', 'nameVote', 'chat', 'emote', 'ping', 'role'].includes(a)) return fail('Agree on a store name first!');

    switch (a) {
      // ---------------- naming
      case 'nameDraft': {
        if (s.phase !== 'naming') return false;
        const name = String(m.name || '').slice(0, 28);
        if (name !== s.nameDraft) { s.nameDraft = name; s.nameVotes = []; }
        this.dirtyMeta(); return true;
      }
      case 'nameVote': {
        if (s.phase !== 'naming') return false;
        const name = s.nameDraft.trim();
        if (name.length < 3) return fail('Name must be at least 3 characters.');
        if (this.hooks.isNameTaken && this.hooks.isNameTaken(name, this.code)) return fail(`"${name}" is already taken by another store!`);
        if (!s.nameVotes.includes(player.id)) s.nameVotes.push(player.id); else s.nameVotes = s.nameVotes.filter(v => v !== player.id);
        const ids = [...this.players.keys()];
        if (ids.every(id => s.nameVotes.includes(id))) {
          s.name = name; s.phase = 'prep';
          this.fx({ k: 'named', name });
          this.sound('fanfare');
          this.dirtyWorld();
        }
        this.dirtyMeta(); return true;
      }

      // ---------------- building
      case 'place': {
        const def = FURNITURE[m.type];
        if (!def) return false;
        if (!this.unlocked(def.level)) return fail(`Unlocks at level ${def.level}.`);
        if (s.cash < def.cost) return fail('Not enough cash!');
        const rot = ((m.rot | 0) % 4 + 4) % 4;
        const res = this.grid.canPlace(s.furniture, m.type, m.x | 0, m.z | 0, rot);
        if (!res.ok) return fail(res.reason);
        const f = { id: this.id(), type: m.type, x: m.x | 0, z: m.z | 0, rot, upg: false, broken: false, boughtDay: s.day, boughtPhase: s.phase };
        if (def.slots) f.slots = Array.from({ length: def.slots }, () => ({ pid: null, qty: 0, exp: 0, expired: false }));
        if (def.kind === 'rack') f.boxes = [];
        if (def.temp !== undefined) { f.temp = def.temp; f.warm = 0; }
        s.furniture.push(f);
        this.spend(def.cost, 'other');
        this.rebuildGrid(); this.dirtyWorld();
        this.sound('place', f.x, f.z);
        this.fx({ k: 'placed', x: f.x, z: f.z, type: f.type });
        return true;
      }
      case 'move': {
        const f = this.fixture(m.id); if (!f) return false;
        const rot = ((m.rot | 0) % 4 + 4) % 4;
        const res = this.grid.canPlace(s.furniture, f.type, m.x | 0, m.z | 0, rot, f.id);
        if (!res.ok) return fail(res.reason);
        f.x = m.x | 0; f.z = m.z | 0; f.rot = rot;
        this.rebuildGrid(); this.dirtyWorld();
        this.sound('place', f.x, f.z);
        return true;
      }
      case 'remove': {
        const f = this.fixture(m.id); if (!f) return false;
        const def = FURNITURE[f.type];
        const fullRefund = s.phase === 'prep' && f.boughtDay === s.day && f.boughtPhase === 'prep';
        const refund = Math.round(def.cost * (fullRefund ? 1 : 0.5) + (f.upg ? (FIXTURE_UPGRADES[def.kind]?.cost || 0) * 0.5 : 0));
        // spill contents back out as boxes
        const [cx, cz] = f._front ? [f._front[0] + 0.5, f._front[1] + 0.5] : center(f.type, f.x, f.z, f.rot);
        if (f.slots) for (const sl of f.slots) if (sl.qty > 0) this.spawnBox(sl.pid, sl.qty, sl.exp, cx + rnd(-0.3, 0.3), cz + rnd(-0.3, 0.3), sl.expired);
        if (f.boxes) for (const b of f.boxes) this.spawnBox(b.pid, b.qty, b.exp, cx + rnd(-0.3, 0.3), cz + rnd(-0.3, 0.3), b.expired);
        // release customers / staff / players tied to it
        const rt = this.rt.get(f.id);
        if (rt) for (const cid of rt.queue) { const c = this.customers.find(c => c.id === cid); if (c) c.reroute = true; }
        for (const p of this.players.values()) if (p.station === f.id) p.station = null;
        for (const st of s.staff) if (st.post === f.id) { st.post = null; st.state = 'idle'; }
        s.furniture = s.furniture.filter(x => x !== f);
        s.cash = round2(s.cash + refund); s.ledger.other = round2(s.ledger.other - refund); this.dirtyMeta();
        this.rebuildGrid(); this.dirtyWorld();
        this.sound('remove', f.x, f.z);
        this.toast(`Sold ${def.name} for ${fmtMoney(refund)}`, 'info', '♻️');
        return true;
      }
      case 'upgradeFixture': {
        const f = this.fixture(m.id); if (!f) return false;
        const def = FURNITURE[f.type]; const up = FIXTURE_UPGRADES[def.kind];
        if (!up || f.upg) return fail('No upgrade available.');
        if (!this.unlocked(up.level)) return fail(`Upgrade unlocks at level ${up.level}.`);
        if (s.cash < up.cost) return fail('Not enough cash!');
        f.upg = true; this.spend(up.cost, 'other');
        this.dirtyWorld(); this.sound('upgrade', f.x, f.z);
        this.toast(`${def.name} upgraded: ${up.name}!`, 'good', '⬆️');
        return true;
      }
      case 'clearLabel': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        const sl = f.slots[m.slot | 0]; if (!sl || sl.qty > 0) return fail('Slot must be empty.');
        sl.pid = null; this.dirtyWorld(); return true;
      }
      case 'floor': {
        const fl = FLOORS.find(x => x.id === m.id); if (!fl) return false;
        if (!s.ownedFloors.includes(fl.id)) {
          if (!this.unlocked(fl.level)) return fail(`Unlocks at level ${fl.level}.`);
          if (s.cash < fl.cost) return fail('Not enough cash!');
          this.spend(fl.cost, 'other'); s.ownedFloors.push(fl.id);
        }
        s.floor = fl.id; this.dirtyWorld(); this.dirtyMeta(); this.sound('upgrade'); return true;
      }
      case 'wall': {
        const wl = WALLS.find(x => x.id === m.id); if (!wl) return false;
        if (!s.ownedWalls.includes(wl.id)) {
          if (!this.unlocked(wl.level)) return fail(`Unlocks at level ${wl.level}.`);
          if (s.cash < wl.cost) return fail('Not enough cash!');
          this.spend(wl.cost, 'other'); s.ownedWalls.push(wl.id);
        }
        s.wall = wl.id; this.dirtyWorld(); this.dirtyMeta(); this.sound('upgrade'); return true;
      }
      case 'lighting': {
        const li = LIGHTS.find(x => x.id === m.id); if (!li) return false;
        if (!s.ownedLights.includes(li.id)) {
          if (!this.unlocked(li.level)) return fail(`Unlocks at level ${li.level}.`);
          if (s.cash < li.cost) return fail('Not enough cash!');
          this.spend(li.cost, 'other'); s.ownedLights.push(li.id);
        }
        s.lighting = li.id; this.dirtyWorld(); this.dirtyMeta(); this.sound('upgrade'); return true;
      }
      case 'expand': {
        const next = EXPANSIONS[s.expansion + 1];
        if (!next) return fail('Already at maximum size!');
        if (!this.unlocked(next.level)) return fail(`Expansion unlocks at level ${next.level}.`);
        if (s.cash < next.cost) return fail('Not enough cash!');
        if (s.phase === 'open' || s.phase === 'closing') return fail('Expand while the store is closed.');
        this.spend(next.cost, 'other');
        const oldD = s.d;
        s.expansion++; s.w = next.w; s.d = next.d; s.doorX = Math.floor(next.w / 2) - 1;
        // relocate boxes that were outside
        const outside = s.boxes.filter(b => b.z >= oldD);
        s.boxes = s.boxes.filter(b => b.z < oldD);
        this.rebuildGrid();
        for (const b of outside) this.spawnBox(b.pid, b.qty, b.exp, null, null, b.expired);
        this.dirtyWorld(); this.dirtyMeta();
        this.fx({ k: 'expanded', w: s.w, d: s.d });
        this.sound('fanfare');
        this.toast(`The supermarket grew to ${s.w}×${s.d}!`, 'good', '📐');
        this.flagGoal('expand1');
        return true;
      }
      case 'buyUpgrade': {
        const u = TEAM_UPGRADE_MAP[m.id]; if (!u) return false;
        if (s.upgrades[u.id]) return fail('Already owned.');
        if (u.requires && !s.upgrades[u.requires]) return fail(`Requires ${TEAM_UPGRADE_MAP[u.requires].name} first.`);
        if (!this.unlocked(u.level)) return fail(`Unlocks at level ${u.level}.`);
        if (s.cash < u.cost) return fail('Not enough cash!');
        this.spend(u.cost, 'other'); s.upgrades[u.id] = true;
        this.sound('upgrade'); this.toast(`Purchased ${u.name}!`, 'good', u.icon);
        this.dirtyMeta(); return true;
      }

      // ---------------- ordering
      case 'order': return this.placeOrder(player, m, fail);

      // ---------------- physical interactions
      case 'pickup': {
        if (player.carry.length >= this.carryCap()) return fail(this.carryCap() === 1 ? 'Your hands are full! (Hand Trucks let you carry more)' : 'You cannot carry more boxes.');
        const b = s.boxes.find(b => b.id === m.id);
        if (!b) return false;
        if (dist(player, b) > 2.2) return fail('Too far away.');
        this.removeBox(b);
        player.carry.push({ pid: b.pid, qty: b.qty, exp: b.exp, expired: b.expired });
        this.sound('pickup', b.x, b.z); this.dirtyWorld(); return true;
      }
      case 'rackTake': {
        const f = this.fixture(m.id); if (!f || !f.boxes) return false;
        if (!f.boxes.length) return fail('Rack is empty.');
        if (player.carry.length >= this.carryCap()) return fail('Your hands are full!');
        const idx = m.pid ? f.boxes.findIndex(b => b.pid === m.pid) : f.boxes.length - 1;
        const b = f.boxes.splice(idx >= 0 ? idx : f.boxes.length - 1, 1)[0];
        player.carry.push(b); this.sound('pickup', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'rackPut': {
        const f = this.fixture(m.id); if (!f || !f.boxes) return false;
        if (!player.carry.length) return false;
        const cap = FURNITURE.rack.boxes + (f.upg ? 4 : 0);
        let n = 0;
        while (player.carry.length && f.boxes.length < cap) { f.boxes.push(player.carry.pop()); n++; }
        if (!n) return fail('Rack is full.');
        this.sound('drop', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'drop': {
        if (!player.carry.length) return false;
        const b = player.carry.pop();
        const [fx, fz] = [Math.sin(player.rot) * 0.6, Math.cos(player.rot) * 0.6];
        this.spawnBox(b.pid, b.qty, b.exp, player.x + fx, player.z + fz, b.expired);
        this.sound('drop', player.x, player.z); this.dirtyWorld(); return true;
      }
      case 'trash': {
        const f = this.fixture(m.id); if (!f || f.type !== 'bin') return false;
        if (!player.carry.length) return false;
        const b = player.carry.pop();
        s.ledger.waste += b.qty;
        this.sound('trash', f.x, f.z); this.dirtyWorld();
        this.toast(`Threw away ${b.qty}× ${PRODUCT_MAP[b.pid].name}`, 'info', '🗑️');
        return true;
      }
      case 'stock': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        if (!player.carry.length) return fail('Pick up a box first.');
        const box = player.carry[player.carry.length - 1];
        if (box.expired) return fail('This box has expired. Throw it in a trash bin.');
        const r = this.stockInto(f, box, m.n ? Math.min(6, m.n | 0) : 3);
        if (r.error) return fail(r.error);
        if (box.qty <= 0) { player.carry.pop(); this.sound('boxempty', f.x, f.z); }
        this.fx({ k: 'stocked', id: f.id, n: r.n, pid: box.pid, by: player.id });
        this.flagGoal('stock');
        if (f.type === 'fridge' && box.pid === 'milk') this.flagGoal('fridge');
        this.dirtyWorld(); return true;
      }
      case 'clearExpired': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        let n = 0; for (const sl of f.slots) if (sl.expired && sl.qty) { n += sl.qty; sl.qty = 0; sl.expired = false; }
        if (!n) return false;
        s.ledger.waste += n;
        this.sound('trash', f.x, f.z); this.dirtyWorld();
        this.toast(`Cleared ${n} expired items`, 'info', '🧹');
        return true;
      }
      case 'clean': {
        const d = s.dirt.find(d => d.id === m.id); if (!d) return false;
        if (dist(player, d) > 2.2) return fail('Too far away.');
        d.hp = (d.hp ?? 3) - 1;
        this.sound('scrub', d.x, d.z);
        if (d.hp <= 0) { s.dirt = s.dirt.filter(x => x !== d); this.sound('sparkle', d.x, d.z); this.addXp(2); }
        this.dirtyWorld(); return true;
      }
      case 'repair': {
        const f = this.fixture(m.id); if (!f || !f.broken) return false;
        f.repair = (f.repair || 0) + 1;
        this.sound('wrench', f.x, f.z);
        if (f.repair >= 6) {
          f.broken = false; f.repair = 0; f.techEta = null;
          this.sound('fixed', f.x, f.z);
          this.toast(`${player.name} fixed the ${FURNITURE[f.type].name}!`, 'good', '🔧');
          this.unlockAch('repairman'); this.addXp(15);
        }
        this.dirtyWorld(); return true;
      }
      case 'callTech': {
        const f = this.fixture(m.id); if (!f || !f.broken) return false;
        if (f.techEta != null) return fail('Technician already on the way.');
        if (s.cash < 180) return fail('Not enough cash!');
        this.spend(180, 'maint'); f.techEta = 60; // game minutes
        this.toast('Technician called ($180). Arriving in ~1 hour.', 'info', '📞');
        this.dirtyWorld(); return true;
      }
      case 'station': {
        const f = this.fixture(m.id); if (!f) return false;
        const k = FURNITURE[f.type].kind;
        if (k !== 'checkout' && k !== 'counter') return false;
        for (const p of this.players.values()) if (p !== player && p.station === f.id) return fail(`${p.name} is already working here.`);
        player.station = f.id; player.carry.length && this.toast('Tip: drop your box (Q) to work faster.', 'info');
        this.sound('click', f.x, f.z); return true;
      }
      case 'leaveStation': player.station = null; return true;
      case 'work': return this.playerWork(player, fail);

      // ---------------- management
      case 'setPrice': {
        const p = PRODUCT_MAP[m.pid]; if (!p) return false;
        const v = round2(clamp(+m.price || p.price, p.cost * 0.5, p.price * 4));
        s.prices[p.id] = v; this.dirtyWorld(); this.dirtyMeta(); return true;
      }
      case 'priceAll': {
        const mult = clamp(+m.mult || 1, 0.5, 3);
        for (const p of PRODUCTS) s.prices[p.id] = round2(p.price * mult);
        this.dirtyWorld(); this.dirtyMeta(); return true;
      }
      case 'hire': {
        const c = s.candidates.find(c => c.id === m.id); if (!c) return false;
        if (!this.unlocked(ROLES[c.role].level)) return fail('Role not unlocked yet.');
        if (s.staff.length >= 4 + s.expansion * 3) return fail('Expand the store to hire more staff.');
        s.candidates = s.candidates.filter(x => x !== c);
        const st = { ...c, shift: m.shift && SHIFTS[m.shift] ? m.shift : 'full', happiness: 75, hiredDay: s.day, absent: false, served: 0 };
        this.resetStaffRuntime(st);
        s.staff.push(st);
        this.toast(`${st.name} joined the team as ${ROLES[st.role].name}!`, 'good', ROLES[st.role].icon);
        this.sound('hire'); this.unlockAch('first_hire'); this.flagGoal('hire');
        this.dirtyMeta(); return true;
      }
      case 'fire': {
        const st = s.staff.find(x => x.id === m.id); if (!st) return false;
        if (st.carry) this.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z);
        s.staff = s.staff.filter(x => x !== st);
        this.toast(`${st.name} was let go.`, 'info', '👋'); this.dirtyMeta(); return true;
      }
      case 'shift': {
        const st = s.staff.find(x => x.id === m.id); if (!st || !SHIFTS[m.shift]) return false;
        st.shift = m.shift; this.dirtyMeta(); return true;
      }
      case 'raise': {
        const st = s.staff.find(x => x.id === m.id); if (!st) return false;
        st.salary = Math.round(st.salary * 1.1); st.happiness = clamp(st.happiness + 20, 0, 100);
        this.toast(`${st.name} got a raise! 😄`, 'good', '💸'); this.dirtyMeta(); return true;
      }
      case 'open': {
        if (s.phase !== 'prep') return false;
        s.phase = 'open'; s.minute = OPEN_HOUR * 60; this.minuteAcc = 0;
        s.ledger.customers = 0;
        this.toast(`${s.name} is now OPEN! Day ${s.day}`, 'good', '🏪');
        this.sound('open');
        this.flagGoal('open');
        this.startDayEvents();
        this.dirtyMeta(); this.dirtyWorld(); return true;
      }
      case 'speed': {
        const v = [1, 2, 3].includes(m.v) ? m.v : 1; s.speed = v; s.paused = false;
        this.fx({ k: 'info', text: `${player.name} set speed to ${v}×` }); this.dirtyMeta(); return true;
      }
      case 'pause': {
        s.paused = !s.paused;
        this.fx({ k: 'info', text: `${player.name} ${s.paused ? 'paused' : 'resumed'} the game` }); this.dirtyMeta(); return true;
      }
      case 'sale': {
        if (!s.pendingSale) return false;
        s.pendingSale = false;
        if (m.accept) {
          s.saleActive = true; s.events.push({ type: 'saleOn', until: CLOSE_HOUR * 60 });
          this.toast('Flash sale is ON! 15% off everything — crowds incoming!', 'good', '🏷️');
        } else this.toast('Flash sale declined.', 'info', '🏷️');
        this.dirtyMeta(); this.dirtyWorld(); return true;
      }
      case 'continue': {
        if (s.phase !== 'report') return false;
        this.beginNewDay(); return true;
      }
      case 'restart': {
        if (s.phase !== 'bankrupt') return false;
        const name = s.name;
        this.customers = []; this.rt.clear(); this.fresh();
        this.s.name = name; this.s.phase = 'prep';
        for (const p of this.players.values()) { p.carry = []; p.station = null; }
        this.rebuildGrid(); this.dirtyWorld(); this.dirtyMeta();
        this.toast('A fresh start! The bank gave you another chance.', 'good', '🌱');
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ orders
  placeOrder(player, m, fail) {
    const s = this.s;
    const sup = SUPPLIER_MAP[m.supplier];
    if (!sup) return false;
    if (!this.unlocked(sup.level)) return fail(`${sup.name} unlocks at level ${sup.level}.`);
    const items = (m.items || []).filter(i => i && PRODUCT_MAP[i.pid] && (i.boxes | 0) > 0).map(i => ({ pid: i.pid, boxes: Math.min(60, i.boxes | 0) }));
    if (!items.length) return fail('Your order is empty.');
    let boxes = 0, subtotal = 0;
    const shortage = s.events.find(e => e.type === 'shortage');
    for (const it of items) {
      const p = PRODUCT_MAP[it.pid];
      if (!sup.cats.includes(p.cat)) return fail(`${sup.name} doesn't sell ${p.name}.`);
      if (!this.unlocked(p.level)) return fail(`${p.name} unlocks at level ${p.level}.`);
      if (shortage && shortage.pid === p.id) return fail(`${p.name} is out of stock at suppliers today!`);
      boxes += it.boxes;
      subtotal += it.boxes * p.box * p.cost * sup.markup;
    }
    if (boxes < sup.minOrder) return fail(`${sup.name} requires at least ${sup.minOrder} boxes.`);
    const disc = discountFor(sup, boxes);
    const total = round2(subtotal * (1 - disc / 100) + sup.fee);
    if (s.cash < total) return fail(`Not enough cash! Order costs ${fmtMoney(total)}.`);
    this.spend(total, 'cogs');
    const delay = this.eventActive('delay') ? 2 : 1;
    const eta = sup.time * delay;
    s.orders.push({ id: this.id(), supplier: sup.id, items, total, eta, remaining: eta, by: player.name });
    this.toast(`${player.name} ordered ${boxes} box${boxes > 1 ? 'es' : ''} from ${sup.name} (${fmtMoney(total)})`, 'info', '🧾');
    this.sound('order');
    this.flagGoal('order');
    this.dirtyMeta();
    return true;
  }

  deliver(o) {
    const sup = SUPPLIER_MAP[o.supplier];
    for (const it of o.items) {
      const p = PRODUCT_MAP[it.pid];
      for (let i = 0; i < it.boxes; i++) this.spawnBox(p.id, p.box, this.s.day + p.life, null, null);
    }
    const [px, pz] = this.padCenter();
    this.fx({ k: 'delivery', x: px, z: pz, supplier: sup.id });
    this.toast(`Delivery from ${sup.name} arrived at the loading area!`, 'good', '🚚');
    this.dirtyWorld();
  }

  padCenter() { return [2, this.s.d + 2]; }

  // Find a free spot on the delivery pad (outside, left of the door). Boxes stack 3 high.
  padSpot() {
    const s = this.s;
    const spots = [];
    for (let z = s.d + 1; z <= s.d + 2; z++) for (let x = 0; x < Math.min(4, s.doorX); x++) spots.push([x + 0.5, z + 0.5]);
    for (let x = -1; x >= -5; x--) for (let z = s.d + 1; z <= s.d + 2; z++) spots.push([x + 0.5, z + 0.5]);
    for (let level = 0; level < 3; level++) {
      for (const [x, z] of spots) {
        const here = s.boxes.filter(b => Math.abs(b.x - x) < 0.3 && Math.abs(b.z - z) < 0.3);
        if (here.length === level) return [x, z, level];
      }
    }
    return [rnd(-8, -6), s.d + rnd(1.3, 2.7), 0];
  }

  spawnBox(pid, qty, exp, x, z, expired = false) {
    let y = 0;
    if (x == null) { [x, z, y] = this.padSpot(); }
    else {
      const here = this.s.boxes.filter(b => Math.abs(b.x - x) < 0.35 && Math.abs(b.z - z) < 0.35);
      if (here.length) { x = here[0].x; z = here[0].z; y = here.length; }
    }
    const b = { id: this.id(), pid, qty, exp, x: round2(x), z: round2(z), y, expired: !!expired };
    this.s.boxes.push(b);
    this.dirtyWorld();
    return b;
  }
  removeBox(b) {
    this.s.boxes = this.s.boxes.filter(x => x !== b);
    for (const o of this.s.boxes) if (Math.abs(o.x - b.x) < 0.35 && Math.abs(o.z - b.z) < 0.35 && o.y > b.y) o.y--;
  }

  // Move up to maxUnits from a carried box into a fixture. Returns {n} or {error}.
  stockInto(f, box, maxUnits) {
    const def = FURNITURE[f.type];
    const p = PRODUCT_MAP[box.pid];
    if (def.cat !== p.cat) {
      const need = CATEGORIES[p.cat];
      return { error: `${p.name} belongs in the ${need.name} section (${FURNITURE[need.fixtures[0]].name}).` };
    }
    let slot = f.slots.find(sl => sl.pid === box.pid && sl.qty > 0 && sl.qty < def.cap && !sl.expired);
    if (!slot) slot = f.slots.find(sl => sl.pid === box.pid && sl.qty === 0);
    if (!slot) slot = f.slots.find(sl => sl.pid === null && sl.qty === 0);
    if (!slot) slot = f.slots.find(sl => sl.qty === 0);
    if (!slot) {
      if (f.slots.some(sl => sl.pid === box.pid && sl.expired)) return { error: 'Clear the expired items first (E with empty hands).' };
      return { error: 'No free space here for this product.' };
    }
    const n = Math.min(maxUnits, box.qty, def.cap - slot.qty);
    if (n <= 0) return { error: 'This spot is full.' };
    slot.exp = slot.qty > 0 ? Math.min(slot.exp, box.exp) : box.exp;
    slot.pid = box.pid; slot.qty += n; slot.expired = false;
    box.qty -= n;
    return { n, slot };
  }

  // ------------------------------------------------------------------ stations
  playerWork(player, fail) {
    const f = this.fixture(player.station);
    if (!f) { player.station = null; return false; }
    const kind = FURNITURE[f.type].kind;
    const rt = this.rt.get(f.id);
    if (kind === 'checkout') {
      const c = this.customerAtRegister(f);
      if (!c) return fail('No customer at the register yet.');
      const per = f.upg ? 2 : 1;
      if (c.scanned < c.basket.length) {
        for (let i = 0; i < per && c.scanned < c.basket.length; i++) c.scanned++;
        this.sound('beep', f.x, f.z);
      } else {
        this.completeCheckout(c, f, player);
      }
      return true;
    }
    if (kind === 'counter') {
      const c = this.customerAtCounter(f);
      if (!c) return fail('Nobody is waiting at the counter.');
      const need = FURNITURE[f.type].presses;
      rt.progress = (rt.progress || 0) + 1;
      this.sound(f.type === 'butcher' ? 'chop' : 'slice', f.x, f.z);
      if (rt.progress >= need) { rt.progress = 0; this.serveCounter(f, c, { skill: 4, name: player.name, player: true }); }
      return true;
    }
    return false;
  }

  customerAtRegister(f) {
    const rt = this.rt.get(f.id); if (!rt || !rt.queue.length) return null;
    const c = this.customers.find(c => c.id === rt.queue[0]);
    return c && c.state === 'register' ? c : null;
  }
  customerAtCounter(f) {
    const rt = this.rt.get(f.id); if (!rt || !rt.queue.length) return null;
    const c = this.customers.find(c => c.id === rt.queue[0]);
    return c && c.state === 'counterServe' ? c : null;
  }
  operatorOf(f) {
    for (const p of this.players.values()) if (p.station === f.id) return { type: 'player', p };
    const st = this.s.staff.find(st => st.present && st.post === f.id && st.state === 'working');
    return st ? { type: 'staff', st } : null;
  }

  completeCheckout(c, f, who) {
    const s = this.s;
    const total = round2(c.basket.reduce((a, b) => a + b.price, 0));
    this.earn(total, 'revenue');
    s.stats.revenue = round2(s.stats.revenue + total);
    for (const it of c.basket) {
      s.ledger.sold[it.pid] = (s.ledger.sold[it.pid] || 0) + 1;
      s.stats.sold[it.pid] = (s.stats.sold[it.pid] || 0) + 1;
    }
    c.paid = true;
    const rt = this.rt.get(f.id); if (rt) rt.queue = rt.queue.filter(id => id !== c.id);
    c.thought = c.mood > 75 ? '😄' : c.mood > 50 ? '🙂' : c.mood > 30 ? '😐' : '😒'; c.thoughtT = 3;
    customerLeave(this, c, 'paid');
    this.sound('kaching', f.x, f.z);
    this.float('+' + fmtMoney(total), f.x + 0.5, f.z + 0.5);
    this.addXp(total * 0.6 + 4);
    if (who && who.id !== undefined && this.players.has(who.id)) {
      s.stats.playerCheckouts++;
      if (s.stats.playerCheckouts >= 25) this.unlockAch('scanner');
    }
    if (c.vip && c.vipHappy) {
      this.earn(300, 'bonus'); s.rep = clamp(s.rep + 5, 0, 100); s.stats.vip++;
      this.toast('The VIP loved your store! +$300 and a glowing review!', 'good', '🕶️');
      this.unlockAch('vip'); this.sound('fanfare');
    }
    this.flagGoal('sale'); this.unlockAch('first_sale');
    this.dirtyMeta();
  }

  serveCounter(f, c, server) {
    const s = this.s;
    const req = c.counterReq;
    const def = FURNITURE[f.type];
    const slot = f.slots.find(sl => sl.pid === req.pid && sl.qty > 0 && !sl.expired);
    const rt = this.rt.get(f.id);
    if (rt) rt.queue = rt.queue.filter(id => id !== c.id);
    c.counterDone = true;
    c.state = 'shop'; c.path = null; c.timer = 0.5;
    if (!slot) {
      c.thought = '😞'; c.mood -= 12;
      s.demand[req.pid] = (s.demand[req.pid] || 0) + 1;
      this.float(`Out of ${PRODUCT_MAP[req.pid].name}!`, f.x + 1, f.z + 0.5, '#dc2626');
      this.sound('error', f.x, f.z);
      return;
    }
    const n = Math.min(req.qty, slot.qty);
    slot.qty -= n;
    for (let i = 0; i < n; i++) c.basket.push({ pid: req.pid, price: this.effPrice(req.pid), src: null });
    c.mood += 4 + (server.skill || 3);
    c.thought = def.cat === 'meat' ? '🥩' : '🧀';
    // skilled staff earn tips
    if ((server.skill || 0) >= 4 && Math.random() < 0.4) {
      const tip = round2(1 + server.skill * Math.random());
      this.earn(tip, 'tips'); this.float(`Tip +${fmtMoney(tip)}`, f.x + 1, f.z + 0.5, '#ca8a04');
    }
    this.sound('serve', f.x, f.z);
    if (def.cat === 'meat') { s.stats.butcher++; this.unlockAch('butcher'); this.flagGoal('butcher'); }
    else { s.stats.deli++; this.unlockAch('deli'); this.flagGoal('deli'); }
    this.addXp(6);
    this.dirtyWorld();
  }

  // ------------------------------------------------------------------ staff helpers
  resetStaffRuntime(st) {
    st.present = false; st.x = this.s.doorX + 1; st.z = this.s.d - 0.5; st.rot = Math.PI;
    st.path = null; st.state = 'idle'; st.task = null; st.timer = 0; st.carry = null; st.post = null; st.thought = '';
  }

  refreshCandidates(levelUp = false) {
    const s = this.s;
    const roles = Object.entries(ROLES).filter(([, r]) => s.level >= r.level).map(([k]) => k);
    const n = levelUp ? 2 : rndi(4, 6);
    if (!levelUp) s.candidates = [];
    const maxSkill = clamp(Math.floor(2 + s.level / 2.5), 2, 5);
    for (let i = 0; i < n; i++) {
      // newly unlocked roles show up more on level up
      const role = levelUp ? roles[roles.length - 1 - (i % Math.min(2, roles.length))] : pick(roles);
      const skill = rndi(1, maxSkill);
      const speed = round2(rnd(0.8, 1.25) + skill * 0.05);
      const base = ROLES[role].baseSalary;
      const salary = Math.round(base * (0.7 + skill * 0.15) * (0.85 + speed * 0.15) * rnd(0.92, 1.08));
      s.candidates.push({ id: this.id(), name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, role, skill, speed, salary, seed: rndi(1, 1e6) });
    }
    s.candidates = s.candidates.slice(-7);
    this.dirtyMeta();
  }

  // ------------------------------------------------------------------ goals & achievements
  flagGoal(id) { this.s.goalFlags[id] = true; }
  checkGoals() {
    const s = this.s;
    const g = GOALS[s.goalIndex];
    if (!g) return;
    let done = false;
    const has = (t) => s.furniture.some(f => f.type === t);
    const stockedCat = (cat) => s.furniture.some(f => FURNITURE[f.type].cat === cat && f.slots && f.slots.some(sl => sl.qty > 0));
    switch (g.id) {
      case 'name': done = !!s.name; break;
      case 'shelf': done = has('shelf'); break;
      case 'checkout': done = has('checkout'); break;
      case 'fridge': done = s.furniture.some(f => f.type === 'fridge' && f.slots.some(sl => sl.pid === 'milk' && sl.qty > 0)); break;
      case 'day1': done = s.day >= 2; break;
      case 'customers30': done = s.stats.customers >= 30; break;
      case 'decor': done = this.appeal() >= 10; break;
      case 'produce': done = stockedCat('produce'); break;
      case 'expand1': done = s.expansion >= 1; break;
      case 'freezer': done = stockedCat('frozen'); break;
      case 'rev10k': done = s.stats.revenue >= 10000; break;
      case 'staff4': done = s.staff.length >= 4; break;
      case 'rep4': done = s.rep >= 80; break;
      case 'day3k': done = s.ledger.revenue >= 3000 || s.history.some(h => h.revenue >= 3000); break;
      case 'level8': done = s.level >= 8; break;
      case 'rev100k': done = s.stats.revenue >= 100000; break;
      default: done = !!s.goalFlags[g.id];
    }
    if (done) {
      s.goalIndex++;
      if (g.reward) this.earn(g.reward, 'bonus');
      this.fx({ k: 'goal', text: g.text, reward: g.reward });
      this.sound('goal');
      this.dirtyMeta();
    }
  }
  makeChallenge() {
    const lvl = this.s.level;
    const cats = ['grocery', 'fridge', 'frozen', 'produce', 'meat', 'deli'].filter(c => this.s.furniture.some(f => FURNITURE[f.type].cat === c));
    const opts = [
      { type: 'serve', target: Math.round((20 + lvl * 7) / 5) * 5 },
      { type: 'revenue', target: Math.round((250 + lvl * 200) / 50) * 50 },
      { type: 'noangry', target: 12 + lvl * 3 },
      { type: 'sat', target: Math.min(80, 62 + lvl) },
    ];
    if (cats.length) opts.push({ type: 'cat', cat: pick(cats), target: 10 + lvl * 4 });
    const c = pick(this.s.day === 1 ? opts.filter(o => o.type === 'serve' || o.type === 'revenue') : opts);
    c.reward = 120 + lvl * 60; c.done = false; c.failed = false;
    return c;
  }
  challengeProgress() {
    const c = this.s.challenge, L = this.s.ledger; if (!c) return 0;
    switch (c.type) {
      case 'serve': case 'noangry': return L.served;
      case 'revenue': return L.revenue;
      case 'sat': return L.satN ? Math.round(L.satSum / L.satN) : 0;
      case 'cat': return Object.entries(L.sold).reduce((a, [pid, n]) => a + (PRODUCT_MAP[pid].cat === c.cat ? n : 0), 0);
    }
    return 0;
  }
  checkChallenge(endOfDay = false) {
    const c = this.s.challenge, L = this.s.ledger;
    if (!c || c.done || c.failed) return;
    const prog = this.challengeProgress();
    let ok = false;
    if (c.type === 'serve' || c.type === 'revenue' || c.type === 'cat') ok = prog >= c.target;
    else if (endOfDay) ok = c.type === 'noangry' ? (L.served >= c.target && L.angry === 0) : (L.satN >= 15 && prog >= c.target);
    if (c.type === 'noangry' && L.angry > 0) { c.failed = true; this.dirtyMeta(); return; }
    if (ok) {
      c.done = true;
      this.earn(c.reward, 'bonus'); this.addXp(c.reward * 0.5);
      this.fx({ k: 'goal', text: "Daily challenge complete!", reward: c.reward });
      this.sound('fanfare'); this.dirtyMeta();
    } else if (endOfDay) { c.failed = true; this.dirtyMeta(); }
  }

  unlockAch(id) {
    if (this.s.achievements[id]) return;
    const a = ACHIEVEMENTS.find(a => a.id === id); if (!a) return;
    this.s.achievements[id] = this.s.day;
    this.fx({ k: 'ach', name: a.name, icon: a.icon, desc: a.desc });
    this.addXp(50);
    this.dirtyMeta();
  }
  checkAchievements() {
    const s = this.s, st = s.stats;
    if (st.customers >= 50) this.unlockAch('customers50');
    if (st.customers >= 500) this.unlockAch('customers500');
    if (st.customers >= 2000) this.unlockAch('customers2k');
    if (st.revenue >= 1000) this.unlockAch('rev1k');
    if (st.revenue >= 25000) this.unlockAch('rev25k');
    if (st.revenue >= 100000) this.unlockAch('rev100k');
    if (s.ledger.revenue >= 3000) this.unlockAch('big_day');
    if (s.staff.length >= 5) this.unlockAch('staff5');
    if (s.expansion >= 1) this.unlockAch('expand');
    if (s.expansion >= EXPANSIONS.length - 1) this.unlockAch('expand_max');
    if (s.level >= 5) this.unlockAch('level5');
    if (s.level >= 10) this.unlockAch('level10');
    if (s.rep >= 90) this.unlockAch('five_star');
    if (this.appeal() >= 40) this.unlockAch('decorator');
    if (['grocery', 'fridge', 'frozen', 'produce', 'meat', 'deli'].every(c => this.hasDept(c))) this.unlockAch('all_depts');
  }

  // ------------------------------------------------------------------ day cycle & events
  startDayEvents() {
    const s = this.s;
    s.events = [];
    s.saleActive = false;
    // absent staff
    for (const st of s.staff) st.absent = false;
    if (s.day >= 2 && Math.random() < 0.6) this.triggerEvent();
    this.dirtyMeta();
  }

  triggerEvent(forceType) {
    const s = this.s;
    const coolers = s.furniture.filter(f => FURNITURE[f.type].temp !== undefined && !f.broken);
    const options = ['rush', 'delay', 'shortage', 'holiday', 'vip', 'sale', 'inspector', 'heatwave', 'influencer', 'pigeon'];
    if (coolers.length) options.push('breakdown', 'breakdown');
    if (s.staff.length >= 2) options.push('absence');
    const type = forceType || pick(options);
    const ev = { type, at: s.minute };
    const E = EVENT_TYPES[type];
    let detail = E.desc;
    switch (type) {
      case 'rush': ev.until = s.minute + 90; break;
      case 'delay': ev.until = CLOSE_HOUR * 60; break;
      case 'holiday': ev.until = CLOSE_HOUR * 60; break;
      case 'heatwave': ev.until = CLOSE_HOUR * 60; break;
      case 'influencer': ev.until = s.minute + 180; s.rep = clamp(s.rep + 6, 0, 100); break;
      case 'breakdown': {
        const f = pick(coolers.length ? coolers : s.furniture.filter(f => FURNITURE[f.type].temp !== undefined));
        if (!f) return;
        f.broken = true; f.repair = 0; ev.fid = f.id;
        detail = `The ${FURNITURE[f.type].name} broke down! Hold E on it to repair, or call a technician.`;
        this.dirtyWorld(); break;
      }
      case 'shortage': {
        const stocked = PRODUCTS.filter(p => this.unlocked(p.level) && s.furniture.some(f => f.slots && f.slots.some(sl => sl.pid === p.id)));
        const p = pick(stocked.length ? stocked : PRODUCTS.filter(p => this.unlocked(p.level)));
        ev.pid = p.id; ev.until = CLOSE_HOUR * 60;
        detail = `Suppliers ran out of ${p.icon} ${p.name}! You can't order it today.`; break;
      }
      case 'vip': {
        const opts = PRODUCTS.filter(p => this.unlocked(p.level) && p.cat !== 'meat' && p.cat !== 'deli');
        const p = pick(opts);
        ev.pid = p.id; ev.spawnAt = Math.min(s.minute + 150, (CLOSE_HOUR - 1) * 60);
        detail = `A famous food blogger will visit around ${fmt(ev.spawnAt)} looking for ${p.icon} ${p.name}. Have it on the shelves!`; break;
      }
      case 'absence': {
        const st = pick(s.staff); st.absent = true; ev.sid = st.id;
        if (st.present) { st.present = false; st.post = null; }
        detail = `${st.name} (${ROLES[st.role].name}) called in sick with a dramatic cough. 🤧`; break;
      }
      case 'sale': s.pendingSale = true; break;
      case 'inspector': ev.checkAt = Math.max(s.minute + 120, 15 * 60); detail = `A health inspector will check cleanliness at ${fmt(ev.checkAt)}. Clean every spill!`; break;
      case 'pigeon': {
        for (let i = 0; i < 6; i++) this.addDirt(rndi(0, s.w - 1), rndi(0, s.d - 2), 'pigeon');
        this.pigeons.push({ id: this.id(), x: s.doorX + 1, z: s.d - 1, tx: rnd(1, s.w - 1), tz: rnd(1, s.d - 1), t: 0, until: s.minute + 120 });
        detail = 'A pigeon flew in through the door and is leaving "gifts" everywhere! Clean up the mess.'; break;
      }
    }
    s.events.push(ev);
    s.eventLog.push({ day: s.day, type, text: detail });
    s.eventLog = s.eventLog.slice(-20);
    this.fx({ k: 'event', type, name: E.name, icon: E.icon, text: detail, sale: type === 'sale' });
    this.sound('event');
    this.dirtyMeta();
  }

  addDirt(x, z, kind = 'spill') {
    if (this.s.dirt.length >= 30) return;
    if (!this.grid.isInterior(x, z) || this.grid.isBlocked(x, z)) return;
    if (this.s.dirt.some(d => Math.floor(d.x) === x && Math.floor(d.z) === z)) return;
    this.s.dirt.push({ id: this.id(), x: x + 0.5 + rnd(-0.2, 0.2), z: z + 0.5 + rnd(-0.2, 0.2), kind, hp: kind === 'spill' ? 3 : 2, r: rnd(0, 6.28) });
    this.dirtyWorld();
  }

  endDay() {
    const s = this.s;
    this.checkChallenge(true);
    s.phase = 'report';
    // remaining customers vanish (store closed), staff go home
    for (const c of this.customers) if (!c.paid) returnBasket(this, c);
    this.customers = [];
    for (const rt of this.rt.values()) { rt.queue = []; rt.progress = 0; }
    for (const p of this.players.values()) p.station = null;
    for (const st of s.staff) {
      if (st.carry) { this.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z); st.carry = null; }
      st.present = false; st.state = 'idle'; st.post = null; st.path = null;
    }
    this.pigeons = [];
    for (const b of s.boxes) delete b._claim;
    const L = s.ledger;
    // salaries
    let salaries = 0;
    const quits = [];
    for (const st of s.staff) {
      if (st.absent) { st.served = 0; continue; }
      const pay = Math.round(st.salary * SHIFTS[st.shift].pay);
      salaries += pay;
      // happiness
      let dh = 0;
      const fair = ROLES[st.role].baseSalary * (0.7 + st.skill * 0.15);
      dh += st.salary >= fair ? 3 : -4;
      dh += st.shift === 'full' ? -5 : 3;
      dh -= Math.max(0, (st.served - 30) * 0.25);
      if (s.upgrades.breakroom) dh += 8;
      if (s.rep > 70) dh += 2;
      st.happiness = clamp(Math.round(st.happiness + dh), 0, 100);
      st.served = 0;
      if (st.happiness < 20 && Math.random() < 0.5) quits.push(st);
    }
    for (const st of quits) s.staff = s.staff.filter(x => x !== st);
    const rent = EXPANSIONS[s.expansion].rent;
    let power = 12, maint = 0, income = 0;
    for (const f of s.furniture) {
      const def = FURNITURE[f.type];
      power += (def.power || 0) * (f.upg && def.kind === 'storage' ? 0.5 : 1);
      maint += def.maint || 0;
      income += def.income || 0;
    }
    if (s.upgrades.led) power *= 0.7;
    power = Math.round(power); maint = Math.round(maint);
    this.spend(salaries, 'salaries'); this.spend(rent, 'rent'); this.spend(power, 'power'); this.spend(maint, 'maint');
    if (income) this.earn(income, 'bonus');
    const expenses = round2(L.cogs + L.salaries + L.rent + L.power + L.maint + L.other);
    const incomeTotal = round2(L.revenue + L.tips + L.bonus);
    const profit = round2(incomeTotal - expenses);
    const avgSat = L.satN ? Math.round(L.satSum / L.satN) : 0;
    const top = Object.entries(L.sold).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const report = {
      day: s.day, revenue: L.revenue, tips: L.tips, bonus: L.bonus, cogs: L.cogs, salaries: L.salaries, rent: L.rent,
      power: L.power, maint: L.maint, other: L.other, expenses, profit, customers: L.customers, served: L.served,
      angry: L.angry, lost: L.lost, avgSat, waste: L.waste, top, rep: s.rep, quits: quits.map(q => q.name),
      demand: Object.entries(s.demand).sort((a, b) => b[1] - a[1]).slice(0, 5), cash: s.cash, vending: income,
      challenge: s.challenge ? { ...s.challenge } : null,
    };
    s.report = report;
    s.history.push({ day: s.day, revenue: L.revenue, expenses, profit, customers: L.served, rep: Math.round(s.rep) });
    s.history = s.history.slice(-30);
    if (profit > 0) this.unlockAch('day_profit');
    if (L.served >= 20 && L.angry === 0) this.unlockAch('perfect_day');
    if (s.cash < 0) s.negativeDays++; else s.negativeDays = 0;
    if (s.negativeDays >= 3) {
      s.phase = 'bankrupt';
      this.fx({ k: 'bankrupt' });
    }
    for (const q of quits) this.toast(`${q.name} quit! They were unhappy. 😤`, 'bad', '🚪');
    this.fx({ k: 'report', report });
    this.sound('dayend');
    this.dirtyMeta(); this.dirtyWorld();
    this.hooks.save && this.hooks.save();
  }

  beginNewDay() {
    const s = this.s;
    s.day++;
    s.minute = 7 * 60; s.phase = 'prep';
    s.ledger = newLedger(); s.demand = {}; s.events = []; s.saleActive = false; s.pendingSale = false;
    // expiry
    let expiredSlots = 0;
    for (const f of s.furniture) if (f.slots) for (const sl of f.slots) if (sl.qty > 0 && sl.exp <= s.day && !sl.expired) { sl.expired = true; expiredSlots++; }
    for (const b of s.boxes) if (b.exp <= s.day) b.expired = true;
    for (const p of this.players.values()) for (const b of p.carry) if (b.exp <= s.day) b.expired = true;
    if (expiredSlots) this.toast(`${expiredSlots} shelf section${expiredSlots > 1 ? 's have' : ' has'} expired products! Clear them (E).`, 'bad', '🤢');
    // random overnight breakdown
    for (const f of s.furniture) {
      if (FURNITURE[f.type].temp === undefined || f.broken) continue;
      if (Math.random() < (f.upg ? 0.01 : 0.035)) {
        f.broken = true; f.repair = 0;
        this.toast(`Overnight, the ${FURNITURE[f.type].name} stopped working! Repair it (hold E).`, 'bad', '🔥');
      }
    }
    this.refreshCandidates();
    s.challenge = this.makeChallenge();
    this.dirtyMeta(); this.dirtyWorld();
    this.hooks.save && this.hooks.save();
  }

  // ------------------------------------------------------------------ main tick
  tick(dt) {
    const s = this.s;
    if (s.phase === 'naming' || s.phase === 'bankrupt') return;
    const simDt = s.paused ? 0 : dt * s.speed;
    if (simDt <= 0) return;

    // deliveries progress in every phase except report
    if (s.phase !== 'report') {
      for (const o of s.orders) o.remaining -= simDt;
      const arrived = s.orders.filter(o => o.remaining <= 0);
      if (arrived.length) { s.orders = s.orders.filter(o => o.remaining > 0); arrived.forEach(o => this.deliver(o)); this.dirtyMeta(); }
    }

    const dMin = simDt / REAL_SECONDS_PER_MINUTE; // game minutes elapsed this tick
    if (s.phase === 'open' || s.phase === 'closing') {
      const prevHour = Math.floor(s.minute / 60);
      s.minute += dMin;
      if (s.phase === 'open' && s.minute >= CLOSE_HOUR * 60) {
        s.phase = 'closing';
        this.toast('Closing time! Finishing up with the last customers…', 'info', '🌙');
        this.dirtyMeta();
      }
      if (Math.floor(s.minute / 60) !== prevHour) {
        this.dirtyMeta();
        // possible mid-day event
        if (s.phase === 'open' && Math.floor(s.minute / 60) === 13 && s.day >= 3 && Math.random() < 0.35) this.triggerEvent();
      }
      this.updateSpawning(dMin);
      this.updateFixtures(dMin);
      this.updateEvents(dMin);
      this.updatePigeons(simDt);
      if (s.phase === 'closing' && (this.customers.length === 0 || s.minute >= CLOSE_HOUR * 60 + 60)) this.endDay();
    }

    updateCustomers(this, simDt, dMin);
    updateStaff(this, simDt, dMin);

    this.lastAchCheck += dt;
    if (this.lastAchCheck > 1) { this.lastAchCheck = 0; this.checkAchievements(); this.checkGoals(); if (s.phase === 'open' || s.phase === 'closing') this.checkChallenge(); }
  }

  updateSpawning(dMin) {
    const s = this.s;
    if (s.phase !== 'open' || s.minute >= LAST_ENTRY_HOUR * 60) return;
    const h = s.minute / 60;
    const tod = h < 10 ? 0.6 : h < 12 ? 0.9 : h < 14 ? 1.35 : h < 17 ? 0.85 : h < 20 ? 1.4 : 0.6;
    const nPlayers = Math.max(1, this.players.size);
    let perHour = (3 + s.level * 1.2 + nPlayers * 0.9 + Math.max(0, this.appeal()) * 0.12) * (0.45 + (s.rep / 100) * 1.15) * tod;
    if (this.eventActive('rush')) perHour *= 3;
    if (this.eventActive('holiday')) perHour *= 1.4;
    if (this.eventActive('influencer')) perHour *= 1.5;
    if (this.eventActive('heatwave')) perHour *= 1.15;
    if (s.saleActive) perHour *= 1.5;
    if (s.upgrades.loyalty) perHour *= 1.15;
    if (s.upgrades.adcampaign) perHour *= 1.25;
    const maxC = 8 + Math.floor(s.w * s.d / 10);
    if (this.customers.length >= maxC) return;
    this.spawnAcc = (this.spawnAcc || 0) + perHour * dMin / 60;
    while (this.spawnAcc >= 1) { this.spawnAcc -= 1; spawnCustomer(this); }
    // VIP
    const vip = s.events.find(e => e.type === 'vip' && !e.spawned && s.minute >= e.spawnAt);
    if (vip) { vip.spawned = true; spawnCustomer(this, { vip: vip.pid }); this.toast('The VIP food blogger has arrived! 🕶️', 'info', '🕶️'); }
  }

  updateFixtures(dMin) {
    if (dMin <= 0) return;
    for (const f of this.s.furniture) {
      const def = FURNITURE[f.type];
      if (def.temp === undefined) continue;
      const before = Math.round(f.temp);
      if (f.broken) {
        const heat = this.eventActive('heatwave') ? 0.45 : 0.3;
        f.temp = Math.min(f.temp + heat * dMin, 21);
        if (f.techEta != null) {
          f.techEta -= dMin;
          if (f.techEta <= 0) { f.broken = false; f.techEta = null; f.repair = 0; this.toast(`Technician repaired the ${def.name}.`, 'good', '🔧'); this.dirtyWorld(); }
        }
      } else {
        f.temp = f.temp > def.temp ? Math.max(def.temp, f.temp - 0.6 * dMin) : def.temp;
      }
      if (f.temp > def.maxTemp) {
        f.warm = (f.warm || 0) + dMin;
        if (f.warm >= 40 && f.slots.some(sl => sl.qty > 0 && !sl.expired)) {
          for (const sl of f.slots) if (sl.qty > 0) sl.expired = true;
          f.warm = 0;
          this.toast(`Food in the ${def.name} spoiled from the heat! 🤢`, 'bad', '🌡️');
          this.dirtyWorld();
        }
      } else f.warm = 0;
      if (Math.round(f.temp) !== before) this.dirtyWorld();
    }
  }

  updateEvents() {
    const s = this.s;
    for (const ev of s.events) {
      if (ev.type === 'inspector' && !ev.done && s.minute >= ev.checkAt) {
        ev.done = true;
        const n = s.dirt.length;
        const expired = s.furniture.some(f => f.slots && f.slots.some(sl => sl.expired && sl.qty > 0));
        if (n <= 1 && !expired) { this.earn(250, 'bonus'); s.rep = clamp(s.rep + 5, 0, 100); this.toast('Inspector: "Spotless!" +$250 bonus and reputation up!', 'good', '🧐'); this.sound('fanfare'); }
        else if (n >= 4 || expired) { this.spend(300, 'other'); s.rep = clamp(s.rep - 8, 0, 100); this.toast(`Inspector found ${n} messes${expired ? ' and expired food' : ''}. Fined $300!`, 'bad', '🧐'); this.sound('error'); }
        else this.toast('Inspector: "Acceptable." No fine this time.', 'info', '🧐');
        this.dirtyMeta();
      }
    }
  }

  updatePigeons(dt) {
    for (const p of this.pigeons) {
      p.t += dt;
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) { p.tx = rnd(1, this.s.w - 1); p.tz = rnd(1, this.s.d - 1); if (Math.random() < 0.3) this.addDirt(Math.floor(p.x), Math.floor(p.z), 'pigeon'); }
      else { p.x += dx / d * dt * 2.5; p.z += dz / d * dt * 2.5; }
    }
    this.pigeons = this.pigeons.filter(p => this.s.minute < p.until);
  }

  // ------------------------------------------------------------------ network views
  worldView() {
    const s = this.s;
    return {
      name: s.name, w: s.w, d: s.d, doorX: s.doorX, floor: s.floor, wall: s.wall, lighting: s.lighting, expansion: s.expansion,
      furniture: s.furniture.map(f => ({ id: f.id, type: f.type, x: f.x, z: f.z, rot: f.rot, upg: f.upg, broken: f.broken, repair: f.repair || 0,
        techEta: f.techEta, temp: f.temp !== undefined ? Math.round(f.temp) : undefined, slots: f.slots, boxes: f.boxes, boughtDay: f.boughtDay, boughtPhase: f.boughtPhase })),
      boxes: s.boxes.map(b => ({ id: b.id, pid: b.pid, qty: b.qty, exp: b.exp, x: b.x, z: b.z, y: b.y, expired: b.expired })), dirt: s.dirt, prices: s.prices, saleActive: s.saleActive,
    };
  }

  metaView() {
    const s = this.s;
    return {
      name: s.name, nameDraft: s.nameDraft, nameVotes: s.nameVotes, phase: s.phase, day: s.day, cash: s.cash,
      xp: s.xp, level: s.level, rep: s.rep, appeal: this.appeal(), expansion: s.expansion,
      staff: s.staff.map(st => ({ id: st.id, name: st.name, role: st.role, skill: st.skill, speed: st.speed, salary: st.salary,
        happiness: st.happiness, shift: st.shift, absent: st.absent, present: st.present, served: st.served, seed: st.seed, state: st.state, hiredDay: st.hiredDay })),
      candidates: s.candidates, orders: s.orders.map(o => ({ id: o.id, supplier: o.supplier, items: o.items, total: o.total, eta: o.eta, remaining: o.remaining, by: o.by })),
      upgrades: s.upgrades, ownedFloors: s.ownedFloors, ownedWalls: s.ownedWalls, ownedLights: s.ownedLights, lighting: s.lighting, floor: s.floor, wall: s.wall,
      ledger: s.ledger, history: s.history, report: s.report, stats: s.stats, achievements: s.achievements, goalIndex: s.goalIndex,
      demand: s.demand, events: s.events, pendingSale: s.pendingSale, saleActive: s.saleActive, eventLog: s.eventLog,
      negativeDays: s.negativeDays, speed: s.speed, paused: s.paused, carryCap: this.carryCap(),
      challenge: s.challenge ? { ...s.challenge, progress: this.challengeProgress() } : null,
    };
  }
}

export function discountFor(sup, boxes) {
  let d = 0;
  for (const [n, pct] of sup.discounts) if (boxes >= n) d = pct;
  return d;
}
export function dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function fmt(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`; }
