// End-to-end browser playthrough with real input: 2 players, computer purchases, delivery, carrying & placing
// furniture, stocking with labelled products, running the register by clicking products, punching.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-saves-'));
const { startServer, rooms } = await import('../server/index.js');
const OUT = process.env.SHOTS || './shots';
const port = 3124;
const srv = startServer(port);
const browsers = [], errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function newPage(name) {
  const browser = await chromium.launch(); browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${name}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${name}] PAGEERROR ${e.message}\n${e.stack}`));
  await page.addInitScript(() => { window.ST_NO_ONLINE = true; localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); });
  await page.goto(`http://localhost:${port}/?low`);
  await sleep(700);
  return page;
}
const G = (page, fn, arg) => page.evaluate(fn, arg);
const tp = (page, x, z, rot = 0) => page.evaluate(([x, z, rot]) => { const m = window.__dbg.me; m.x = x; m.z = z; m.rot = rot; }, [x, z, rot]);
const shot = (page, n) => page.screenshot({ path: `${OUT}/${n}.png` });
async function waitFor(page, fn, ms = 10000, arg) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await sleep(150); } throw new Error('timeout: ' + fn); }
const screenOf = (page, [x, y, z]) => page.evaluate(([x, y, z]) => { const c = window.__dbg.S.camera; const v = c.position.clone().set(x, y, z).project(c); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, y, z]);

const p1 = await newPage('p1');
await p1.fill('#m-name', 'Alice'); await p1.click('#m-create'); await sleep(500);
const code = await p1.textContent('#l-code');
const p2 = await newPage('p2');
await p2.fill('#m-name', 'Bob'); await p2.fill('#m-code', code); await p2.click('#m-join'); await sleep(500);
await p1.click('#l-start'); await sleep(900);
await p1.fill('#n-input', 'Fresh & Friends ' + (Date.now() % 1000)); await sleep(300);
await p1.click('#n-vote'); await p2.click('#n-vote');
await waitFor(p1, () => window.__G.meta.phase === 'prep');
const game = rooms.get(code).game;

// --- the computer: buy a shelf, order flour & sugar
const comp = await G(p1, () => window.__G.world.furniture.find(f => f.type === 'computer'));
await tp(p1, comp.x + 1.5, comp.z + 1, -Math.PI / 2);
await waitFor(p1, () => window.__dbg.lastInter?.action?.a === '_computer');
await p1.keyboard.press('e');
await waitFor(p1, () => !document.getElementById('panel').classList.contains('hidden'));
await shot(p1, '50-computer-orders');
await p1.click('[data-goto="furniture"]'); await sleep(300);
await shot(p1, '51-computer-furniture');
await p1.click('[data-act="buyf"][data-type="shelf"]');
await waitFor(p1, () => window.__G.meta.orders.length === 1);
await p1.click('[data-goto="orders"]'); await sleep(300);
await p1.evaluate(() => { const n = window.__dbg.net; const o = n.act.bind(n); window.__acts = []; n.act = (x, d) => { window.__acts.push([x, JSON.stringify(d)]); o(x, d); }; });
await p1.click('[data-act="qty"][data-pid="flour"][data-d="1"]');
await p1.click('[data-act="qty"][data-pid="sugar"][data-d="1"]');
await p1.click('[data-act="order"]');
await sleep(1500); console.log('order dbg', await G(p1, () => JSON.stringify({ orders: window.__G.meta.orders.length, cart: window.__dbg.ui.cart, err: document.getElementById('toast-err').textContent, panel: window.__dbg.ui.panel, btn: document.querySelector('[data-act="order"]')?.disabled, acts: window.__acts, tab: window.__dbg.ui.tab, qtyBtns: document.querySelectorAll('[data-act="qty"]').length })));
await waitFor(p1, () => window.__G.meta.orders.some(o => o.supplier === 'pantry'));
await p1.click('[data-goto="licenses"]'); await sleep(300); await shot(p1, '52-computer-licenses');
await p1.keyboard.press('Escape');
console.log('cash after shopping:', await G(p1, () => window.__G.meta.cash));
game.s.speed = 3;
await waitFor(p1, () => window.__G.world.boxes.length === 3 && !window.__G.meta.orders.length, 40000);
game.s.speed = 1;
await tp(p1, 2, game.s.d + 2.6, Math.PI); await sleep(500); await shot(p1, '53-delivery-boxes');

