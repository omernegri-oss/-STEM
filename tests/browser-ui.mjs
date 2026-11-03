// UI interaction test: butcher counter, build selection card, panels, events, level-up and report overlays.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-ui-'));
const { startServer, rooms } = await import('../server/index.js');
const OUT = process.env.SHOTS || './shots';
const port = 3131;
const srv = startServer(port);
const browser = await chromium.launch();
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', e => errors.push(`PAGEERROR ${e.message}\n${e.stack}`));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => localStorage.setItem('st_seen_help', '1'));
await page.goto(`http://localhost:${port}/?low`); await sleep(600);
await page.click('#m-create'); await sleep(400); await page.click('#l-start'); await sleep(600);
const code = await page.evaluate(() => window.__G.code);
const room = rooms.get(code), g = room.game, p = [...room.players.values()][0];
const E = (fn) => page.evaluate(fn);
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await E(fn)) return true; await sleep(150); } throw new Error('timeout: ' + fn); };
g.act(p, { a: 'nameDraft', name: 'UI Test ' + Date.now() % 1000 }); g.act(p, { a: 'nameVote' });
g.s.level = 6; g.s.cash = 80000;
g.act(p, { a: 'place', type: 'butcher', x: 2, z: 2, rot: 0 });
g.act(p, { a: 'place', type: 'checkout', x: 7, z: 5, rot: 0 });
const butcher = g.s.furniture.find(f => f.type === 'butcher');
butcher.slots[0] = { pid: 'ribeye', qty: 8, exp: 99, expired: false };
g.dirtyWorld();
await waitFor(() => window.__G.world.furniture.length === 2);

// --- butcher counter: player stands on the staff mat and serves a request
g.act(p, { a: 'open' });
const { spawnCustomer } = await import('../server/customers.js');
const c = spawnCustomer(g); c.counterReq = { pid: 'ribeye', qty: 2, cat: 'meat' }; c.list = [];
await page.evaluate(([x, z]) => { const m = window.__dbg.me; m.x = x; m.z = z; m.rot = 0; }, [butcher._back[0] + 0.5, butcher._back[1] + 0.5]);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'station');
await page.keyboard.press('e');
await waitFor(() => !!window.__G.station);
await waitFor(() => window.__dbg.lastInter?.station?.pid === 'ribeye', 30000);
await page.screenshot({ path: `${OUT}/40-butcher-station.png` });
await page.keyboard.down('e'); await waitFor(() => window.__G.meta.stats.butcher >= 1, 15000); await page.keyboard.up('e');
assert.equal(butcher.slots[0].qty, 6, 'two ribeyes cut and handed over');
console.log('butcher served ✓');

// --- walking away leaves the station
await page.evaluate(() => { window.__dbg.me.x += 3; });
await waitFor(() => !window.__G.station);
console.log('left station ✓');

// --- build mode: select a fixture via its card, rotate, upgrade, sell
await page.keyboard.press('b'); await sleep(300);
await page.evaluate((id) => { window.__dbg.build.selected = id; window.__dbg.build.render(); }, butcher.id);
await page.click('#buildbar [data-act="upgrade"]');
await waitFor(() => window.__G.world.furniture.find(f => f.type === 'butcher')?.upg === true);
await page.screenshot({ path: `${OUT}/41-build-selected.png` });
await page.click('#buildbar [data-act="tab"][data-v="style"]'); await sleep(200);
await page.click('#buildbar [data-act="floor"][data-v="marble"]');
await waitFor(() => window.__G.world.floor === 'marble');
await page.click('#buildbar [data-act="tab"][data-v="expand"]'); await sleep(200);
await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200);
assert.equal(await E(() => window.__dbg.build.active), false);
console.log('build card / floor ✓');

// --- prices panel: edit a price via input
await page.keyboard.press('p'); await sleep(300);
await page.fill('input[data-price="cereal"]', '5.25'); await page.keyboard.press('Tab');
await waitFor(() => window.__G.world.prices.cereal === 5.25);
await page.click('[data-act="price"][data-pid="pasta"][data-d="0.1"]');
await waitFor(() => Math.abs(window.__G.world.prices.pasta - 2.09) < 0.001);
await page.keyboard.press('Escape');
console.log('prices ✓');

// --- staff panel: hire, change shift, raise
g.s.candidates.push({ id: g.id(), name: 'Testy McTest', role: 'deli', skill: 5, speed: 1.2, salary: 99, seed: 3 }); g.dirtyMeta();
await page.keyboard.press('h'); await sleep(500);
await page.click(`[data-act="hire"][data-id="${g.s.candidates.at(-1).id}"]`);
await waitFor(() => window.__G.meta.staff.length === 1);
await sleep(500);
const sid = g.s.staff[0].id;
await page.selectOption(`select[data-shift="${sid}"]`, 'evening');
await waitFor(() => window.__G.meta.staff[0].shift === 'evening');
await page.click(`[data-act="raise"][data-id="${sid}"]`);
await waitFor(() => window.__G.meta.staff[0].salary > 99);
await page.screenshot({ path: `${OUT}/42-staff.png` });
await page.keyboard.press('Escape');
console.log('staff ✓');

// --- inventory reorder button pre-fills an order
await page.keyboard.press('i'); await sleep(400);
await page.click('[data-act="reorder"][data-pid="ribeye"]'); await sleep(300);
assert.equal(await E(() => window.__dbg.ui.panel), 'orders');
assert.ok(await E(() => (window.__dbg.ui.cart.prime || {}).ribeye >= 1), 'reorder filled the cart');
await page.click('[data-act="order"]');
await waitFor(() => window.__G.meta.orders.length === 1);
await page.keyboard.press('Escape');
console.log('reorder ✓');

// --- events: flash sale card with buttons
g.triggerEvent('sale');
await waitFor(() => !!document.getElementById('ev-yes'));
await page.click('#ev-yes');
await waitFor(() => window.__G.meta.saleActive === true);
console.log('sale event ✓');

// --- level up overlay
g.addXp(100000);
await waitFor(() => !document.getElementById('levelup').classList.contains('hidden'));
await page.screenshot({ path: `${OUT}/43-levelup.png` });
console.log('level up ✓');

// --- end of day report and "start next day"
g.customers = []; g.s.minute = 22 * 60 + 1; g.s.phase = 'closing';
await waitFor(() => window.__G.meta.phase === 'report');
await waitFor(() => !document.getElementById('report').classList.contains('hidden'));
await page.click('#r-next');
await waitFor(() => window.__G.meta.day === 2 && window.__G.meta.phase === 'prep');
console.log('report → day 2 ✓');

// --- chat + emote
await page.keyboard.press('Enter'); await page.keyboard.type('hello!'); await page.keyboard.press('Enter');
await waitFor(() => document.getElementById('chat-log').textContent.includes('hello!'));
await page.keyboard.press('1'); await sleep(300);
assert.ok(room.players.values().next().value.emote === '👋');
console.log('chat/emote ✓');

console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
