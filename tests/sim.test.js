// Headless simulation test: drives the authoritative Game through the full new-player flow without a browser.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { spawnCustomer } from '../server/customers.js';
import { PRODUCT_MAP, MAX_CUSTOMERS, licenseCost, priceLimits, EXPANSIONS, ROLES } from '../shared/data.js';

const fx = [];
const g = new Game('TEST1', null, { fx: m => fx.push(m), isNameTaken: () => false, save: () => {} });
const p = { id: 1, name: 'Tester', x: 6, z: 7, rot: 0, carry: [], station: null, floor: 0 };
g.players.set(1, p);
const act = (m) => g.act(p, m);
const lastErr = () => fx.filter(f => f.k === 'err').map(f => f.text).at(-1);
const tickFor = (sec, dt = 0.05) => { for (let t = 0; t < sec; t += dt) g.tick(dt); };
const at = (x, z, rot = 0) => { p.x = x; p.z = z; p.rot = rot; };
const computer = () => g.s.furniture.find(f => f.type === 'computer');
const atComputer = () => { const c = computer(); at(c.x + 1.5, c.z + 1); };

// --- start: empty store with a computer + checkout, $400, flour/oil/sugar licensed
assert.equal(g.s.cash, 400);
assert.deepEqual(g.s.furniture.map(f => f.type).sort(), ['checkout', 'computer']);
assert.ok(g.s.licenses.includes('flour') && g.s.licenses.includes('sugar') && g.s.licenses.includes('oil'));
act({ a: 'nameDraft', name: 'Test Mart' }); act({ a: 'nameVote' });
assert.equal(g.s.phase, 'prep');

// --- the computer is the only place to buy things
at(9, 2);
assert.equal(act({ a: 'buyFurniture', type: 'shelf' }), false); assert.match(lastErr(), /computer/);
atComputer();
assert.ok(act({ a: 'buyFurniture', type: 'shelf' }), 'buy shelf ' + lastErr());
assert.ok(act({ a: 'order', supplier: 'pantry', items: [{ pid: 'flour', boxes: 1 }, { pid: 'sugar', boxes: 1 }] }), 'order ' + lastErr());
assert.equal(act({ a: 'order', supplier: 'dairy', items: [{ pid: 'milk', boxes: 1 }] }), false, 'milk needs a license');
assert.match(lastErr(), /Unlock/);
console.log('cash after shelf + flour + sugar:', g.s.cash);
assert.ok(g.s.cash >= 0 && g.s.cash < 150, 'starting money is roughly a shelf and a few boxes');
assert.equal(act({ a: 'license', pid: 'coffee' }), false, 'coffee is level 2'); assert.ok(licenseCost(PRODUCT_MAP.milk) >= 50 && licenseCost(PRODUCT_MAP.wine) <= 200);

// --- price limits
assert.ok(act({ a: 'setPrice', pid: 'flour', price: 100 }));
assert.equal(g.s.prices.flour, priceLimits(PRODUCT_MAP.flour)[1]);
assert.ok(act({ a: 'setPrice', pid: 'flour', price: 0.01 }));
assert.equal(g.s.prices.flour, priceLimits(PRODUCT_MAP.flour)[0]);
act({ a: 'setPrice', pid: 'flour', price: 2.5 });

// --- deliveries: furniture arrives in a box that you carry and place
tickFor(45);
assert.equal(g.s.orders.length, 0);
const fbox = g.s.boxes.find(b => b.ftype === 'shelf'); assert.ok(fbox, 'furniture box delivered');
assert.ok(fx.some(f => f.k === 'delivery'));
assert.equal(act({ a: 'place', x: 2, z: 1, rot: 0 }), false, 'cannot place without carrying the box');
at(fbox.x, fbox.z); assert.ok(act({ a: 'pickup', id: fbox.id }), 'pickup furniture box ' + lastErr());
assert.ok(act({ a: 'place', x: 2, z: 1, rot: 0 }), 'place from box ' + lastErr());
const shelf = g.s.furniture.find(f => f.type === 'shelf');
for (const b of g.s.boxes.filter(b => b.pid)) {
  at(b.x, b.z); assert.ok(act({ a: 'pickup', id: b.id }));
  at(3, 2.5, Math.PI); let guard = 0; while (p.carry.length && guard++ < 10) act({ a: 'stock', id: shelf.id, n: 6 });
}
assert.equal(shelf.slots.filter(s => s.qty).length, 2, 'flour and sugar on the shelf');

