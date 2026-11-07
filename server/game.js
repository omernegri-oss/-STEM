// Authoritative game simulation for one supermarket (one multiplayer room).
import {
  PRODUCTS, PRODUCT_MAP, SUPPLIERS, SUPPLIER_MAP, FURNITURE, FIXTURE_UPGRADES, EXPANSIONS,
  TEAM_UPGRADES, TEAM_UPGRADE_MAP, ROLES, SHIFTS, MAX_LEVEL, levelForXp, ACHIEVEMENTS,
  FIRST_NAMES, LAST_NAMES, EVENT_TYPES, STARTING_CASH, REAL_SECONDS_PER_MINUTE, OPEN_HOUR, CLOSE_HOUR,
  LAST_ENTRY_HOUR, fmtMoney, CATEGORIES, MAX_CUSTOMERS, STARTER_PRODUCTS, FURNITURE_SUPPLIER,
  licenseCost, priceLimits, stairInfo, slotCap, HIRE_FEE_DAYS,
} from '../shared/data.js';
import { Grid, footprint, serviceTiles, FACING, center, route, deptSpots, dims } from '../shared/grid.js';
import { updateCustomers, spawnCustomer, returnBasket, customerLeave } from './customers.js';
import { updateStaff } from './staff.js';

export const rnd = (a, b) => a + Math.random() * (b - a);
export const rndi = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round2 = v => Math.round(v * 100) / 100;
// the cash a shopper hands over: sometimes exact, usually the next round note above the total
export function tenderFor(due) {
  const cents = Math.round(due * 100);
  if (Math.random() < 0.1) return cents / 100;
  const ups = [...new Set([100, 500, 1000, 2000, 5000, 10000].map(st => Math.ceil(cents / st) * st).filter(v => v > cents))];
  return pick(ups.slice(0, 3)) / 100;
}
const money = v => '$' + v.toFixed(2);
export const DOOR_TYPES = new Set(['fridge', 'freezer_upright', 'freezer']);
const COMPUTER_ACTIONS = new Set(['order', 'license', 'buyFurniture', 'hire', 'fire', 'shift', 'raise', 'buyUpgrade',
  'priceAll', 'expand', 'payBill', 'sale']); // setPrice also works at a shelf label

function newLedger() {
  return { revenue: 0, cogs: 0, salaries: 0, rent: 0, power: 0, maint: 0, other: 0, bonus: 0, tips: 0,
    customers: 0, served: 0, angry: 0, lost: 0, satSum: 0, satN: 0, waste: 0, sold: {} };
}

export class Game {
  constructor(code, save = null, hooks = {}) {
    this.code = code;
    this.hooks = hooks; // { fx(msg), isNameTaken(name), save() }
    this.customers = [];
    this.pigeons = [];
    this.rt = new Map();          // fixture runtime: queues, timers
    this.worldDirty = true;
    this.metaDirty = true;
    this.gridVersion = 0;
    this.lastAchCheck = 0;
    this.players = new Map();     // filled by Room (shared reference)
    if (save) this.load(save); else this.fresh();
    this.rebuildGrid();
  }

  fresh() {
    const e = EXPANSIONS[0];
    this.s = {
      version: 3, name: '', nameDraft: '', nameVotes: [], phase: 'naming',
      w: e.w, d: e.d, doorX: Math.floor(e.w / 2) - 1, expansion: 0, floors: 1,
      floor: 'white', wall: 'cream',
      furniture: [], boxes: [], dirt: [],
      prices: Object.fromEntries(PRODUCTS.map(p => [p.id, p.price])),
      licenses: [...STARTER_PRODUCTS],
      cash: STARTING_CASH, day: 1, minute: 7 * 60, speed: 1, paused: false,
      xp: 0, level: 1, rep: 55,
      staff: [], candidates: [], orders: [], bills: [], inbox: [],
      upgrades: {},
      ledger: newLedger(), history: [], report: null,
      stats: { revenue: 0, customers: 0, sold: {}, playerCheckouts: 0, butcher: 0, deli: 0, angry: 0, vip: 0, punched: 0 },
      achievements: {}, demand: {}, events: [], pendingSale: false, saleActive: false, eventLog: [],
      negativeDays: 0, nextId: 1, created: Date.now(), bankruptReason: '',
    };
    // the empty store comes with a computer and one checkout counter
    this.s.furniture.push(this.newFixture('computer', 0, e.d - 3, 1));
    this.s.furniture.push(this.newFixture('checkout', e.w - 4, e.d - 3, 0));
    this.refreshCandidates();
    this.s.challenge = this.makeChallenge();
    this.msg('Welcome! Use this computer to buy shelves, order stock and unlock new products. Arrange the store however you like.', '🖥️');
  }

  load(save) {
    this.s = save;
    const def = { eventLog: [], licenses: [...STARTER_PRODUCTS], bills: [], inbox: [], floors: 1, bankruptReason: '' };
    for (const k in def) if (this.s[k] === undefined) this.s[k] = def[k];
    if (!this.s.furniture.some(f => f.type === 'computer')) this.s.furniture.push(this.newFixture('computer', 0, this.s.d - 3, 1));
    if (this.s.phase === 'open' || this.s.phase === 'closing') this.s.phase = 'prep';
    this.s.paused = false;
    for (const st of this.s.staff) this.resetStaffRuntime(st);
    for (const f of this.s.furniture) { const def = FURNITURE[f.type]; if (f.slots) while (f.slots.length < def.slots) f.slots.push({ pid: null, qty: 0, exp: 0, expired: false }); }
    for (const b of this.s.boxes) { delete b._claim; if (b.floor === undefined) b.floor = 0; }
    for (const f of this.s.furniture) if (f.floor === undefined) f.floor = 0;
    if (!this.s.challenge) this.s.challenge = this.makeChallenge();
  }

  serialize() {
    const s = { ...this.s };
    s.staff = this.s.staff.map(st => ({ id: st.id, name: st.name, role: st.role, skill: st.skill, speed: st.speed,
      salary: st.salary, happiness: st.happiness, shift: st.shift, seed: st.seed, hiredDay: st.hiredDay, absent: false, served: 0 }));
    s.boxes = this.s.boxes.map(b => { const c = { ...b }; delete c._claim; return c; });
    return JSON.parse(JSON.stringify(s));
  }

  newFixture(type, x, z, rot, floor = 0) {
    const def = FURNITURE[type];
    const f = { id: this.id(), type, x, z, rot, floor, upg: false, broken: false, open: false, boughtDay: this.s.day };
    if (def.slots) f.slots = Array.from({ length: def.slots }, () => ({ pid: null, qty: 0, exp: 0, expired: false }));
    if (def.kind === 'rack') f.boxes = [];
    if (def.temp !== undefined) { f.temp = def.temp; f.warm = 0; }
    return f;
  }

  id() { return this.s.nextId++; }
  fx(msg) { this.hooks.fx && this.hooks.fx(msg); }
  // Everything that isn't a level-up or a delivery goes to the computer's inbox instead of a pop-up.
  msg(text, icon = '💬', key = null) {
    const s = this.s;
    if (key) {
      const m = s.inbox.find(m => m.key === key);
      if (m) { m.count = (m.count || 1) + 1; m.text = text; m.min = Math.floor(s.minute); m.seq = this.id(); this.dirtyMeta(); return; }
    }
    s.inbox.push({ seq: this.id(), day: s.day, min: Math.floor(s.minute), icon, text, key, count: 1 });
    if (s.inbox.length > 60) s.inbox = s.inbox.slice(-60);
    this.dirtyMeta();
  }
  toast(text, kind, icon) { this.msg(text, icon || (kind === 'bad' ? '⚠️' : 'ℹ️')); }
  sound(name, x, z) { this.fx({ k: 'snd', name, x, z }); }
  float(text, x, z, color = '#16a34a', floor = 0) { this.fx({ k: 'float', text, x, z, color, floor }); }
  dirtyWorld() { this.worldDirty = true; }
  dirtyMeta() { this.metaDirty = true; }