// --- carry the furniture box inside and place it with the mouse
const fb = await G(p1, () => window.__G.world.boxes.find(b => b.ftype));
await tp(p1, fb.x - 0.5, fb.z, Math.PI / 2);
await waitFor(p1, () => window.__dbg.lastInter?.action?.a === 'pickup');
await p1.keyboard.press('e');
await sleep(800); console.log('after pickup', await G(p1, () => JSON.stringify({ carry: window.__G.carry, inter: window.__dbg.lastInter, boxes: window.__G.world.boxes.map(b => [b.ftype || b.pid, b.x, b.z]), me: [window.__dbg.me.x, window.__dbg.me.z] })), await p1.textContent('#toast-err'));
await waitFor(p1, () => (window.__G.carry || [])[0] === 'f:shelf');
await tp(p1, 3, 4, Math.PI);
await waitFor(p1, () => window.__dbg.lastInter?.action?.a === '_place');
await p1.keyboard.press('e');
await waitFor(p1, () => window.__dbg.build.active && window.__dbg.build.placing === 'shelf');
await sleep(800);
const [sx, sy] = await screenOf(p1, [3, 0, 1.5]);
await p1.mouse.move(sx, sy); await sleep(900);
await shot(p1, '54-placing-shelf');
await p1.mouse.click(sx, sy);
await waitFor(p1, () => window.__G.world.furniture.some(f => f.type === 'shelf'));
await waitFor(p1, () => !window.__dbg.build.active);
const shelf = await G(p1, () => window.__G.world.furniture.find(f => f.type === 'shelf'));
console.log('placed shelf at', shelf.x, shelf.z, 'rot', shelf.rot);

// --- haul & stock flour and sugar
for (let i = 0; i < 2; i++) {
  const b = await G(p1, () => window.__G.world.boxes.find(b => b.pid));
  await tp(p1, b.x + 0.6, b.z, -Math.PI / 2);
  await waitFor(p1, () => window.__dbg.lastInter?.action?.a === 'pickup');
  await p1.keyboard.press('e');
  await waitFor(p1, () => (window.__G.carry || []).length === 1);
  await tp(p1, shelf.x + 1, shelf.z + 1.45, Math.PI);
  await waitFor(p1, () => window.__dbg.lastInter?.action?.a === 'stock');
  await p1.keyboard.down('e');
  await waitFor(p1, () => !(window.__G.carry || []).length, 20000);
  await p1.keyboard.up('e');
}
await tp(p1, shelf.x + 1, shelf.z + 2.2, Math.PI);
await p1.evaluate(() => { const r = window.__dbg.rig; r.dist = 4.5; r.pitch = 0.45; }); await sleep(900);
await shot(p1, '55-labelled-products');
await p1.evaluate(() => { const r = window.__dbg.rig; r.dist = 11; r.pitch = 0.95; });

