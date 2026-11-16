// Supermarket server: static file hosting + WebSocket multiplayer rooms.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { Persistence } from './persistence.js';
import { TICK_RATE, MAX_PLAYERS } from '../shared/data.js';
import { cspFor } from './csp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 3000;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// desktop builds ship three.js in vendor/three (see tools/prepare-desktop.mjs); otherwise use node_modules
const VENDOR = path.join(ROOT, 'vendor', 'three');
const HAS_VENDOR = fs.existsSync(path.join(VENDOR, 'build', 'three.module.js'));
const STATIC = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/vendor/', HAS_VENDOR ? path.join(VENDOR, 'build') : path.join(ROOT, 'node_modules', 'three', 'build')],
  ['/lib/', path.join(ROOT, 'node_modules', 'peerjs', 'dist')],
  ['/addons/', HAS_VENDOR ? path.join(VENDOR, 'addons') : path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')],
  ['/', path.join(ROOT, 'client')],
];

// limits: one misbehaving client must not be able to take the server down
const MAX_MESSAGE_BYTES = 64 * 1024;  // the largest real message (an order) is a few hundred bytes
const MAX_CONNECTIONS = 400;
const MAX_ROOMS = 200;
const MSG_PER_SECOND = 60, MSG_BURST = 240; // per connection; the game sends about 15 a second
const CODE = /^[A-Z0-9]{4,8}$/;

const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
const notFound = (res) => { res.writeHead(404, SECURITY_HEADERS); res.end('Not found'); };

// A page on another website must not be able to talk to this server through the player's browser:
//  - a server bound to this computer only (the desktop app) answers only when addressed as this computer, which
//    stops a hostile site that points its own name at 127.0.0.1;
//  - a WebSocket opened by a web page must come from a page this server served.
const LOCAL_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostName = (h) => String(h || '').toLowerCase().replace(/:\d+$/, '');
function allowedRequest(req, localOnly) {
  const host = String(req.headers.host || '').toLowerCase();
  if (localOnly && !LOCAL_NAMES.has(hostName(host))) return false;
  const origin = req.headers.origin;
  if (origin === undefined || !req.headers.upgrade) return true; // not a browser, or a plain page request
  let o; try { o = new URL(origin).host.toLowerCase(); } catch { return false; }
  return o === host || (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase()).includes(o);
}

function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' }); res.end(); return; }
  let url;
  try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return notFound(res); } // malformed %-escape
  if (url.includes('\0')) return notFound(res);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break; // never outside the folder (also not a sibling such as client-old/)
    fs.readFile(file, (err, data) => {
      if (err) return notFound(res);
      const type = MIME[path.extname(file)] || 'application/octet-stream';
      const headers = { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache' };
      if (type.startsWith('text/html')) headers['Content-Security-Policy'] = cspFor(data.toString('utf8')) + "; frame-ancestors 'self'";
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return;
  }
  notFound(res);
}

export const persistence = new Persistence(process.env.SAVES_DIR || path.join(ROOT, 'saves'));
export const rooms = new Map();
persistence.activeNames = () => [...rooms.values()].map(r => ({ code: r.code, name: r.game.s.name }));

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c) && !persistence.exists(c)) return c;
  }
}

function lobbyList() {
  return {
    t: 'rooms',
    rooms: [...rooms.values()].filter(r => r.isPublic && r.players.size > 0 && r.players.size < MAX_PLAYERS)
      .map(r => ({ code: r.code, name: r.game.s.name || 'New Store', players: r.players.size, max: MAX_PLAYERS, started: r.started, day: r.game.s.day })),
    saves: persistence.list().filter(s => !rooms.has(s.code)),
  };
}