  // ------------------------------------------------------------------ grid
  rebuildGrid() {
    const s = this.s;
    this.grids = [new Grid(s.w, s.d, s.doorX, 0, s.floors)];
    if (s.floors > 1) this.grids.push(new Grid(s.w, s.d, s.doorX, 1, s.floors));
    for (const g of this.grids) g.build(s.furniture);
    this.grid = this.grids[0];
    this.gridVersion++;
    for (const f of s.furniture) {
      const st = serviceTiles(f);
      f._front = st.front; f._back = st.back; f._fronts = st.fronts;
      if (FURNITURE[f.type].kind === 'counter') f._spots = deptSpots(f);
      if (!this.rt.has(f.id)) this.rt.set(f.id, { queue: [], timer: 0, progress: 0 });
      const kind = FURNITURE[f.type].kind;
      if (kind === 'checkout' || kind === 'counter' || kind === 'selfcheckout') f._queue = this.queueSpots(f);
    }
    for (const id of [...this.rt.keys()]) if (!this.fixture(id)) this.rt.delete(id);
  }
  gridOf(floor) { return this.grids[floor || 0] || this.grids[0]; }
  route(ent, x, z, floor = 0) { return route(this.grids, { x: ent.x, z: ent.z, floor: ent.floor || 0 }, { x, z, floor }); }

