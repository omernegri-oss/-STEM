// Characters: players, customers, employees, pigeons. Interpolates server snapshots and animates them.
import * as THREE from 'three';
import { PRODUCT_MAP, ROLES, PLAYER_ROLES } from '/shared/data.js';
import { makeCharacter, animateCharacter, lookFromSeed, makeSprite, setSpriteText, makeBasket, makeCart, makeBox, makeHandTruck, makePigeon, UNIT_GEOS, mat, B, C } from './models.js';

const ROLE_UNIFORM = {
  cashier: { shirt: 0x2563eb, cap: 0x1d4ed8 },
  stocker: { shirt: 0x16a34a, apron: 0x166534, cap: 0x15803d },
  cleaner: { shirt: 0x0891b2, cap: 0x0e7490 },
  butcher: { shirt: 0xffffff, apron: 0xb91c1c, chef: true },
  deli:    { shirt: 0xfef3c7, apron: 0xca8a04, hairnet: true },
};
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export class Actors {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.players = new Map(); this.customers = new Map(); this.staff = new Map(); this.pigeons = new Map();
    this.info = new Map();
    this.myId = null;
  }

  setPlayersInfo(list) {
    this.info = new Map(list.map(p => [p.id, p]));
    for (const [id, e] of this.players) {
      const inf = this.info.get(id);
      if (!inf) { this.root.remove(e.obj); this.players.delete(id); continue; }
      if (e.color !== inf.color) { this.root.remove(e.obj); this.players.delete(id); }
      else this.updateTag(e, inf);
    }
  }

  updateTag(e, inf) {
    const role = PLAYER_ROLES[inf.role];
    setSpriteText(e.tag, `${role ? role.icon + ' ' : ''}${inf.name}`, 0.3, { bg: inf.color, color: '#fff', size: 40 });
  }

  makePlayer(id) {
    const inf = this.info.get(id) || { name: '?', color: '#888', role: 'manager' };
    const col = new THREE.Color(inf.color).getHex();
    const look = { ...lookFromSeed(id * 7777 + 13), shirt: col, pants: 0x1e293b, cap: col, hat: null, scale: 1, glasses: false, badge: 0xfacc15 };
    const obj = makeCharacter(look);
    const tag = makeSprite(inf.name, 0.3, { bg: inf.color, color: '#fff', size: 40 }); tag.position.y = 2.05; obj.add(tag);
    const emote = makeSprite(' ', 0.5, { bg: null }); emote.position.y = 2.5; emote.visible = false; obj.add(emote);
    // ring marker under players
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; obj.add(ring);
    const carry = new THREE.Group(); obj.add(carry);
    this.root.add(obj);
    const e = { obj, tag, emote, carry, carryKey: '', x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, color: inf.color, first: true };
    this.updateTag(e, inf);
    return e;
  }

  makeCustomer(seed) {
    const look = lookFromSeed(seed);
    const obj = makeCharacter(look);
    const bubble = makeSprite(' ', 0.42, { bg: '#ffffff', border: '#cbd5e1' }); bubble.position.y = 2.05 * look.scale + 0.1; bubble.visible = false; obj.add(bubble);
    const basket = makeBasket([0xef4444, 0x2563eb, 0x16a34a][seed % 3]);
    obj.userData.parts.side.add(basket);
    const items = new THREE.Group(); basket.add(items);
    this.root.add(obj);
    return { obj, bubble, basket, items, itemsKey: '', cart: null, x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, first: true, scale: look.scale };
  }

  makeStaff(role, seed) {
    const u = ROLE_UNIFORM[role] || {};
    const look = { ...lookFromSeed(seed), shirt: u.shirt, apron: u.apron, chef: u.chef, hairnet: u.hairnet, cap: u.cap, hat: null, badge: 0xfacc15, scale: 1 };
    const obj = makeCharacter(look);
    const tag = makeSprite(ROLES[role].icon, 0.3, { bg: null }); tag.position.y = 2.15; obj.add(tag);
    const bubble = makeSprite(' ', 0.36, { bg: '#ffffff', border: '#cbd5e1' }); bubble.position.y = 2.5; bubble.visible = false; obj.add(bubble);
    const carry = new THREE.Group(); obj.userData.parts.hold.add(carry);
    let mop = null;
    if (role === 'cleaner') {
      mop = new THREE.Group(); C(mop, 0.015, 0.015, 1.3, 0x92400e, 0, 0.65, 0); B(mop, 0.3, 0.06, 0.12, 0x7dd3fc, 0, 0.03, 0);
      mop.position.set(0.3, 0, 0.35); mop.rotation.x = 0.3; obj.add(mop);
    }
    this.root.add(obj);
    return { obj, tag, bubble, carry, carryPid: '', mop, x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, first: true };
  }

  applySnapshot(s, myId, localPlayer) {
    this.myId = myId;
    // players
    const seenP = new Set();
    for (const [id, x, z, rot, anim, carry, station, emote] of s.P) {
      seenP.add(id);
      let e = this.players.get(id);
      if (!e) { e = this.makePlayer(id); this.players.set(id, e); }
      if (id === myId && localPlayer) { e.local = true; }
      else { e.tx = x; e.tz = z; e.trot = rot; e.moving = !!anim; if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; } }
      e.station = station;
      e.carryList = carry;
      this.setPlayerCarry(e, carry);
      if (emote) { setSpriteText(e.emote, emote, 0.6, { bg: null, size: 64 }); e.emote.visible = true; } else e.emote.visible = false;
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) { this.root.remove(e.obj); this.players.delete(id); }
    // customers
    const seenC = new Set();
    for (const [id, x, z, rot, moving, thought, basket, seed, flags] of s.C) {
      seenC.add(id);
      let e = this.customers.get(id);
      if (!e) { e = this.makeCustomer(seed); this.customers.set(id, e); }
      e.tx = x; e.tz = z; e.trot = rot; e.moving = !!moving;
      if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; }
      e.flags = flags;
      if (thought) { setSpriteText(e.bubble, thought, 0.42, { bg: '#ffffff', border: flags & 2 ? '#a855f7' : '#cbd5e1' }); e.bubble.visible = true; } else e.bubble.visible = false;
      // VIP sunglasses look: purple glow ring
      if (flags & 2 && !e.vip) { e.vip = true; const s2 = makeSprite('🕶️ VIP', 0.26, { bg: '#7c3aed', color: '#fff', size: 36 }); s2.position.y = 1.85; e.obj.add(s2); }
      const wantCart = !!(flags & 1);
      if (wantCart && !e.cart) { e.cart = makeCart(); e.cart.position.set(0, 0, 0.75); e.obj.add(e.cart); e.basket.visible = false; e.items.parent && e.items.parent.remove(e.items); e.cart.add(e.items); e.items.position.copy(e.cart.userData.itemsAt); }
      const key = basket.join(',');
      if (key !== e.itemsKey) {
        e.itemsKey = key; e.items.clear();
        basket.forEach((pid, i) => {
          const p = PRODUCT_MAP[pid]; if (!p) return;
          const m = new THREE.Mesh(UNIT_GEOS[p.shape], mat(p.color));
          const sc = e.cart ? 1.0 : 0.7;
          m.scale.setScalar(sc);
          if (e.cart) m.position.set(-0.15 + (i % 3) * 0.15, Math.floor(i / 6) * 0.12, -0.2 + Math.floor(i / 3) % 2 * 0.25);
          else m.position.set(-0.09 + (i % 3) * 0.09, 0.06 + Math.floor(i / 3) * 0.06, (i % 2) * 0.06 - 0.03);
          e.items.add(m);
        });
      }
    }
    for (const [id, e] of this.customers) if (!seenC.has(id)) { this.root.remove(e.obj); this.customers.delete(id); }
    // staff
    const seenS = new Set();
    for (const [id, x, z, rot, moving, role, carryPid, seed, thought, state] of s.S) {
      seenS.add(id);
      let e = this.staff.get(id);
      if (!e) { e = this.makeStaff(role, seed); this.staff.set(id, e); }
      e.tx = x; e.tz = z; e.trot = rot; e.moving = !!moving; e.state = state; e.role = role;
      if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; }
      if (carryPid !== e.carryPid) {
        e.carryPid = carryPid; e.carry.clear();
        if (carryPid) { const b = makeBox(carryPid, PRODUCT_MAP[carryPid]?.color ?? 0xffffff); b.position.set(0, -0.2, -0.05); e.carry.add(b); }
      }
      if (thought) { setSpriteText(e.bubble, thought, 0.36, { bg: '#ffffff', border: '#cbd5e1' }); e.bubble.visible = true; } else e.bubble.visible = false;
    }
    for (const [id, e] of this.staff) if (!seenS.has(id)) { this.root.remove(e.obj); this.staff.delete(id); }
    // pigeons
    const seenG = new Set();
    for (const [id, x, z] of s.G || []) {
      seenG.add(id);
      let e = this.pigeons.get(id);
      if (!e) { const obj = makePigeon(); this.root.add(obj); e = { obj, x, z, tx: x, tz: z, t: 0 }; this.pigeons.set(id, e); }
      e.tx = x; e.tz = z;
    }
    for (const [id, e] of this.pigeons) if (!seenG.has(id)) { this.root.remove(e.obj); this.pigeons.delete(id); }
  }

  setPlayerCarry(e, carry) {
    const key = carry.join(',');
    if (key === e.carryKey) return;
    e.carryKey = key;
    e.carry.clear();
    if (!carry.length) return;
    if (carry.length === 1) {
      const b = makeBox(carry[0], PRODUCT_MAP[carry[0]]?.color ?? 0xffffff); b.position.set(0, 0.78, 0.38); e.carry.add(b);
    } else {
      const ht = makeHandTruck(); ht.position.set(0, 0, 0.75); e.carry.add(ht);
      carry.forEach((pid, i) => { const b = makeBox(pid, PRODUCT_MAP[pid]?.color ?? 0xffffff); b.position.set(0, 0.06 + i * 0.37, 0.88); b.scale.setScalar(0.95); e.carry.add(b); });
    }
  }

  update(dt, local) {
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, e] of this.players) {
      if (e.local && local) { e.x = local.x; e.z = local.z; e.rot = local.rot; e.moving = local.moving; }
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k); }
      e.obj.position.set(e.x, 0, e.z); e.obj.rotation.y = e.rot;
      const carrying = e.carryList && e.carryList.length;
      const pose = e.station ? 'work' : carrying ? 'carry' : (e.emote.visible && e.emote.userData.text === '👋') ? 'wave' : 'walk';
      animateCharacter(e.obj, dt, e.moving, pose, 1.1);
      e.tag.visible = !e.local;
    }
    for (const e of this.customers.values()) {
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k);
      e.obj.position.set(e.x, 0, e.z); e.obj.rotation.y = e.rot;
      animateCharacter(e.obj, dt, e.moving, e.cart ? 'cart' : 'basket', 0.85);
      if (e.bubble.visible) e.bubble.position.y = 2.0 * e.scale + 0.15 + Math.sin(performance.now() / 300 + e.x) * 0.04;
    }
    for (const e of this.staff.values()) {
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k);
      e.obj.position.set(e.x, 0, e.z); e.obj.rotation.y = e.rot;
      const pose = e.carryPid ? 'carry' : (e.state === 'working' && !e.moving) || e.state === 'stocking' || e.state === 'clearing' ? 'work' : e.state === 'cleaning' ? 'clean' : 'walk';
      animateCharacter(e.obj, dt, e.moving, pose, 1);
      if (e.mop) e.mop.rotation.z = e.state === 'cleaning' ? Math.sin(performance.now() / 90) * 0.4 : 0;
    }
    for (const e of this.pigeons.values()) {
      e.t += dt;
      const dx = e.tx - e.x, dz = e.tz - e.z;
      e.x += dx * k; e.z += dz * k;
      e.obj.position.set(e.x, 1.2 + Math.sin(e.t * 3) * 0.4, e.z);
      if (Math.abs(dx) + Math.abs(dz) > 0.01) e.obj.rotation.y = Math.atan2(dx, dz);
      const flap = Math.sin(e.t * 25) * 0.7;
      e.obj.userData.wings[0].rotation.z = flap; e.obj.userData.wings[1].rotation.z = -flap;
    }
  }

  positions() {
    const out = [];
    for (const m of [this.players, this.customers, this.staff]) for (const e of m.values()) out.push(e);
    return out;
  }
}
