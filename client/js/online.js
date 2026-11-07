// Online play with a store code, from anywhere: WebRTC data channels through PeerJS.
// The free public PeerJS server only introduces the two computers; game messages then go directly between them
// (or through PeerJS's free relay when a direct route is impossible). No accounts needed.
//
// Host: OnlineHost registers the store code and pipes every friend into the store, exactly like a player
//       connected to the game server (a socket into the in-page store for the web version, or a WebSocket to the
//       local game server in the desktop/server versions).
// Friend: OnlineNet connects to the host's code and works like the normal network client (same messages).

const PREFIX = 'supermarket-stem-'; // peer id = PREFIX + store code
const CHUNK = 16000;                // data channel messages are split above this size and joined on arrival
const BEAT = 3000, DEAD = 12000;    // both sides send a heartbeat; silence this long means the other computer is gone
const HB = '{"t":"hb"}';

function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'lib/peerjs.min.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load the online module.'));
    document.head.appendChild(s);
  });
}
// tests (and anyone self-hosting) can point at their own PeerServer: window.ST_PEER = { host, port, path, secure, config }
const peerOptions = () => ({ debug: 0, ...(window.ST_PEER || {}) });
export const onlineAvailable = () => !window.ST_NO_ONLINE && typeof RTCPeerConnection !== 'undefined';

function sendStr(conn, str) {
  if (str.length <= CHUNK) { conn.send(str); return; }
  const id = Math.random().toString(36).slice(2, 8), n = Math.ceil(str.length / CHUNK);
  for (let i = 0; i < n; i++) conn.send(`\u0001${id}|${i}|${n}|${str.slice(i * CHUNK, (i + 1) * CHUNK)}`);
}
class Joiner {
  constructor() { this.parts = new Map(); }
  // returns a whole message string, or null while parts are still missing
  push(data) {
    if (typeof data !== 'string') return null;
    if (data[0] !== '\u0001') return data;
    const a = data.indexOf('|'), b = data.indexOf('|', a + 1), c = data.indexOf('|', b + 1);
    const id = data.slice(1, a), i = +data.slice(a + 1, b), n = +data.slice(b + 1, c);
    let p = this.parts.get(id); if (!p) { p = new Array(n); p.got = 0; this.parts.set(id, p); }
    if (p[i] === undefined) { p[i] = data.slice(c + 1); p.got++; }
    if (p.got < n) return null;
    this.parts.delete(id);
    return p.join('');
  }
}

// a socket into the store on this computer for one friend: { send(str), onmessage(str), onclose(), close() }
export function localServerSocket() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  const queue = [];
  const link = { onmessage: null, onclose: null, send: (s) => (ws.readyState === 1 ? ws.send(s) : queue.push(s)), close: () => ws.close() };
  ws.onopen = () => { for (const s of queue) ws.send(s); queue.length = 0; };
  ws.onmessage = (e) => link.onmessage && link.onmessage(e.data);
  ws.onclose = () => link.onclose && link.onclose();
  return link;
}

