// Steam service test with a simulated Steam (two accounts, lobbies, P2P packets, invites, achievements).
// Runs the real desktop/steam.mjs host + join code paths end to end against two game servers.
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import WebSocket from 'ws';
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-steam-'));
const { startServer, attachSocket, rooms } = await import('../server/index.js');
const { SteamService, achievementApiName } = await import('../desktop/steam.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------ a tiny fake Steam
const accounts = new Map(), lobbies = new Map(); let nextLobby = 1000n;
class FakeLobby {
  constructor(owner) { this.id = nextLobby++; this.owner = owner; this.members = [owner]; this.data = {}; this.joinable = true; }
  getOwner() { return { steamId64: this.owner.id }; }
  getMembers() { return this.members.map(a => ({ steamId64: a.id })); }
  getData(k) { return this.data[k] ?? null; }
  setData(k, v) { this.data[k] = v; return true; }
  mergeFullData(o) { Object.assign(this.data, o); return true; }
  setJoinable(v) { this.joinable = v; return true; }
  openInviteDialog() { this.inviteOpened = true; }
  leave() { /* the account that called this leaves */ }
}
function fakeSteam(id, name) {
  const acc = { id: BigInt(id), name, inbox: [], callbacks: {}, accepted: new Set(), ach: new Set(), presence: {} };
  accounts.set(acc.id, acc);
  const fire = (a, cb, v) => (a.callbacks[cb] || []).forEach(fn => fn(v));
  const lobbyFor = (l) => Object.assign(Object.create(FakeLobby.prototype), l, { leave() { l.members = l.members.filter(m => m !== acc); for (const m of l.members) fire(m, 5, { lobby: l.id, user_changed: acc.id, making_change: acc.id, member_state_change: 1 }); } , getMembers: () => l.members.map(a => ({ steamId64: a.id })), getData: (k) => l.data[k] ?? null, setData: (k, v) => { l.data[k] = v; return true; }, mergeFullData: (o) => { Object.assign(l.data, o); return true; }, openInviteDialog: () => { l.inviteOpened = true; } });
  acc.sw = {
    localplayer: { getSteamId: () => ({ steamId64: acc.id }), getName: () => name, setRichPresence: (k, v) => { acc.presence[k] = v; } },
    utils: { getAppId: () => 480, isSteamRunningOnSteamDeck: () => false },
    networking: {
      sendP2PPacket: (to, type, buf) => {
        const dest = accounts.get(BigInt(to)); if (!dest) return false;
        if (!dest.accepted.has(acc.id) && !dest.requested?.has(acc.id)) { (dest.requested ||= new Set()).add(acc.id); fire(dest, 6, { remote: acc.id }); }
        dest.inbox.push({ data: Buffer.from(buf), size: buf.length, steamId: { steamId64: acc.id } }); return true;
      },
      isP2PPacketAvailable: () => acc.inbox.length ? acc.inbox[0].size : 0,
      readP2PPacket: () => acc.inbox.shift(),
      acceptP2PSession: (from) => acc.accepted.add(BigInt(from)),
    },
    matchmaking: {
      createLobby: async () => { const l = new FakeLobby(acc); lobbies.set(l.id, l); return lobbyFor(l); },
      joinLobby: async (lid) => { const l = lobbies.get(BigInt(lid)); if (!l) throw new Error('no lobby'); l.members.push(acc); for (const m of l.members) if (m !== acc) fire(m, 5, { lobby: l.id, user_changed: acc.id, making_change: acc.id, member_state_change: 0 }); return lobbyFor(l); },
    },
    callback: { register: (cb, fn) => { (acc.callbacks[cb] ||= []).push(fn); return { disconnect() {} }; } },
    achievement: { isActivated: (n) => acc.ach.has(n), activate: (n) => { acc.ach.add(n); return true; } },
  };
  acc.invite = (lobbyId) => fire(acc, 8, { lobby_steam_id: lobbyId, friend_steam_id: 1n }); // friend accepted an invite in the overlay
  return acc;
}

// ------------------------------------------------------------------ host (Maya) and friend (Omer), each with their own game
const maya = fakeSteam(76561198000000001n, 'Maya'), omer = fakeSteam(76561198000000002n, 'Omer');
const joins = [];
const hostSteam = new SteamService(maya.sw, { attachSocket, log: () => {} });
const friendSteam = new SteamService(omer.sw, { attachSocket, onJoin: (d) => joins.push(d), log: () => {} });
const hostSrv = startServer(0, { host: '127.0.0.1', quiet: true, routes: { '/steam-relay': (ws) => hostSteam.pipe(ws) } });
const friendSrv = startServer(0, { host: '127.0.0.1', quiet: true, routes: { '/steam-relay': (ws) => friendSteam.pipe(ws) } });
const [hp, fp] = [await hostSrv.ready, await friendSrv.ready];

class Client {
  constructor(url) { this.url = url; this.state = {}; this.msgs = []; }
  async connect() { this.ws = new WebSocket(this.url); await new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); }); this.ws.on('message', d => { const m = JSON.parse(d); this.msgs.push(m); if (m.t === 'lobby') this.state.lobby = m; if (m.t === 'w') this.state.world = m.world; if (m.t === 'm') this.state.meta = m.meta; }); return this; }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(this)) return; await sleep(25); } throw new Error('timeout ' + fn); }
}

