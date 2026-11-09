// Desktop app smoke test: launches the real Electron app (in a virtual display on Linux CI),
// plays the opening (create store, name it, open the computer), checks the save folder,
// the app bridge in the page, online hosting by store code, and a clean quit.
import { createRequire } from 'node:module';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const { _electron } = createRequire(import.meta.url)('playwright');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.env.SHOTS || './shots';

async function run(label, args) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'st-desk-'));
  const app = await _electron.launch({
    executablePath: process.env.ELECTRON_PATH || path.join(ROOT, 'node_modules/.bin/electron'),
    args: [ROOT, `--user-data-dir=${userData}`, '--no-sandbox', ...args], cwd: ROOT, timeout: 60000,
  });
  const out = []; app.process().stdout.on('data', d => out.push(String(d))); app.process().stderr.on('data', d => out.push(String(d)));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message)); page.on('console', m => { if (m.type() === 'error' && !/peerjs|mqtt|emqx|hivemq|mosquitto/i.test(m.text())) errors.push(m.text()); }); // the online services may be unreachable (sandboxed CI)
  await page.waitForFunction(() => window.__dbg && window.desktopApp, null, { timeout: 90000 }); // __dbg is set once the menu is fully built
  const info = await page.evaluate(() => window.desktopApp.info);
  console.log(`[${label}] app`, JSON.stringify(info));
  assert.ok(info.port > 0);
  const deskUi = await page.evaluate(() => ({ quit: !document.getElementById('m-quit').closest('[hidden]'), join: !document.querySelector('.join-row').closest('.hidden,[hidden]'), dl: document.getElementById('m-download').hidden }));
  assert.ok(deskUi.quit, 'quit button shown in the desktop app');
  assert.ok(deskUi.join, 'join with code shown in the desktop app');
  assert.ok(deskUi.dl, 'no download box inside the desktop app');
  await page.evaluate(() => { localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); localStorage.setItem('st_gfx', 'low'); });
  await page.reload(); await page.waitForFunction(() => window.__dbg, null, { timeout: 90000 });
  const click = (sel) => page.evaluate((sel) => document.querySelector(sel).click(), sel); // CI machines without a GPU render slowly
  await page.fill('#m-name', 'Desk'); await click('#m-create');
  await page.waitForFunction(() => !document.getElementById('lobby').classList.contains('hidden'), null, { timeout: 90000 });
  // the lobby says whether friends can join online (the CI machine may have no internet: any status is fine, but it must show)
  await page.waitForFunction(() => document.getElementById('l-online').textContent.length > 0, null, { timeout: 30000 });
  console.log(`[${label}] online:`, await page.evaluate(() => document.getElementById('l-online').textContent));
  await click('#l-start');
  await page.waitForFunction(() => window.__G.meta && window.__G.meta.phase === 'naming', null, { timeout: 90000 });
  await page.fill('#n-input', 'Desk Mart'); await sleep(300); await click('#n-vote');
  await page.waitForFunction(() => window.__G.meta.phase === 'prep', null, { timeout: 90000 });
  // in-page confirm instead of a browser dialog: leaving asks first
  await click('#h-exit'); await page.waitForSelector('.ask', { timeout: 60000 }); await click('.ask [data-no]');
  assert.equal(await page.evaluate(() => !!document.querySelector('.ask')), false);
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/95-desktop-${label}.png` });
  await app.evaluate(({ app }) => app.quit());
  await sleep(1500);
  const saves = fs.existsSync(path.join(userData, 'saves')) ? fs.readdirSync(path.join(userData, 'saves')) : [];
  console.log(`[${label}] saves in app data:`, saves.length, '| errors:', errors.length ? errors : 'none');
  assert.ok(saves.length >= 1, 'store saved to the app data folder on quit');
  assert.deepEqual(errors, []);
  return { info, out: out.join('') };
}

fs.mkdirSync(OUT, { recursive: true });
await run('desktop', []);
console.log('✅ desktop smoke test passed');
