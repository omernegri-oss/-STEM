// A multiplayer room: up to 4 players sharing one supermarket. Owns the Game and the network fan-out.
import { Game } from './game.js';
import { MAX_PLAYERS, TICK_RATE, PLAYER_COLORS, PLAYER_ROLES } from '../shared/data.js';

const r2 = v => Math.round(v * 100) / 100;
const REACTIONS = new Set(['😡', '😵', '💢']);
// carried things are sent as short codes: 'milk', 'f:shelf' (furniture box), 'raw:ribeye', 'pack:ribeye'
const carryCode = (b) => b.ftype ? 'f:' + b.ftype : b.dept ? `${b.dept}:${b.pid}` : b.pid;

export class Room {
  constructor(code, { save = null, isPublic = true, persistence }) {
    this.code = code;
    this.isPublic = isPublic;
    this.persistence = persistence;
    this.players = new Map();
    this.nextPid = 1;
    this.started = false;
    this.emptySince = null;
    this.tickN = 0;
    this.lastWorld = 0; this.lastMeta = 0;
    this.game = new Game(code, save, {
      fx: (m) => this.fx(m),
      isNameTaken: (name, code) => persistence.isNameTaken(name, code),
      save: () => this.save(),
    });
    this.game.players = this.players;
  }

  get hostId() { for (const p of this.players.values()) if (p.host) return p.id; return null; }