// One player connection (a WebSocket). Friends who join a desktop host online arrive here too: the host's page
// opens one local WebSocket per friend and pipes the WebRTC data channel into it (see client/js/online.js).
function attachSocket(ws) {
  let room = null, player = null;
  let tokens = MSG_BURST, refilled = Date.now();
  const openRoom = (code, opts) => {
    if (rooms.size >= MAX_ROOMS) { ws.send(JSON.stringify({ t: 'err', text: 'The server is full. Try again later.' })); return null; }
    const r = new Room(code, { ...opts, persistence }); rooms.set(code, r); return r;
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    // flood guard: a steady allowance per second, with room for short bursts
    const now = Date.now(); tokens = Math.min(MSG_BURST, tokens + (now - refilled) / 1000 * MSG_PER_SECOND); refilled = now;
    if (tokens < 1) return; tokens--;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (!room) {
      if (msg.t === 'list') { ws.send(JSON.stringify(lobbyList())); return; }
      if (msg.t === 'create') {
        let code = null, save = null;
        if (msg.load) {
          const wanted = typeof msg.load === 'string' ? msg.load : '';
          const s = CODE.test(wanted) ? persistence.load(wanted) : null;
          if (!s) { ws.send(JSON.stringify({ t: 'err', text: 'Save not found.' })); return; }
          if (rooms.has(wanted)) { ws.send(JSON.stringify({ t: 'err', text: 'That store is already open — join it instead.' })); return; }
          code = wanted; save = s;
        }
        room = openRoom(code || newCode(), { save, isPublic: msg.isPublic !== false });
        if (!room) return;
        player = room.addPlayer(ws, msg.name, msg.color);
        return;
      }
      if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) {
          // a saved but inactive store can be re-opened by code
          const save = persistence.exists(code) ? persistence.load(code) : null;
          if (save) {
            room = openRoom(code, { save, isPublic: true });
            if (room) player = room.addPlayer(ws, msg.name, msg.color);
            return;
          }
          ws.send(JSON.stringify({ t: 'err', text: 'No store with that code.' })); return;
        }
        if (r.players.size >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'err', text: 'That store is full (4 players).' })); return; }
        room = r; player = r.addPlayer(ws, msg.name, msg.color);
        return;
      }
      return;
    }
    if (msg.t === 'leave') { room.removePlayer(player); room = null; player = null; return; }
    try { room.handle(player, msg); } catch (e) { console.error(`[room ${room.code}] error handling ${msg.t}/${msg.a || ''}`, e); }
  });
  ws.on('close', () => { if (room && player) room.removePlayer(player); });
  ws.on('error', () => {});
}

// opts.host: interface to listen on (the desktop app uses 127.0.0.1); opts.quiet: no startup message
export function startServer(port = PORT, opts = {}) {
  const localOnly = LOCAL_NAMES.has(opts.host);
  const server = http.createServer((req, res) => (allowedRequest(req, localOnly) ? serveStatic(req, res) : notFound(res)));
  server.headersTimeout = 15000; server.requestTimeout = 30000; // slow or stalled requests don't hold connections open
  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES, verifyClient: ({ req }) => allowedRequest(req, localOnly) && wss.clients.size < MAX_CONNECTIONS });
  wss.on('connection', (ws) => attachSocket(ws));

  // Fixed-rate simulation loop
  const dt = 1 / TICK_RATE;
  let last = Date.now(), acc = 0;
  const loop = setInterval(() => {
    const now = Date.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
    while (acc >= dt) {
      acc -= dt;
      for (const r of rooms.values()) {
        try { r.tick(dt); } catch (e) { console.error(`[room ${r.code}] tick error`, e); }
      }
    }
    // drop empty rooms (saved) after a grace period
    for (const [code, r] of rooms) {
      if (!r.players.size && r.emptySince && now - r.emptySince > (r.started ? 120000 : 5000)) { r.save(); rooms.delete(code); }
    }
  }, 1000 / TICK_RATE);

  // periodic autosave
  const autosave = setInterval(() => { for (const r of rooms.values()) if (r.started && r.game.s.phase === 'prep') r.save(); }, 30000);

  const ready = new Promise((resolve) => server.listen(port, opts.host, () => {
    const actual = server.address().port;
    if (!opts.quiet) console.log(`🛒 Supermarket running at http://localhost:${actual}`);
    resolve(actual);
  }));
  const saveAll = () => { for (const r of rooms.values()) if (r.started) { try { r.save(); } catch {} } };
  return { server, wss, ready, saveAll, close: () => { clearInterval(loop); clearInterval(autosave); wss.close(); server.close(); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