// --- open, run the register by hand
const chk = g.s.furniture.find(f => f.type === 'checkout');
at(chk._back[0] + 0.5, chk._back[1] + 0.5);
assert.ok(act({ a: 'station', id: chk.id }));
assert.ok(act({ a: 'open' }));
act({ a: 'speed', v: 3 });
let maxC = 0; const payChecks = {};
for (let i = 0; i < 20 * 260 && g.s.phase !== 'report'; i++) {
  g.tick(0.05);
  maxC = Math.max(maxC, g.customers.length);
  const c = g.customerAtRegister(chk);
  if (c) {
    if (c.scanned < c.basket.length) { act({ a: 'work' }); continue; }
    const owed = Math.round((c.tendered - c.due) * 100) / 100;
    if (c.payBy === 'cash') {
      assert.ok(c.tendered >= c.due, 'cash covers the total');
      if (!payChecks.cashShort && owed > 0) {
        payChecks.cashShort = true;
        assert.equal(act({ a: 'payCash', change: owed - 0.01 }), false, 'too little change is refused'); assert.match(lastErr(), /not enough change/);
        assert.equal(act({ a: 'payCard', amount: c.due }), false, 'a cash customer does not pay by card');
      }
      if (!payChecks.cashOver && owed > 0 && payChecks.cashShort) {
        payChecks.cashOver = true; const before = g.s.cash;
        assert.ok(act({ a: 'payCash', change: owed + 1 }), 'too much change is accepted');
        assert.ok(Math.abs(g.s.cash - before - (c.due - 1)) < 0.011, 'the extra change is lost');
        continue;
      }
      act({ a: 'payCash', change: owed });
    } else {
      if (!payChecks.card) {
        payChecks.card = true;
        assert.equal(act({ a: 'payCard', amount: c.due + 1 }), false, 'wrong card amount is refused'); assert.match(lastErr(), /not paying/);
        assert.equal(act({ a: 'payCash', change: 0 }), false, 'a card customer does not pay cash');
      }
      assert.ok(act({ a: 'payCard', amount: c.due }), 'right card amount accepted ' + lastErr());
    }
  }
}
console.log('payment checks', payChecks);
assert.ok(payChecks.card && payChecks.cashShort && payChecks.cashOver, 'cash and card customers both came to the register');
const r = g.s.report;
console.log('day 1', { served: r.served, revenue: r.revenue, profit: r.profit, sat: r.avgSat, bill: r.bill, maxC, inbox: g.s.inbox.length });
assert.equal(g.s.phase, 'report');
assert.ok(r.served >= 3, 'customers served at the register');
assert.ok(maxC <= MAX_CUSTOMERS, 'never more than 15 shoppers');
assert.ok(g.s.inbox.some(m => m.icon === '🗣️'), 'missing products reported as computer messages');
assert.ok(!fx.some(f => f.k === 'toast'), 'no toasts other than level-up and delivery');
const bill = g.s.bills.find(b => !b.paid); assert.ok(bill, 'rent bill created');
act({ a: 'continue' });
atComputer();
const cashBefore = g.s.cash;
assert.ok(act({ a: 'payBill', id: bill.id }), 'pay bill ' + lastErr());
assert.equal(g.s.cash, Math.round((cashBefore - bill.total) * 100) / 100);