  addPlayer(ws, name, color) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map(p => p.color));
    if (!color || used.has(color)) color = PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[0];
    const s = this.game.s;
    const p = {
      id: this.nextPid++, ws, name: String(name || 'Player').slice(0, 16) || 'Player', color,
      role: 'manager', x: s.doorX + 1 + (this.players.size - 1.5) * 0.8, z: s.d - 2, rot: Math.PI, anim: 0,
      carry: [], station: null, host: this.players.size === 0, emote: '', emoteT: 0, ready: false, floor: 0, stunUntil: 0,
    };
    this.players.set(p.id, p);
    this.emptySince = null;
    this.send(p, { t: 'joined', id: p.id, code: this.code, started: this.started });
    this.sendLobby();
    if (this.started) this.sendFullState(p);
    this.fx({ k: 'info', text: `${p.name} joined the store!` });
    this.sendPlayers();
    return p;
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    // drop whatever they were carrying
    for (const b of p.carry) if (!b.dept) this.game.respawnBox(b, p.x, p.z, p.floor || 0);
    p.carry = [];
    this.players.delete(p.id);
    if (p.host && this.players.size) [...this.players.values()][0].host = true;
    const s = this.game.s;
    s.nameVotes = s.nameVotes.filter(v => v !== p.id);
    this.game.dirtyMeta();
    if (!this.players.size) { this.emptySince = Date.now(); this.save(); }
    else { this.fx({ k: 'info', text: `${p.name} left the store.` }); this.sendLobby(); this.sendPlayers(); }
  }

  save() {
    if (!this.game.s.name) return;
    try { this.persistence.save(this.code, this.game.serialize()); } catch (e) { console.error('save failed', e); }
  }

  send(p, obj) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
  }
  broadcast(obj) {
    const str = JSON.stringify(obj);
    for (const p of this.players.values()) this.send(p, str);
  }
  fx(m) {
    if (m.to) { const p = this.players.get(m.to); if (p) this.send(p, { t: 'fx', ...m }); return; }
    this.broadcast({ t: 'fx', ...m });
  }

  lobbyView() {
    return {
      t: 'lobby', code: this.code, started: this.started, isPublic: this.isPublic, storeName: this.game.s.name,
      day: this.game.s.day, loaded: !!this.game.s.name,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, role: p.role, host: p.host })),
    };
  }
  sendLobby() { this.broadcast(this.lobbyView()); }
  sendPlayers() {
    this.broadcast({ t: 'pl', players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, role: p.role, host: p.host })) });
  }
  sendFullState(p) {
    this.send(p, { t: 'w', world: this.game.worldView() });
    this.send(p, { t: 'm', meta: this.game.metaView() });
  }

  handle(p, msg) {
    const g = this.game;
    switch (msg.t) {
      case 'p': {
        if (typeof msg.x !== 'number' || typeof msg.z !== 'number') return;
        p.x = msg.x; p.z = msg.z; p.rot = +msg.rot || 0; p.anim = msg.anim | 0;
        p.floor = Math.max(0, Math.min((g.s.floors || 1) - 1, msg.floor | 0));
        if (p.station) {
          const f = g.fixture(p.station);
          if (!f || (f.floor || 0) !== p.floor || Math.hypot(f._back[0] + 0.5 - p.x, f._back[1] + 0.5 - p.z) > 1.3) p.station = null;
        }
        return;
      }
      case 'lobby': {
        if (msg.color && PLAYER_COLORS.includes(msg.color) && ![...this.players.values()].some(o => o !== p && o.color === msg.color)) p.color = msg.color;
        if (msg.role && PLAYER_ROLES[msg.role]) p.role = msg.role;
        if (msg.name) p.name = String(msg.name).slice(0, 16);
        this.sendLobby(); this.sendPlayers();
        return;
      }
      case 'start': {
        if (!p.host || this.started) return;
        this.started = true;
        this.sendLobby();
        for (const q of this.players.values()) this.sendFullState(q);
        return;
      }
      case 'a': {
        if (!this.started) return;
        g.act(p, msg);
        return;
      }
      case 'chat': {
        const text = String(msg.text || '').slice(0, 140).trim();
        if (!text) return;
        this.broadcast({ t: 'chat', from: p.name, color: p.color, text });
        return;
      }
      case 'emote': {
        p.emote = String(msg.e || '').slice(0, 4); p.emoteT = 3;
        return;
      }
      case 'ping': {
        this.broadcast({ t: 'fx', k: 'ping', x: +msg.x, z: +msg.z, color: p.color, name: p.name });
        return;
      }
    }
  }

  tick(dt) {
    this.tickN++;
    if (this.started) this.game.tick(dt);
    for (const p of this.players.values()) if (p.emoteT > 0) { p.emoteT -= dt; if (p.emoteT <= 0) p.emote = ''; }
    if (!this.started || !this.players.size) return;
    const now = Date.now();
    const g = this.game;
    if (g.worldDirty && now - this.lastWorld > 180) {
      g.worldDirty = false; this.lastWorld = now;
      this.broadcast({ t: 'w', world: g.worldView() });
    }
    if ((g.metaDirty && now - this.lastMeta > 250) || now - this.lastMeta > 2000) {
      g.metaDirty = false; this.lastMeta = now;
      this.broadcast({ t: 'm', meta: g.metaView() });
    }
    if (this.tickN % 2 === 0) this.broadcast(this.snapshot());
  }

  snapshot() {
    const g = this.game, s = g.s;
    const now = Date.now();
    const P = [...this.players.values()].map(p => [p.id, r2(p.x), r2(p.z), r2(p.rot), p.anim, p.carry.map(carryCode), p.station, p.emote, p.floor || 0, p.stunUntil > now ? 1 : 0]);
    const C = g.customers.map(c => [c.id, r2(c.x), r2(c.z), r2(c.rot), c.moving ? 1 : 0, REACTIONS.has(c.thought) ? c.thought : '',
      c.basket.slice(0, 8).map(b => b.pid), c.seed, (c.cart ? 1 : 0) | (c.vip ? 2 : 0) | (c.mood < 25 ? 4 : 0) | (c.paid ? 8 : 0) | (c.stunT > 0 ? 16 : 0), c.floor || 0]);
    const S = s.staff.filter(st => st.present).map(st => [st.id, r2(st.x), r2(st.z), r2(st.rot), st.moving ? 1 : 0, st.role,
      st.carry ? carryCode(st.carry) : '', st.seed, REACTIONS.has(st.thought) ? st.thought : '', st.task && st.task.stage ? st.task.stage : st.state, st.floor || 0, st.stunT > 0 ? 1 : 0]);
    const K = [], N = [];
    for (const f of s.furniture) {
      const kind = f.type === 'checkout' || f.type === 'selfcheckout' ? 'k' : (f.type === 'butcher' || f.type === 'deli') ? 'n' : null;
      if (!kind) continue;
      const rt = g.rt.get(f.id);
      if (kind === 'k') {
        const c = g.customerAtRegister(f);
        const op = g.operatorOf(f);
        K.push([f.id, c ? c.id : 0, c ? c.scanned : 0, c ? c.basket.length : 0, c ? c.basket.map(b => b.pid) : [], rt ? rt.queue.length : 0, op ? (op.type === 'player' ? op.p.id : -op.st.id) : 0]);
      } else {
        const c = g.customerAtCounter(f);
        const op = g.operatorOf(f);
        N.push([f.id, c ? c.id : 0, c ? c.counterReq.pid : '', c ? c.counterReq.qty : 0, rt ? rt.progress || 0 : 0, rt ? rt.queue.length : 0, op ? (op.type === 'player' ? op.p.id : -op.st.id) : 0]);
      }
    }
    const G = g.pigeons.map(p => [p.id, r2(p.x), r2(p.z)]);
    return { t: 's', time: r2(s.minute), phase: s.phase, cash: s.cash, P, C, S, K, N, G };
  }
}
