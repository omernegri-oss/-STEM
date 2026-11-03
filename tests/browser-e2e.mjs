// End-to-end browser playthrough: 2 players, build, order, haul boxes, stock, open, serve, end of day.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-saves-'));
const { startServer } = await import('../server/index.js');
const OUT = process.env.SHOTS || './shots';
const port = 3124;
const srv = startServer(port);
const browsers = [];
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newPage(name) {
  const browser = await chromium.launch(); browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] PAGEERROR ${e.message}\n${e.stack}`));
  await page.addInitScript(() => localStorage.setItem('st_seen_help', '1'));
  await page.goto(`http://localhost:${port}/?low`);
  await sleep(700);
  return page;
}
const act = (page, a, data = {}) => page.evaluate(([a, d]) => window.__dbg.net.act(a, d), [a, data]);
const tp = (page, x, z, rot = 0) => page.evaluate(([x, z, rot]) => { const m = window.__dbg.me; m.x = x; m.z = z; m.rot = rot; }, [x, z, rot]);
const G = (page, fn) => page.evaluate(fn);
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });

const p1 = await newPage('p1');
await p1.fill('#m-name', 'Alice'); await p1.click('#m-create'); await sleep(600);
const code = await p1.textContent('#l-code');
const p2 = await newPage('p2');
await p2.fill('#m-name', 'Bob'); await p2.fill('#m-code', code); await p2.click('#m-join'); await sleep(600);
console.log('p2 state', await G(p2, () => JSON.stringify({code: window.__G.code, err: document.getElementById('toast-err').textContent, lobby: document.getElementById('lobby').className, menu: document.getElementById('menu').className})), code);
await p2.click('#l-roles button[data-role="cashier"]'); await sleep(300);
await shot(p1, '10-lobby');
await p1.click('#l-start'); await sleep(1200);
await p1.fill('#n-input', 'Fresh & Friends'); await sleep(300);
await p1.click('#n-vote'); await sleep(300); console.log('votes1', await G(p1, () => JSON.stringify([window.__G.meta.nameVotes, window.__G.meta.nameDraft, window.__G.players.map(p=>p.id)])));
await p2.click('#n-vote'); await sleep(1200); console.log('votes2', await G(p2, () => JSON.stringify([window.__G.meta.nameVotes, window.__G.meta.phase, document.getElementById('toast-err').textContent])));

// Build mode via keyboard + UI click
await p1.bringToFront(); await p1.keyboard.press('b'); await sleep(400);
console.log('dbg', await G(p1, () => ({ phase: window.__G.meta.phase, build: window.__dbg.build.active, ae: document.activeElement.tagName + '#' + document.activeElement.id, hud: document.getElementById('hud').className })));
await p1.click('#buildbar [data-act="pick"][data-v="shelf"]'); await sleep(300);
await p1.mouse.move(500, 380); await sleep(400);
await shot(p1, '11-build-ghost');
// place via protocol for determinism
for (const [type, x, z, rot] of [['shelf', 1, 1, 0], ['shelf', 4, 1, 0], ['fridge', 8, 0, 0], ['produce', 1, 4, 0], ['checkout', 8, 5, 0], ['rack', 10, 2, 3], ['plant', 0, 7, 0], ['bin', 11, 7, 0]]) {
  await act(p1, 'place', { type, x, z, rot }); await sleep(120);
}
await sleep(500);
await p1.keyboard.press('Escape'); await sleep(100); await p1.keyboard.press('Escape'); await sleep(300);
console.log('build still active?', await G(p1, () => window.__dbg.build.active));
console.log('furniture', await G(p1, () => window.__G.world.furniture.map(f => f.type).join(',')));

// Orders panel
await p1.keyboard.press('o'); await sleep(400);
await p1.click('[data-act="qty"][data-pid="cereal"][data-d="1"]');
await p1.click('[data-act="qty"][data-pid="cereal"][data-d="1"]');
await p1.click('[data-act="qty"][data-pid="pasta"][data-d="1"]');
await p1.click('[data-act="qty"][data-pid="chips"][data-d="1"]');
await p1.click('[data-act="qty"][data-pid="soda"][data-d="1"]');
await sleep(200);
await shot(p1, '12-orders');
await p1.click('[data-act="order"]'); await sleep(300);
await act(p1, 'order', { supplier: 'dairy', items: [{ pid: 'milk', boxes: 2 }, { pid: 'yogurt', boxes: 1 }, { pid: 'eggs', boxes: 1 }] });
await p1.keyboard.press('Escape'); await sleep(200);
await act(p1, 'speed', { v: 3 });
await sleep(14000);
await act(p1, 'speed', { v: 1 });
const nBoxes = await G(p1, () => window.__G.world.boxes.length);
console.log('boxes delivered', nBoxes);
await tp(p1, 3, 10.6, Math.PI); await sleep(500);
await shot(p1, '13-delivery');

