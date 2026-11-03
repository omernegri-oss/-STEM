// Headless simulation test: drives the authoritative Game through a full business day without a browser.
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { FURNITURE, PRODUCT_MAP } from '../shared/data.js';

const fx = [];
const g = new Game('TEST1', null, { fx: m => fx.push(m), isNameTaken: () => false, save: () => {} });
const p = { id: 1, name: 'Tester', x: 6, z: 7, rot: 0, carry: [], station: null };
g.players.set(1, p);
const act = (m) => g.act(p, m);
const errs = () => fx.filter(f => f.k === 'err').map(f => f.text);
const tickFor = (sec, dt = 0.05) => { for (let t = 0; t < sec; t += dt) g.tick(dt); };

// --- naming
assert.equal(g.s.phase, 'naming');
assert.equal(act({ a: 'place', type: 'shelf', x: 1, z: 1, rot: 0 }), false, 'cannot build before naming');
act({ a: 'nameDraft', name: 'Test Mart' });
act({ a: 'nameVote' });
assert.equal(g.s.phase, 'prep'); assert.equal(g.s.name, 'Test Mart');

// --- building
const cash0 = g.s.cash;
assert.ok(act({ a: 'place', type: 'shelf', x: 1, z: 1, rot: 0 }), 'place shelf ' + errs());
assert.ok(act({ a: 'place', type: 'shelf', x: 4, z: 1, rot: 0 }), 'place shelf 2 ' + errs());
assert.ok(act({ a: 'place', type: 'fridge', x: 8, z: 1, rot: 0 }), 'place fridge ' + errs());
assert.ok(act({ a: 'place', type: 'checkout', x: 8, z: 5, rot: 0 }), 'place checkout ' + errs());
assert.ok(act({ a: 'place', type: 'rack', x: 0, z: 6, rot: 1 }), 'place rack ' + errs());
assert.equal(act({ a: 'place', type: 'shelf', x: 1, z: 1, rot: 0 }), false, 'overlap rejected');
assert.equal(act({ a: 'place', type: 'shelf', x: g.s.doorX, z: g.s.d - 1, rot: 0 }), false, 'door blocked rejected');
assert.equal(act({ a: 'place', type: 'freezer', x: 1, z: 4, rot: 0 }), false, 'locked furniture rejected');
assert.equal(g.s.cash, cash0 - 250 * 2 - 700 - 500 - 200);
// move & rotate
const shelf2 = g.s.furniture[1];
assert.ok(act({ a: 'move', id: shelf2.id, x: 4, z: 2, rot: 2 }), 'move ' + errs());
assert.equal(shelf2.rot, 2);
assert.ok(act({ a: 'move', id: shelf2.id, x: 4, z: 1, rot: 0 }));

// --- ordering
assert.ok(act({ a: 'order', supplier: 'pantry', items: [{ pid: 'cereal', boxes: 2 }, { pid: 'pasta', boxes: 1 }, { pid: 'chips', boxes: 1 }, { pid: 'soda', boxes: 2 }] }), 'order ' + errs());
assert.ok(act({ a: 'order', supplier: 'dairy', items: [{ pid: 'milk', boxes: 2 }, { pid: 'yogurt', boxes: 1 }] }), 'order dairy ' + errs());
assert.equal(act({ a: 'order', supplier: 'dairy', items: [{ pid: 'cereal', boxes: 3 }] }), false, 'wrong supplier rejected');
assert.equal(g.s.orders.length, 2);
tickFor(45);
assert.equal(g.s.orders.length, 0, 'orders delivered');
assert.equal(g.s.boxes.length, 9, 'boxes on delivery pad');
assert.ok(fx.some(f => f.k === 'delivery'));

