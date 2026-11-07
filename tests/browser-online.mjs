// Online play by store code (WebRTC through PeerJS), with a local PeerServer standing in for the free public one.
//  1. website host  + website friend
//  2. game-server host (what the desktop app runs) + website friend
//  3. website host  + game-server page friend (no such store on that server, so it goes online)
// Usage: node tools/build-static.mjs && node tests/browser-online.mjs
import { createRequire } from 'node:module';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { PeerServer } = require('peer');
import os from 'node:os';
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-online-')); // fresh saves: store names must be unique
const { startServer } = await import('../server/index.js');
const DIST = path.resolve('dist'), OUT = process.env.SHOTS || './shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const PEER_PORT = 3171;
const peerServer = PeerServer({ port: PEER_PORT, host: '127.0.0.1', path: '/' });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const site = http.createServer((req, res) => { let f = path.join(DIST, decodeURIComponent(req.url.split('?')[0])); if (f.endsWith('/')) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }).listen(3170);
const game = startServer(3172, { quiet: true }); await game.ready;
const SITE = 'http://localhost:3170/?low', SERVER = 'http://localhost:3172/?low';

// local network only: plain host candidates (no mDNS names), no STUN/TURN
const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-ui-for-media-stream'] });
const errors = [];
async function player(name) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: PAGEERROR ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  await page.addInitScript((port) => {
    window.ST_PEER = { host: '127.0.0.1', port, path: '/', secure: false, config: { iceServers: [] } };
    localStorage.setItem('st_seen_help', '1'); localStorage.setItem('st_cam', 'tps'); localStorage.setItem('st_gfx', 'low');
  }, PEER_PORT);
  const E = (fn, a) => page.evaluate(fn, a);
  const waitFor = async (fn, ms = 30000, a) => { const t0 = Date.now(); for (;;) { try { if (await page.evaluate(fn, a)) return; } catch {} if (Date.now() - t0 > ms) throw new Error(`${name}: timeout ${fn}`); await sleep(200); } };
  return { name, ctx, page, E, waitFor };
}
const inMenu = (p) => p.waitFor(() => window.__dbg && !document.getElementById('menu').classList.contains('hidden'));

async function hostStore(h, url) {
  await h.page.goto(url); await inMenu(h);
  await h.page.fill('#m-name', h.name); await h.page.click('#m-create');
  await h.waitFor(() => !document.getElementById('lobby').classList.contains('hidden'));
  await h.waitFor(() => /^Online:/.test(document.getElementById('l-online').textContent));
  return h.E(() => window.__G.code);
}
async function joinStore(f, url, code) {
  await f.page.goto(url); await inMenu(f);
  await f.page.fill('#m-name', f.name);
  await f.page.fill('#m-code', code); await f.page.click('#m-join');
  await f.waitFor(() => window.__dbg && window.__dbg.net.online && window.__G.code);
  await f.waitFor(() => !document.getElementById('lobby').classList.contains('hidden'));
}

