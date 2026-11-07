// Browser soak test: serves dist/artifact.html wrapped the way the artifact host wraps it, from a sub-folder,
// with DEFAULT settings (high graphics, first person, help popup) and plays a big busy store for several
// game days at 3x speed. Fails on page errors and on GPU-memory growth (geometries/textures leaking).
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const DIST = path.resolve('dist'), OUT = process.env.SHOTS || './shots', SECS = +process.env.SECS || 150;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const wrap = () => '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + fs.readFileSync(path.join(DIST, 'artifact.html'), 'utf8') + '</body></html>';
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (!u.startsWith('/art/x/')) { res.writeHead(404); return res.end(); }
  u = u.slice('/art/x'.length);
  if (u === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(wrap()); }
  fs.readFile(path.join(DIST, u), (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(u)] || 'application/octet-stream' }); res.end(d); });
}).listen(3160);
const browser = await chromium.launch({ args: ['--enable-precise-memory-info'] });
const VW = +process.env.VW || 1100, VH = Math.round(VW * 0.62);
const page = await browser.newPage({ viewport: { width: VW, height: VH } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message + '\n' + e.stack));
let expectLoss = false;
page.on('console', m => { if (m.type() === 'error' && !(expectLoss && /context|lost/i.test(m.text()))) errors.push(m.text()); });
page.on('response', r => { if (r.status() >= 400) errors.push(r.status() + ' ' + r.url()); });
page.on('crash', () => errors.push('PAGE CRASHED'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const E = (fn, a) => page.evaluate(fn, a);
const waitFor = async (fn, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await E(fn)) return; await sleep(250); } throw new Error('timeout ' + fn); };
await page.addInitScript(() => { window.ST_NO_ONLINE = true; }); // online play has its own test (browser-online)
if (process.env.LOW) await page.addInitScript(() => { try { localStorage.setItem('st_gfx', 'low'); } catch {} });
await page.goto('http://localhost:3160/art/x/'); await sleep(3000);
await page.fill('#m-name', 'Omer'); await page.click('#m-create');
await waitFor(() => !document.getElementById('lobby').classList.contains('hidden'));
await page.click('#l-start');
await waitFor(() => window.__G.meta && window.__G.meta.phase === 'naming');
await page.fill('#n-input', 'Soak Market'); await sleep(300); await page.click('#n-vote');
await waitFor(() => window.__G.meta.phase === 'prep');
// a first-time player sees the help window only now, after naming the store; close it like a player would
await waitFor(() => !document.getElementById('help').classList.contains('hidden'), 5000);
await page.click('#help-close'); await sleep(300);
const info = await E(() => ({ fps: window.__dbg.rig.fps, composer: !!window.__dbg.S.composer }));
console.log('defaults: first person', info.fps, '| post-processing', info.composer);
// build a big busy store directly in the in-browser game
await E(() => {
  const g = window.__dbg.net.room.game, F = g.s.furniture;
  const p = [...window.__dbg.net.room.players.values()][0];
  g.s.level = 10; g.s.xp = 26000; g.s.cash = 500000;
  const comp = F.find(f => f.type === 'computer'); p.x = comp.x + 1.5; p.z = comp.z + 1;
  while (g.s.expansion < 4) if (!g.act(p, { a: 'expand' })) break;
  window.__soakPlace = (type, x, z, rot = 0, floor = 0) => { if (g.gridOf(floor).canPlace(g.s.furniture, type, x, z, rot).ok) { g.s.furniture.push(g.newFixture(type, x, z, rot, floor)); g.rebuildGrid(); } };
  const P = window.__soakPlace;
  P('fridge', 2, 0); P('fridge', 4, 0); P('fridge_large', 6, 0); P('freezer_upright', 9, 0); P('butcher', 12, 0); P('deli', 16, 0);
  P('shelf', 2, 4); P('shelf', 4, 4); P('shelf_large', 6, 4); P('endcap', 9, 4); P('shelf', 2, 7, 2); P('shelf', 4, 7, 2); P('freezer', 9, 7, 1);
  P('produce', 12, 5); P('produce', 14, 5); P('checkout', 14, 10); P('checkout', 17, 10); P('selfcheckout', 20, 10); P('plant_tall', 21, 6);
  P('shelf_large', 2, 1, 0, 1); P('shelf', 6, 1, 0, 1); P('checkout', 16, 8, 0, 1);
});
await E(() => {
  const g = window.__dbg.net.room.game;
  window.__soakRestock = () => {
    const { FURNITURE, PRODUCTS } = window.__soakData;
    for (const f of g.s.furniture) { const def = FURNITURE[f.type]; if (f.slots) { const prods = PRODUCTS.filter(pr => pr.cat === def.cat); f.slots.forEach((sl, i) => { if (!sl.pid || sl.qty < 3) { sl.pid = prods[(i + f.id) % prods.length].id; sl.qty = def.cap; sl.exp = g.s.day + 30; } }); } }
    g.s.licenses = PRODUCTS.map(p => p.id); g.dirtyWorld();
  };
});
await page.addScriptTag({ type: 'module', content: "import { FURNITURE, PRODUCTS } from './shared/data.js'; window.__soakData = { FURNITURE, PRODUCTS };" });
await waitFor(() => !!window.__soakData);
await E(() => {
  const g = window.__dbg.net.room.game, p = [...window.__dbg.net.room.players.values()][0];
  window.__soakRestock();
  for (const role of ['cashier', 'cashier', 'stocker', 'cleaner', 'butcher', 'deli']) { g.s.candidates.push({ id: g.id(), name: 'Soak ' + role, role, skill: 4, speed: 1.1, salary: 80, seed: Math.floor(Math.random() * 1e6) }); g.act(p, { a: 'hire', id: g.s.candidates.at(-1).id }); }
  g.act(p, { a: 'open' }); g.s.speed = 3; g.act(p, { a: 'speed', v: 3 });
  // keep the store running across days like an active player would
  setInterval(() => { if (g.s.phase !== 'open') { window.__soakRestock(); g.s.cash = Math.max(g.s.cash, 100000); for (const b of g.s.bills || []) if (!b.paid) g.act(p, { a: 'payBill', id: b.id }); if (g.s.phase === 'report') g.act(p, { a: 'continue' }); else g.act(p, { a: 'open' }); g.act(p, { a: 'speed', v: 3 }); } }, 1000);
});
const mem = () => E(() => { const r = window.__dbg.S.renderer.info; return { geo: r.memory.geometries, tex: r.memory.textures, calls: r.render.calls, heap: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576), day: window.__G.meta.day, minute: Math.round(window.__dbg.net.room.game.s.minute), speed: window.__dbg.net.room.game.s.speed, fps: window.__fpsNow || 0, phase: window.__G.snap?.phase, cust: window.__G.snap?.C?.length || 0 }; });
await E(() => { let n = 0, t = performance.now(); (function f() { n++; const now = performance.now(); if (now - t > 2000) { window.__fpsNow = Math.round(n * 1000 / (now - t)); n = 0; t = now; } requestAnimationFrame(f); })(); });
if (process.env.PROFILE) {
  await sleep(8000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); await sleep(10000);
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) || 0) + (dt[i] || 0)));
  for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + t); }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  console.log('top self time (10s profile):'); for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${(t / 1000).toFixed(0).padStart(6)}ms ${(100 * t / total).toFixed(1).padStart(5)}%  ${k}`);
}
const samples = [];
const t0 = Date.now(); let walk = 0;
while (Date.now() - t0 < SECS * 1000 && !errors.length) {
  // move around like a player: walk, look, switch camera, open panels
  await page.keyboard.down('w'); await sleep(700); await page.keyboard.up('w');
  if (walk % 5 === 2) { await page.keyboard.press('v'); }
  if (walk % 7 === 3) { await page.keyboard.press('i'); await sleep(300); await page.keyboard.press('Escape'); }
  if (walk % 9 === 4) await E(() => { const m = window.__dbg.me; m.x = 10; m.z = 8; m.floor = 0; });
  walk++;
  await sleep(1500);
  samples.push(await mem());
}
const first = samples[Math.min(3, samples.length - 1)], last = samples.at(-1);
console.log('samples (geometries / textures / draw calls / heap MB / day / customers):');
for (const s of samples.filter((_, i) => i % 6 === 0).concat([last])) console.log(`  min ${s.minute} x${s.speed} fps ${s.fps}  geo ${s.geo}  tex ${s.tex}  calls ${s.calls}  heap ${s.heap}MB  day ${s.day} ${s.phase}  customers ${s.cust}`);
await page.screenshot({ path: `${OUT}/90-soak.png` }).catch(() => {});
// slow high graphics should have switched itself to low (headless Chromium renders in software)
if (!process.env.LOW) console.log('auto low graphics after slow frames:', await E(() => localStorage.getItem('st_gfx') === 'low'));
// the graphics card losing the 3D context: the store is saved and the game reloads in low graphics
const codeBefore = await E(() => window.__G.code); expectLoss = true;
await E(() => window.__dbg.S.renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
await page.waitForEvent('load', { timeout: 20000 });
await sleep(2500);
const after = await E((code) => ({ low: localStorage.getItem('st_gfx') === 'low', saved: !!JSON.parse(localStorage.getItem('st_local_saves') || '{}')[code], menu: !document.getElementById('menu').classList.contains('hidden') }), codeBefore);
console.log('after losing the 3D context:', JSON.stringify(after));
if (!after.low || !after.saved || !after.menu) errors.push('context loss recovery failed ' + JSON.stringify(after));
const days = last.day - samples[0].day;
console.log(`soak: ${days} game days, ${samples.length} samples`);
if (last.tex > first.tex * 1.6 + 40) errors.push(`texture leak: ${first.tex} -> ${last.tex}`);
if (last.geo > first.geo * 1.6 + 60) errors.push(`geometry leak: ${first.geo} -> ${last.geo}`);
if (last.heap > first.heap * 2.5 + 80) errors.push(`JS heap growth: ${first.heap}MB -> ${last.heap}MB`);
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close(); srv.close(); process.exit(errors.length ? 1 : 0);