// --- fridges must be opened before stocking
g.s.cash = 50000; g.s.level = 10;
if (!g.licensed('milk')) assert.ok(act({ a: 'license', pid: 'milk' }));
p.carry = [{ ftype: 'fridge' }]; at(8, 3);
assert.ok(act({ a: 'place', x: 4, z: 0, rot: 0 }), 'place fridge ' + lastErr());
const fridge = g.s.furniture.find(f => f.type === 'fridge');
p.carry = [{ pid: 'milk', qty: 10, exp: 20 }]; at(5, 1.5, Math.PI);
assert.equal(act({ a: 'stock', id: fridge.id }), false); assert.match(lastErr(), /Open/);
assert.ok(act({ a: 'door', id: fridge.id })); assert.ok(fridge.open);
assert.ok(act({ a: 'stock', id: fridge.id, n: 6 }));
act({ a: 'door', id: fridge.id }); assert.equal(fridge.open, false);

// --- butcher: take from the big fridge -> cut at the station -> hand over at the counter
p.carry = [{ ftype: 'butcher' }]; at(8, 3);
assert.ok(act({ a: 'place', x: 7, z: 1, rot: 0 }) || act({ a: 'place', x: 2, z: 4, rot: 0 }), 'place butcher ' + lastErr());
const butcher = g.s.furniture.find(f => f.type === 'butcher');
g.s.minute = 9 * 60; const saveEvent = g.triggerEvent; g.triggerEvent = () => {}; // no random fridge breakdowns mid-test
butcher.slots[0] = { pid: 'ribeye', qty: 6, exp: g.s.day + 5, expired: false };
// only the test customers in the store, so random shoppers can't use up the meat or take the counter
const saveSpawn = g.updateSpawning; g.updateSpawning = () => {};
act({ a: 'open' }); g.customers.length = 0;
const bc = spawnCustomer(g); bc.list = []; bc.counterReq = { pid: 'ribeye', qty: 2, cat: 'meat' };
const sp = butcher._spots;
for (let i = 0; i < 20 * 40 && !g.customerAtCounter(butcher); i++) g.tick(0.05);
assert.ok(g.customerAtCounter(butcher), 'customer waiting at butcher');
at(...sp.fridgeSpot); assert.ok(act({ a: 'deptTake', id: butcher.id }), 'take ' + lastErr());
assert.equal(p.carry[0].dept, 'raw'); assert.equal(butcher.slots[0].qty, 4);
assert.equal(act({ a: 'deptServe', id: butcher.id }), false, 'must cut first');
at(...sp.stationSpot); for (let i = 0; i < 5; i++) act({ a: 'deptCut', id: butcher.id });
assert.equal(p.carry[0].dept, 'pack');
at(...sp.counterSpot); assert.ok(act({ a: 'deptServe', id: butcher.id }), 'serve ' + lastErr());
assert.equal(g.s.stats.butcher, 1); assert.ok(bc.basket.filter(b => b.pid === 'ribeye').length === 2);

