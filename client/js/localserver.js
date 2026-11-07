// In-browser game server for the static web version: runs the same authoritative Room/Game code
// that the Node server uses, but inside the page. Saves go to localStorage. Same interface as Net.
// Friends who join online (client/js/online.js) are added to this page's store through openRemote().
import { Room } from '/server/room.js';
import { TICK_RATE, MAX_PLAYERS } from '/shared/data.js';

const SAVE_KEY = 'st_local_saves';
const readSaves = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}'); } catch { return {}; } };
const writeSaves = (o) => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(o)); } catch {} };

const persistence = {
  activeNames: () => [],
  exists: (code) => !!readSaves()[code],
  load: (code) => readSaves()[code]?.state || null,
  save: (code, state) => { const all = readSaves(); all[code] = { code, savedAt: Date.now(), state }; writeSaves(all); },
  list: () => Object.values(readSaves()).map(d => ({ code: d.code, name: d.state.name, day: d.state.day, level: d.state.level, cash: d.state.cash, savedAt: d.savedAt })).sort((a, b) => b.savedAt - a.savedAt),
  isNameTaken: (name, code) => Object.values(readSaves()).some(d => d.code !== code && d.state.name && d.state.name.trim().toLowerCase() === name.trim().toLowerCase()),
};

export class LocalNet {
  constructor() { this.handlers = {}; this.open = false; this.room = null; this.player = null; this.local = true; }
  connect() {
    this.open = true;
    const dt = 1 / TICK_RATE; let last = performance.now(), acc = 0;
    setInterval(() => {
      // a hidden tab only runs timers about once a second: catch up then, so friends' game keeps going
      const now = performance.now(); acc += Math.min(document.hidden ? 1.5 : 0.25, (now - last) / 1000); last = now;
      while (acc >= dt) { acc -= dt; if (this.room) { try { this.room.tick(dt); } catch (e) { console.error(e); } } }
    }, 1000 / TICK_RATE);
    setInterval(() => { if (this.room && this.room.started && this.room.game.s.phase === 'prep') this.room.save(); }, 30000);
    addEventListener('beforeunload', () => this.room && this.room.save());
    addEventListener('pagehide', () => this.room && this.room.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.room && this.room.started) this.room.save(); });
    return Promise.resolve();
  }
  on(t, fn) { (this.handlers[t] ||= []).push(fn); }
  emit(t, m) { for (const fn of this.handlers[t] || []) fn(m); }
  act(a, data = {}) { this.send({ t: 'a', a, ...data }); }
  // a fake websocket handed to the Room: messages are delivered back to the page asynchronously
  socket() {
    return { readyState: 1, send: (str) => { const m = typeof str === 'string' ? JSON.parse(str) : str; setTimeout(() => this.emit(m.t, m), 0); } };
  }
  newCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 5; i++) c += A[Math.floor(Math.random() * A.length)]; return c; }
  send(msg) {
    if (!this.room) {
      if (msg.t === 'list') { setTimeout(() => this.emit('rooms', { t: 'rooms', rooms: [], saves: persistence.list() }), 0); return; }
      if (msg.t === 'create') {
        let code = this.newCode(), save = null;
        if (msg.load) { save = persistence.load(msg.load); if (!save) return this.emit('err', { text: 'Save not found.' }); code = msg.load; }
        this.room = new Room(code, { save, isPublic: false, persistence });
        this.player = this.room.addPlayer(this.socket(), msg.name, msg.color);
        return;
      }
      return;
    }
    if (msg.t === 'leave') { this.room.save(); this.room = null; this.player = null; return; }
    try { this.room.handle(this.player, msg); } catch (e) { console.error(e); }
  }
  // a friend's connection into this store: { send(str), onmessage(str), onclose(), close() }
  openRemote() {
    let player = null, room = null;
    const link = { onmessage: null, onclose: null };
    const ws = { readyState: 1, send: (str) => setTimeout(() => link.onmessage && link.onmessage(str), 0) };
    const reply = (obj) => ws.send(JSON.stringify(obj));
    link.send = (str) => {
      let m; try { m = JSON.parse(str); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      if (!player) {
        if (m.t !== 'join') return;
        if (!this.room) return reply({ t: 'err', text: 'That store is closed.' });
        if (this.room.players.size >= MAX_PLAYERS) return reply({ t: 'err', text: 'That store is full (4 players).' });
        room = this.room; player = room.addPlayer(ws, m.name, m.color);
        return;
      }
      if (m.t === 'leave') { room.removePlayer(player); player = null; return; }
      try { room.handle(player, m); } catch (e) { console.error(e); }
    };
    link.close = () => { ws.readyState = 3; if (player) room.removePlayer(player); player = null; };
    return link;
  }
}
