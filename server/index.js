// Supermarket server: static file hosting + WebSocket multiplayer rooms.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { Persistence } from './persistence.js';
import { TICK_RATE, MAX_PLAYERS } from '../shared/data.js';

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
  ['/addons/', HAS_VENDOR ? path.join(VENDOR, 'addons') : path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res) {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size })); return; }
  for (const [prefix, dir] of STATIC) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (!file.startsWith(dir)) break;
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
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

// One player connection. `ws` is anything socket-like: a real WebSocket, or a virtual socket for a player who
// reaches this server over Steam networking ({ readyState, send(str), on('message' | 'close' | 'error', fn) }).
export function attachSocket(ws) {
  let room = null, player = null;
  ws.on('message', (data) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    if (!room) {
      if (msg.t === 'list') { ws.send(JSON.stringify(lobbyList())); return; }
      if (msg.t === 'create') {
        let code = newCode(), save = null;
        if (msg.load) {
          const s = persistence.load(msg.load);
          if (!s) { ws.send(JSON.stringify({ t: 'err', text: 'Save not found.' })); return; }
          if (rooms.has(msg.load)) { ws.send(JSON.stringify({ t: 'err', text: 'That store is already open — join it instead.' })); return; }
          code = msg.load; save = s;
        }
        room = new Room(code, { save, isPublic: msg.isPublic !== false, persistence });
        rooms.set(code, room);
        player = room.addPlayer(ws, msg.name, msg.color);
        return;
      }
      if (msg.t === 'join') {
        const code = String(msg.code || '').toUpperCase().trim();
        const r = rooms.get(code);
        if (!r) {
          // a saved but inactive store can be re-opened by code
          if (persistence.exists(code)) {
            room = new Room(code, { save: persistence.load(code), isPublic: true, persistence });
            rooms.set(code, room);
            player = room.addPlayer(ws, msg.name, msg.color);
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

// opts.host: interface to listen on (the desktop app uses 127.0.0.1); opts.routes: { '/path': (ws) => {} } sends
// WebSocket connections on that path somewhere else (the desktop app relays '/steam-relay' to a Steam host).
export function startServer(port = PORT, opts = {}) {
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws, req) => {
    const route = opts.routes && opts.routes[(req.url || '/').split('?')[0]];
    if (route) route(ws); else attachSocket(ws);
  });

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