  queueSpots(f) {
    const g = this.gridOf(f.floor);
    const [fx, fz] = FACING[f.rot];
    const [ox, oz] = f._front;
    const cands = [];
    for (let dx = -5; dx <= 5; dx++) for (let dz = -5; dz <= 5; dz++) {
      const x = ox + dx, z = oz + dz;
      if (!g.isInterior(x, z) || g.isBlocked(x, z) || g.isReserved(x, z)) continue;
      const along = dx * fx + dz * fz, lat = Math.abs(dx * fz - dz * fx);
      if (along < 0) continue;
      cands.push({ x, z, score: along + lat * 1.7 });
    }
    cands.sort((a, b) => a.score - b.score);
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
    if (this.s.floors > 1) a += 6;
    a -= this.s.dirt.length;
    return Math.round(a);
  }
  carryCap() { return this.s.upgrades.palletjack ? 6 : this.s.upgrades.handtruck ? 3 : 1; }
  hasDept(cat) { return this.s.furniture.some(f => FURNITURE[f.type].cat === cat && f.slots && f.slots.some(sl => sl.qty > 0)); }
  unlocked(level) { return this.s.level >= level; }
  licensed(pid) { return this.s.licenses.includes(pid); }
  price(pid) { return this.s.prices[pid] ?? PRODUCT_MAP[pid].price; }
  effPrice(pid) { return round2(this.price(pid) * (this.s.saleActive ? 0.85 : 1)); }
  eventActive(type) { return this.s.events.some(e => e.type === type && (e.until == null || this.s.minute < e.until)); }
  nearComputer(p) {
    return this.s.furniture.some(f => f.type === 'computer' && (f.floor || 0) === (p.floor || 0) && distToFixture(f, p.x, p.z) < 2.6);
  }

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
      for (const f of Object.values(FURNITURE)) if (inRange(f.level)) unlocks.push(f.icon + ' ' + f.name);
      for (const p of PRODUCTS) if (inRange(p.level)) unlocks.push(p.icon + ' ' + p.name);
      for (const s of SUPPLIERS) if (inRange(s.level)) unlocks.push(s.icon + ' ' + s.name);
      for (const r of Object.values(ROLES)) if (inRange(r.level)) unlocks.push(r.icon + ' Hire ' + r.name);
      for (const u of TEAM_UPGRADES) if (inRange(u.level)) unlocks.push(u.icon + ' ' + u.name);
      for (const e of EXPANSIONS) if (inRange(e.level) && e.cost > 0) unlocks.push(e.floors ? '🏢 Second floor' : '📐 Expansion ' + e.w + '×' + e.d);
      this.fx({ k: 'levelup', level: lvl });
      this.msg(`Level ${lvl}! Now available: ${unlocks.join(', ') || 'nothing new'}.`, '⭐');
      this.refreshCandidates(true);
    }
    this.dirtyMeta();
  }

  // ------------------------------------------------------------------ actions from players
  act(player, m) {
    const s = this.s;
    const fail = (text) => { this.fx({ k: 'err', text, to: player.id }); return false; };
    const a = m.a;
    if (s.phase === 'bankrupt' && a !== 'restart') return fail('The store is closed.');
    if (s.phase === 'naming' && !['nameDraft', 'nameVote'].includes(a)) return fail('Agree on a store name first!');
    if (COMPUTER_ACTIONS.has(a) && !this.nearComputer(player)) return fail('Use the store computer for that.');
    if (player.stunUntil && Date.now() < player.stunUntil && a !== 'nameDraft' && a !== 'nameVote') return fail('You are seeing stars! 💫');
    const pf = player.floor || 0;

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
          this.fx({ k: 'named', name }); this.sound('fanfare');
          this.dirtyWorld();
        }
        this.dirtyMeta(); return true;
      }

      // ---------------- computer: buying
      case 'buyFurniture': {
        const def = FURNITURE[m.type]; if (!def) return false;
        const n = clamp(m.n | 0 || 1, 1, 10);
        if (!this.unlocked(def.level)) return fail(`Unlocks at level ${def.level}.`);
        const total = def.cost * n + FURNITURE_SUPPLIER.fee;
        if (s.cash < total) return fail('Not enough cash!');
        this.spend(total, 'other');
        const eta = FURNITURE_SUPPLIER.time * (this.eventActive('delay') ? 2 : 1);
        s.orders.push({ id: this.id(), supplier: 'fixtures', furniture: [{ type: m.type, n }], items: [], total, eta, remaining: eta, by: player.name });
        this.sound('order'); this.dirtyMeta();
        return true;
      }
      case 'license': {
        const p = PRODUCT_MAP[m.pid]; if (!p) return false;
        if (this.licensed(p.id)) return fail('Already unlocked.');
        if (!this.unlocked(p.level)) return fail(`Available at level ${p.level}.`);
        const cost = licenseCost(p);
        if (s.cash < cost) return fail('Not enough cash!');
        this.spend(cost, 'other'); s.licenses.push(p.id);
        this.sound('upgrade'); this.dirtyMeta();
        return true;
      }
      case 'order': return this.placeOrder(player, m, fail);
      case 'expand': {
        const next = EXPANSIONS[s.expansion + 1];
        if (!next) return fail('Already at maximum size!');
        if (!this.unlocked(next.level)) return fail(`Expansion unlocks at level ${next.level}.`);
        if (s.cash < next.cost) return fail('Not enough cash!');
        if (s.phase === 'open' || s.phase === 'closing') return fail('Expand while the store is closed.');
        this.spend(next.cost, 'other');
        const oldD = s.d;
        s.expansion++; s.w = next.w; s.d = next.d; s.doorX = Math.floor(next.w / 2) - 1;
        if (next.floors) s.floors = next.floors;
        const outside = s.boxes.filter(b => b.z >= oldD && (b.floor || 0) === 0);
        s.boxes = s.boxes.filter(b => !outside.includes(b));
        if (next.floors) this.clearStairArea();
        this.rebuildGrid();
        for (const b of outside) this.respawnBox(b, null, null);
        this.dirtyWorld(); this.dirtyMeta();
        this.fx({ k: 'expanded', w: s.w, d: s.d, floors: s.floors });
        this.sound('fanfare');
        this.msg(next.floors ? 'A second floor was built! Take the stairs on the right.' : `The supermarket grew to ${s.w}×${s.d}!`, next.floors ? '🏢' : '📐');
        return true;
      }
      case 'buyUpgrade': {
        const u = TEAM_UPGRADE_MAP[m.id]; if (!u) return false;
        if (s.upgrades[u.id]) return fail('Already owned.');
        if (u.requires && !s.upgrades[u.requires]) return fail(`Requires ${TEAM_UPGRADE_MAP[u.requires].name} first.`);
        if (!this.unlocked(u.level)) return fail(`Unlocks at level ${u.level}.`);
        if (s.cash < u.cost) return fail('Not enough cash!');
        this.spend(u.cost, 'other'); s.upgrades[u.id] = true;
        this.sound('upgrade'); this.dirtyMeta(); return true;
      }
      case 'payBill': {
        const b = s.bills.find(b => b.id === m.id && !b.paid); if (!b) return false;
        if (s.cash < b.total) return fail('Not enough cash to pay this bill!');
        this.spend(b.items.rent + (b.items.late || 0), 'rent'); this.spend(b.items.power, 'power'); this.spend(b.items.maint, 'maint');
        b.paid = true; this.sound('coin'); this.dirtyMeta(); return true;
      }
      case 'setPrice': {
        const p = PRODUCT_MAP[m.pid]; if (!p) return false;
        const [lo, hi] = priceLimits(p);
        s.prices[p.id] = round2(clamp(+m.price || p.price, lo, hi)); this.dirtyWorld(); this.dirtyMeta(); return true;
      }
      case 'priceAll': {
        const mult = clamp(+m.mult || 1, 0.5, 2);
        for (const p of PRODUCTS) { const [lo, hi] = priceLimits(p); s.prices[p.id] = round2(clamp(p.price * mult, lo, hi)); }
        this.dirtyWorld(); this.dirtyMeta(); return true;
      }
      case 'hire': {
        const c = s.candidates.find(c => c.id === m.id); if (!c) return false;
        if (!this.unlocked(ROLES[c.role].level)) return fail('Role not unlocked yet.');
        if (s.staff.length >= 4 + s.expansion * 3) return fail('Expand the store to hire more staff.');
        const fee = Math.round(c.salary * HIRE_FEE_DAYS);
        if (s.cash < fee) return fail(`Hiring ${c.name.split(' ')[0]} costs a ${fmtMoney(fee)} recruitment fee.`);
        this.spend(fee, 'salaries');
        s.candidates = s.candidates.filter(x => x !== c);
        const st = { ...c, shift: m.shift && SHIFTS[m.shift] ? m.shift : 'full', happiness: 75, hiredDay: s.day, absent: false, served: 0 };
        this.resetStaffRuntime(st);
        s.staff.push(st);
        this.sound('hire'); this.unlockAch('first_hire');
        this.dirtyMeta(); return true;
      }
      case 'fire': {
        const st = s.staff.find(x => x.id === m.id); if (!st) return false;
        if (st.carry && st.carry.pid) this.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, false, st.floor);
        s.staff = s.staff.filter(x => x !== st);
        this.dirtyMeta(); return true;
      }
      case 'shift': { const st = s.staff.find(x => x.id === m.id); if (!st || !SHIFTS[m.shift]) return false; st.shift = m.shift; this.dirtyMeta(); return true; }
      case 'raise': {
        const st = s.staff.find(x => x.id === m.id); if (!st) return false;
        st.salary = Math.round(st.salary * 1.1); st.happiness = clamp(st.happiness + 20, 0, 100); this.dirtyMeta(); return true;
      }
      case 'sale': {
        if (!s.pendingSale) return false;
        s.pendingSale = false;
        if (m.accept) { s.saleActive = true; s.events.push({ type: 'saleOn', until: CLOSE_HOUR * 60 }); this.msg('Flash sale is ON: 15% off everything today.', '🏷️'); }
        this.dirtyMeta(); this.dirtyWorld(); return true;
      }

      // ---------------- build mode: place furniture from a carried box, move, pack, sell
      case 'place': {
        const top = player.carry[player.carry.length - 1];
        if (!top || !top.ftype) return fail('Buy furniture on the computer, then carry its box here.');
        const type = top.ftype;
        const rot = ((m.rot | 0) % 4 + 4) % 4;
        const res = this.gridOf(pf).canPlace(s.furniture, type, m.x | 0, m.z | 0, rot);
        if (!res.ok) return fail(res.reason);
        player.carry.pop();
        const f = this.newFixture(type, m.x | 0, m.z | 0, rot, pf);
        f.boughtPhase = s.phase;
        s.furniture.push(f);
        this.rebuildGrid(); this.dirtyWorld();
        this.sound('place', f.x, f.z);
        this.fx({ k: 'placed', x: f.x, z: f.z, type: f.type, floor: pf });
        return true;
      }
      case 'move': {
        const f = this.fixture(m.id); if (!f) return false;
        const rot = ((m.rot | 0) % 4 + 4) % 4;
        const res = this.gridOf(f.floor).canPlace(s.furniture, f.type, m.x | 0, m.z | 0, rot, f.id);
        if (!res.ok) return fail(res.reason);
        f.x = m.x | 0; f.z = m.z | 0; f.rot = rot;
        this.rebuildGrid(); this.dirtyWorld();
        this.sound('place', f.x, f.z);
        return true;
      }
      case 'pack': case 'remove': {
        const f = this.fixture(m.id); if (!f) return false;
        const def = FURNITURE[f.type];
        if (f.type === 'computer' && this.fixtures('computer').length <= 1) return fail('You need at least one computer.');
        this.unpackFixture(f, a === 'pack');
        if (a === 'remove') { const refund = Math.round(def.cost * 0.5); s.cash = round2(s.cash + refund); this.msg(`Sold ${def.name} for ${fmtMoney(refund)}.`, '♻️'); }
        this.rebuildGrid(); this.dirtyWorld(); this.dirtyMeta();
        this.sound('remove', f.x, f.z);
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
        return true;
      }
      case 'clearLabel': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        const sl = f.slots[m.slot | 0]; if (!sl || sl.qty > 0) return fail('Slot must be empty.');
        sl.pid = null; this.dirtyWorld(); return true;
      }

      // ---------------- physical interactions
      case 'pickup': {
        const b = s.boxes.find(b => b.id === m.id);
        if (!b) return false;
        if ((b.floor || 0) !== pf || dist(player, b) > 2.2) return fail('Too far away.');
        const hasFurniture = player.carry.some(c => c.ftype);
        if (b.ftype ? player.carry.length : (hasFurniture || player.carry.length >= this.carryCap()))
          return fail(this.carryCap() === 1 || b.ftype || hasFurniture ? 'Your hands are full!' : 'You cannot carry more boxes.');
        if (player.carry.some(c => c.dept)) return fail('Your hands are full!');
        this.removeBox(b);
        player.carry.push(b.ftype ? { ftype: b.ftype } : { pid: b.pid, qty: b.qty, exp: b.exp, expired: b.expired });
        this.sound('pickup', b.x, b.z); this.dirtyWorld(); return true;
      }
      case 'rackTake': {
        const f = this.fixture(m.id); if (!f || !f.boxes) return false;
        if (!f.boxes.length) return fail('Rack is empty.');
        if (player.carry.length >= this.carryCap() || player.carry.some(c => c.ftype || c.dept)) return fail('Your hands are full!');
        const b = f.boxes.pop();
        player.carry.push(b); this.sound('pickup', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'rackPut': {
        const f = this.fixture(m.id); if (!f || !f.boxes) return false;
        const cap = FURNITURE.rack.boxes + (f.upg ? 4 : 0);
        let n = 0;
        while (player.carry.length && player.carry[player.carry.length - 1].pid && f.boxes.length < cap) { f.boxes.push(player.carry.pop()); n++; }
        if (!n) return fail('Rack is full.');
        this.sound('drop', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'drop': {
        if (!player.carry.length) return false;
        const b = player.carry.pop();
        if (b.dept) { s.ledger.waste += b.qty; this.dirtyWorld(); this.sound('trash', player.x, player.z); return true; }
        const ox = Math.sin(player.rot) * 0.6, oz = Math.cos(player.rot) * 0.6;
        this.respawnBox(b, player.x + ox, player.z + oz, pf);
        this.sound('drop', player.x, player.z); this.dirtyWorld(); return true;
      }
      case 'trash': {
        const f = this.fixture(m.id); if (!f || f.type !== 'bin') return false;
        const b = player.carry[player.carry.length - 1];
        if (!b || b.ftype) return false;
        player.carry.pop();
        s.ledger.waste += b.qty || 0;
        this.sound('trash', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'door': {
        const f = this.fixture(m.id); if (!f || !DOOR_TYPES.has(f.type)) return false;
        f.open = !f.open; this.sound(f.open ? 'fridgeOpen' : 'fridgeClose', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'stock': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        const box = player.carry[player.carry.length - 1];
        if (!box || !box.pid) return fail('Pick up a product box first.');
        if (DOOR_TYPES.has(f.type) && !f.open) return fail('Open it first.');
        if (box.expired) return fail('This box has expired. Throw it in a trash bin.');
        const r = this.stockInto(f, box, m.n ? Math.min(6, m.n | 0) : 3);
        if (r.error) return fail(r.error);
        if (box.qty <= 0) { player.carry.pop(); this.sound('boxempty', f.x, f.z); }
        this.fx({ k: 'stocked', id: f.id, n: r.n, pid: box.pid, by: player.id });
        this.dirtyWorld(); return true;
      }
      case 'clearExpired': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        if (DOOR_TYPES.has(f.type) && !f.open) return fail('Open it first.');
        let n = 0; for (const sl of f.slots) if (sl.expired && sl.qty) { n += sl.qty; sl.qty = 0; sl.expired = false; }
        if (!n) return false;
        s.ledger.waste += n; this.sound('trash', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'clean': {
        const d = s.dirt.find(d => d.id === m.id); if (!d) return false;
        if ((d.floor || 0) !== pf || dist(player, d) > 2.2) return fail('Too far away.');
        d.hp = (d.hp ?? 3) - 1;
        this.sound('scrub', d.x, d.z);
        if (d.hp <= 0) { s.dirt = s.dirt.filter(x => x !== d); this.sound('sparkle', d.x, d.z); this.addXp(2); }
        this.dirtyWorld(); return true;
      }
      case 'repair': {
        const f = this.fixture(m.id); if (!f || !f.broken) return false;
        f.repair = (f.repair || 0) + 1;
        this.sound('wrench', f.x, f.z);
        if (f.repair >= 6) { f.broken = false; f.repair = 0; f.techEta = null; this.sound('fixed', f.x, f.z); this.unlockAch('repairman'); this.addXp(15); }
        this.dirtyWorld(); return true;
      }
      case 'callTech': {
        const f = this.fixture(m.id); if (!f || !f.broken) return false;
        if (f.techEta != null) return fail('Technician already on the way.');
        if (s.cash < 180) return fail('Not enough cash!');
        this.spend(180, 'maint'); f.techEta = 60;
        this.msg('Technician called ($180). Arriving in about an hour.', '📞');
        this.dirtyWorld(); return true;
      }
      case 'station': {
        const f = this.fixture(m.id); if (!f || f.type !== 'checkout') return false;
        for (const p of this.players.values()) if (p !== player && p.station === f.id) return fail(`${p.name} is already working here.`);
        player.station = f.id; this.sound('click', f.x, f.z); return true;
      }
      case 'leaveStation': player.station = null; return true;
      case 'work': return this.playerWork(player, fail);
      case 'payCash': case 'payCard': return this.takePayment(player, m, fail);

      // ---------------- butcher / deli: take from the big fridge -> cut at the station -> hand over
      case 'deptTake': {
        const f = this.fixture(m.id); if (!f || FURNITURE[f.type].kind !== 'counter') return false;
        if (player.carry.length) return fail('Your hands are full!');
        const c = this.customerAtCounter(f);
        const pid = m.pid || (c ? c.counterReq.pid : null);
        const slot = f.slots.find(sl => (!pid || sl.pid === pid) && sl.qty > 0 && !sl.expired);
        if (!slot) {
          if (c && pid) { this.counterOutOfStock(f, c); return fail(`Out of ${PRODUCT_MAP[pid].name}! The customer is disappointed.`); }
          return fail('The fridge is empty. Stock it with meat/deli boxes.');
        }
        const qty = c && c.counterReq.pid === slot.pid ? Math.min(c.counterReq.qty, slot.qty) : 1;
        slot.qty -= qty;
        player.carry.push({ dept: 'raw', pid: slot.pid, qty, fid: f.id, progress: 0 });
        this.sound('fridgeOpen', f.x, f.z); this.dirtyWorld(); return true;
      }
      case 'deptCut': {
        const f = this.fixture(m.id); if (!f || FURNITURE[f.type].kind !== 'counter') return false;
        const it = player.carry[0];
        if (!it || it.dept !== 'raw') return fail('Take the product from the fridge first.');
        it.progress = (it.progress || 0) + 1;
        this.sound(f.type === 'butcher' ? 'chop' : 'slice', f.x, f.z);
        if (it.progress >= FURNITURE[f.type].presses) { it.dept = 'pack'; this.sound('serve', f.x, f.z); }
        this.dirtyWorld(); return true;
      }
      case 'deptServe': {
        const f = this.fixture(m.id); if (!f || FURNITURE[f.type].kind !== 'counter') return false;
        const it = player.carry[0];
        if (!it || it.dept !== 'pack') return fail(it && it.dept === 'raw' ? 'Cut and wrap it at the station first.' : 'Nothing to hand over.');
        const c = this.customerAtCounter(f);
        if (!c) return fail('Nobody is waiting at the counter.');
        if (c.counterReq.pid !== it.pid) return fail(`They asked for ${PRODUCT_MAP[c.counterReq.pid].name}, not ${PRODUCT_MAP[it.pid].name}!`);
        player.carry.pop();
        this.serveCounter(f, c, { skill: 4, name: player.name }, it.qty);
        return true;
      }
      case 'deptReturn': {
        const f = this.fixture(m.id); if (!f || !f.slots) return false;
        const it = player.carry[0]; if (!it || !it.dept) return false;
        const sl = f.slots.find(sl => sl.pid === it.pid && !sl.expired) || f.slots.find(sl => sl.qty === 0);
        if (!sl) return fail('No room in the fridge.');
        if (!sl.qty) { sl.pid = it.pid; sl.exp = s.day + PRODUCT_MAP[it.pid].life; }
        sl.qty += it.qty; player.carry.pop(); this.dirtyWorld(); return true;
      }

      // ---------------- punching (cartoon slapstick)
      case 'punch': return this.punch(player);

      // ---------------- day flow
      case 'open': {
        if (s.phase !== 'prep') return false;
        s.phase = 'open'; s.minute = OPEN_HOUR * 60;
        s.ledger.customers = 0;
        this.sound('open');
        this.startDayEvents();
        this.dirtyMeta(); this.dirtyWorld(); return true;
      }
      case 'speed': { s.speed = [1, 2, 3].includes(m.v) ? m.v : 1; s.paused = false; this.dirtyMeta(); return true; }
      case 'pause': { s.paused = !s.paused; this.dirtyMeta(); return true; }
      case 'continue': { if (s.phase !== 'report') return false; this.beginNewDay(); return true; }
      case 'restart': {
        if (s.phase !== 'bankrupt') return false;
        const name = s.name;
        this.customers = []; this.rt.clear(); this.fresh();
        this.s.name = name; this.s.phase = 'prep';
        for (const p of this.players.values()) { p.carry = []; p.station = null; p.floor = 0; }
        this.rebuildGrid(); this.dirtyWorld(); this.dirtyMeta();
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ punching
  punch(player) {
    const now = Date.now();
    if (player.punchAt && now - player.punchAt < 550) return false;
    player.punchAt = now;
    const pf = player.floor || 0;
    const fx = Math.sin(player.rot), fz = Math.cos(player.rot);
    const cands = [];
    const consider = (kind, e) => {
      if ((e.floor || 0) !== pf) return;
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > 1.35 || d < 0.01) return;
      if ((dx * fx + dz * fz) / d < 0.35) return;
      cands.push({ kind, e, d, dx: dx / d, dz: dz / d });
    };
    for (const p of this.players.values()) if (p !== player) consider('player', p);
    for (const c of this.customers) if (c.state !== 'leaving' && c.state !== 'arrive') consider('customer', c);
    for (const st of this.s.staff) if (st.present) consider('staff', st);
    this.fx({ k: 'swing', id: player.id });
    if (!cands.length) { this.sound('whoosh', player.x, player.z); return true; }
    cands.sort((a, b) => a.d - b.d);
    const t = cands[0];
    this.sound('punch', t.e.x, t.e.z);
    this.fx({ k: 'pow', x: t.e.x, z: t.e.z, floor: pf });
    if (t.kind === 'player') {
      const v = t.e;
      v.stunUntil = now + 2000;
      for (const b of v.carry) this.respawnBox(b, v.x, v.z, v.floor || 0);
      v.carry = []; v.station = null;
      this.fx({ k: 'knock', id: v.id, dx: t.dx * 3.2, dz: t.dz * 3.2, by: player.name });
      this.dirtyWorld();
    } else if (t.kind === 'customer') {
      const c = t.e;
      const g = this.gridOf(c.floor);
      const nx = c.x + t.dx * 0.6, nz = c.z + t.dz * 0.6;
      if (!g.isBlocked(Math.floor(nx), Math.floor(nz))) { c.x = nx; c.z = nz; }
      this.s.stats.punched++;
      customerLeave(this, c, 'hit');
      c.stunT = 1.2;
    } else {
      const st = t.e;
      st.happiness = clamp(st.happiness - 15, 0, 100); st.stunT = 1.5; st.thought = '💢'; st.thoughtT = 1.5;
      this.msg(`${st.name} didn't appreciate being punched (happiness −15).`, '💢');
      this.dirtyMeta();
    }
    return true;
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
      if (!this.licensed(p.id)) return fail(`Unlock ${p.name} first (Licenses tab).`);
      if (shortage && shortage.pid === p.id) return fail(`${p.name} is out of stock at suppliers today!`);
      boxes += it.boxes;
      subtotal += it.boxes * p.box * p.cost * sup.markup;
    }
    if (boxes < sup.minOrder) return fail(`${sup.name} requires at least ${sup.minOrder} boxes.`);
    const disc = discountFor(sup, boxes);
    const total = round2(subtotal * (1 - disc / 100) + sup.fee);
    if (s.cash < total) return fail(`Not enough cash! Order costs ${fmtMoney(total)}.`);
    this.spend(total, 'cogs');
    const eta = sup.time * (this.eventActive('delay') ? 2 : 1);
    s.orders.push({ id: this.id(), supplier: sup.id, items, total, eta, remaining: eta, by: player.name });
    this.sound('order');
    this.dirtyMeta();
    return true;
  }

  deliver(o) {
    for (const it of o.items) {
      const p = PRODUCT_MAP[it.pid];
      for (let i = 0; i < it.boxes; i++) this.spawnBox(p.id, p.box, this.s.day + p.life, null, null);
    }
    for (const fu of o.furniture || []) for (let i = 0; i < fu.n; i++) this.spawnFBox(fu.type, null, null);
    const [px, pz] = this.padCenter();
    const name = o.supplier === 'fixtures' ? FURNITURE_SUPPLIER.name : SUPPLIER_MAP[o.supplier].name;
    this.fx({ k: 'delivery', x: px, z: pz, supplier: o.supplier, name });
    this.dirtyWorld();
  }

  padCenter() { return [2, this.s.d + 2]; }
  padSpot() {
    const s = this.s;
    const spots = [];
    for (let z = s.d + 1; z <= s.d + 2; z++) for (let x = 0; x < Math.min(4, s.doorX); x++) spots.push([x + 0.5, z + 0.5]);
    for (let x = -1; x >= -5; x--) for (let z = s.d + 1; z <= s.d + 2; z++) spots.push([x + 0.5, z + 0.5]);
    for (let level = 0; level < 3; level++) {
      for (const [x, z] of spots) {
        const here = s.boxes.filter(b => (b.floor || 0) === 0 && Math.abs(b.x - x) < 0.3 && Math.abs(b.z - z) < 0.3);
        if (here.length === level) return [x, z, level];
      }
    }
    return [rnd(-8, -6), s.d + rnd(1.3, 2.7), 0];
  }
  stackAt(x, z, floor) {
    if (x == null) return this.padSpot();
    const here = this.s.boxes.filter(b => (b.floor || 0) === floor && Math.abs(b.x - x) < 0.35 && Math.abs(b.z - z) < 0.35);
    return here.length ? [here[0].x, here[0].z, here.length] : [x, z, 0];
  }
  spawnBox(pid, qty, exp, x, z, expired = false, floor = 0) {
    if (x == null) floor = 0;
    const [bx, bz, y] = this.stackAt(x, z, floor);
    const b = { id: this.id(), pid, qty, exp, x: round2(bx), z: round2(bz), y, floor, expired: !!expired };
    this.s.boxes.push(b); this.dirtyWorld(); return b;
  }
  spawnFBox(ftype, x, z, floor = 0) {
    if (x == null) floor = 0;
    const [bx, bz, y] = this.stackAt(x, z, floor);
    const b = { id: this.id(), ftype, x: round2(bx), z: round2(bz), y, floor };
    this.s.boxes.push(b); this.dirtyWorld(); return b;
  }
  respawnBox(item, x, z, floor = 0) {
    if (item.ftype) return this.spawnFBox(item.ftype, x, z, floor);
    if (item.pid) return this.spawnBox(item.pid, item.qty, item.exp, x, z, item.expired, floor);
  }
  removeBox(b) {
    this.s.boxes = this.s.boxes.filter(x => x !== b);
    for (const o of this.s.boxes) if ((o.floor || 0) === (b.floor || 0) && Math.abs(o.x - b.x) < 0.35 && Math.abs(o.z - b.z) < 0.35 && o.y > b.y) o.y--;
  }

  // Turn a fixture back into boxes (its contents as product boxes; itself as a furniture box when packing).
  unpackFixture(f, keepBox) {
    const s = this.s;
    const [cx, cz] = f._front ? [f._front[0] + 0.5, f._front[1] + 0.5] : center(f.type, f.x, f.z, f.rot);
    const fl = f.floor || 0;
    if (f.slots) for (const sl of f.slots) if (sl.qty > 0) this.spawnBox(sl.pid, sl.qty, sl.exp, cx + rnd(-0.3, 0.3), cz + rnd(-0.3, 0.3), sl.expired, fl);
    if (f.boxes) for (const b of f.boxes) this.spawnBox(b.pid, b.qty, b.exp, cx + rnd(-0.3, 0.3), cz + rnd(-0.3, 0.3), b.expired, fl);
    if (keepBox) this.spawnFBox(f.type, cx, cz, fl);
    const rt = this.rt.get(f.id);
    if (rt) for (const cid of rt.queue) { const c = this.customers.find(c => c.id === cid); if (c) c.reroute = true; }
    for (const p of this.players.values()) if (p.station === f.id) p.station = null;
    for (const st of s.staff) if (st.post === f.id) { st.post = null; st.state = 'idle'; }
    s.furniture = s.furniture.filter(x => x !== f);
  }

  // Building the second floor: pack up anything standing where the stairs go.
  clearStairArea() {
    const s = this.s, st = stairInfo(s.w);
    const inArea = (x, z) => x >= st.x && x < st.x + 2 && z >= st.z0 - 1 && z <= st.z1;
    for (const f of [...s.furniture]) {
      if ((f.floor || 0) !== 0) continue;
      if (footprint(f.type, f.x, f.z, f.rot).some(([x, z]) => inArea(x, z))) { this.unpackFixture(f, true); }
    }
    for (const b of s.boxes) if ((b.floor || 0) === 0 && inArea(Math.floor(b.x), Math.floor(b.z))) { b.x = st.x - 1.5; }
  }

  // Move up to maxUnits from a carried box into a fixture. Returns {n} or {error}.
  stockInto(f, box, maxUnits) {
    const def = FURNITURE[f.type];
    const p = PRODUCT_MAP[box.pid];
    if (def.cat !== p.cat) {
      const need = CATEGORIES[p.cat];
      return { error: `${p.name} belongs in the ${need.name} section (${FURNITURE[need.fixtures[0]].name}).` };
    }
    const cap = slotCap(f.type, box.pid);
    let slot = f.slots.find(sl => sl.pid === box.pid && sl.qty > 0 && sl.qty < cap && !sl.expired);
    if (!slot) slot = f.slots.find(sl => sl.pid === box.pid && sl.qty === 0);
    if (!slot) slot = f.slots.find(sl => sl.pid === null && sl.qty === 0);
    if (!slot) slot = f.slots.find(sl => sl.qty === 0);
    if (!slot) {
      if (f.slots.some(sl => sl.pid === box.pid && sl.expired)) return { error: 'Clear the expired items first (E with empty hands).' };
      return { error: 'No free space here for this product.' };
    }
    const n = Math.min(maxUnits, box.qty, cap - slot.qty);
    if (n <= 0) return { error: 'This spot is full.' };
    slot.exp = slot.qty > 0 ? Math.min(slot.exp, box.exp) : box.exp;
    slot.pid = box.pid; slot.qty += n; slot.expired = false;
    box.qty -= n;
    return { n, slot };
  }

  // ------------------------------------------------------------------ checkout
  playerWork(player, fail) {
    const f = this.fixture(player.station);
    if (!f) { player.station = null; return false; }
    if (f.type !== 'checkout') return false;
    const c = this.customerAtRegister(f);
    if (!c) return fail('No customer at the register yet.');
    if (c.scanned < c.basket.length) {
      const per = f.upg ? 2 : 1;
      for (let i = 0; i < per && c.scanned < c.basket.length; i++) c.scanned++;
      this.sound('beep', f.x, f.z);
    }
    if (c.scanned >= c.basket.length) this.readyToPay(c);
    return true;
  }
  // everything scanned: the total is fixed and the shopper takes out cash or a card
  readyToPay(c) {
    if (c.due != null) return;
    c.due = round2(c.basket.reduce((a, b) => a + b.price, 0));
    if (!c.payBy) c.payBy = 'card';
    if (c.payBy === 'cash') c.tendered = tenderFor(c.due);
  }
  // the player at the register takes the payment: change counted from the drawer, or the amount typed on the card terminal
  takePayment(player, m, fail) {
    const f = this.fixture(player.station);
    if (!f || f.type !== 'checkout') return fail('Stand behind a register first.');
    const c = this.customerAtRegister(f);
    if (!c) return fail('No customer at the register.');
    if (c.scanned < c.basket.length) return fail('Scan all the products first.');
    this.readyToPay(c);
    const complain = (text) => { c.mood -= 3; c.thought = '😠'; c.thoughtT = 2.5; return fail(text); };
    if (c.payBy === 'cash') {
      if (m.a !== 'payCash') return complain(`${c.name} is paying cash, not by card.`);
      const owed = round2(c.tendered - c.due), given = round2(Math.max(0, +m.change || 0));
      if (given < owed - 0.004) return complain(`${c.name}: "That's not enough change. I gave you ${money(c.tendered)} for ${money(c.due)}, I should get ${money(owed)} back."`);
      const extra = round2(given - owed);
      this.completeCheckout(c, f, player, extra);
      if (extra > 0.004) this.fx({ k: 'err', text: `You gave ${money(extra)} too much change. That money is gone.`, to: player.id });
      return true;
    }
    if (m.a !== 'payCard') return complain(`${c.name} is paying by card. Use the card terminal.`);
    const amount = round2(+m.amount || 0);
    if (Math.abs(amount - c.due) > 0.004) return complain(amount > c.due
      ? `${c.name}: "${money(amount)}? My total is ${money(c.due)}. I'm not paying that."`
      : `${c.name}: "The terminal says ${money(amount)}, but my total is ${money(c.due)}. Please fix it."`);
    this.completeCheckout(c, f, player);
    return true;
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
    if (FURNITURE[f.type].kind === 'counter') {
      for (const p of this.players.values()) if ((p.floor || 0) === (f.floor || 0) && f._spots && Math.hypot(p.x - f._spots.counterSpot[0], p.z - f._spots.counterSpot[1]) < 1.8) return { type: 'player', p };
    }
    const st = this.s.staff.find(st => st.present && st.post === f.id && (st.state === 'working' || st.state === 'dept'));
    return st ? { type: 'staff', st } : null;
  }

  completeCheckout(c, f, who, lostChange = 0) {
    const s = this.s;
    const total = round2(c.basket.reduce((a, b) => a + b.price, 0) - lostChange);
    this.earn(total, 'revenue');
    s.stats.revenue = round2(s.stats.revenue + total);
    for (const it of c.basket) {
      s.ledger.sold[it.pid] = (s.ledger.sold[it.pid] || 0) + 1;
      s.stats.sold[it.pid] = (s.stats.sold[it.pid] || 0) + 1;
    }
    c.paid = true;
    const rt = this.rt.get(f.id); if (rt) rt.queue = rt.queue.filter(id => id !== c.id);
    customerLeave(this, c, 'paid');
    this.sound('kaching', f.x, f.z);
    this.float('+' + fmtMoney(total), f.x + 0.5, f.z + 0.5, '#16a34a', f.floor || 0);
    this.addXp(total * 0.6 + 4);
    if (who && this.players.has(who.id)) { s.stats.playerCheckouts++; if (s.stats.playerCheckouts >= 25) this.unlockAch('scanner'); }
    if (c.vip && c.vipHappy) {
      this.earn(300, 'bonus'); s.rep = clamp(s.rep + 5, 0, 100); s.stats.vip++;
      this.msg('The VIP food blogger loved your store! +$300 and a glowing review.', '🕶️');
      this.unlockAch('vip');
    }
    this.unlockAch('first_sale');
    this.dirtyMeta();
  }

  counterOutOfStock(f, c) {
    const s = this.s, pid = c.counterReq.pid;
    const rt = this.rt.get(f.id); if (rt) rt.queue = rt.queue.filter(id => id !== c.id);
    c.counterDone = true; c.state = 'shop'; c.path = null; c.timer = 0.5; c.mood -= 12;
    s.demand[pid] = (s.demand[pid] || 0) + 1;
    this.msg(`A customer wanted ${PRODUCT_MAP[pid].name} at the ${FURNITURE[f.type].name}, but it was out of stock.`, '😞', `dept:${s.day}:${pid}`);
  }

  // Hand a prepared order to the customer (stock was already taken out of the fridge).
  serveCounter(f, c, server, qty) {
    const s = this.s;
    const def = FURNITURE[f.type];
    const rt = this.rt.get(f.id);
    if (rt) rt.queue = rt.queue.filter(id => id !== c.id);
    c.counterDone = true; c.state = 'shop'; c.path = null; c.timer = 0.5;
    for (let i = 0; i < qty; i++) c.basket.push({ pid: c.counterReq.pid, price: this.effPrice(c.counterReq.pid), src: null });
    c.mood += 4 + (server.skill || 3);
    if ((server.skill || 0) >= 4 && Math.random() < 0.4) {
      const tip = round2(1 + server.skill * Math.random());
      this.earn(tip, 'tips'); this.float(`Tip +${fmtMoney(tip)}`, f.x + 1, f.z + 0.5, '#ca8a04', f.floor || 0);
    }
    this.sound('serve', f.x, f.z);
    if (def.cat === 'meat') { s.stats.butcher++; this.unlockAch('butcher'); } else { s.stats.deli++; this.unlockAch('deli'); }
    this.addXp(6);
    this.dirtyWorld();
  }

  // ------------------------------------------------------------------ staff helpers
  resetStaffRuntime(st) {
    st.present = false; st.x = this.s.doorX + 1; st.z = this.s.d - 0.5; st.rot = Math.PI; st.floor = 0;
    st.route = null; st.state = 'idle'; st.task = null; st.timer = 0; st.carry = null; st.post = null; st.thought = '';
  }

  refreshCandidates(levelUp = false) {
    const s = this.s;
    let roles = Object.entries(ROLES).filter(([, r]) => s.level >= r.level).map(([k]) => k);
    // before any role is unlocked, show applicants for the first roles to come (they can't be hired yet)
    if (!roles.length) { const first = Math.min(...Object.values(ROLES).map(r => r.level)); roles = Object.entries(ROLES).filter(([, r]) => r.level === first).map(([k]) => k); }
    const n = levelUp ? 2 : rndi(4, 6);
    if (!levelUp) s.candidates = [];
    const maxSkill = clamp(Math.floor(2 + s.level / 2), 2, 5);
    for (let i = 0; i < n; i++) {
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

  // ------------------------------------------------------------------ challenge & achievements
  makeChallenge() {
    const lvl = this.s.level;
    const cats = ['grocery', 'fridge', 'frozen', 'produce', 'meat', 'deli'].filter(c => this.s.furniture.some(f => FURNITURE[f.type].cat === c));
    const opts = [
      { type: 'serve', target: Math.round((8 + lvl * 7) / 5) * 5 },
      { type: 'revenue', target: Math.round((60 + lvl * 160) / 10) * 10 },
      { type: 'noangry', target: 8 + lvl * 3 },
      { type: 'sat', target: Math.min(80, 62 + lvl) },
    ];
    if (cats.length) opts.push({ type: 'cat', cat: pick(cats), target: 8 + lvl * 4 });
    const c = pick(this.s.day === 1 ? opts.filter(o => o.type === 'serve' || o.type === 'revenue') : opts);
    c.reward = 40 + lvl * 50; c.done = false; c.failed = false;
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
    else if (endOfDay) ok = c.type === 'noangry' ? (L.served >= c.target && L.angry === 0) : (L.satN >= 10 && prog >= c.target);
    if (c.type === 'noangry' && L.angry > 0) { c.failed = true; this.dirtyMeta(); return; }
    if (ok) {
      c.done = true;
      this.earn(c.reward, 'bonus'); this.addXp(c.reward * 0.5);
      this.msg(`Daily challenge complete! +${fmtMoney(c.reward)}`, '⭐');
      this.sound('goal'); this.dirtyMeta();
    } else if (endOfDay) { c.failed = true; this.dirtyMeta(); }
  }
  unlockAch(id) {
    if (this.s.achievements[id]) return;
    const a = ACHIEVEMENTS.find(a => a.id === id); if (!a) return;
    this.s.achievements[id] = this.s.day;
    this.msg(`Achievement unlocked: ${a.name} — ${a.desc}`, a.icon);
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
    s.events = []; s.saleActive = false;
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
      case 'delay': case 'holiday': case 'heatwave': ev.until = CLOSE_HOUR * 60; break;
      case 'influencer': ev.until = s.minute + 180; s.rep = clamp(s.rep + 6, 0, 100); break;
      case 'breakdown': {
        const f = pick(coolers.length ? coolers : s.furniture.filter(f => FURNITURE[f.type].temp !== undefined));
        if (!f) return;
        f.broken = true; f.repair = 0; ev.fid = f.id;
        detail = `The ${FURNITURE[f.type].name} broke down! Hold E on it to repair, or call a technician.`;
        this.dirtyWorld(); break;
      }
      case 'shortage': {
        const pool = PRODUCTS.filter(p => this.licensed(p.id));
        const p = pick(pool);
        ev.pid = p.id; ev.until = CLOSE_HOUR * 60;
        detail = `Suppliers ran out of ${p.icon} ${p.name}! You can't order it today.`; break;
      }
      case 'vip': {
        const opts = PRODUCTS.filter(p => this.unlocked(p.level) && p.cat !== 'meat' && p.cat !== 'deli');
        const p = pick(opts);
        ev.pid = p.id; ev.spawnAt = Math.min(s.minute + 150, (CLOSE_HOUR - 1) * 60);
        detail = `A famous food blogger will visit around ${fmt(ev.spawnAt)} looking for ${p.icon} ${p.name}.`; break;
      }
      case 'absence': {
        const st = pick(s.staff); st.absent = true; ev.sid = st.id;
        if (st.present) { st.present = false; st.post = null; }
        detail = `${st.name} (${ROLES[st.role].name}) called in sick.`; break;
      }
      case 'sale': s.pendingSale = true; detail = 'Run a store-wide 15% discount today to attract a crowd? Decide in Messages.'; break;
      case 'inspector': ev.checkAt = Math.max(s.minute + 120, 15 * 60); detail = `A health inspector will check cleanliness at ${fmt(ev.checkAt)}.`; break;
      case 'pigeon': {
        for (let i = 0; i < 6; i++) this.addDirt(rndi(0, s.w - 1), rndi(0, s.d - 2), 'pigeon', 0);
        this.pigeons.push({ id: this.id(), x: s.doorX + 1, z: s.d - 1, tx: rnd(1, s.w - 1), tz: rnd(1, s.d - 1), t: 0, until: s.minute + 120 });
        break;
      }
    }
    s.events.push(ev);
    s.eventLog.push({ day: s.day, type, text: detail });
    s.eventLog = s.eventLog.slice(-20);
    this.msg(`${E.name}: ${detail}`, E.icon);
    this.dirtyMeta();
  }

  addDirt(x, z, kind = 'spill', floor = 0) {
    if (this.s.dirt.length >= 30) return;
    const g = this.gridOf(floor);
    if (!g.isInterior(x, z) || g.isBlocked(x, z)) return;
    if (this.s.dirt.some(d => (d.floor || 0) === floor && Math.floor(d.x) === x && Math.floor(d.z) === z)) return;
    this.s.dirt.push({ id: this.id(), x: x + 0.5 + rnd(-0.2, 0.2), z: z + 0.5 + rnd(-0.2, 0.2), floor, kind, hp: kind === 'spill' ? 3 : 2, r: rnd(0, 6.28) });
    this.dirtyWorld();
  }

  fixedCosts() {
    const s = this.s;
    let power = 4, maint = 0, income = 0;
    for (const f of s.furniture) {
      const def = FURNITURE[f.type];
      power += (def.power || 0) * (f.upg && def.kind === 'storage' ? 0.5 : 1);
      maint += def.maint || 0;
      income += def.income || 0;
    }
    if (s.upgrades.led) power *= 0.7;
    return { rent: EXPANSIONS[s.expansion].rent, power: Math.round(power), maint: Math.round(maint), income };
  }

  endDay() {
    const s = this.s;
    this.checkChallenge(true);
    s.phase = 'report';
    for (const c of this.customers) if (!c.paid) returnBasket(this, c);
    this.customers = [];
    for (const rt of this.rt.values()) { rt.queue = []; rt.progress = 0; }
    for (const p of this.players.values()) p.station = null;
    for (const st of s.staff) {
      if (st.carry && st.carry.pid) this.spawnBox(st.carry.pid, st.carry.qty, st.carry.exp, st.x, st.z, false, st.floor || 0);
      st.carry = null; st.present = false; st.state = 'idle'; st.post = null; st.route = null;
    }
    this.pigeons = [];
    for (const b of s.boxes) delete b._claim;
    const L = s.ledger;
    // salaries are paid automatically from the bank account
    let salaries = 0;
    const quits = [];
    for (const st of s.staff) {
      if (st.absent) { st.served = 0; continue; }
      salaries += Math.round(st.salary * SHIFTS[st.shift].pay);
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
    for (const st of quits) { s.staff = s.staff.filter(x => x !== st); this.msg(`${st.name} quit because they were unhappy.`, '🚪'); }
    this.spend(salaries, 'salaries');
    // rent, electricity & maintenance arrive as a bill to pay on the computer
    const fc = this.fixedCosts();
    const bill = { id: this.id(), day: s.day, due: s.day + 2, items: { rent: fc.rent, power: fc.power, maint: fc.maint, late: 0 }, total: fc.rent + fc.power + fc.maint, paid: false };
    s.bills.push(bill); s.bills = s.bills.filter(b => !b.paid || b.day > s.day - 5);
    this.msg(`New bill for day ${s.day}: ${fmtMoney(bill.total)} (rent, electricity, maintenance). Pay it on the computer by the end of day ${bill.due}.`, '🧾');
    if (fc.income) this.earn(fc.income, 'bonus');
    const expenses = round2(L.cogs + L.salaries + L.rent + L.power + L.maint + L.other);
    const incomeTotal = round2(L.revenue + L.tips + L.bonus);
    const profit = round2(incomeTotal - expenses);
    const avgSat = L.satN ? Math.round(L.satSum / L.satN) : 0;
    const top = Object.entries(L.sold).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const report = {
      day: s.day, revenue: L.revenue, tips: L.tips, bonus: L.bonus, cogs: L.cogs, salaries: L.salaries, rent: L.rent,
      power: L.power, maint: L.maint, other: L.other, expenses, profit, customers: L.customers, served: L.served,
      angry: L.angry, lost: L.lost, avgSat, waste: L.waste, top, rep: s.rep, quits: quits.map(q => q.name),
      demand: Object.entries(s.demand).sort((a, b) => b[1] - a[1]).slice(0, 5), cash: s.cash, vending: fc.income,
      challenge: s.challenge ? { ...s.challenge } : null, bill: bill.total,
    };
    s.report = report;
    s.history.push({ day: s.day, revenue: L.revenue, expenses, profit, customers: L.served, rep: Math.round(s.rep) });
    s.history = s.history.slice(-30);
    if (profit > 0) this.unlockAch('day_profit');
    if (L.served >= 20 && L.angry === 0) this.unlockAch('perfect_day');
    if (s.cash < 0) s.negativeDays++; else s.negativeDays = 0;
    if (s.negativeDays >= 3) { s.phase = 'bankrupt'; s.bankruptReason = 'debt'; this.fx({ k: 'bankrupt' }); }
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
    // overdue bills: late fee, then eviction
    for (const b of s.bills) {
      if (b.paid || s.day <= b.due) continue;
      const late = Math.round(b.items.rent * 0.1);
      b.items.late += late; b.total += late;
      if (s.day - b.due >= 3) { s.phase = 'bankrupt'; s.bankruptReason = 'evicted'; this.fx({ k: 'bankrupt' }); }
      else this.msg(`Bill from day ${b.day} is overdue! A ${fmtMoney(late)} late fee was added. Pay soon or you'll be evicted.`, '⚠️');
    }
    let expiredSlots = 0;
    for (const f of s.furniture) if (f.slots) for (const sl of f.slots) if (sl.qty > 0 && sl.exp <= s.day && !sl.expired) { sl.expired = true; expiredSlots++; }
    for (const b of s.boxes) if (b.pid && b.exp <= s.day) b.expired = true;
    for (const p of this.players.values()) for (const b of p.carry) if (b.pid && b.exp <= s.day) b.expired = true;
    if (expiredSlots) this.msg(`${expiredSlots} shelf section${expiredSlots > 1 ? 's have' : ' has'} expired products.`, '🤢');
    for (const f of s.furniture) {
      if (FURNITURE[f.type].temp === undefined || f.broken) continue;
      if (Math.random() < (f.upg ? 0.01 : 0.035)) { f.broken = true; f.repair = 0; this.msg(`Overnight, the ${FURNITURE[f.type].name} stopped working!`, '🔥'); }
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
    if (s.phase !== 'report') {
      for (const o of s.orders) o.remaining -= simDt;
      const arrived = s.orders.filter(o => o.remaining <= 0);
      if (arrived.length) { s.orders = s.orders.filter(o => o.remaining > 0); arrived.forEach(o => this.deliver(o)); this.dirtyMeta(); }
    }
    const dMin = simDt / REAL_SECONDS_PER_MINUTE;
    if (s.phase === 'open' || s.phase === 'closing') {
      const prevHour = Math.floor(s.minute / 60);
      s.minute += dMin;
      if (s.phase === 'open' && s.minute >= CLOSE_HOUR * 60) { s.phase = 'closing'; this.dirtyMeta(); }
      if (Math.floor(s.minute / 60) !== prevHour) {
        this.dirtyMeta();
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
    if (this.lastAchCheck > 1) { this.lastAchCheck = 0; this.checkAchievements(); if (s.phase === 'open' || s.phase === 'closing') this.checkChallenge(); }
  }

  updateSpawning(dMin) {
    const s = this.s;
    if (s.phase !== 'open' || s.minute >= LAST_ENTRY_HOUR * 60) return;
    if (this.customers.length >= MAX_CUSTOMERS) return; // never a queue outside: only 15 shoppers at once
    const h = s.minute / 60;
    const tod = h < 10 ? 0.6 : h < 12 ? 0.9 : h < 14 ? 1.35 : h < 17 ? 0.85 : h < 20 ? 1.4 : 0.6;
    const nPlayers = Math.max(1, this.players.size);
    const variety = new Set(s.furniture.flatMap(f => (f.slots || []).filter(sl => sl.qty > 0).map(sl => sl.pid))).size;
    let perHour = (2 + s.level * 1.1 + nPlayers * 0.6 + Math.min(10, variety * 0.5) + Math.max(0, this.appeal()) * 0.12) * (0.45 + (s.rep / 100) * 1.15) * tod;
    if (this.eventActive('rush')) perHour *= 3;
    if (this.eventActive('holiday')) perHour *= 1.4;
    if (this.eventActive('influencer')) perHour *= 1.5;
    if (this.eventActive('heatwave')) perHour *= 1.15;
    if (s.saleActive) perHour *= 1.5;
    if (s.upgrades.loyalty) perHour *= 1.15;
    if (s.upgrades.adcampaign) perHour *= 1.25;
    this.spawnAcc = (this.spawnAcc || 0) + perHour * dMin / 60;
    while (this.spawnAcc >= 1 && this.customers.length < MAX_CUSTOMERS) { this.spawnAcc -= 1; spawnCustomer(this); }
    if (this.spawnAcc > 1) this.spawnAcc = 1;
    const vip = s.events.find(e => e.type === 'vip' && !e.spawned && s.minute >= e.spawnAt);
    if (vip && this.customers.length < MAX_CUSTOMERS) { vip.spawned = true; spawnCustomer(this, { vip: vip.pid }); }
  }

  updateFixtures(dMin) {
    if (dMin <= 0) return;
    for (const f of this.s.furniture) {
      const def = FURNITURE[f.type];
      if (def.temp === undefined) continue;
      const before = Math.round(f.temp);
      if (f.broken) {
        f.temp = Math.min(f.temp + (this.eventActive('heatwave') ? 0.45 : 0.3) * dMin, 21);
        if (f.techEta != null) {
          f.techEta -= dMin;
          if (f.techEta <= 0) { f.broken = false; f.techEta = null; f.repair = 0; this.msg(`Technician repaired the ${def.name}.`, '🔧'); this.dirtyWorld(); }
        }
      } else if (f.open) {
        f.temp = Math.min(f.temp + 0.1 * dMin, 16); // doors left open: it slowly warms up
      } else {
        f.temp = f.temp > def.temp ? Math.max(def.temp, f.temp - 0.6 * dMin) : def.temp;
      }
      if (f.temp > def.maxTemp) {
        f.warm = (f.warm || 0) + dMin;
        if (f.warm >= 40 && f.slots.some(sl => sl.qty > 0 && !sl.expired)) {
          for (const sl of f.slots) if (sl.qty > 0) sl.expired = true;
          f.warm = 0;
          this.msg(`Food in the ${def.name} spoiled from the heat${f.open ? ' (the door was left open)' : ''}!`, '🌡️');
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
        if (n <= 1 && !expired) { this.earn(250, 'bonus'); s.rep = clamp(s.rep + 5, 0, 100); this.msg('Health inspector: "Spotless!" +$250 bonus.', '🧐'); }
        else if (n >= 4 || expired) { this.spend(300, 'other'); s.rep = clamp(s.rep - 8, 0, 100); this.msg(`Health inspector found ${n} messes${expired ? ' and expired food' : ''}. Fined $300.`, '🧐'); }
        else this.msg('Health inspector: "Acceptable."', '🧐');
        this.dirtyMeta();
      }
    }
  }

  updatePigeons(dt) {
    for (const p of this.pigeons) {
      p.t += dt;
      const dx = p.tx - p.x, dz = p.tz - p.z, d = Math.hypot(dx, dz);
      if (d < 0.2) { p.tx = rnd(1, this.s.w - 1); p.tz = rnd(1, this.s.d - 1); if (Math.random() < 0.3) this.addDirt(Math.floor(p.x), Math.floor(p.z), 'pigeon', 0); }
      else { p.x += dx / d * dt * 2.5; p.z += dz / d * dt * 2.5; }
    }
    this.pigeons = this.pigeons.filter(p => this.s.minute < p.until);
  }

  // ------------------------------------------------------------------ network views
  worldView() {
    const s = this.s;
    return {
      name: s.name, w: s.w, d: s.d, doorX: s.doorX, floors: s.floors, floor: s.floor, wall: s.wall, expansion: s.expansion,
      furniture: s.furniture.map(f => ({ id: f.id, type: f.type, x: f.x, z: f.z, rot: f.rot, floor: f.floor || 0, upg: f.upg, broken: f.broken, repair: f.repair || 0,
        open: !!f.open, techEta: f.techEta, temp: f.temp !== undefined ? Math.round(f.temp) : undefined, slots: f.slots, boxes: f.boxes })),
      boxes: s.boxes.map(b => ({ id: b.id, pid: b.pid, ftype: b.ftype, qty: b.qty, exp: b.exp, x: b.x, z: b.z, y: b.y, floor: b.floor || 0, expired: b.expired })),
      dirt: s.dirt, prices: s.prices, saleActive: s.saleActive,
    };
  }

  metaView() {
    const s = this.s;
    return {
      name: s.name, nameDraft: s.nameDraft, nameVotes: s.nameVotes, phase: s.phase, day: s.day, cash: s.cash,
      xp: s.xp, level: s.level, rep: s.rep, appeal: this.appeal(), expansion: s.expansion, floors: s.floors,
      staff: s.staff.map(st => ({ id: st.id, name: st.name, role: st.role, skill: st.skill, speed: st.speed, salary: st.salary,
        happiness: st.happiness, shift: st.shift, absent: st.absent, present: st.present, served: st.served, seed: st.seed, state: st.state, hiredDay: st.hiredDay })),
      candidates: s.candidates, orders: s.orders.map(o => ({ id: o.id, supplier: o.supplier, items: o.items, furniture: o.furniture, total: o.total, eta: o.eta, remaining: o.remaining, by: o.by })),
      upgrades: s.upgrades, licenses: s.licenses, bills: s.bills, inbox: s.inbox,
      ledger: s.ledger, history: s.history, report: s.report, stats: s.stats, achievements: s.achievements,
      demand: s.demand, events: s.events, pendingSale: s.pendingSale, saleActive: s.saleActive, eventLog: s.eventLog,
      negativeDays: s.negativeDays, speed: s.speed, paused: s.paused, carryCap: this.carryCap(), fixed: this.fixedCosts(), bankruptReason: s.bankruptReason,
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
export function distToFixture(f, x, z) {
  const [w, d] = dims(f.type, f.rot);
  const dx = Math.max(f.x - x, 0, x - (f.x + w)), dz = Math.max(f.z - z, 0, z - (f.z + d));
  return Math.hypot(dx, dz);
}
function fmt(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`; }