export class OnlineHost {
  // openLocal(): returns a socket into this computer's store (see localServerSocket / LocalNet.openRemote)
  constructor(openLocal) { this.openLocal = openLocal; this.peer = null; this.code = ''; this.status = 'off'; this.onStatus = () => {}; this.friends = 0; }
  setStatus(s, detail = '') { this.status = s; this.onStatus(s, detail); }
  async start(code) {
    if (!onlineAvailable() || this.code === code) return;
    this.stop(); this.code = code;
    this.setStatus('connecting');
    try { await loadPeerJS(); } catch (e) { this.setStatus('error', e.message); return; }
    if (this.code !== code) return;
    const peer = this.peer = new window.Peer(PREFIX + code, peerOptions());
    // no internet or the service is down: keep trying, less and less often (up to every 30 s)
    let wait = 2000;
    const retry = () => setTimeout(() => {
      if (this.peer !== peer || peer.destroyed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch {} }
    }, wait = Math.min(wait * 1.6, 30000));
    peer.on('open', () => { wait = 2000; this.setStatus('online'); });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { this.setStatus('error', 'This code is already open somewhere else.'); return; }
      if (e.type === 'peer-unavailable') return; // a friend's connection attempt that went nowhere
      this.setStatus('error', 'Could not reach the online service. Check your internet connection.');
    });
    // PeerJS gives up on some errors (and a code can stay taken for a moment after a reload): start over later
    peer.on('error', () => setTimeout(() => { if (this.peer === peer && peer.destroyed) { this.code = ''; this.start(code); } }, 15000));
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) { if (this.status !== 'error') this.setStatus('connecting'); retry(); } });
    peer.on('connection', (conn) => this.accept(conn));
    // closing the page: tell friends right away instead of letting their connection time out
    if (!this.unloadHooked) { this.unloadHooked = true; addEventListener('pagehide', () => this.stop()); }
  }
  accept(conn) {
    let local = null, joined = false, heard = Date.now();
    const joiner = new Joiner();
    const beat = setInterval(() => {
      if (Date.now() - heard > DEAD) { try { conn.close(); } catch {} drop(); return; }
      if (conn.open) try { conn.send(HB); } catch {}
    }, BEAT);
    const drop = () => { clearInterval(beat); if (local) { const l = local; local = null; l.close(); } if (joined) { joined = false; this.friends--; this.onStatus(this.status); } };
    conn.on('data', (data) => {
      heard = Date.now();
      const str = joiner.push(data); if (str == null || str === HB) return;
      let m; try { m = JSON.parse(str); } catch { return; }
      if (!joined) {
        // a friend may only join this store: no other commands before that
        if (m.t !== 'join' || String(m.code || '').toUpperCase() !== this.code) return;
        joined = true; this.friends++; this.onStatus(this.status);
        local = this.openLocal();
        local.onmessage = (s) => { if (conn.open) sendStr(conn, s); };
        local.onclose = () => { local = null; try { conn.close(); } catch {} };
      }
      if (m.t === 'create' || m.t === 'list') return;
      if (local) local.send(JSON.stringify(m));
    });
    conn.on('close', drop);
    conn.on('error', drop);
  }
  stop() { if (this.peer) { try { this.peer.destroy(); } catch {} } this.peer = null; this.code = ''; this.friends = 0; this.setStatus('off'); }
}

// the friend's side: same interface as Net (connect, on, emit, send, act)
export class OnlineNet {
  constructor(code) { this.code = code; this.handlers = {}; this.open = false; this.online = true; this.joiner = new Joiner(); }
  async connect() {
    if (!onlineAvailable()) throw new Error('Online play is not available here. Open the game website or the downloaded game.');
    await loadPeerJS();
    const peer = this.peer = new window.Peer(peerOptions());
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('Could not reach the online service. Check your internet connection.')), 15000);
      peer.on('open', () => { clearTimeout(t); resolve(); });
      peer.on('error', () => { clearTimeout(t); reject(new Error('Could not reach the online service. Check your internet connection.')); });
    });
    const conn = this.conn = peer.connect(PREFIX + this.code, { serialization: 'raw', reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`Could not connect to store ${this.code}. Ask your friend to keep the store open and try again.`)), 20000);
      conn.on('open', () => { clearTimeout(t); resolve(); });
      peer.on('error', (e) => { clearTimeout(t); reject(new Error(e.type === 'peer-unavailable' ? `No store with code ${this.code} is open right now. Check the code, and ask your friend to open the store first.` : 'The connection to your friend failed. Try again.')); });
    });
    this.open = true;
    let heard = Date.now();
    const lost = () => { if (!this.open) return; this.open = false; clearInterval(this.beat); try { peer.destroy(); } catch {} this.emit('close', {}); };
    this.beat = setInterval(() => { if (Date.now() - heard > DEAD) return lost(); try { conn.send(HB); } catch {} }, BEAT);
    conn.on('data', (data) => { heard = Date.now(); const s = this.joiner.push(data); if (s == null || s === HB) return; let m; try { m = JSON.parse(s); } catch { return; } this.emit(m.t, m); });
    conn.on('close', lost);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} }); // only the introduction service; the game link stays up
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  send(obj) { if (this.open) sendStr(this.conn, JSON.stringify(obj)); }
  act(a, data = {}) { this.send({ t: 'a', a, ...data }); }
  close() { this.open = false; clearInterval(this.beat); try { this.peer.destroy(); } catch {} }
}