// --- carrying & stocking
const shelfA = g.s.furniture[0], shelfB = g.s.furniture[1], fridge = g.s.furniture[2];
function haul(box, target) {
  p.x = box.x; p.z = box.z;
  assert.ok(act({ a: 'pickup', id: box.id }), 'pickup ' + errs());
  let guard = 0;
  while (p.carry.length && guard++ < 20) { if (!act({ a: 'stock', id: target.id, n: 4 })) break; }
}
for (const b of [...g.s.boxes]) {
  const prod = PRODUCT_MAP[b.pid];
  if (prod.cat === 'fridge') haul(b, fridge);
  else haul(b, ['cereal', 'pasta'].includes(b.pid) ? shelfA : shelfB);
  if (p.carry.length) act({ a: 'drop' });
}
// wrong category
const milkLeft = g.s.boxes.find(b => b.pid === 'milk');
assert.ok(shelfA.slots.some(s => s.pid === 'cereal' && s.qty > 0), 'cereal stocked');
assert.ok(fridge.slots.some(s => s.pid === 'milk' && s.qty > 0), 'milk stocked in fridge');
console.log('shelfA', shelfA.slots.map(s => `${s.pid}:${s.qty}`).join(' '), '| shelfB', shelfB.slots.map(s => `${s.pid}:${s.qty}`).join(' '), '| fridge', fridge.slots.map(s => `${s.pid}:${s.qty}`).join(' '));
console.log('leftover boxes', g.s.boxes.length, milkLeft ? 'milk box left' : '');
// category mismatch check
g.s.boxes.length && (p.x = g.s.boxes[0].x, p.z = g.s.boxes[0].z);
const testBox = g.spawnBox('milk', 10, 10, p.x, p.z);
act({ a: 'pickup', id: testBox.id });
fx.length = 0;
assert.equal(act({ a: 'stock', id: shelfA.id }), false);
assert.ok(errs()[0].includes('Refrigerated'), 'category error: ' + errs()[0]);
act({ a: 'rackPut', id: g.s.furniture[4].id });
assert.equal(g.s.furniture[4].boxes.length, 1, 'box into rack');

// --- staff
const cashierCand = g.s.candidates.find(c => c.role === 'cashier') || (g.s.candidates[0].role = 'cashier', g.s.candidates[0]);
assert.ok(act({ a: 'hire', id: cashierCand.id }), 'hire ' + errs());
g.s.candidates.push({ id: g.id(), name: 'Stock Bot', role: 'stocker', skill: 3, speed: 1.1, salary: 60, seed: 5 });
assert.ok(act({ a: 'hire', id: g.s.candidates[g.s.candidates.length - 1].id }));
g.s.candidates.push({ id: g.id(), name: 'Clean Bot', role: 'cleaner', skill: 3, speed: 1.1, salary: 60, seed: 6 });
act({ a: 'hire', id: g.s.candidates[g.s.candidates.length - 1].id }); // cleaner locked at level 1 -> rejected
assert.equal(g.s.staff.length, 2);

// --- open the store and simulate a day at 3x speed
p.x = 3; p.z = 7;
assert.ok(act({ a: 'open' }));
act({ a: 'speed', v: 3 });
let maxCust = 0, sawRegister = false, sawStockerCarry = false;
for (let i = 0; i < 20 * 200 && g.s.phase !== 'report'; i++) {
  g.tick(0.05);
  maxCust = Math.max(maxCust, g.customers.length);
  if (g.customers.some(c => c.state === 'register')) sawRegister = true;
  if (g.s.staff.some(s => s.carry)) sawStockerCarry = true;
}
const L = g.s.report;
console.log('report', L && { revenue: L.revenue, served: L.served, customers: L.customers, angry: L.angry, lost: L.lost, profit: L.profit, avgSat: L.avgSat, rep: Math.round(g.s.rep), xp: g.s.xp, level: g.s.level });
console.log('max concurrent customers', maxCust, 'demand', JSON.stringify(g.s.demand));
assert.equal(g.s.phase, 'report', 'day ended');
assert.ok(L.customers > 20, 'customers came');
assert.ok(L.served > 5, 'customers served by cashier');
assert.ok(L.revenue > 30, 'made revenue');
assert.ok(sawRegister, 'customers reached register');
assert.ok(g.s.achievements.first_sale);
assert.ok(L.salaries > 0 && L.rent > 0 && L.power > 0);

// --- next day + expiry
act({ a: 'continue' });
assert.equal(g.s.phase, 'prep'); assert.equal(g.s.day, 2);

