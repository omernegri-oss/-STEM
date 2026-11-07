// Customer AI: arrive -> browse departments -> pick items -> butcher/deli counters -> queue -> pay -> leave.
import { PRODUCTS, PRODUCT_MAP, FURNITURE, CLOSE_HOUR, FIRST_NAMES, slotCap } from '../shared/data.js';
import { rnd, rndi, pick, clamp } from './game.js';

const COUNTER_CATS = ['meat', 'deli'];
const COLD_DRINKS = new Set(['soda', 'water', 'energy', 'juice', 'icecream', 'popsicles', 'kombucha', 'salad']);

export function spawnCustomer(game, opts = {}) {
  const s = game.s;
  const left = Math.random() < 0.5;
  const lane = s.d + 3.6;
  const c = {
    id: game.id(), seed: rndi(1, 1e6), name: pick(FIRST_NAMES),
    x: left ? -13 : s.w + 13, z: lane + rnd(-0.2, 0.2), rot: left ? Math.PI / 2 : -Math.PI / 2, moving: true,
    state: 'arrive', floor: 0, wp: [[s.doorX + 1, lane, 0], [s.doorX + 1, s.d + 1.2, 0], [s.doorX + 1 + rnd(-0.4, 0.4), s.d - 0.5, 0]],
    path: null, goal: null, pathVer: 0, speed: rnd(1.6, 2.2),
    list: [], basket: [], counterReq: null, counterDone: false,
    patience: rnd(100, 160) * (s.upgrades.music ? 1.2 : 1), mood: 70, timer: 0, thought: '', thoughtT: 0,
    sens: rnd(0.6, 1.4), vip: opts.vip || null, vipHappy: false, scanned: 0, paid: false, waited: 0,
    payBy: Math.random() < 0.5 ? 'cash' : 'card', due: null, tendered: 0, // how they pay at a staffed register
    exitSide: Math.random() < 0.5 ? -13 : s.w + 13, wanted: 0, missed: 0,
  };
  // initial mood: store appeal & cleanliness
  const appeal = game.appeal();
  c.mood = clamp(68 + Math.min(20, appeal * 0.45) - Math.min(18, s.dirt.length * 1.8), 20, 95);
  buildList(game, c);
  game.customers.push(c);
  s.ledger.customers++;
  return c;
}

function buildList(game, c) {
  const s = game.s;
  const avail = PRODUCTS.filter(p => s.level >= p.level && !COUNTER_CATS.includes(p.cat) && (s.licenses.includes(p.id) || Math.random() < 0.5));
  const stocked = new Set(), carried = new Set();
  const catPresent = new Set();
  for (const f of s.furniture) {
    const def = FURNITURE[f.type];
    if (def.cat) catPresent.add(def.cat);
    if (f.slots) for (const sl of f.slots) { if (sl.pid) carried.add(sl.pid); if (sl.qty > 0 && !sl.expired) stocked.add(sl.pid); }
  }
  c.carried = carried;
  const heat = game.eventActive('heatwave');
  // shoppers mostly want what the store is known to sell; a few ask for other things (that's your demand signal)
  const weights = avail.map(p => {
    let w = stocked.has(p.id) ? 6 : carried.has(p.id) ? 4 : catPresent.has(p.cat) ? 0.45 : 0.15;
    if (heat && COLD_DRINKS.has(p.id)) w *= 4;
    return w;
  });
  let n = rndi(2, 5);
  if (s.upgrades.carts) n += rndi(0, 3);
  if (game.eventActive('holiday')) n += 2;
  if (c.vip) n = Math.max(2, n);
  const list = [];
  for (let i = 0; i < n && list.length < avail.length; i++) {
    let tot = 0; for (let j = 0; j < avail.length; j++) if (!list.includes(avail[j].id)) tot += weights[j];
    let r = Math.random() * tot;
    for (let j = 0; j < avail.length; j++) {
      if (list.includes(avail[j].id)) continue;
      r -= weights[j];
      if (r <= 0) { list.push(avail[j].id); break; }
    }
  }
  if (c.vip) { c.list = [c.vip, ...list.filter(x => x !== c.vip)]; }
  else c.list = list;
  c.qty = Object.fromEntries(c.list.map(pid => { const r = Math.random(); return [pid, r < 0.1 ? 3 : r < 0.38 ? 2 : 1]; }));
  c.wanted = c.list.length;
  c.cart = s.upgrades.carts && c.list.length >= 4;
  // butcher / deli requests
  for (const cat of COUNTER_CATS) {
    if (c.counterReq) break;
    const counters = s.furniture.filter(f => FURNITURE[f.type].cat === cat);
    if (!counters.length) continue;
    if (Math.random() > (cat === 'meat' ? 0.32 : 0.27)) continue;
    const inStock = [];
    for (const f of counters) for (const sl of f.slots) if (sl.qty > 0 && !sl.expired && !inStock.includes(sl.pid)) inStock.push(sl.pid);
    const all = PRODUCTS.filter(p => p.cat === cat && s.level >= p.level).map(p => p.id);
    const pid = (inStock.length && Math.random() < 0.75) ? pick(inStock) : pick(all);
    if (pid) c.counterReq = { pid, qty: Math.random() < 0.3 ? 2 : 1, cat };
  }
}

