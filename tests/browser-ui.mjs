// UI interaction test: butcher routine with real keys, fridge doors, build card, computer tabs (prices, staff,
// bills, messages / flash sale), level-up chat line, report -> next day.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-ui-'));
const { startServer, rooms } = await import('../server/index.js');
const { deptSpots } = await import('../shared/grid.js');
const OUT = process.env.SHOTS || './shots';
const port = 3131;
const srv = startServer(port);
const browser = await chromium.launch();
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
page.on('pageerror', e => errors.push(`PAGEERROR ${e.message}\n${e.stack}`));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); });
await page.goto(`http://localhost:${port}/?low`); await sleep(600);
await page.click('#m-create'); await sleep(400); await page.click('#l-start'); await sleep(600);
const code = await page.evaluate(() => window.__G.code);
const room = rooms.get(code), g = room.game, p = [...room.players.values()][0];
const E = (fn) => page.evaluate(fn);
const waitFor = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await E(fn)) return true; await sleep(150); } throw new Error('timeout: ' + fn); };
const tp = (x, z, rot = 0) => page.evaluate(([x, z, rot]) => { const m = window.__dbg.me; m.x = x; m.z = z; m.rot = rot; }, [x, z, rot]);
g.act(p, { a: 'nameDraft', name: 'UI Test ' + Date.now() % 1000 }); g.act(p, { a: 'nameVote' });
g.s.level = 6; g.s.cash = 80000;
const put = (type, x, z, rot = 0) => { g.s.furniture.push(g.newFixture(type, x, z, rot, 0)); g.rebuildGrid(); g.dirtyWorld(); return g.s.furniture.at(-1); };
const butcher = put('butcher', 2, 1, 0);
const fridge = put('fridge', 7, 0, 0);
butcher.slots[0] = { pid: 'ribeye', qty: 8, exp: 99, expired: false };
await waitFor(() => window.__G.world.furniture.length === 4);

// --- fridge doors: open with E, then stock, then close
p.carry = [{ pid: 'milk', qty: 10, exp: 99 }];
await tp(fridge.x + 1, fridge.z + 1.45, Math.PI);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'door');
await page.keyboard.press('e');
await waitFor(() => window.__G.world.furniture.find(f => f.type === 'fridge').open);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'stock');
await page.keyboard.down('e'); await waitFor(() => !(window.__G.carry || []).length, 15000); await page.keyboard.up('e');
await page.screenshot({ path: `${OUT}/70-fridge-open.png` });
await waitFor(() => window.__dbg.lastInter?.action?.a === 'door');
await page.keyboard.press('e');
await waitFor(() => !window.__G.world.furniture.find(f => f.type === 'fridge').open);
console.log('fridge door ✓');

// --- butcher: fridge -> station -> counter with real keys
g.act(p, { a: 'open' });
const { spawnCustomer } = await import('../server/customers.js');
const c = spawnCustomer(g); c.counterReq = { pid: 'ribeye', qty: 2, cat: 'meat' }; c.list = [];
const sp = deptSpots(butcher);
await tp(...sp.counterSpot, 0);
await waitFor(() => (window.__G.snap?.N || []).some(n => n[1]), 40000);
await tp(...sp.fridgeSpot, Math.PI);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'deptTake');
await page.screenshot({ path: `${OUT}/71-butcher-fridge.png` });
await page.keyboard.press('e');
await waitFor(() => (window.__G.carry || [])[0] === 'raw:ribeye');
await tp(...sp.stationSpot, Math.PI);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'deptCut');
await page.keyboard.down('e'); await waitFor(() => (window.__G.carry || [])[0] === 'pack:ribeye', 15000); await page.keyboard.up('e');
await tp(...sp.counterSpot, 0);
await waitFor(() => window.__dbg.lastInter?.action?.a === 'deptServe');
await page.screenshot({ path: `${OUT}/72-butcher-serve.png` });
await page.keyboard.press('e');
await waitFor(() => window.__G.meta.stats.butcher >= 1);
assert.equal(butcher.slots[0].qty, 6);
console.log('butcher routine ✓');

// --- build card: pack the fridge into a box
await tp(9, 5); await page.keyboard.press('b'); await sleep(300);
await page.evaluate((id) => { window.__dbg.build.selected = id; window.__dbg.build.render(); }, fridge.id);
await page.click('#buildbar [data-act="pack"]');
await waitFor(() => window.__G.world.boxes.some(b => b.ftype === 'fridge'));
await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
console.log('pack into box ✓');

// --- computer tabs
const comp = g.s.furniture.find(f => f.type === 'computer');
await tp(comp.x + 1.5, comp.z + 1, -Math.PI / 2);
await waitFor(() => window.__dbg.lastInter?.action?.a === '_computer');
await page.keyboard.press('e'); await sleep(300);
await page.click('[data-goto="prices"]'); await sleep(300);
await page.fill('input[data-price="flour"]', '99'); await page.keyboard.press('Tab');
await waitFor(() => window.__G.world.prices.flour === 4.58);
console.log('price max limit ✓');
g.s.candidates.push({ id: g.id(), name: 'Testy McTest', role: 'deli', skill: 5, speed: 1.2, salary: 99, seed: 3 }); g.dirtyMeta();
await page.click('[data-goto="staff"]'); await sleep(500);
await page.click(`[data-act="hire"][data-id="${g.s.candidates.at(-1).id}"]`);
await waitFor(() => window.__G.meta.staff.length === 1);
console.log('hire ✓');
g.triggerEvent('sale');
await page.click('[data-goto="messages"]'); await sleep(500);
await page.screenshot({ path: `${OUT}/73-messages-sale.png` });
await page.evaluate(() => document.querySelector('[data-act="sale"][data-v="1"]').click()); // the panel refreshes while the game runs
await waitFor(() => window.__G.meta.saleActive === true);
console.log('flash sale via messages ✓');

// --- level up appears in chat
g.addXp(8000);
await waitFor(() => /store level \d+/i.test(document.getElementById('chat-log').textContent));
console.log('level-up chat ✓');

// --- report, then pay the bill on the computer
g.customers = []; g.s.minute = 22 * 60 + 1; g.s.phase = 'closing';
await waitFor(() => window.__G.meta.phase === 'report');
await waitFor(() => !document.getElementById('report').classList.contains('hidden'));
await page.click('#r-next');
await waitFor(() => window.__G.meta.day === 2);
await page.keyboard.press('Escape'); await sleep(200);
await waitFor(() => window.__dbg.lastInter?.action?.a === '_computer');
await page.keyboard.press('e'); await sleep(300);
await page.click('[data-goto="bills"]'); await sleep(400);
await page.screenshot({ path: `${OUT}/74-bills.png` });
await page.click('[data-act="paybill"]');
await waitFor(() => window.__G.meta.bills.every(b => b.paid));
console.log('bill paid ✓');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
