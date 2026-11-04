// Makes the Steam store images in steam/assets/: five 1920x1080 screenshots of a busy two-floor store,
// and every capsule size Steam asks for (header, small, main, vertical, library capsule/hero/logo).
// Usage: node tools/steam-assets.mjs   (needs Playwright + Chromium; takes a few minutes)
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'steam/assets');
fs.mkdirSync(OUT, { recursive: true });
const SRC = path.join(OUT, 'source'); fs.mkdirSync(SRC, { recursive: true });
const CAPSULES_ONLY = process.argv.includes('--capsules');
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-assets-'));
const { startServer, rooms } = await import('../server/index.js');
const { FURNITURE, PRODUCTS } = await import('../shared/data.js');
const { spawnCustomer } = await import('../server/customers.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
// the screenshots: a running game in a real browser (skipped with --capsules, which reuses steam/assets/source)
if (!CAPSULES_ONLY) {
  const srv = startServer(0, { host: '127.0.0.1', quiet: true });
  const port = await srv.ready;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => { localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); localStorage.setItem('st_gfx', 'high'); });
  page.setDefaultTimeout(240000);
  await page.goto(`http://127.0.0.1:${port}/`); await sleep(1500);
  // (software rendering in CI is slow at 1080p, so the menus are driven by script, not by mouse clicks)
  const click = (sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel);
  await page.evaluate(() => { const i = document.getElementById('m-name'); i.value = 'Maya'; i.dispatchEvent(new Event('input')); });
  await click('#m-create'); await page.waitForFunction(() => !document.getElementById('lobby').classList.contains('hidden'));
  await click('#l-start'); await page.waitForFunction(() => window.__G.meta && window.__G.meta.phase === 'naming');
  const code = await page.evaluate(() => window.__G.code);
  const g = rooms.get(code).game, p = [...rooms.get(code).players.values()][0];
  g.act(p, { a: 'nameDraft', name: 'Fresh Corner Market' }); g.act(p, { a: 'nameVote' });
  g.s.level = 10; g.s.xp = 26000; g.s.cash = 84250;
  const comp = g.s.furniture.find(f => f.type === 'computer'); p.x = comp.x + 1.5; p.z = comp.z + 1;
  while (g.s.expansion < 4) if (!g.act(p, { a: 'expand' })) break;
  g.s.licenses = PRODUCTS.map(p => p.id);
  const place = (type, x, z, rot = 0, floor = 0) => { if (g.gridOf(floor).canPlace(g.s.furniture, type, x, z, rot).ok) { g.s.furniture.push(g.newFixture(type, x, z, rot, floor)); g.rebuildGrid(); } };
  place('fridge', 2, 0); place('fridge', 4, 0); place('fridge_large', 6, 0); place('freezer_upright', 9, 0); place('butcher', 12, 0); place('deli', 16, 0);
  place('shelf', 2, 4); place('shelf', 4, 4); place('shelf_large', 6, 4); place('endcap', 9, 4); place('shelf', 2, 7, 2); place('shelf', 4, 7, 2); place('freezer', 9, 7, 1);
  place('produce', 12, 5); place('produce', 14, 5); place('checkout', 14, 10); place('checkout', 17, 10); place('selfcheckout', 20, 10);
  place('plant_tall', 21, 6); place('cactus', 19, 4); place('flowerpot', 11, 9); place('balloons', 11, 7); place('bin', 1, 11);
  place('shelf_large', 2, 1, 0, 1); place('shelf', 6, 1, 0, 1); place('shelf', 9, 1, 0, 1); place('plant', 1, 6, 0, 1); place('plant_tall', 14, 2, 0, 1); place('checkout', 16, 8, 0, 1);
  for (const f of g.s.furniture) {
    const def = FURNITURE[f.type];
    if (f.slots) { const prods = PRODUCTS.filter(pr => pr.cat === def.cat); f.slots.forEach((sl, i) => { const pr = prods[(i + f.id) % prods.length]; sl.pid = pr.id; sl.qty = def.cap; sl.exp = 99; }); }
  }
  for (const role of ['cashier', 'cashier', 'stocker', 'butcher', 'deli']) { g.s.candidates.push({ id: g.id(), name: 'Staff ' + role, role, skill: 4, speed: 1.1, salary: 80, seed: Math.floor(Math.random() * 1e6) }); g.act(p, { a: 'hire', id: g.s.candidates.at(-1).id }); }
  for (let i = 0; i < 3; i++) g.spawnBox(['cereal', 'milk', 'soda'][i], 12, 99, null, null);
  g.dirtyWorld(); g.act(p, { a: 'open' }); g.s.minute = 11 * 60;
  for (let i = 0; i < 15; i++) { const c = spawnCustomer(g); if (i % 4 === 0) c.counterReq = { pid: i % 8 ? 'ribeye' : 'gouda', qty: 1, cat: i % 8 ? 'meat' : 'deli' }; }
  await sleep(20000); // let shoppers spread through the aisles

  const hud = (on) => page.evaluate((on) => { for (const id of ['topbar', 'dock', 'chat', 'toast-err', 'lookhint', 'crosshair']) { const el = document.getElementById(id); if (el) el.style.visibility = on ? '' : 'hidden'; } document.querySelectorAll('#hud > *').forEach(el => { if (!on && el.id !== 'game') el.style.visibility = 'hidden'; if (on) el.style.visibility = ''; }); }, on);
  const view = (o) => page.evaluate((o) => { const d = window.__dbg; d.rig.fps = !!o.fps; Object.assign(d.me, { x: o.x, z: o.z, floor: o.f || 0 }); if (o.fps) { d.rig.yaw = o.yaw; d.rig.look = o.look || 0; } else Object.assign(d.rig, { dist: o.dist, pitch: o.pitch, yaw: o.yaw }); }, o);
  const shot = async (file, o, { ui = true, clip } = {}) => { await view(o); await hud(ui); await sleep(2500); await page.screenshot({ path: path.join(OUT, file), clip }); console.log('  ' + file); };

  // no floating money, confetti or pings in the store pictures
  await page.evaluate(() => { const f = window.__dbg.fx; f.float = () => {}; f.burst = () => {}; f.ping = () => {}; for (const it of f.items) it.obj.visible = false; });
  console.log('screenshots:');
  await shot('screenshot-1-store.png', { x: 12, z: 7, dist: 21, pitch: 0.95, yaw: 0.25 });
  await shot('screenshot-2-butcher-deli.png', { x: 15.5, z: 4.4, dist: 7.5, pitch: 0.5, yaw: 0.15 });
  await shot('screenshot-3-fridges.png', { fps: true, x: 5, z: 2.6, yaw: 0.25, look: -0.05 });
  await shot('screenshot-4-checkout.png', { fps: true, x: 15.5, z: 9.2, yaw: 0, look: -0.42 });
  await shot('screenshot-5-upstairs.png', { x: 9, z: 5, f: 1, dist: 17, pitch: 0.9, yaw: 0.2 });
  // clean backgrounds for the capsules (no interface)
  await shot('../assets/source/background.png', { x: 12, z: 6.5, dist: 16, pitch: 0.62, yaw: 0.35 }, { ui: false });
  await page.setViewportSize({ width: 1920, height: 620 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await shot('../assets/source/hero.png', { x: 12, z: 6.5, dist: 14, pitch: 0.42, yaw: 0.3 }, { ui: false });
  srv.close();
}

// ------------------------------------------------------------------ capsules
const bg = 'data:image/png;base64,' + fs.readFileSync(path.join(SRC, 'background.png')).toString('base64');
const icon = fs.readFileSync(path.join(ROOT, 'build/icon.svg'), 'utf8');
const art = await browser.newPage();
const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fredoka:wght@600;700&family=Nunito:wght@800&display=swap">';
const logo = (size, tagline, extra = '') => `<div class="logo" style="font-size:${size}px;${extra}"><div class="mark">${icon.replace('<svg ', `<svg width="${size * 1.15}" height="${size * 1.15}" `)}</div><div><div class="word">Supermarket</div>${tagline ? `<div class="tag" style="font-size:${size * 0.28}px">Build it. Stock it. Run it. Together.</div>` : ''}</div></div>`;
const css = `*{box-sizing:border-box}body{margin:0;overflow:hidden;font-family:Fredoka,Nunito,system-ui,sans-serif}
.cap{position:relative;overflow:hidden;background:#7c2d12 url(${bg}) center/cover no-repeat}
.cap::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(15,23,42,0) 30%,rgba(15,23,42,.55) 100%),linear-gradient(90deg,rgba(234,88,12,.55),rgba(234,88,12,0) 60%)}
.logo{position:absolute;z-index:2;display:flex;align-items:center;gap:.28em}
.word{font-weight:700;color:#fff;line-height:.95;letter-spacing:.01em;-webkit-text-stroke:.06em #9a3412;paint-order:stroke fill;text-shadow:0 .06em 0 #9a3412,0 .12em .25em rgba(0,0,0,.35)}
.tag{font-family:Nunito,system-ui,sans-serif;font-weight:800;color:#fff;margin-top:.35em;text-shadow:0 2px 6px rgba(0,0,0,.5)}
.mark svg{display:block;filter:drop-shadow(0 .05em .1em rgba(0,0,0,.35))}`;
async function capsule(file, w, h, inner, { transparent = false, cls = 'cap' } = {}) {
  await art.setViewportSize({ width: w, height: h });
  await art.setContent(`<html><head>${FONTS}<style>${css}</style></head><body style="width:${w}px;height:${h}px;${transparent ? 'background:transparent' : ''}"><div class="${cls}" style="width:${w}px;height:${h}px;position:relative">${inner}</div></body></html>`);
  await art.evaluate(() => document.fonts.ready); await sleep(300);
  await art.screenshot({ path: path.join(OUT, file), omitBackground: transparent });
  console.log('  ' + file);
}
console.log('capsules:');
await capsule('header-capsule-920x430.png', 920, 430, `<div style="position:absolute;left:44px;bottom:40px">${logo(92, true, 'position:static')}</div>`);
await capsule('small-capsule-462x174.png', 462, 174, `<div style="position:absolute;inset:0;display:grid;place-items:center">${logo(60, false, 'position:static')}</div>`);
await capsule('main-capsule-1232x706.png', 1232, 706, `<div style="position:absolute;left:64px;bottom:60px">${logo(128, true, 'position:static')}</div>`);
await capsule('vertical-capsule-748x896.png', 748, 896, `<div style="position:absolute;left:0;right:0;bottom:70px;display:grid;justify-items:center">${logo(96, true, 'position:static;flex-direction:column;text-align:center')}</div>`);
await capsule('library-capsule-600x900.png', 600, 900, `<div style="position:absolute;left:0;right:0;bottom:80px;display:grid;justify-items:center">${logo(84, false, 'position:static;flex-direction:column;text-align:center')}</div>`);
await capsule('library-logo-1280x720.png', 1280, 720, `<div style="position:absolute;inset:0;display:grid;place-items:center">${logo(170, false, 'position:static')}</div>`, { transparent: true, cls: '' });
// library hero: the store with no text, at 3840x1240
await art.setViewportSize({ width: 1920, height: 620 });
const hero = 'data:image/png;base64,' + fs.readFileSync(path.join(SRC, 'hero.png')).toString('base64');
const heroPage = await browser.newPage({ viewport: { width: 3840, height: 1240 } });
await heroPage.setContent(`<html><body style="margin:0"><img src="${hero}" style="width:3840px;height:1240px;display:block;image-rendering:auto"></body></html>`);
await heroPage.screenshot({ path: path.join(OUT, 'library-hero-3840x1240.png') }); console.log('  library-hero-3840x1240.png');
await browser.close();
console.log('done: steam/assets');
process.exit(0);