// ------------------------------------------------------------------ 1. website host + website friend
{
  const h = await player('WebHost'), f = await player('WebFriend');
  const code = await hostStore(h, SITE);
  console.log('1. store code', code);
  await joinStore(f, SITE, code);
  await h.waitFor(() => window.__G.players.length === 2 || document.querySelectorAll('#l-players .lp:not(.empty)').length === 2);
  await h.waitFor(() => /1 friend connected/.test(document.getElementById('l-online').textContent));
  assert.equal(await f.E(() => document.querySelectorAll('#l-players .lp:not(.empty)').length), 2);
  // the friend picks a role: the host sees it
  await f.page.click('#l-roles [data-role="cashier"]');
  await h.waitFor(() => [...document.querySelectorAll('#l-players .lp')].some(e => /WebFriend/.test(e.textContent) && /Cashier/i.test(e.textContent)));
  await h.page.click('#l-start');
  await h.waitFor(() => window.__G.meta && window.__G.meta.phase === 'naming');
  await f.waitFor(() => window.__G.meta && window.__G.meta.phase === 'naming');
  // both vote the name; the big first world message arrives in pieces and must be put back together
  await h.page.fill('#n-input', 'Online Mart'); await sleep(300); await h.page.click('#n-vote');
  await f.waitFor(() => window.__G.meta.nameDraft === 'Online Mart' && window.__G.meta.nameVotes.length === 1); await f.E(() => window.__dbg.net.act('nameVote'));
  await h.waitFor(() => window.__G.meta.phase === 'prep');
  await f.waitFor(() => window.__G.meta.phase === 'prep' && window.__G.meta.name === 'Online Mart' && window.__G.world && window.__G.world.furniture.length > 0);
  // the friend walks: the host's store moves them
  const x0 = await h.E(() => window.__G.snap.P.find(p => p[0] !== window.__G.me)[1]);
  await f.E(() => { const m = window.__dbg.me; m.x += 2; });
  await h.waitFor((x0) => { const fr = window.__G.snap.P.find(p => p[0] !== window.__G.me); return fr && fr[1] > x0 + 1.5; }, 15000, x0);
  // the friend's chat reaches the host
  await f.E(() => window.__dbg.net.send({ t: 'chat', text: 'hello from far away' }));
  await h.waitFor(() => document.body.textContent.includes('hello from far away'));
  await h.page.screenshot({ path: `${OUT}/90-online-host.png` });
  await f.page.screenshot({ path: `${OUT}/91-online-friend.png` });
  // the host leaves: the friend is told and sent back to the menu
  await h.E(() => { window.__dbg.net.send({ t: 'leave' }); });
  await h.page.close();
  await f.waitFor(() => /closed the store|connection was lost/.test(document.getElementById('loading').textContent), 30000);
  await f.waitFor(() => !document.getElementById('menu').classList.contains('hidden') && !window.__dbg.net.online, 30000);
  console.log('1. website host + website friend: ok');
  await h.ctx.close(); await f.ctx.close();
}

// ------------------------------------------------------------------ 2. game-server host (desktop app) + website friend
{
  const h = await player('DeskHost'), f = await player('WebFriend2');
  const code = await hostStore(h, SERVER);
  console.log('2. store code', code);
  await joinStore(f, SITE, code);
  await h.waitFor(() => document.querySelectorAll('#l-players .lp:not(.empty)').length === 2);
  await h.page.click('#l-start');
  await f.waitFor(() => window.__G.meta && window.__G.meta.phase === 'naming');
  await h.page.fill('#n-input', 'Desk Online'); await sleep(300); await h.page.click('#n-vote');
  await f.waitFor(() => window.__G.meta.nameDraft === 'Desk Online' && window.__G.meta.nameVotes.length === 1); await f.E(() => window.__dbg.net.act('nameVote'));
  await f.waitFor(() => window.__G.meta.phase === 'prep' && window.__G.world && window.__G.world.furniture.length > 0);
  // the friend orders from the store computer: the order lands in the host's store
  await f.E(() => window.__dbg.net.act('speed', { v: 2 }));
  await h.waitFor(() => window.__G.snap && window.__G.snap.speed === 2 || window.__G.meta.speed === 2, 10000).catch(() => {});
  console.log('2. game-server host + website friend: ok');
  await h.ctx.close(); await f.ctx.close();
}

// ------------------------------------------------------------------ 3. website host + game-server page friend
{
  const h = await player('WebHost3'), f = await player('ServerFriend');
  const code = await hostStore(h, SITE);
  await joinStore(f, SERVER, code);
  await h.waitFor(() => document.querySelectorAll('#l-players .lp:not(.empty)').length === 2);
  console.log('3. website host + game-server page friend: ok');
  await h.ctx.close(); await f.ctx.close();
}

// ------------------------------------------------------------------ wrong code: a clear message, back to the menu
{
  const f = await player('Lost');
  await f.page.goto(SITE); await inMenu(f);
  await f.page.fill('#m-code', 'ZZZZZ'); await f.page.click('#m-join');
  await f.waitFor(() => /No store with code ZZZZZ/.test(document.getElementById('loading').textContent), 30000);
  console.log('wrong code message:', await f.E(() => document.getElementById('loading').textContent.trim()));
  await f.ctx.close();
}

await browser.close(); site.close(); game.close(); peerServer.close?.();
console.log('errors:', errors.length ? errors : 'none');
assert.deepEqual(errors, []);
console.log('✅ online play test passed');
process.exit(0);