function say(c, t, dur = 2.5) { c.thought = t; c.thoughtT = dur; }

function goTo(game, c, tx, tz, tf = 0) {
  const p = game.route(c, tx, tz, tf);
  if (!p) return false;
  c.path = p;
  c.goal = [tx, tz, tf]; c.pathVer = game.gridVersion;
  return true;
}

// Walk along waypoints (outside) then path (inside). Returns true when arrived.
function walk(game, c, dt) {
  const list = c.path && c.path.length ? c.path : c.wp;
  if (!list || !list.length) { c.moving = false; return true; }
  const [tx, tz, tf] = list[0];
  const dx = tx - c.x, dz = tz - c.z; const d = Math.hypot(dx, dz);
  const step = c.speed * dt;
  if (d <= step) { c.x = tx; c.z = tz; if (tf !== undefined) c.floor = tf; list.shift(); }
  else { c.x += dx / d * step; c.z += dz / d * step; c.rot = Math.atan2(dx, dz); }
  c.moving = true;
  return !list.length && !(c.wp && c.wp.length) && !(c.path && c.path.length);
}

function face(c, f) {
  const cx = f.x + (f.rot % 2 === 0 ? FURNITURE[f.type].w : FURNITURE[f.type].d) / 2;
  const cz = f.z + (f.rot % 2 === 0 ? FURNITURE[f.type].d : FURNITURE[f.type].w) / 2;
  c.rot = Math.atan2(cx - c.x, cz - c.z);
}

