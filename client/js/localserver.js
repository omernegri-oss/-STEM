// In-browser game server for the static web version: runs the same authoritative Room/Game code
// that the Node server uses, but inside the page. Saves go to localStorage. Same interface as Net.
import { Room } from '/server/room.js';
import { TICK_RATE } from '/shared/data.js';

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
      const now = performance.now(); acc += Math.min(0.25, (now - last) / 1000); last = now;
      while (acc >= dt) { acc -= dt; if (this.room) { try { this.room.tick(dt); } catch (e) { console.error(e); } } }
    }, 1000 / TICK_RATE);
    setInterval(() => { if (this.room && this.room.started && this.room.game.s.phase === 'prep') this.room.save(); }, 30000);
    addEventListener('beforeunload', () => this.room && this.room.save());
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
      if (msg.t === 'join') { setTimeout(() => this.emit('err', { t: 'err', text: 'Joining friends needs the multiplayer server (see the main menu).' }), 0); return; }
      return;
    }
    if (msg.t === 'leave') { this.room.save(); this.room = null; this.player = null; return; }
    try { this.room.handle(this.player, msg); } catch (e) { console.error(e); }
  }
}
