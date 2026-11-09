// Online play with a store code, from anywhere. Two routes:
//  1. direct: WebRTC data channels through PeerJS. The free public PeerJS server only introduces the two computers;
//     game messages then go directly between them (or through a TURN relay when a direct route is impossible);
//  2. relay: when the direct route doesn't open (strict home routers, carrier-grade NAT), messages go through free
//     public MQTT brokers over a secure WebSocket (client/js/relay.js).
// No accounts needed.
//
// Host: OnlineHost listens on both routes and pipes every friend into the store, exactly like a player connected to
//       the game server (a socket into the in-page store for the web version, or a WebSocket to the local game
//       server in the desktop/server versions).
// Friend: OnlineNet tries the direct route, then the relay, and works like the normal network client (same messages).
import { Mqtt, relayLink, relayUrls, TOPIC, BYE } from './relay.js';

const PREFIX = 'supermarket-stem-'; // peer id = PREFIX + store code
const CHUNK = 16000;                // messages are split above this size and joined on arrival
const BEAT = 3000, DEAD = 12000;    // both sides send a heartbeat; silence this long means the other computer is gone
const HB = '{"t":"hb"}';
// STUN finds each computer's public address; TURN relays when there is no direct route
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
];

function loadPeerJS() {
  if (window.Peer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = 'lib/peerjs.min.js';
    s.onload = () => resolve(); s.onerror = () => reject(new Error('Could not load the online module.'));
    document.head.appendChild(s);
  });
}
// tests (and anyone self-hosting) can point at their own PeerServer: window.ST_PEER = { host, port, path, secure, config }
const peerOptions = () => ({ debug: 0, config: { iceServers: ICE }, ...(window.ST_PEER || {}) });
export const onlineAvailable = () => !window.ST_NO_ONLINE && typeof WebSocket !== 'undefined';
const rid = () => Math.random().toString(36).slice(2, 10);
const hostTopic = (code) => `${TOPIC}/${code}/h`;
const friendTopic = (code, fid) => `${TOPIC}/${code}/c/${fid}`;

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
  constructor(openLocal) { this.openLocal = openLocal; this.peer = null; this.relays = []; this.code = ''; this.status = 'off'; this.onStatus = () => {}; this.friends = 0; this.direct = 'off'; this.relayOk = 0; }
  setStatus(s, detail = '') { this.status = s; this.detail = detail; this.onStatus(s, detail); }
  // online as soon as either route works
  sync() {
    if (!this.code) return;
    if (this.direct === 'online' || this.relayOk > 0) this.setStatus('online');
    else if (this.direct === 'error' && this.relaysTried >= this.relayCount) this.setStatus('error', this.directErr || 'Could not reach the online services. Check your internet connection.');
    else this.setStatus('connecting');
  }
  start(code) {
    if (!onlineAvailable() || this.code === code) return;
    this.stop(); this.code = code;
    this.setStatus('connecting');
    if (!this.unloadHooked) { this.unloadHooked = true; addEventListener('pagehide', () => this.stop()); } // tell friends right away
    if (typeof RTCPeerConnection !== 'undefined' && !window.ST_RELAY_ONLY) this.startDirect(code); else { this.direct = 'error'; }
    this.startRelays(code);
  }
  async startDirect(code) {
    this.direct = 'connecting';
    try { await loadPeerJS(); } catch (e) { this.direct = 'error'; this.directErr = e.message; this.sync(); return; }
    if (this.code !== code) return;
    const peer = this.peer = new window.Peer(PREFIX + code, peerOptions());
    // no internet or the service is down: keep trying, less and less often (up to every 30 s)
    let wait = 2000;
    const retry = () => setTimeout(() => {
      if (this.peer !== peer || peer.destroyed) return;
      if (peer.disconnected) { try { peer.reconnect(); } catch {} }
    }, wait = Math.min(wait * 1.6, 30000));
    peer.on('open', () => { wait = 2000; this.direct = 'online'; this.sync(); });
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') return; // a friend's connection attempt that went nowhere
      this.direct = 'error'; this.directErr = e.type === 'unavailable-id' ? 'This code is already open somewhere else.' : 'Could not reach the online service.';
      this.sync();
      // PeerJS gives up on some errors (and a code can stay taken for a moment after a reload): start over later
      setTimeout(() => { if (this.peer === peer && peer.destroyed && this.code === code) this.startDirect(code); }, 15000);
    });
    peer.on('disconnected', () => { if (this.peer === peer && !peer.destroyed) { this.direct = 'connecting'; this.sync(); retry(); } });
    peer.on('connection', (conn) => this.accept(conn));
  }
  // listen on every public broker, so a friend who reaches any one of them finds the store
  startRelays(code) {
    const urls = relayUrls(); this.relayCount = urls.length; this.relaysTried = 0; this.relayOk = 0;
    for (const url of urls) this.openRelay(code, url, 2000);
  }
  async openRelay(code, url, wait) {
    const m = new Mqtt(url);
    this.relays.push(m);
    try { await m.connect('ssmh' + rid()); }
    catch { this.relays = this.relays.filter(x => x !== m); this.relaysTried++; this.sync(); this.retryRelay(code, url, wait); return; }
    if (this.code !== code) { m.close(); return; }
    this.relaysTried++; this.relayOk++; this.sync();
    const links = new Map();
    m.subscribe(hostTopic(code));
    m.onmessage = (topic, payload) => {
      const nl = payload.indexOf('\n'); if (nl < 1) return;
      const fid = payload.slice(0, nl), data = payload.slice(nl + 1);
      let link = links.get(fid);
      if (data === BYE) { if (link) { links.delete(fid); link.open = false; link.fire('close'); } return; }
      if (!link) {
        if (links.size > 12) return;
        link = relayLink(m, friendTopic(code, fid));
        link.on('close', () => links.delete(fid));
        links.set(fid, link); this.accept(link);
      }
      link.fire('data', data);
    };
    m.onclose = () => {
      this.relays = this.relays.filter(x => x !== m); this.relayOk--; this.sync();
      for (const l of links.values()) { l.open = false; l.fire('close'); }
      this.retryRelay(code, url, 2000);
    };
  }
  retryRelay(code, url, wait) { setTimeout(() => { if (this.code === code) this.openRelay(code, url, Math.min(wait * 1.6, 30000)); }, wait); }
  accept(conn) {
    let local = null, joined = false, heard = Date.now();
    const joiner = new Joiner();
    const beat = setInterval(() => {
      if (Date.now() - heard > DEAD) { try { conn.close(); } catch {} drop(); return; }
      if (conn.open) try { conn.send(HB); } catch {}
    }, BEAT);
    if (conn.via === 'relay') try { conn.send(HB); } catch {} // answer at once: the friend is waiting to hear the store exists
    const drop = () => { clearInterval(beat); if (local) { const l = local; local = null; l.close(); } if (joined) { joined = false; this.friends--; this.sync(); } };
    conn.on('data', (data) => {
      heard = Date.now();
      const str = joiner.push(data); if (str == null || str === HB) return;
      let m; try { m = JSON.parse(str); } catch { return; }
      if (!joined) {
        // a friend may only join this store: no other commands before that
        if (m.t !== 'join' || String(m.code || '').toUpperCase() !== this.code) return;
        joined = true; this.friends++; this.sync();
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
  stop() {
    if (this.peer) { try { this.peer.destroy(); } catch {} }
    for (const m of this.relays) m.close();
    this.peer = null; this.relays = []; this.code = ''; this.friends = 0; this.direct = 'off'; this.relayOk = 0; this.setStatus('off');
  }
}

// the friend's side: same interface as Net (connect, on, emit, send, act)
export class OnlineNet {
  constructor(code) { this.code = code; this.handlers = {}; this.open = false; this.online = true; this.joiner = new Joiner(); this.onStage = () => {}; }
  async connect() {
    if (!onlineAvailable()) throw new Error('Online play is not available here. Open the game website or the downloaded game.');
    let notFound = false;
    if (typeof RTCPeerConnection !== 'undefined' && !window.ST_RELAY_ONLY) {
      this.onStage(`Looking for store ${this.code}…`);
      try { this.link = await this.connectDirect(); this.via = 'direct'; }
      catch (e) { notFound = e.notFound; try { this.peer && this.peer.destroy(); } catch {} this.peer = null; }
    }
    if (!this.link) {
      this.onStage(notFound ? `Looking for store ${this.code} on the relay servers…` : 'The direct connection is blocked by the network. Connecting through a relay server…');
      try { this.link = await this.connectRelay(); this.via = 'relay'; }
      catch (e) {
        throw new Error(e.notFound || notFound ? `No store with code ${this.code} is open right now. Check the code, and ask your friend to open the store first (and keep it open).`
          : 'Could not reach the online services. Check your internet connection and try again.');
      }
    }
    this.open = true;
    let heard = Date.now();
    const link = this.link;
    const lost = () => { if (!this.open) return; this.open = false; clearInterval(this.beat); this.shutdown(); this.emit('close', {}); };
    this.beat = setInterval(() => { if (Date.now() - heard > DEAD) return lost(); try { link.send(HB); } catch {} }, BEAT);
    link.on('data', (data) => { heard = Date.now(); const s = this.joiner.push(data); if (s == null || s === HB) return; let m; try { m = JSON.parse(s); } catch { return; } this.emit(m.t, m); });
    link.on('close', lost);
  }
  // route 1: WebRTC through PeerJS
  async connectDirect() {
    await loadPeerJS();
    const peer = this.peer = new window.Peer(peerOptions());
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no service')), 10000);
      peer.on('open', () => { clearTimeout(t); resolve(); });
      peer.on('error', () => { clearTimeout(t); reject(new Error('no service')); });
    });
    const conn = peer.connect(PREFIX + this.code, { serialization: 'raw', reliable: true });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no route')), 12000);
      conn.on('open', () => { clearTimeout(t); resolve(); });
      peer.on('error', (e) => { clearTimeout(t); const err = new Error(e.type); err.notFound = e.type === 'peer-unavailable'; reject(err); });
    });
    this.onStage(`Connected to store ${this.code}…`);
    peer.on('disconnected', () => { try { peer.reconnect(); } catch {} }); // only the introduction service; the game link stays up
    return conn;
  }
  // route 2: a public MQTT broker. The store answers at once, so silence means the store isn't on this broker
  async connectRelay() {
    const fid = rid(); let reached = 0;
    for (const url of relayUrls()) {
      const m = new Mqtt(url);
      try { await m.connect('ssmc' + fid, 7000); } catch { continue; }
      reached++;
      const link = relayLink(m, hostTopic(this.code), fid + '\n');
      m.subscribe(friendTopic(this.code, fid));
      m.onmessage = (topic, data) => { if (data === BYE) { link.open = false; link.fire('close'); } else link.fire('data', data); };
      m.onclose = () => { link.open = false; link.fire('close'); };
      const found = await new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 8000);
        link.on('data', () => { clearTimeout(t); resolve(true); });
        setTimeout(() => link.send(HB), 300); // after the subscription is in place
      });
      if (found) { this.mqtt = m; this.onStage(`Connected to store ${this.code} through a relay server…`); return link; }
      m.close();
    }
    const err = new Error('relay'); err.notFound = reached > 0; throw err;
  }
  shutdown() { try { this.peer && this.peer.destroy(); } catch {} try { this.mqtt && this.mqtt.close(); } catch {} }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  send(obj) { if (this.open) sendStr(this.link, JSON.stringify(obj)); }
  act(a, data = {}) { this.send({ t: 'a', a, ...data }); }
  close() { this.open = false; clearInterval(this.beat); try { this.link && this.link.close(); } catch {} this.shutdown(); }
}