function nearestFront(game, c, f) {
  let best = null, bd = Infinity;
  const g = game.gridOf(f.floor);
  for (const t of f._fronts || [f._front]) {
    if (!g.isInterior(t[0], t[1]) || g.isBlocked(t[0], t[1])) continue;
    const d = Math.hypot(t[0] + 0.5 - c.x, t[1] + 0.5 - c.z);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

export function returnBasket(game, c) {
  // put unpaid items back where they came from if there is room, otherwise they are lost
  for (const it of c.basket) {
    if (!it.src) continue;
    const f = game.fixture(it.src);
    if (!f || !f.slots) continue;
    const def = FURNITURE[f.type];
    const sl = f.slots.find(sl => sl.pid === it.pid && sl.qty < slotCap(f.type, it.pid) && !sl.expired) || f.slots.find(sl => sl.qty === 0 && (sl.pid === null || sl.pid === it.pid));
    if (sl) { sl.pid = it.pid; sl.qty++; if (!sl.exp) sl.exp = game.s.day + PRODUCT_MAP[it.pid].life; }
  }
  if (c.basket.length) game.dirtyWorld();
  c.basket = [];
}

function leave(game, c, reason) {
  const s = game.s;
  if (c.state === 'leaving') return;
  for (const rt of game.rt.values()) rt.queue = rt.queue.filter(id => id !== c.id);
  if (reason === 'angry') {
    returnBasket(game, c);
    c.mood = Math.min(c.mood, 12);
    say(c, '😡', 4);
    s.ledger.angry++; s.stats.angry++;
    game.sound('angry', c.x, c.z);
  } else if (reason === 'nothing') {
    say(c, c.missed ? '😞' : '🙁', 3);
    c.mood = Math.min(c.mood, 38);
    s.ledger.lost++;
  } else if (reason === 'hit') {
    returnBasket(game, c);
    c.mood = 0;
    say(c, '😵', 2);
    s.ledger.angry++; s.stats.angry++;
    s.rep = clamp(s.rep - 1.5, 0, 100);
    game.msg('Someone punched a customer! They stormed out without buying anything.', '🥊', `hit:${s.day}`);
  } else if (reason === 'nocheckout') {
    returnBasket(game, c);
    say(c, '🤷', 3);
    c.mood = Math.min(c.mood, 15);
    s.ledger.angry++;
    game.toast('A customer left because there is no checkout counter!', 'bad', '🛒');
  }
  const sat = clamp(c.mood, 0, 100);
  s.rep = clamp(s.rep + (sat - s.rep) * (c.paid ? 0.03 : reason === 'angry' || reason === 'hit' ? 0.03 : 0.012), 0, 100);
  if (c.paid) { s.ledger.served++; s.stats.customers++; }
  s.ledger.satSum += sat;
  // count every leaving customer in satisfaction average
  s.ledger.satN = (s.ledger.satN || 0) + 1;
  c.state = 'leaving'; c.path = null; c.wp = null;
  game.dirtyMeta();
}

function chooseCheckout(game, c) {
  let best = null, bs = Infinity;
  for (const f of game.s.furniture) {
    const k = FURNITURE[f.type].kind;
    if (k !== 'checkout' && k !== 'selfcheckout') continue;
    const rt = game.rt.get(f.id); if (!rt) continue;
    let score = rt.queue.length * 1.0 + Math.hypot(f.x - c.x, f.z - c.z) * 0.06 + ((f.floor || 0) !== (c.floor || 0) ? 3 : 0);
    if (k === 'checkout' && !game.operatorOf(f)) score += 2.5;
    if (k === 'selfcheckout') score += c.basket.length > 6 ? 2 : 0.6;
    if (score < bs) { bs = score; best = f; }
  }
  return best;
}

function queueIndex(game, c, f) {
  const rt = game.rt.get(f.id);
  return rt ? rt.queue.indexOf(c.id) : -1;
}

function updateQueueTarget(game, c, f) {
  const idx = queueIndex(game, c, f);
  if (idx < 0) return -1;
  const spots = f._queue || [f._front];
  const spot = spots[Math.min(idx, spots.length - 1)];
  if (!c.goal || c.goal[0] !== spot[0] || c.goal[1] !== spot[1]) {
    if (!goTo(game, c, spot[0], spot[1], f.floor || 0)) {
      goTo(game, c, f._front[0], f._front[1], f.floor || 0);
    }
  }
  return idx;
}

export function updateCustomers(game, dt, dMin) {
  const s = game.s;
  const closing = s.phase === 'closing' || s.minute >= CLOSE_HOUR * 60;
  for (const c of game.customers) {
    if (c.thoughtT > 0) { c.thoughtT -= dt; if (c.thoughtT <= 0) c.thought = ''; }
    // repath if the layout changed underneath us
    // (a shopper standing at the register stays there: they are being served)
    if (c.path && c.path.length && c.pathVer !== game.gridVersion && c.goal && c.state !== 'register') {
      if (!goTo(game, c, c.goal[0], c.goal[1], c.goal[2] || 0)) { c.path = null; c.reroute = true; }
    }
    if (c.reroute) {
      c.reroute = false;
      for (const rt of game.rt.values()) rt.queue = rt.queue.filter(id => id !== c.id);
      if (['queue', 'register', 'toCheckout'].includes(c.state)) c.state = 'toCheckout';
      else if (c.state !== 'leaving' && c.state !== 'arrive') { c.state = 'shop'; c.timer = 0.2; }
      c.path = null; c.goal = null;
    }
    const waitingStates = c.state === 'queue' || c.state === 'register' || c.state === 'counterQueue' || c.state === 'counterServe';
    if (c.state !== 'leaving' && c.state !== 'arrive') {
      // at the register patience runs slower, and barely while paying (waiting for change or the card terminal)
      c.patience -= dMin * (waitingStates ? (c.state === 'register' ? (c.due != null ? 0.1 : 0.5) : 1) : 0.12);
      if (waitingStates) {
        c.waited += dMin;
        if (c.waited > 25) c.mood -= dMin * 0.25;
        if (c.patience < 30 && !c.thoughtT) say(c, c.patience < 15 ? '😤' : '⌛', 1.5);
      }
      // litter
      if (Math.random() < 0.0015 * dMin) {
        const tx = Math.floor(c.x), tz = Math.floor(c.z);
        const nearBin = s.furniture.some(f => f.type === 'bin' && (f.floor || 0) === (c.floor || 0) && Math.abs(f.x - tx) <= 4 && Math.abs(f.z - tz) <= 4);
        if (!nearBin || Math.random() < 0.3) game.addDirt(tx, tz, Math.random() < 0.5 ? 'spill' : 'litter', c.floor || 0);
      }
    }
    if (c.patience <= 0 && c.state !== 'leaving' && c.state !== 'arrive') {
      if (c.state === 'counterQueue' || c.state === 'counterServe') {
        for (const rt of game.rt.values()) rt.queue = rt.queue.filter(id => id !== c.id);
        c.counterDone = true; c.mood -= 15; say(c, '😠', 3);
        c.patience = 40; c.state = 'shop'; c.timer = 0.3; c.path = null; c.waited = 0;
      } else if (waitingStates || c.state === 'toCheckout') {
        leave(game, c, 'angry');
      } else {
        // took too long wandering: head to checkout with what they have
        c.list = []; c.patience = 45;
      }
    }

    switch (c.state) {
      case 'arrive':
        if (walk(game, c, dt)) { c.state = 'shop'; c.timer = 0.3; c.wp = null; }
        break;

      case 'shop': {
        if (c.timer > 0) { c.timer -= dt; c.moving = false; break; }
        if (closing) c.list = [];
        // counter request first if the counter is on our way
        if (c.counterReq && !c.counterDone && !closing) {
          const counters = s.furniture.filter(f => FURNITURE[f.type].cat === c.counterReq.cat);
          if (counters.length) {
            const f = counters.reduce((a, b) => (game.rt.get(a.id)?.queue.length || 0) <= (game.rt.get(b.id)?.queue.length || 0) ? a : b);
            const rt = game.rt.get(f.id);
            if (!rt.queue.includes(c.id)) rt.queue.push(c.id);
            c.target = f.id; c.state = 'counterQueue'; c.waited = 0;
            updateQueueTarget(game, c, f);
            break;
          }
          c.counterDone = true;
        }
        if (c.list.length) {
          const pid = c.list.shift();
          const opts = s.furniture.filter(f => f.slots && f.slots.some(sl => sl.pid === pid && sl.qty > 0 && !sl.expired) && FURNITURE[f.type].kind === 'storage');
          const cost = (f) => Math.hypot(f.x - c.x, f.z - c.z) + ((f.floor || 0) !== (c.floor || 0) ? 10 : 0);
          opts.sort((a, b) => cost(a) - cost(b));
          let ok = false;
          for (const f of opts) {
            const t = nearestFront(game, c, f);
            if (t && goTo(game, c, t[0], t[1], f.floor || 0)) { c.state = 'toItem'; c.target = f.id; c.want = pid; ok = true; break; }
          }
          if (!ok) {
            const p = PRODUCT_MAP[pid];
            s.demand[pid] = (s.demand[pid] || 0) + 1;
            c.mood -= c.carried && c.carried.has(pid) ? 6 : 2; c.missed++;
            const n = s.demand[pid];
            game.msg(`${c.name}: "I couldn't find ${p.name} ${p.icon}"${n > 1 ? ` (${n} customers asked today)` : ''}`, '🗣️', `miss:${s.day}:${pid}`);
            c.timer = 0.7;
            if (c.vip === pid) { c.mood -= 15; game.toast(`The VIP couldn't find ${p.name}... 😢`, 'bad', '🕶️'); }
            game.dirtyMeta();
          }
          break;
        }
        // done shopping
        if (!c.basket.length) { leave(game, c, 'nothing'); break; }
        c.state = 'toCheckout';
        break;
      }

      case 'toItem': {
        const f = game.fixture(c.target);
        if (!f) { c.state = 'shop'; break; }
        if (walk(game, c, dt)) { c.state = 'picking'; c.timer = 1.0; face(c, f); }
        break;
      }

      case 'picking': {
        c.moving = false;
        c.timer -= dt;
        if (c.timer > 0) break;
        const f = game.fixture(c.target);
        c.state = 'shop'; c.timer = 0.25;
        if (!f || !f.slots) break;
        if (f.slots.some(sl => sl.expired && sl.qty > 0)) { c.mood -= 5; say(c, '🤢', 2); }
        const sl = f.slots.find(sl => sl.pid === c.want && sl.qty > 0 && !sl.expired);
        const p = PRODUCT_MAP[c.want];
        if (!sl) { c.list.push(c.want); c.retry = (c.retry || 0) + 1; if (c.retry > 3) c.list.pop(); break; }
        const price = game.effPrice(p.id);
        const ratio = price / p.price;
        const accept = c.vip === p.id ? 1 : ratio <= 1.0 ? 1 : Math.max(0, 1 - (ratio - 1) * 2.2 * c.sens);
        if (Math.random() > accept) {
          c.mood -= 4 + (ratio - 1) * 10; say(c, '💸', 2.2);
          break;
        }
        const n = Math.min(sl.qty, c.qty[p.id] || 1);
        sl.qty -= n;
        for (let i = 0; i < n; i++) c.basket.push({ pid: p.id, price, src: f.id });
        if (ratio < 0.85) { c.mood += 3; say(c, '🤑', 1.6); }
        else if (ratio <= 1.05) { c.mood += 1.5; }
        else c.mood -= 1;
        if (c.vip === p.id) { c.vipHappy = true; say(c, '🤩', 3); game.toast('The VIP found what they wanted! Now check them out!', 'good', '🕶️'); }
        // impulse buy from endcaps/promo
        const def = FURNITURE[f.type];
        if (def.impulse && Math.random() < def.impulse) {
          const other = f.slots.find(o => o !== sl && o.qty > 0 && !o.expired);
          if (other) { other.qty--; c.basket.push({ pid: other.pid, price: game.effPrice(other.pid), src: f.id }); say(c, '😍', 1.5); }
        }
        game.fx({ k: 'take', cid: c.id, fid: f.id, pid: p.id });
        game.dirtyWorld();
        break;
      }

      case 'counterQueue': {
        const f = game.fixture(c.target);
        if (!f) { c.counterDone = true; c.state = 'shop'; break; }
        const idx = updateQueueTarget(game, c, f);
        if (idx < 0) { c.state = 'shop'; break; }
        const p = PRODUCT_MAP[c.counterReq.pid];
        if (!c.thoughtT) { c.thought = `${p.icon}×${c.counterReq.qty}`; }
        if (walk(game, c, dt)) {
          face(c, f);
          if (idx === 0) { c.state = 'counterServe'; c.thought = `${p.icon}×${c.counterReq.qty}`; }
        }
        break;
      }
      case 'counterServe': {
        c.moving = false;
        const f = game.fixture(c.target);
        if (!f) { c.counterDone = true; c.state = 'shop'; break; }
        const p = PRODUCT_MAP[c.counterReq.pid];
        if (!c.thoughtT || c.thoughtT < 0.1) c.thought = `${p.icon}×${c.counterReq.qty}`;
        break;
      }

      case 'toCheckout': {
        const f = chooseCheckout(game, c);
        if (!f) { leave(game, c, 'nocheckout'); break; }
        const rt = game.rt.get(f.id);
        if (!rt.queue.includes(c.id)) rt.queue.push(c.id);
        c.target = f.id; c.state = 'queue'; c.waited = 0;
        updateQueueTarget(game, c, f);
        break;
      }
      case 'queue': {
        const f = game.fixture(c.target);
        if (!f) { c.state = 'toCheckout'; break; }
        const idx = updateQueueTarget(game, c, f);
        if (idx < 0) { c.state = 'toCheckout'; break; }
        if (walk(game, c, dt)) {
          face(c, f);
          if (idx === 0 && c.goal && c.goal[0] === f._front[0] && c.goal[1] === f._front[1]) {
            c.state = 'register'; c.scanned = 0; c.selfT = 0; c.due = null; c.tendered = 0;
          }
        }
        break;
      }
      case 'register': {
        c.moving = false;
        const f = game.fixture(c.target);
        if (!f) { c.state = 'toCheckout'; break; }
        if (FURNITURE[f.type].kind === 'selfcheckout') {
          c.selfT += dt;
          const per = f.upg ? 0.75 : 1.8;
          if (c.selfT >= per) {
            c.selfT = 0;
            if (c.scanned < c.basket.length) { c.scanned++; game.sound('beep', f.x, f.z); }
            else game.completeCheckout(c, f, null);
          }
        }
        // staffed checkouts are driven by players (work action) or cashiers (staff.js)
        break;
      }

      case 'leaving': {
        if (c.stunT > 0) { c.stunT -= dt; c.moving = false; break; }
        if (!c.wp && !c.path) {
          if (c.z < s.d || (c.floor || 0) > 0) {
            if (!goTo(game, c, s.doorX + (Math.random() < 0.5 ? 0 : 1), s.d - 1, 0)) { c.dead = true; break; }
          }
          c.wp = [[s.doorX + 1, s.d + 1.2, 0], [s.doorX + 1, s.d + 3.6, 0], [c.exitSide, s.d + 3.6, 0]];
          if (c.z >= s.d) c.path = [];
        }
        if (c.path && c.path.length) { walk(game, c, dt); break; }
        const list = c.wp;
        if (!list || !list.length) { c.dead = true; break; }
        const [tx, tz] = list[0];
        const dx = tx - c.x, dz = tz - c.z; const d = Math.hypot(dx, dz); const step = c.speed * dt;
        if (d <= step) { c.x = tx; c.z = tz; list.shift(); } else { c.x += dx / d * step; c.z += dz / d * step; c.rot = Math.atan2(dx, dz); }
        c.moving = true;
        if (!list.length) c.dead = true;
        break;
      }
    }
  }
  if (game.customers.some(c => c.dead)) game.customers = game.customers.filter(c => !c.dead);
}

export { leave as customerLeave };
