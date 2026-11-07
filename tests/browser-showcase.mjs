// Visual showcase: builds a level-10, two-floor store server-side (all departments, staff, decor) and screenshots it.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-show-'));
const { startServer, rooms } = await import('../server/index.js');
const { FURNITURE, PRODUCTS } = await import('../shared/data.js');
const OUT = process.env.SHOTS || './shots';
const port = 3130;
const srv = startServer(port);
const browser = await chromium.launch();
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
page.on('pageerror', e => errors.push(`PAGEERROR ${e.message}\n${e.stack}`));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { window.ST_NO_ONLINE = true; localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); });
await page.goto(`http://localhost:${port}/${process.env.HIGH ? '' : '?low'}`); await sleep(800);
await page.fill('#m-name', 'Maya'); await page.click('#m-create'); await sleep(500);
await page.click('#l-start'); await sleep(800);
const code = await page.evaluate(() => window.__G.code);
const g = rooms.get(code).game;
const p = [...rooms.get(code).players.values()][0];
g.act(p, { a: 'nameDraft', name: 'Mega Maya Market' }); g.act(p, { a: 'nameVote' });
g.s.level = 10; g.s.xp = 26000; g.s.cash = 500000;
const comp = g.s.furniture.find(f => f.type === 'computer');
p.x = comp.x + 1.5; p.z = comp.z + 1;
while (g.s.expansion < 4) if (!g.act(p, { a: 'expand' })) break;
console.log('size', g.s.w, g.s.d, 'floors', g.s.floors);
g.s.licenses = PRODUCTS.map(p => p.id);
const place = (type, x, z, rot = 0, floor = 0) => {
  const res = g.gridOf(floor).canPlace(g.s.furniture, type, x, z, rot);
  if (!res.ok) { console.log('cannot place', type, x, z, res.reason); return; }
  g.s.furniture.push(g.newFixture(type, x, z, rot, floor)); g.rebuildGrid();
};
// ground floor
place('fridge', 2, 0); place('fridge', 4, 0); place('fridge_large', 6, 0); place('freezer_upright', 9, 0);
place('butcher', 12, 0); place('deli', 16, 0);
place('shelf', 2, 4); place('shelf', 4, 4); place('shelf_large', 6, 4); place('endcap', 9, 4);
place('shelf', 2, 7, 2); place('shelf', 4, 7, 2); place('freezer', 9, 7, 1);
place('produce', 12, 5); place('produce', 14, 5);
place('checkout', 14, 10); place('checkout', 17, 10); place('selfcheckout', 20, 10);
place('rack', 0, 9, 1); place('plant_tall', 21, 6); place('cactus', 19, 4); place('flowerpot', 11, 9); place('balloons', 11, 7); place('bin', 1, 11);
// upstairs
place('shelf_large', 2, 1, 0, 1); place('shelf', 6, 1, 0, 1); place('shelf', 9, 1, 0, 1); place('fountain', 9, 6, 0, 1);
place('plant', 1, 6, 0, 1); place('plant_tall', 14, 2, 0, 1); place('flowers', 4, 6, 0, 1); place('bench', 12, 8, 0, 1); place('checkout', 16, 8, 0, 1);
for (const f of g.s.furniture) {
  const def = FURNITURE[f.type];
  if (f.slots) { const prods = PRODUCTS.filter(pr => pr.cat === def.cat); f.slots.forEach((sl, i) => { const pr = prods[(i + f.id) % prods.length]; sl.pid = pr.id; sl.qty = Math.max(2, def.cap - ((i * 5 + f.id) % 6)); sl.exp = 99; }); }
  if (f.boxes) f.boxes = ['cereal', 'milk', 'pizza', 'apples', 'soda', 'chips'].map(pid => ({ pid, qty: 12, exp: 99 }));
}
g.dirtyWorld();
for (const role of ['cashier', 'cashier', 'stocker', 'cleaner', 'butcher', 'deli']) { g.s.candidates.push({ id: g.id(), name: 'Test ' + role, role, skill: 4, speed: 1.1, salary: 80, seed: Math.floor(Math.random() * 1e6) }); g.act(p, { a: 'hire', id: g.s.candidates.at(-1).id }); }
for (let i = 0; i < 4; i++) g.spawnBox(['cereal', 'milk', 'pizza', 'ribeye'][i], 12, 99, null, null);
g.spawnFBox('plant', null, null);
g.act(p, { a: 'open' });
g.s.minute = 12 * 60;
const { spawnCustomer } = await import('../server/customers.js');
for (let i = 0; i < 15; i++) { const c = spawnCustomer(g); if (i % 3 === 0) c.counterReq = { pid: i % 2 ? 'ribeye' : 'gouda', qty: 1, cat: i % 2 ? 'meat' : 'deli' }; }
await sleep(14000);
const view = (o) => page.evaluate((o) => { const d = window.__dbg; Object.assign(d.me, { x: o.x, z: o.z, floor: o.f || 0 }); Object.assign(d.rig, { dist: o.dist, pitch: o.pitch, yaw: o.yaw }); }, o);
const shot = async (n, o) => { await view(o); await sleep(1100); await page.screenshot({ path: `${OUT}/${n}.png` }); };
await shot('60-overview-ground', { x: 12, z: 7, dist: 23, pitch: 1.0, yaw: 0.25 });
await shot('61-butcher-deli', { x: 15.5, z: 4.6, dist: 7.5, pitch: 0.55, yaw: 0.15 });
await shot('62-butcher-closeup', { x: 13.5, z: 1.6, dist: 4.2, pitch: 0.35, yaw: 0.3 });
await shot('63-stairs', { x: 21.5, z: 7, dist: 9, pitch: 0.6, yaw: -0.7 });
await shot('64-upstairs', { x: 9, z: 5, f: 1, dist: 18, pitch: 0.95, yaw: 0.2 });
await shot('65-front-sign', { x: 9, z: 16, dist: 16, pitch: 0.35, yaw: 0 });
// first-person views
const fps = (o) => page.evaluate((o) => { const d = window.__dbg; d.rig.fps = true; Object.assign(d.me, { x: o.x, z: o.z, floor: 0 }); d.rig.yaw = o.yaw; d.rig.look = o.look || 0; }, o);
const fshot = async (n, o) => { await fps(o); await sleep(1300); await page.screenshot({ path: `${OUT}/${n}.png` }); };
await fshot('66-fps-aisle', { x: 3, z: 6.2, yaw: Math.PI / 2 + 0.25, look: -0.12 });
await fshot('67-fps-butcher', { x: 13.5, z: 4.2, yaw: 0.05, look: -0.2 });
await fshot('68-fps-checkout', { x: 15.5, z: 9.2, yaw: 0.0, look: -0.45 });
await fshot('69-fps-fridges', { x: 5, z: 2.6, yaw: 0.25, look: -0.05 });
console.log('customers upstairs:', g.customers.filter(c => c.floor === 1).length, 'total', g.customers.length);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