assert.deepEqual(hostSteam.info(), { available: true, name: 'Maya', appId: 480, deck: false });
assert.deepEqual(new SteamService(null).info(), { available: false }, 'no Steam: offline');

// Maya opens a store and the page asks for a Steam lobby
const mayaPage = await new Client(`ws://127.0.0.1:${hp}`).connect();
mayaPage.send({ t: 'create', name: 'Maya' }); await mayaPage.waitFor(c => c.state.lobby);
const code = mayaPage.state.lobby.code;
const lobbyId = await hostSteam.host(code, 'Maya Mart');
const lobby = lobbies.get(BigInt(lobbyId));
assert.equal(lobby.data.code, code); assert.equal(lobby.data.host, 'Maya');
assert.match(maya.presence.connect, /^\+connect_lobby \d+$/, 'friends list "Join game" works');
assert.equal(await hostSteam.host(code, 'Maya Mart'), lobbyId, 'same store keeps the same lobby');
assert.ok(hostSteam.invite() && lobby.inviteOpened, 'invite dialog opens');
console.log('host lobby ✓');

// Omer accepts the invite: his game learns the store code and pipes its page to Maya
omer.invite(lobbyId);
await (async () => { for (let i = 0; i < 100 && !joins.length; i++) await sleep(20); })();
assert.equal(joins[0].code, code); assert.equal(joins[0].hostName, 'Maya');
const omerPage = await new Client(`ws://127.0.0.1:${fp}/steam-relay`).connect();
omerPage.send({ t: 'join', code, name: 'Omer' });
await omerPage.waitFor(c => c.state.lobby && c.state.lobby.players.length === 2);
assert.ok(maya.accepted.has(omer.id), 'host accepted the P2P session because Omer is in the lobby');
mayaPage.send({ t: 'start' });
await omerPage.waitFor(c => c.state.world && c.state.meta);
console.log('friend joined from a Steam invite and got the store ✓');

// a stranger who isn't in the lobby can't get a session
const eve = fakeSteam(76561198000000003n, 'Eve');
eve.sw.networking.sendP2PPacket(maya.id, 2, Buffer.from([1]));
await sleep(80);
assert.ok(!maya.accepted.has(eve.id), 'stranger not accepted');
assert.equal(rooms.get(code).players.size, 2);
console.log('stranger kept out ✓');

// achievements map to Steam API names
assert.ok(hostSteam.achievement('first_sale')); assert.ok(maya.ach.has('ACH_FIRST_SALE')); assert.equal(achievementApiName('rev100k'), 'ACH_REV100K');
console.log('achievements ✓');

// Omer leaves the Steam lobby (quits): Maya's store removes him
friendSteam.leave();
await mayaPage.waitFor(() => rooms.get(code).players.size === 1);
console.log('friend left ✓');

hostSteam.leave(); clearInterval(hostSteam.poll); clearInterval(friendSteam.poll);
hostSrv.close(); friendSrv.close();
console.log('✅ steam service test passed');
process.exit(0);
