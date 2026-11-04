// Steam multiplayer bridge test, with an in-memory network instead of Steam:
// a host runs the game server, a friend's game reaches it through its local '/steam-relay' WebSocket,
// the relay, the P2P "network", and the host's virtual socket. Also checks big-message splitting,
// leaving, reconnecting and a dropped connection.
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import WebSocket from 'ws';
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-p2p-'));
const { startServer, attachSocket, rooms } = await import('../server/index.js');
const { HostBridge, ClientRelay, LoopbackHub, encode, Decoder, CHUNK, PEER_TIMEOUT_MS } = await import('../desktop/p2p.mjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- splitting: a message bigger than one packet arrives whole
{
  const big = 'x'.repeat(CHUNK * 3 + 123) + '✓';
  const parts = encode(2, big); assert.equal(parts.length, 4);
  const d = new Decoder(); let out = null;
  for (const p of parts) out = d.push(p) || out;
  assert.equal(out.data, big); assert.equal(out.type, 2);
}

// --- host: the real game server plus a bridge on the loopback network
const hub = new LoopbackHub();
const hostEp = hub.endpoint('HOST'), friendEp = hub.endpoint('FRIEND');
let clock = Date.now();
const bridge = new HostBridge(hostEp, attachSocket, { now: () => clock });
const host = startServer(0, { host: '127.0.0.1', quiet: true });
const hostPort = await host.ready;

// --- friend: their own local server whose '/steam-relay' path is piped to the host
const relay = new ClientRelay(friendEp, 'HOST');
const friendSrv = startServer(0, { host: '127.0.0.1', quiet: true, routes: { '/steam-relay': (ws) => relay.pipe(ws) } });
const friendPort = await friendSrv.ready;

class Client {
  constructor(name, url) { this.name = name; this.url = url; this.state = {}; this.msgs = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', d => { const m = JSON.parse(d); this.msgs.push(m); if (m.t === 'w') this.state.world = m.world; if (m.t === 'm') this.state.meta = m.meta; if (m.t === 'lobby') this.state.lobby = m; if (m.t === 'chat') this.state.chat = m; if (m.t === 'err') this.lastErr = m.text; });
    this.closed = new Promise(r => this.ws.on('close', r));
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async waitFor(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(this)) return; await sleep(25); } throw new Error(`${this.name}: timeout waiting for ${fn}`); }
}

const alice = await new Client('Alice', `ws://127.0.0.1:${hostPort}`).connect();
alice.send({ t: 'create', name: 'Alice' });
await alice.waitFor(c => c.state.lobby);
const code = alice.state.lobby.code;

// Bob joins through Steam (the relay)
const bob = await new Client('Bob', `ws://127.0.0.1:${friendPort}/steam-relay`).connect();
bob.send({ t: 'join', code, name: 'Bob' });
await bob.waitFor(c => c.state.lobby && c.state.lobby.players.length === 2);
await alice.waitFor(c => c.state.lobby.players.length === 2);
assert.equal(bridge.count, 1, 'host sees one Steam friend');
console.log('friend joined over the P2P bridge ✓');

// the game starts for both, and the full world reaches the friend
alice.send({ t: 'start' });
await bob.waitFor(c => c.state.world && c.state.meta);
assert.equal(bob.state.world.w, alice.state.world?.w ?? bob.state.world.w);
assert.ok(bob.state.world.furniture.some(f => f.type === 'computer'), 'friend got the store');
// actions from the friend reach the host's game
bob.send({ t: 'a', a: 'nameDraft', name: 'Bridge Mart' });
await alice.waitFor(c => c.state.meta && c.state.meta.nameDraft === 'Bridge Mart');
bob.send({ t: 'chat', text: 'hi from steam' });
await alice.waitFor(c => c.msgs.some(m => m.t === 'chat' && /hi from steam/.test(m.text || '')));
console.log('world sync + friend actions + chat ✓');

// the friend leaves (closes the game window): the host removes the player
bob.ws.close(); await bob.closed;
const room = rooms.get(code);
await alice.waitFor(() => room.players.size === 1);
assert.equal(bridge.count, 0);
console.log('friend left cleanly ✓');

// ...and can come back
const bob2 = await new Client('Bob again', `ws://127.0.0.1:${friendPort}/steam-relay`).connect();
bob2.send({ t: 'join', code, name: 'Bob' });
await bob2.waitFor(c => c.state.world);
assert.equal(room.players.size, 2);
console.log('friend rejoined ✓');

// connection dies without a goodbye: the host drops them after the timeout
hub.cut('FRIEND');
clock += PEER_TIMEOUT_MS + 1000; bridge.tick();
await alice.waitFor(() => room.players.size === 1);
console.log('dropped connection cleaned up ✓');

// a packet from someone who never opened a connection is refused, not attached
const strangerEp = hub.endpoint('STRANGER'); const got = [];
strangerEp.onPacket((peer, buf) => got.push(buf[0]));
for (const b of encode(2, JSON.stringify({ t: 'join', code, name: 'Eve' }))) strangerEp.send('HOST', b);
await sleep(100);
assert.equal(room.players.size, 1, 'stranger did not join'); assert.deepEqual(got, [4], 'stranger told to reconnect');
console.log('unknown peer refused ✓');

host.close(); friendSrv.close(); bridge.close(); relay.close();
console.log('✅ p2p bridge test passed');
process.exit(0);
