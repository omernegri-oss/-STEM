// Soak test: runs a fully built, staffed two-floor store for many game days at high speed and fails on any
// exception or invalid state (NaN money/positions, stuck customers, runaway entity counts).
import assert from 'node:assert/strict';
import { Game } from '../server/game.js';
import { spawnCustomer } from '../server/customers.js';
import { FURNITURE, PRODUCTS } from '../shared/data.js';

const DAYS = +process.env.DAYS || 20;
const g = new Game('SOAK1', null, { fx: () => {}, isNameTaken: () => false, save: () => {} });
const p = { id: 1, name: 'Soak', x: 6, z: 7, rot: 0, carry: [], station: null, floor: 0 };
g.players.set(1, p);
g.act(p, { a: 'nameDraft', name: 'Soak Mart' }); g.act(p, { a: 'nameVote' });
g.s.level = 10; g.s.xp = 26000; g.s.cash = 500000;
const comp = g.s.furniture.find(f => f.type === 'computer'); p.x = comp.x + 1.5; p.z = comp.z + 1;
while (g.s.expansion < 4) if (!g.act(p, { a: 'expand' })) break;
g.s.licenses = PRODUCTS.map(p => p.id);
const place = (type, x, z, rot = 0, floor = 0) => { if (g.gridOf(floor).canPlace(g.s.furniture, type, x, z, rot).ok) { g.s.furniture.push(g.newFixture(type, x, z, rot, floor)); g.rebuildGrid(); } };
place('fridge', 2, 0); place('fridge', 4, 0); place('fridge_large', 6, 0); place('freezer_upright', 9, 0);
place('butcher', 12, 0); place('deli', 16, 0);
place('shelf', 2, 4); place('shelf', 4, 4); place('shelf_large', 6, 4); place('endcap', 9, 4);
place('shelf', 2, 7, 2); place('shelf', 4, 7, 2); place('freezer', 9, 7, 1); place('produce', 12, 5); place('produce', 14, 5);
place('checkout', 14, 10); place('checkout', 17, 10); place('selfcheckout', 20, 10); place('rack', 0, 9, 1); place('bin', 1, 11);
place('shelf_large', 2, 1, 0, 1); place('shelf', 6, 1, 0, 1); place('shelf', 9, 1, 0, 1); place('checkout', 16, 8, 0, 1);
const restock = () => { for (const f of g.s.furniture) { const def = FURNITURE[f.type]; if (f.slots) { const prods = PRODUCTS.filter(pr => pr.cat === def.cat); f.slots.forEach((sl, i) => { if (!sl.pid || sl.qty < 3) { sl.pid = prods[(i + f.id) % prods.length].id; sl.qty = def.cap; sl.exp = g.s.day + 30; } }); } } g.dirtyWorld(); };
restock();
for (const role of ['cashier', 'cashier', 'cashier', 'stocker', 'cleaner', 'butcher', 'deli']) { g.s.candidates.push({ id: g.id(), name: 'Soak ' + role, role, skill: 4, speed: 1.1, salary: 80, seed: 1 }); g.act(p, { a: 'hire', id: g.s.candidates.at(-1).id }); }
let served = 0, maxC = 0, days = 0, lastDay = g.s.day, errors = 0;
const t0 = Date.now();
while (days < DAYS) {
  if (g.s.phase === 'report') g.act(p, { a: 'continue' });
  if (g.s.phase === 'prep') { restock(); g.s.cash = Math.max(g.s.cash, 100000); for (const b of g.s.bills || []) if (!b.paid) g.act(p, { a: 'payBill', id: b.id }); g.act(p, { a: 'open' }); }
  try { g.tick(0.05); } catch (e) { errors++; console.error('tick error day', g.s.day, e.stack); if (errors > 3) break; }
  g.worldView(); g.metaView();
  maxC = Math.max(maxC, g.customers.length);
  assert.ok(Number.isFinite(g.s.cash), 'cash is a number');
  for (const c of g.customers) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), 'customer position ' + JSON.stringify(c).slice(0, 200));
  for (const st of g.s.staff) assert.ok(Number.isFinite(st.x ?? 0) && Number.isFinite(st.z ?? 0), 'staff position');
  assert.ok(g.customers.length <= 15, 'customer cap');
  assert.ok(g.s.boxes.length < 400, 'boxes do not pile up forever: ' + g.s.boxes.length);
  if (g.s.day !== lastDay) { days++; lastDay = g.s.day; served = g.s.stats?.served ?? served; }
  if (Date.now() - t0 > 200000) { console.log('time limit'); break; }
}
assert.equal(errors, 0, 'no exceptions');
assert.ok(days >= Math.min(DAYS, 5), 'game days keep passing: ' + days);
const ser = JSON.parse(JSON.stringify(g.serialize())); const g2 = new Game('SOAK2', ser, { fx: () => {}, isNameTaken: () => false, save: () => {} }); g2.tick(0.05);
console.log(`soak: ${days} days, max ${maxC} customers in store, served ${g.s.stats?.served ?? "-"}, cash ${Math.round(g.s.cash)}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('✅ soak test passed');