// --- Bob runs the register and passes products over the scanner by clicking them
const chk = await G(p2, () => window.__G.world.furniture.find(f => f.type === 'checkout'));
await p2.bringToFront();
await tp(p2, chk.x + 0.5, chk.z - 0.5, 0);
await waitFor(p2, () => window.__dbg.lastInter?.action?.a === 'station');
await p2.keyboard.press('e');
await waitFor(p2, () => !!window.__G.station);
await p1.click('#h-open');
game.s.speed = 2;
let clicks = 0, paid = 0; const payShots = {};
for (let t = 0; t < 120 && game.s.ledger.served < 2; t++) {
  const item = await G(p2, () => { const it = window.__dbg.world.beltItems.find(m => m.visible); if (!it) return null; const v = it.getWorldPosition(it.position.clone()); return [v.x, v.y, v.z]; });
  const pay = await G(p2, () => window.__dbg.lastInter?.station?.pay ? window.__dbg.lastInter.station : null);
  if (pay) {
    // take the payment like a cashier: count change from the drawer, or type the total on the card terminal
    await p2.keyboard.press('e'); await p2.waitForSelector('.pay-wrap', { timeout: 10000 });
    if (pay.payBy === 'cash') {
      let c = Math.round((pay.tendered - pay.due) * 100);
      try { for (const d of [5000, 2000, 1000, 500, 100, 25, 10, 5, 1]) while (c >= d) { await p2.click(`.drawer [data-v="${d / 100}"]`, { timeout: 10000 }); c -= d; } }
      catch (e) {
        const cu = game.customers.find(x => x.id === pay.cid);
        console.log('drawer closed early', JSON.stringify({ pay, why: await G(p2, () => window.__dbg.ui.lastPayClose), K: await G(p2, () => window.__G.snap.K), station: await G(p2, () => window.__G.station),
          bobStation: [...game.players.values()].map(p => [p.name, p.station]), customer: cu && { state: cu.state, due: cu.due, patience: cu.patience, paid: cu.paid } }));
        throw e;
      }
      if (!payShots.cash) { payShots.cash = true; await shot(p2, '57-cash-drawer'); }
      await p2.click('[data-give]');
    } else {
      for (const ch of String(Math.round(pay.due * 100))) await p2.keyboard.press(ch);
      if (!payShots.card) { payShots.card = true; await shot(p2, '57-card-terminal'); }
      await p2.keyboard.press('Enter');
    }
    try { await p2.waitForFunction(() => !document.querySelector('.pay-wrap'), null, { timeout: 15000 }); }
    catch (e) {
      const c = game.customers.find(c => c.id === pay.cid);
      console.log('payment window still open', JSON.stringify({ pay, msg: await G(p2, () => document.querySelector('.pay-msg')?.textContent), sum: await G(p2, () => document.querySelector('.pay-sum')?.textContent),
        K: await G(p2, () => window.__G.snap.K), station: await G(p2, () => window.__G.station), customer: c && { state: c.state, due: c.due, tendered: c.tendered, payBy: c.payBy, scanned: c.scanned, n: c.basket.length } }));
      await shot(p2, '57-payment-stuck'); throw e;
    }
    paid++;
  } else if (item) { const [x, y] = await screenOf(p2, item); await p2.mouse.click(x, y); clicks++; if (clicks === 2) await shot(p2, '56-scanning'); await sleep(250); }
  else await sleep(400);
}
console.log('belt clicks', clicks, 'payments', paid, 'served', game.s.ledger.served, 'revenue', game.s.ledger.revenue);
assert.ok(game.s.ledger.served >= 1, 'Bob checked out a customer by clicking products');
assert.ok(paid >= 1, 'Bob took a payment (cash drawer or card terminal)');
// paying takes a while: keep the rest of the test inside the same day (no end-of-day report in the way)
game.s.speed = 1; game.s.minute = Math.min(game.s.minute, 13 * 60);

// --- punching: Alice punches Bob
await p1.bringToFront();
// a punch hits the nearest person in front, so step right behind Bob (shoppers in the queue can be close by)
const near = () => game.customers.filter(c => Math.hypot(c.x - bob[0], c.z - bob[1]) < 1.3).length;
const bob = await G(p2, () => [window.__dbg.me.x, window.__dbg.me.z]);
console.log('shoppers near Bob:', near());
let stunned = false;
for (let attempt = 0; attempt < 4 && !stunned; attempt++) {
  await tp(p1, bob[0], bob[1] - 0.45, 0); await sleep(700);
  await p1.keyboard.press('f');
  stunned = await (async () => { try { await waitFor(p2, () => window.__dbg.me.stunned, 3000); return true; } catch { return false; } })();
  if (!stunned) console.log('punch attempt', attempt + 1, 'hit someone else; punched customers so far', game.s.stats.punched);
}
assert.ok(stunned, 'Bob got punched');
console.log('Bob stunned ✓');
await shot(p1, '57-punch');

// --- check the computer messages tab and the chat
await tp(p1, comp.x + 1.5, comp.z + 1, -Math.PI / 2);
await waitFor(p1, () => window.__dbg.lastInter?.action?.a === '_computer');
await p1.keyboard.press('e'); await sleep(300);
await p1.click('[data-goto="messages"]'); await sleep(400);
await shot(p1, '58-messages');
const chat = await p1.textContent('#chat-log');
console.log('chat log:', chat.slice(0, 160));
assert.ok(/delivery/i.test(chat), 'deliveries are announced in the chat');
console.log('errors:', errors.length ? errors.join('\n') : 'none');
for (const b of browsers) await b.close(); srv.close(); process.exit(errors.length ? 1 : 0);
