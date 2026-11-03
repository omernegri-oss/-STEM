// Multiplayer protocol test: 4 WebSocket clients share one store; checks sync, limits, persistence.
import assert from 'node:assert/strict';
import os from 'node:os'; import fs from 'node:fs'; import path from 'node:path';
import WebSocket from 'ws';
process.env.SAVES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-mp-'));
const { startServer, rooms } = await import('../server/index.js');

const PORT = 3190;
const srv = startServer(PORT);
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.state = {}; }
  async connect() {
    this.ws = new WebSocket(`ws://localhost:${PORT}`);
    await new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', d => {
      const m = JSON.parse(d); this.msgs.push(m);
      if (m.t === 'joined') this.id = m.id;
      if (m.t === 'w') this.state.world = m.world;
      if (m.t === 'm') this.state.meta = m.meta;
      if (m.t === 's') this.state.snap = m;
      if (m.t === 'lobby') this.state.lobby = m;
      if (m.t === 'err' || (m.t === 'fx' && m.k === 'err')) this.lastErr = m.text;
    });
    return this;
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  act(a, d = {}) { this.send({ t: 'a', a, ...d }); }
  async waitFor(fn, ms = 4000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn(this)) return true; await sleep(30); } throw new Error(`${this.name}: timeout waiting`); }
}

const A = await new Client('A').connect();
A.send({ t: 'create', name: 'Ann', color: '#ef4444' });
await A.waitFor(c => c.state.lobby);
const code = A.state.lobby.code;
const others = [];
for (const n of ['Ben', 'Cat', 'Dov']) { const c = await new Client(n).connect(); c.send({ t: 'join', code, name: n }); others.push(c); }
for (const c of others) await c.waitFor(c => c.state.lobby && c.state.lobby.players.length >= 2);
await A.waitFor(c => c.state.lobby.players.length === 4);
// unique colours assigned
assert.equal(new Set(A.state.lobby.players.map(p => p.color)).size, 4, 'unique colours');
// 5th player rejected
const E = await new Client('Eve').connect(); E.send({ t: 'join', code, name: 'Eve' });
await E.waitFor(c => c.lastErr); assert.match(E.lastErr, /full/);
// only the host can start
others[0].send({ t: 'start' }); await sleep(200);
assert.equal(A.state.lobby.started, false);
A.send({ t: 'start' });
for (const c of [A, ...others]) await c.waitFor(c => c.state.world && c.state.meta);
assert.equal(A.state.meta.phase, 'naming');

// naming: everyone must vote, editing resets votes
A.act('nameDraft', { name: 'Quad Mart' }); await sleep(150);
A.act('nameVote'); others[0].act('nameVote'); others[1].act('nameVote'); await sleep(300);
assert.equal(A.state.meta.phase, 'naming');
others[2].act('nameDraft', { name: 'Quad Market' }); await sleep(300);
assert.deepEqual(A.state.meta.nameVotes, [], 'edit resets votes');
for (const c of [A, ...others]) c.act('nameVote');
for (const c of [A, ...others]) await c.waitFor(c => c.state.meta.phase === 'prep');
assert.equal(others[1].state.world.name, 'Quad Market');

// shared building + shared cash
others[0].act('place', { type: 'shelf', x: 2, z: 2, rot: 0 });
await A.waitFor(c => c.state.world.furniture.length === 1);
await others[2].waitFor(c => c.state.meta.cash === 4750);
// shared ordering, delivery visible to all
others[1].act('order', { supplier: 'pantry', items: [{ pid: 'cereal', boxes: 2 }] });
A.act('speed', { v: 3 });
await others[2].waitFor(c => c.state.world.boxes.length === 2, 20000);

// positions are relayed; carried boxes are visible to others
const box = others[2].state.world.boxes[0];
others[2].send({ t: 'p', x: box.x, z: box.z, rot: 0, anim: 0 }); await sleep(100);
others[2].act('pickup', { id: box.id });
await A.waitFor(c => { const p = c.state.snap?.P.find(p => p[0] === others[2].id); return p && p[5].length === 1 && Math.abs(p[1] - box.x) < 0.01; });
// disconnecting while carrying drops the box back into the world
others[2].ws.close();
await A.waitFor(c => c.state.world.boxes.length === 2 && c.state.lobby.players.length === 3 || c.state.world.boxes.length === 2);
// chat
others[0].send({ t: 'chat', text: 'hello team' });
await A.waitFor(c => c.msgs.some(m => m.t === 'chat' && m.text === 'hello team' && m.from === 'Ben'));
// late joiner gets full state immediately
const F = await new Client('Fay').connect(); F.send({ t: 'join', code, name: 'Fay' });
await F.waitFor(c => c.state.world && c.state.world.name === 'Quad Market' && c.state.meta);

// persistence: everyone leaves, room saved, can be resumed by code
for (const c of [A, others[0], others[1], F]) c.ws.close();
await sleep(400);
const room = rooms.get(code); room.save();
const G = await new Client('Gus').connect();
G.send({ t: 'list' });
await G.waitFor(c => c.msgs.some(m => m.t === 'rooms'));
rooms.delete(code);
G.send({ t: 'create', load: code, name: 'Gus' });
await G.waitFor(c => c.state.lobby && c.state.lobby.loaded);
G.send({ t: 'start' });
await G.waitFor(c => c.state.world && c.state.world.furniture.length === 1 && c.state.meta.phase === 'prep');
// a second store cannot take the same name
const H = await new Client('Hal').connect(); H.send({ t: 'create', name: 'Hal' });
await H.waitFor(c => c.state.lobby); H.send({ t: 'start' }); await H.waitFor(c => c.state.meta);
H.act('nameDraft', { name: 'quad market' }); await sleep(100); H.act('nameVote');
await H.waitFor(c => c.lastErr && /taken/.test(c.lastErr));
console.log('✅ multiplayer test passed');
srv.close(); process.exit(0);