// --- butcher employee does the same routine
p.x = 1; p.z = 8;
// staff unlock with store levels and cost a one-time recruitment fee (one day's wage)
atComputer();
const lvlBefore = g.s.level;
g.s.level = 2; g.refreshCandidates();
assert.ok(g.s.candidates.length > 0 && g.s.candidates.every(c => ROLES[c.role].level === 3), 'level 1-2: applicants preview the level-3 roles');
assert.equal(act({ a: 'hire', id: g.s.candidates[0].id }), false, 'no hiring before level 3'); assert.match(lastErr(), /not unlocked/);
g.s.level = 3; g.refreshCandidates();
const cand = g.s.candidates[0], cashKeep = g.s.cash;
g.s.cash = cand.salary - 1;
assert.equal(act({ a: 'hire', id: cand.id }), false, 'fee needs cash'); assert.match(lastErr(), /recruitment fee/);
g.s.cash = 5000;
assert.ok(act({ a: 'hire', id: cand.id }), 'hire at level 3 ' + lastErr());
assert.equal(g.s.cash, 5000 - cand.salary, 'recruitment fee = one day of wages');
assert.ok(ROLES.cashier.level === 3 && ROLES.butcher.level === 6 && ROLES.deli.level === 7 && ROLES.cashier.baseSalary >= 85);
g.s.staff = g.s.staff.filter(st => st.id !== cand.id); g.s.cash = cashKeep + 5000; g.s.level = Math.max(lvlBefore, 6);
console.log('staff levels & recruitment fee ✓');
g.s.candidates.push({ id: g.id(), name: 'Bob Butcher', role: 'butcher', skill: 4, speed: 1.2, salary: 90, seed: 2 });
assert.ok(act({ a: 'hire', id: g.s.candidates.at(-1).id }) || (atComputer(), act({ a: 'hire', id: g.s.candidates.at(-1).id })));
p.x = 1; p.z = 8;
g.customers.length = 0; g.s.minute = 10 * 60; butcher.broken = false; butcher.warm = 0; butcher.open = false; // mid-morning, so closing time can't cut the test short
butcher.slots[0] = { pid: 'ribeye', qty: 6, exp: g.s.day + 5, expired: false };
const bc2 = spawnCustomer(g); bc2.list = []; bc2.counterReq = { pid: 'ribeye', qty: 1, cat: 'meat' };
const stages = new Set();
for (let i = 0; i < 20 * 180 && g.s.stats.butcher < 2; i++) { g.tick(0.05); const st = g.s.staff[0]; if (st.task) stages.add(st.task.stage); }
console.log('butcher stages', [...stages].join(' → '));
if (g.s.stats.butcher < 2) console.log('debug', JSON.stringify({ staff: g.s.staff.map(st => ({ role: st.role, present: st.present, x: st.x, z: st.z, task: st.task })), c: g.customers.map(c => ({ state: c.state, x: c.x, z: c.z, req: c.counterReq })), slot: butcher.slots[0], minute: g.s.minute, phase: g.s.phase }));
assert.equal(g.s.stats.butcher, 2, 'butcher employee served the customer');
assert.ok(stages.has('cutting') && stages.has('taking'));

// --- punching
g.customers.length = 0; for (const st of g.s.staff) { st.x = 1; st.z = 1; } // nobody else within reach
const victim = spawnCustomer(g);
g.updateSpawning = saveSpawn; g.triggerEvent = saveEvent; victim.state = 'shop'; victim.x = 6; victim.z = 6; victim.floor = 0; victim.basket = [{ pid: 'flour', price: 2, src: shelf.id }];
at(6, 5, 0); // facing +z towards the customer
assert.ok(act({ a: 'punch' }));
assert.equal(victim.state, 'leaving', 'punched customer leaves'); assert.equal(victim.basket.length, 0, 'and buys nothing');
const p2 = { id: 2, name: 'Friend', x: 6, z: 5.9, rot: 0, carry: [{ pid: 'flour', qty: 12, exp: 99 }], station: null, floor: 0 };
g.players.set(2, p2);
await new Promise(r => setTimeout(r, 600));
at(6, 5, 0);
assert.ok(act({ a: 'punch' }));
assert.ok(p2.stunUntil > Date.now(), 'friend is dizzy'); assert.equal(p2.carry.length, 0, 'friend dropped the box');
assert.ok(fx.some(f => f.k === 'knock' && f.id === 2));
assert.equal(g.act(p2, { a: 'drop' }), false, 'stunned players cannot act');
g.players.delete(2);

