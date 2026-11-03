// Headless simulation test: drives the authoritative Game through the full new-player flow without a browser.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { spawnCustomer } from '../server/customers.js';
import { PRODUCT_MAP, MAX_CUSTOMERS, licenseCost, priceLimits, EXPANSIONS } from '../shared/data.js';

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
let maxC = 0;
for (let i = 0; i < 20 * 260 && g.s.phase !== 'report'; i++) {
  g.tick(0.05);
  maxC = Math.max(maxC, g.customers.length);
  if (g.customerAtRegister(chk)) act({ a: 'work' });
}
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
butcher.slots[0] = { pid: 'ribeye', qty: 6, exp: 99, expired: false };
act({ a: 'open' });
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
g.s.candidates.push({ id: g.id(), name: 'Bob Butcher', role: 'butcher', skill: 4, speed: 1.2, salary: 90, seed: 2 });
assert.ok(act({ a: 'hire', id: g.s.candidates.at(-1).id }) || (atComputer(), act({ a: 'hire', id: g.s.candidates.at(-1).id })));
p.x = 1; p.z = 8;
const bc2 = spawnCustomer(g); bc2.list = []; bc2.counterReq = { pid: 'ribeye', qty: 1, cat: 'meat' };
const stages = new Set();
for (let i = 0; i < 20 * 90 && g.s.stats.butcher < 2; i++) { g.tick(0.05); const st = g.s.staff[0]; if (st.task) stages.add(st.task.stage); }
console.log('butcher stages', [...stages].join(' → '));
assert.equal(g.s.stats.butcher, 2, 'butcher employee served the customer');
assert.ok(stages.has('cutting') && stages.has('taking'));

// --- punching
const victim = spawnCustomer(g); victim.state = 'shop'; victim.x = 6; victim.z = 6; victim.floor = 0; victim.basket = [{ pid: 'flour', price: 2, src: shelf.id }];
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
