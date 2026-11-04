// Peer-to-peer bridge between the game server and players who connect over Steam networking.
//
// The host runs the normal game server. A friend's game connects its own page to a local relay
// ('/steam-relay'), and the relay forwards every WebSocket message over Steam P2P to the host, where it
// enters the server through a virtual socket. The page code doesn't know the difference.
//
// This file knows nothing about Steam itself: it talks to a `transport` with two methods,
// send(peerId, buffer) and onPacket((peerId, buffer) => {}), so tests can use an in-memory network.

const OPEN = 1, MSG = 2, PART = 3, CLOSE = 4, PING = 5;
export const CHUNK = 60000;              // bytes per packet; Steam reliable packets allow up to 1 MB
export const PEER_TIMEOUT_MS = 20000;    // host drops a friend that has been silent this long
export const PING_MS = 4000;

// one logical message → one or more packets (big world updates are split and joined again)
export function encode(type, str = '') {
  const body = Buffer.from(str, 'utf8');
  if (body.length <= CHUNK) return [Buffer.concat([Buffer.from([type]), body])];
  const out = [];
  for (let i = 0; i < body.length; i += CHUNK) {
    const last = i + CHUNK >= body.length;
    out.push(Buffer.concat([Buffer.from([last ? type : PART]), body.subarray(i, i + CHUNK)]));
  }
  return out;
}

export class Decoder {
  constructor() { this.parts = []; }
  // returns { type, data } when a whole message is complete, otherwise null
  push(buf) {
    const type = buf[0], body = buf.subarray(1);
    if (type === PART) { this.parts.push(body); return null; }
    let data = body;
    if (this.parts.length) { data = Buffer.concat([...this.parts, body]); this.parts = []; }
    return { type, data: data.toString('utf8') };
  }
}

// what the game server sees for a remote player: just enough of the WebSocket interface
export class VirtualSocket {
  constructor(sendFn) { this.readyState = 1; this.sendFn = sendFn; this.handlers = {}; }
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); return this; }
  emit(ev, ...a) { for (const fn of this.handlers[ev] || []) { try { fn(...a); } catch (e) { console.error(e); } } }
  send(str) { if (this.readyState === 1) this.sendFn(typeof str === 'string' ? str : String(str)); }
  close() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
}

// Host side: every friend gets a virtual socket attached to the game server.
export class HostBridge {
  constructor(transport, attach, { now = () => Date.now() } = {}) {
    this.t = transport; this.attach = attach; this.now = now; this.peers = new Map(); this.closed = false;
    transport.onPacket((peer, buf) => this.onPacket(peer, buf));
  }
  get count() { return this.peers.size; }
  sendTo(peer, type, str) { for (const b of encode(type, str)) this.t.send(peer, b); }
  onPacket(peer, buf) {
    if (this.closed || !buf || !buf.length) return;
    let p = this.peers.get(peer);
    if (buf[0] === OPEN) {
      if (p) this.drop(peer, false);
      const vs = new VirtualSocket((str) => this.sendTo(peer, MSG, str));
      p = { vs, dec: new Decoder(), seen: this.now() };
      this.peers.set(peer, p);
      this.attach(vs);
      return;
    }
    if (!p) { if (buf[0] !== CLOSE) this.sendTo(peer, CLOSE); return; } // unknown friend: tell them to reconnect
    p.seen = this.now();
    const m = p.dec.push(buf); if (!m) return;
    if (m.type === MSG) p.vs.emit('message', m.data);
    else if (m.type === CLOSE) this.drop(peer, false);
  }
  // a friend left (closed the game, lost connection, left the Steam lobby)
  drop(peer, notify = true) {
    const p = this.peers.get(peer); if (!p) return;
    this.peers.delete(peer);
    if (notify) this.sendTo(peer, CLOSE);
    p.vs.close();
  }
  tick() { const t = this.now(); for (const [peer, p] of this.peers) if (t - p.seen > PEER_TIMEOUT_MS) this.drop(peer); }
  close() { for (const peer of [...this.peers.keys()]) this.drop(peer); this.closed = true; }
}

// Friend side: pipes the page's local WebSocket to the host over the transport.
export class ClientRelay {
  constructor(transport, hostPeer) {
    this.t = transport; this.host = hostPeer; this.ws = null; this.dec = new Decoder(); this.pingT = null;
    transport.onPacket((peer, buf) => { if (peer === this.host) this.onPacket(buf); });
  }
  sendHost(type, str) { for (const b of encode(type, str)) this.t.send(this.host, b); }
  pipe(ws) {
    if (this.ws) this.unpipe(true);
    this.ws = ws; this.dec = new Decoder();
    this.sendHost(OPEN);
    ws.on('message', (data) => this.sendHost(MSG, typeof data === 'string' ? data : data.toString('utf8')));
    ws.on('close', () => { if (this.ws === ws) this.unpipe(true); });
    ws.on('error', () => {});
    this.pingT = setInterval(() => this.sendHost(PING), PING_MS);
  }
  unpipe(notifyHost) {
    clearInterval(this.pingT); this.pingT = null;
    const ws = this.ws; this.ws = null;
    if (notifyHost) this.sendHost(CLOSE);
    if (ws && ws.readyState === 1) ws.close();
  }
  onPacket(buf) {
    if (!this.ws) return;
    const m = this.dec.push(buf); if (!m) return;
    if (m.type === MSG) { if (this.ws.readyState === 1) this.ws.send(m.data); }
    else if (m.type === CLOSE) this.unpipe(false);
  }
  close() { if (this.ws) this.unpipe(true); }
}

// In-memory network for tests: hub.endpoint('A') and hub.endpoint('B') can send to each other.
export class LoopbackHub {
  constructor() { this.eps = new Map(); this.down = new Set(); }
  endpoint(id) {
    const listeners = [];
    const ep = {
      id, listeners,
      send: (peer, buf) => {
        if (this.down.has(id) || this.down.has(peer)) return false;
        const dest = this.eps.get(peer); if (!dest) return false;
        const copy = Buffer.from(buf);
        setImmediate(() => { for (const fn of dest.listeners) fn(id, copy); });
        return true;
      },
      onPacket: (fn) => listeners.push(fn),
    };
    this.eps.set(id, ep);
    return ep;
  }
  // simulate a player's connection dying without a goodbye
  cut(id) { this.down.add(id); }
}