// --- second floor with stairs; shoppers walk upstairs
for (let i = 0; i < 20 * 200 && g.s.phase !== 'report'; i++) { g.tick(0.05); if (g.s.phase === 'closing') { g.customers = []; } }
act({ a: 'continue' });
atComputer();
while (g.s.expansion < EXPANSIONS.length - 1) assert.ok(act({ a: 'expand' }), 'expand ' + lastErr());
assert.equal(g.s.floors, 2); assert.equal(g.grids.length, 2);
p.floor = 1; p.x = 5; p.z = 5; p.carry = [{ ftype: 'shelf' }];
assert.ok(act({ a: 'place', x: 4, z: 4, rot: 0 }), 'place upstairs ' + lastErr());
const up = g.s.furniture.find(f => f.floor === 1);
up.slots[0] = { pid: 'honey', qty: 12, exp: 99, expired: false };
if (!g.licensed('honey')) g.s.licenses.push('honey');
p.floor = 0; at(3, 10);
act({ a: 'open' });
const climber = spawnCustomer(g); climber.list = ['honey'];
let reachedUp = false;
for (let i = 0; i < 20 * 80 && !climber.basket.length; i++) { g.tick(0.05); if (climber.floor === 1) reachedUp = true; }
assert.ok(reachedUp, 'customer climbed the stairs'); assert.equal(climber.basket[0]?.pid, 'honey', 'bought the upstairs product');

// --- the baton: only with empty hands; a hit customer leaves without buying and the store's reputation drops
{
  const g3 = new Game('BATON', null, { fx: () => {}, isNameTaken: () => false, save: () => {} });
  const q = { id: 7, name: 'Q', x: 5, z: 5, rot: 0, carry: [], station: null, floor: 0 };
  const r2 = { id: 8, name: 'R', x: 5, z: 6.2, rot: 0, carry: [], station: null, floor: 0 };
  g3.players.set(7, q); g3.players.set(8, r2);
  g3.act(q, { a: 'nameDraft', name: 'Baton Mart' }); g3.act(q, { a: 'nameVote' }); g3.act(r2, { a: 'nameVote' });
  q.carry.push({ pid: 'flour', qty: 1, exp: 99 });
  assert.equal(g3.act(q, { a: 'baton' }), false, 'no baton with full hands');
  q.carry = [];
  assert.ok(g3.act(q, { a: 'baton' })); assert.equal(q.baton, true);
  // a friend 1.2 m in front (the fist would also reach), knocked down for longer
  assert.ok(g3.act(q, { a: 'punch', weapon: 'baton' }));
  assert.ok(r2.stunUntil - Date.now() > 2500, 'baton stuns a friend for about 3 s');
  // a customer 1.6 m in front: out of fist reach, inside baton reach
  r2.x = 50; q.punchAt = 0;
  const c = spawnCustomer(g3); c.state = 'shop'; c.x = 5; c.z = 6.6; c.floor = 0; c.basket = [{ pid: 'flour', price: 2.29 }];
  g3.s.rep = 60;
  assert.ok(g3.act(q, { a: 'punch', weapon: 'baton' }));
  assert.equal(c.state, 'leaving', 'the customer leaves'); assert.equal(c.basket.length, 0, 'without buying');
  assert.ok(g3.s.rep < 57, `reputation drops (now ${g3.s.rep.toFixed(1)})`);
  console.log('baton ✓ (rep', g3.s.rep.toFixed(1) + ')');
}

// --- unpaid bills lead to eviction
g.s.bills = [{ id: 999, day: g.s.day - 3, due: g.s.day - 1, items: { rent: 100, power: 10, maint: 5, late: 0 }, total: 115, paid: false }];
g.customers = []; g.endDay(); g.beginNewDay(); g.beginNewDay();
assert.equal(g.s.phase, 'bankrupt'); assert.equal(g.s.bankruptReason, 'evicted');

// --- serialization round-trip
const g2 = new Game('TEST1', JSON.parse(JSON.stringify(g.serialize())), { fx: () => {}, isNameTaken: () => false });
assert.equal(g2.s.floors, 2); assert.equal(g2.s.furniture.length, g.s.furniture.length);
g2.tick(0.05);
console.log('✅ sim test passed');
process.exit(0);