// Haul boxes with real key presses: pick up (E) at the box, then stock at the right fixture
async function waitFor(page, fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await G(page, fn)) return true; await sleep(150); }
  return false;
}
async function haulAll(page) {
  for (let guard = 0; guard < 14; guard++) {
    const info = await G(page, () => { const W = window.__G.world; const tops = W.boxes.filter(b => b.y === Math.max(...W.boxes.filter(o => Math.abs(o.x - b.x) < 0.3 && Math.abs(o.z - b.z) < 0.3).map(o => o.y))); const b = tops[0]; return b ? { id: b.id, x: b.x, z: b.z, pid: b.pid } : null; });
    if (!info) return;
    await tp(page, info.x + 0.5, info.z, -Math.PI / 2);
    await waitFor(page, () => window.__dbg.lastInter?.action?.a === 'pickup');
    await page.keyboard.press('e');
    if (!await waitFor(page, () => (window.__G.carry || []).length > 0)) { console.log('pickup failed', info); continue; }
    const target = await G(page, () => { const W = window.__G.world; const pid = window.__G.carry[0]; const cat = { cereal: 'shelf', pasta: 'shelf', chips: 'shelf', soda: 'shelf', milk: 'fridge', yogurt: 'fridge', eggs: 'fridge' }[pid]; const f = W.furniture.find(f => f.type === cat && f.slots.some(s => s.qty === 0 || (s.pid === pid && s.qty < 10))); return f ? { x: f.x, z: f.z } : null; });
    if (!target) { await page.keyboard.press('q'); await waitFor(page, () => !(window.__G.carry || []).length); continue; }
    await tp(page, target.x + 1, target.z + 1.45, Math.PI);
    await waitFor(page, () => window.__dbg.lastInter?.action?.a === 'stock');
    await page.keyboard.down('e');
    await waitFor(page, () => !(window.__G.carry || []).length || window.__dbg.lastInter?.action?.a !== 'stock', 15000);
    await page.keyboard.up('e');
    if ((await G(page, () => (window.__G.carry || []).length))) { await page.keyboard.press('q'); await waitFor(page, () => !(window.__G.carry || []).length); }
  }
}
await p1.bringToFront(); await sleep(200);
await haulAll(p1);
await sleep(500);
const fill = await G(p1, () => window.__G.world.furniture.filter(f => f.slots).map(f => f.type + ':' + f.slots.map(s => (s.pid || '-') + s.qty).join('/')).join('  '));
console.log('stock', fill);
await tp(p1, 6, 6.5, Math.PI); await sleep(600);
await shot(p1, '14-stocked');

// Bob runs the register
const chk = await G(p2, () => { const f = window.__G.world.furniture.find(f => f.type === 'checkout'); return { x: f.x, z: f.z }; });
await p2.bringToFront(); await tp(p2, chk.x + 0.5, chk.z - 0.5, 0);
await waitFor(p2, () => window.__dbg.lastInter?.action?.a === 'station');
await p2.keyboard.press('e'); await waitFor(p2, () => !!window.__G.station);
console.log('bob station', await G(p2, () => window.__G.station));
await p1.click('#h-open'); await sleep(300);
await act(p1, 'speed', { v: 3 });
let served = 0;
for (let t = 0; t < 40; t++) {
  await p2.keyboard.down('e'); await sleep(450); await p2.keyboard.up('e');
  if (t === 14) { await shot(p2, '15-checkout'); await act(p1, 'speed', { v: 3 }); }
  served = await G(p1, () => window.__G.meta.ledger.served);
}
console.log('served by Bob:', served, 'revenue', await G(p1, () => window.__G.meta.ledger.revenue));
await p1.bringToFront(); await tp(p1, 6, 4, Math.PI); await sleep(300);
await shot(p1, '16-busy-store');
// panels
for (const [k, n] of [['h', '17-staff'], ['f', '18-finance'], ['k', '19-progress'], ['p', '20-prices'], ['i', '21-inventory'], ['u', '22-upgrades']]) {
  await p1.keyboard.press(k); await sleep(500); await shot(p1, n); await p1.keyboard.press('Escape'); await sleep(150);
}
// hire a cashier and finish day fast
const cid = await G(p1, () => window.__G.meta.candidates.find(c => c.role === 'cashier')?.id);
if (cid) await act(p1, 'hire', { id: cid });
await p2.evaluate(() => { window.__dbg.me.x = 3; window.__dbg.me.z = 7; });
for (let i = 0; i < 120; i++) { const ph = await G(p1, () => window.__G.snap.phase); if (ph === 'report') break; await sleep(1000); }
await sleep(800);
await shot(p1, '23-report');
console.log('phase', await G(p1, () => window.__G.snap.phase), 'report', JSON.stringify(await G(p1, () => { const r = window.__G.meta.report; return r && { revenue: r.revenue, served: r.served, profit: r.profit, avgSat: r.avgSat }; })));
console.log('errors:', errors.length ? errors.join('\n') : 'none');
for (const b of browsers) await b.close(); srv.close(); process.exit(errors.length ? 1 : 0);
