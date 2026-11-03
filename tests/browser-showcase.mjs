// Visual showcase: builds a high-level store server-side (all departments, staff, decor) and screenshots it.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-show-'));
const { startServer, rooms } = await import('../server/index.js');
const { FURNITURE, PRODUCTS, EXPANSIONS } = await import('../shared/data.js');
const OUT = process.env.SHOTS || './shots';
const port = 3130;
const srv = startServer(port);
const browser = await chromium.launch();
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
page.on('pageerror', e => errors.push(`PAGEERROR ${e.message}\n${e.stack}`));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('st_seen_help', '1'));
await page.goto(`http://localhost:${port}/${process.env.HIGH ? '' : '?low'}`); await sleep(800);
await page.fill('#m-name', 'Maya'); await page.click('#m-create'); await sleep(500);
await page.click('#l-start'); await sleep(800);
const code = await page.evaluate(() => window.__G.code);
const g = rooms.get(code).game;
const p = [...rooms.get(code).players.values()][0];
const act = (m) => { const ok = g.act(p, m); if (!ok) console.log('act failed', m.a, m.type || '', JSON.stringify(g.s.ledger).slice(0, 0)); return ok; };
act({ a: 'nameDraft', name: 'Mega Maya Market' }); act({ a: 'nameVote' });
g.s.level = 10; g.s.xp = 30000; g.s.cash = 500000;
act({ a: 'expand' }); act({ a: 'expand' });
act({ a: 'floor', id: 'wood' }); act({ a: 'wall', id: 'mint' });
const W = g.s.w, D = g.s.d; console.log('size', W, D);
const place = (type, x, z, rot = 0) => act({ a: 'place', type, x, z, rot });
// back wall: fridges & freezers
place('fridge', 0, 0); place('fridge', 2, 0); place('fridge_large', 4, 0); place('freezer_upright', 7, 0); place('freezer_upright', 9, 0);
place('butcher', 12, 1); place('deli', 16, 1);
// aisles
place('shelf', 1, 3); place('shelf', 3, 3); place('shelf_large', 5, 3); place('endcap', 8, 3);
place('shelf', 1, 6, 2); place('shelf', 3, 6, 2); place('shelf_large', 5, 6, 2);
place('freezer', 9, 5, 1); place('produce', 12, 5); place('produce', 14, 5);
place('checkout', 12, 9); place('checkout', 15, 9); place('selfcheckout', 18, 9);
place('rack', 0, 9, 1); place('plant', 19, 0); place('fountain', 17, 5); place('balloons', 11, 8); place('flowers', 1, 10);
place('vending', 19, 4); place('neon', 19, 7); place('bench', 8, 10); place('lamp', 10, 10); place('bin', 11, 11); place('statue', 6, 10);
// fill every slot with matching products
for (const f of g.s.furniture) {
  const def = FURNITURE[f.type];
  if (f.slots) {
    const prods = PRODUCTS.filter(pr => pr.cat === def.cat);
    f.slots.forEach((sl, i) => { const pr = prods[(i + f.id) % prods.length]; sl.pid = pr.id; sl.qty = Math.max(2, def.cap - ((i * 5 + f.id) % 6)); sl.exp = 99; });
  }
  if (f.boxes) f.boxes = ['cereal', 'milk', 'pizza', 'apples', 'soda', 'chips'].map(pid => ({ pid, qty: 12, exp: 99 }));
}
g.rebuildGrid(); g.dirtyWorld();
// staff of every role
const roles = ['cashier', 'cashier', 'stocker', 'cleaner', 'butcher', 'deli'];
for (const role of roles) { g.s.candidates.push({ id: g.id(), name: 'Test ' + role, role, skill: 4, speed: 1.1, salary: 80, seed: Math.floor(Math.random() * 1e6) }); act({ a: 'hire', id: g.s.candidates.at(-1).id }); }
for (let i = 0; i < 6; i++) g.spawnBox(['cereal', 'milk', 'pizza'][i % 3], 12, 99, null, null);
g.addDirt(8, 8, 'spill'); g.addDirt(4, 9, 'litter');
act({ a: 'open' });
g.s.minute = 12 * 60;
const { spawnCustomer } = await import('../server/customers.js');
for (let i = 0; i < 18; i++) spawnCustomer(g);
g.s.upgrades.carts = true; for (let i = 0; i < 4; i++) { const c = spawnCustomer(g); c.cart = true; }
// let the store run
for (let i = 0; i < 40; i++) { await sleep(250); }
const shot = async (n, fn) => { if (fn) await page.evaluate(fn); await sleep(900); await page.screenshot({ path: `${OUT}/${n}.png` }); };
await page.evaluate(([W, D]) => { const d = window.__dbg; d.me.x = W / 2; d.me.z = D / 2 + 1; d.rig.dist = 21; d.rig.pitch = 0.95; d.rig.yaw = 0.35; }, [W, D]);
await shot('30-showcase-overview');
await page.evaluate(() => { const d = window.__dbg; d.me.x = 14; d.me.z = 3.2; d.rig.dist = 8; d.rig.pitch = 0.6; d.rig.yaw = 0.2; });
await shot('31-butcher-deli');
await page.evaluate(() => { const d = window.__dbg; d.me.x = 5; d.me.z = 2.2; d.rig.dist = 7; d.rig.pitch = 0.45; d.rig.yaw = 0; });
await shot('32-aisle-fridges');
await page.evaluate(() => { const d = window.__dbg; d.me.x = 14; d.me.z = 11; d.rig.dist = 9; d.rig.pitch = 0.7; d.rig.yaw = -0.3; });
await shot('33-checkouts');
g.s.minute = 21 * 60 + 20;
await page.evaluate(([W, D]) => { const d = window.__dbg; d.me.x = W / 2; d.me.z = D + 3; d.rig.dist = 20; d.rig.pitch = 0.6; d.rig.yaw = 0; }, [W, D]);
await shot('34-night-front');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