// --- player-operated checkout & counters at high level
g.s.level = 6; g.s.cash = 50000;
assert.ok(act({ a: 'place', type: 'butcher', x: 1, z: 4, rot: 0 }) || act({ a: 'place', type: 'butcher', x: 2, z: 4, rot: 0 }), 'butcher ' + errs());
const butcher = g.s.furniture.find(f => f.type === 'butcher');
p.carry = [{ pid: 'ribeye', qty: 6, exp: 10 }];
p.x = butcher._front[0] + 0.5; p.z = butcher._front[1] + 0.5;
while (p.carry.length && act({ a: 'stock', id: butcher.id, n: 6 })) {}
assert.ok(butcher.slots.some(s => s.pid === 'ribeye' && s.qty === 6), 'butcher stocked');
// fire cashier so player has to work; put player at checkout
g.s.staff = g.s.staff.filter(s => s.role !== 'cashier');
const chk = g.s.furniture.find(f => f.type === 'checkout');
act({ a: 'open' });
p.x = chk._back[0] + 0.5; p.z = chk._back[1] + 0.5;
assert.ok(act({ a: 'station', id: chk.id }), 'take station');
// force a butcher-request customer
const { spawnCustomer } = await import('../server/customers.js');
const bc = spawnCustomer(g); bc.counterReq = { pid: 'ribeye', qty: 2, cat: 'meat' }; bc.list = ['cereal'];
let served = 0, butcherServed = false;
const p2 = { id: 2, name: 'Butch', x: butcher._back[0] + 0.5, z: butcher._back[1] + 0.5, rot: 0, carry: [], station: null };
g.players.set(2, p2);
assert.ok(g.act(p2, { a: 'station', id: butcher.id }), 'butcher station');
for (let i = 0; i < 20 * 120; i++) {
  g.tick(0.05);
  if (g.customerAtRegister(chk)) { act({ a: 'work' }); }
  if (g.customerAtCounter(butcher)) { g.act(p2, { a: 'work' }); butcherServed = true; }
  served = g.s.ledger.served;
  if (served >= 3 && g.s.stats.butcher > 0) break;
}
console.log('player-served customers', served, 'butcher served', g.s.stats.butcher, 'playerCheckouts', g.s.stats.playerCheckouts);
assert.ok(g.s.stats.playerCheckouts >= 1, 'player checked out customers');
assert.ok(g.s.stats.butcher >= 1 && butcherServed, 'player served butcher customer');

// --- events
for (const t of ['rush', 'delay', 'breakdown', 'shortage', 'holiday', 'vip', 'sale', 'inspector', 'heatwave', 'influencer', 'pigeon', 'absence']) g.triggerEvent(t);
const broken = g.s.furniture.find(f => f.broken);
assert.ok(broken, 'breakdown event broke something');
for (let i = 0; i < 6; i++) act({ a: 'repair', id: broken.id });
assert.equal(broken.broken, false, 'repaired by hand');
assert.ok(g.s.dirt.length > 0, 'pigeon mess');
const d = g.s.dirt[0]; p.x = d.x; p.z = d.z;
for (let i = 0; i < 3; i++) act({ a: 'clean', id: d.id });
assert.ok(!g.s.dirt.includes(d), 'cleaned');
assert.ok(act({ a: 'sale', accept: true }));
assert.ok(g.s.saleActive);

// --- expansion & upgrades
act({ a: 'leaveStation' }); g.act(p2, { a: 'leaveStation' });
g.s.phase = 'prep';
const w0 = g.s.w;
assert.ok(act({ a: 'expand' }), 'expand ' + errs());
assert.ok(g.s.w > w0);
assert.ok(act({ a: 'buyUpgrade', id: 'handtruck' }));
assert.equal(g.carryCap(), 3);
assert.ok(act({ a: 'upgradeFixture', id: chk.id }));
assert.ok(act({ a: 'floor', id: 'wood' }));
assert.ok(act({ a: 'setPrice', pid: 'cereal', price: 4.5 }));
assert.equal(g.s.prices.cereal, 4.5);

// --- serialization round-trip
const saved = JSON.parse(JSON.stringify(g.serialize()));
const g2 = new Game('TEST1', saved, { fx: () => {}, isNameTaken: () => false });
assert.equal(g2.s.name, 'Test Mart'); assert.equal(g2.s.furniture.length, g.s.furniture.length);
g2.tick(0.05);
console.log('✅ sim test passed');
process.exit(0);
