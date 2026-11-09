// Characters: players, customers, employees, pigeons. Interpolates server snapshots and animates them.
import * as THREE from 'three';
import { PRODUCT_MAP, ROLES, PLAYER_ROLES } from '/shared/data.js';
import { heightAt } from '/shared/grid.js';
import { disposeOwned, makeCharacter, animateCharacter, lookFromSeed, makeSprite, setSpriteText, makeBasket, makeCart, makeBox, makeFBox, makeHandTruck, makePigeon, UNIT_GEOS, mat, B, C, productMaterial, S as Sph, makeBaton } from './models.js';

// visual for one carried item code: 'milk' | 'f:shelf' | 'raw:ribeye' | 'pack:ribeye'
export function carryModel(code) {
  if (code.startsWith('f:')) return makeFBox(code.slice(2));
  if (code.startsWith('raw:') || code.startsWith('pack:')) {
    const [kind, pid] = code.split(':'); const p = PRODUCT_MAP[pid]; const g = new THREE.Group();
    if (kind === 'raw') { B(g, 0.32, 0.03, 0.24, 0xe5e7eb, 0, 0.0, 0); const m = new THREE.Mesh(UNIT_GEOS[p?.shape] || UNIT_GEOS.slab, mat(p?.color ?? 0xb91c1c)); m.scale.setScalar(1.3); m.position.y = 0.02; g.add(m); }
    else { B(g, 0.26, 0.1, 0.2, 0xfef3c7, 0, 0.05, 0); B(g, 0.27, 0.02, 0.05, 0xdc2626, 0, 0.1, 0); }
    return g;
  }
  return makeBox(code, PRODUCT_MAP[code]?.color ?? 0xffffff);
}
const GESTURES = { wave: 'wave', pnt: 'point', thum: 'thumbs', shrg: 'shrug', clap: 'clap', nod: 'nod' };

// store uniforms: brand-green polos with a name badge; white coat for the butcher, black polo at the deli
const ROLE_UNIFORM = {
  cashier: { shirt: 0x1f5135, pants: 0x1a1a1a },
  stocker: { shirt: 0x1f5135, apron: 0x2b2f33, pants: 0x2c3e5a },
  cleaner: { shirt: 0x55595d, pants: 0x3a3a3a },
  butcher: { shirt: 0xf2f2ef, apron: 0x2b2f33, chef: true, pants: 0x1a1a1a },
  deli:    { shirt: 0x1a1a1a, apron: 0x6b4a2a, hairnet: true, pants: 0x1a1a1a },
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
      if (!inf) { this.root.remove(e.obj); disposeOwned(e.obj); this.players.delete(id); continue; }
      if (e.color !== inf.color) { this.root.remove(e.obj); disposeOwned(e.obj); this.players.delete(id); }
      else this.updateTag(e, inf);
    }
  }

  updateTag(e, inf) {
    const role = PLAYER_ROLES[inf.role];
    void role; setSpriteText(e.tag, inf.name, 0.17, { bg: 'rgba(17,20,24,0.72)', color: '#f4f6f2', size: 40, radius: 8, pad: 12, font: 'Barlow', weight: 600 });
  }

  makePlayer(id) {
    const inf = this.info.get(id) || { name: '?', color: '#888', role: 'manager' };
    const col = new THREE.Color(inf.color).getHex();
    const muted = new THREE.Color(col).lerp(new THREE.Color(0x4a4d50), 0.45).getHex(); // player colour, toned down like a real shirt
    const look = { ...lookFromSeed(id * 7777 + 13), shirt: muted, pants: 0x2c3e5a, cap: null, hat: null, scale: 1, glasses: false, badge: 0xe9e6df };
    const obj = makeCharacter(look);
    const tag = makeSprite(inf.name, 0.17, { bg: 'rgba(17,20,24,0.72)', color: '#f4f6f2', size: 40, radius: 8, pad: 12, font: 'Barlow', weight: 600 }); tag.position.y = 2.08; obj.add(tag);
    const emote = { visible: false, userData: { text: '' } }; // gestures are animations, not icons
    // ring marker under players
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.7 })); ring.userData.owned = ring.userData.ownGeo = true;
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; obj.add(ring);
    const carry = new THREE.Group(); obj.add(carry);
    const stars = null;
    this.root.add(obj);
    const e = { obj, tag, emote, carry, stars, carryKey: '', x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, color: inf.color, first: true, floor: 0, kind: 'player', swingT: 0 };
    this.updateTag(e, inf);
    return e;
  }

  makeCustomer(seed) {
    const look = lookFromSeed(seed);
    const obj = makeCharacter(look);
    const bubble = { visible: false, position: { y: 0 } }, stars = null; // mood shows in body language
    const basket = makeBasket([0xef4444, 0x2563eb, 0x16a34a][seed % 3]);
    obj.userData.parts.side.add(basket);
    const items = new THREE.Group(); basket.add(items);
    this.root.add(obj);
    return { obj, bubble, basket, items, stars, itemsKey: '', cart: null, x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, first: true, scale: look.scale, floor: 0, kind: 'customer' };
  }

  makeStaff(role, seed) {
    const u = ROLE_UNIFORM[role] || {};
    const look = { ...lookFromSeed(seed), shirt: u.shirt, apron: u.apron, chef: u.chef, hairnet: u.hairnet, cap: null, hat: null, badge: 0xe9e6df, pants: u.pants ?? 0x1a1a1a, jacket: null, scale: 1 };
    const obj = makeCharacter(look);
    const tag = { visible: false }, bubble = { visible: false, position: { y: 0 } };
    const carry = new THREE.Group(); obj.userData.parts.hold.add(carry);
    const stars = null;
    let mop = null;
    if (role === 'cleaner') {
      mop = new THREE.Group(); C(mop, 0.015, 0.015, 1.3, 0x92400e, 0, 0.65, 0); B(mop, 0.3, 0.06, 0.12, 0x7dd3fc, 0, 0.03, 0);
      mop.position.set(0.3, 0, 0.35); mop.rotation.x = 0.3; obj.add(mop);
    }
    this.root.add(obj);
    return { obj, tag, bubble, carry, stars, carryPid: '', mop, x: 0, z: 0, rot: 0, tx: 0, tz: 0, trot: 0, moving: false, first: true, floor: 0, kind: 'staff' };
  }

  applySnapshot(s, myId, localPlayer) {
    this.myId = myId;
    // players
    const seenP = new Set();
    for (const [id, x, z, rot, anim, carry, station, emote, floor, stun, baton] of s.P) {
      seenP.add(id);
      let e = this.players.get(id);
      if (!e) { e = this.makePlayer(id); this.players.set(id, e); }
      e.stun = !!stun;
      if (id === myId && localPlayer) { e.local = true; }
      else { e.tx = x; e.tz = z; e.trot = rot; e.moving = !!anim; e.floor = floor || 0; if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; } }
      e.carryDept = carry.some(c => c.startsWith('raw:') || c.startsWith('pack:'));
      e.station = station;
      e.carryList = carry;
      this.setPlayerCarry(e, carry);
      e.gesture = emote || '';
      this.setBaton(e, !!baton);
    }
    for (const [id, e] of this.players) if (!seenP.has(id)) { this.root.remove(e.obj); disposeOwned(e.obj); this.players.delete(id); }
    // customers
    const seenC = new Set();
    for (const [id, x, z, rot, moving, thought, basket, seed, flags, floor] of s.C) {
      seenC.add(id);
      let e = this.customers.get(id);
      if (!e) { e = this.makeCustomer(seed); this.customers.set(id, e); }
      e.tx = x; e.tz = z; e.trot = rot; e.moving = !!moving; e.floor = floor || 0; e.stun = !!(flags & 16);
      if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; }
      e.flags = flags;
      e.upset = !!thought; // annoyed shoppers shake their head
      // VIP sunglasses look: purple glow ring
      const wantCart = !!(flags & 1);
      if (wantCart && !e.cart) { e.cart = makeCart(); e.cart.position.set(0, 0, 0.75); e.obj.add(e.cart); e.basket.visible = false; e.items.parent && e.items.parent.remove(e.items); e.cart.add(e.items); e.items.position.copy(e.cart.userData.itemsAt); }
      const key = basket.join(',');
      if (key !== e.itemsKey) {
        e.itemsKey = key; e.items.clear();
        basket.forEach((pid, i) => {
          const p = PRODUCT_MAP[pid]; if (!p) return;
          const m = new THREE.Mesh(UNIT_GEOS[p.shape], productMaterial(p));
          const sc = e.cart ? 1.0 : 0.7;
          m.scale.setScalar(sc);
          if (e.cart) m.position.set(-0.15 + (i % 3) * 0.15, Math.floor(i / 6) * 0.12, -0.2 + Math.floor(i / 3) % 2 * 0.25);
          else m.position.set(-0.09 + (i % 3) * 0.09, 0.06 + Math.floor(i / 3) * 0.06, (i % 2) * 0.06 - 0.03);
          e.items.add(m);
        });
      }
    }
    for (const [id, e] of this.customers) if (!seenC.has(id)) { this.root.remove(e.obj); disposeOwned(e.obj); this.customers.delete(id); }
    // staff
    const seenS = new Set();
    for (const [id, x, z, rot, moving, role, carryPid, seed, thought, state, floor, stun] of s.S) {
      seenS.add(id);
      let e = this.staff.get(id);
      if (!e) { e = this.makeStaff(role, seed); this.staff.set(id, e); }
      e.tx = x; e.tz = z; e.trot = rot; e.moving = !!moving; e.state = state; e.stage = state; e.role = role; e.floor = floor || 0; e.stun = !!stun;
      e.carryDept = carryPid && (carryPid.startsWith('raw:') || carryPid.startsWith('pack:'));
      if (e.first) { e.x = x; e.z = z; e.rot = rot; e.first = false; }
      if (carryPid !== e.carryPid) {
        e.carryPid = carryPid; e.carry.clear();
        if (carryPid) { const b = carryModel(carryPid); b.position.set(0, -0.2, -0.05); e.carry.add(b); }
      }
      e.upset = !!thought;
    }
    for (const [id, e] of this.staff) if (!seenS.has(id)) { this.root.remove(e.obj); disposeOwned(e.obj); this.staff.delete(id); }
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
      const b = carryModel(carry[0]); b.position.set(0, carry[0].startsWith('f:') ? 0.62 : carry[0].includes(':') ? 1.0 : 0.82, carry[0].startsWith('f:') ? 0.55 : 0.44); e.carry.add(b);
    } else {
      const ht = makeHandTruck(); ht.position.set(0, 0, 0.75); e.carry.add(ht);
      carry.forEach((pid, i) => { const b = carryModel(pid); b.position.set(0, 0.06 + i * 0.37, 0.88); b.scale.setScalar(0.95); e.carry.add(b); });
    }
  }

  setDims(W, floors, viewFloor) { this.W = W; this.floors = floors; this.viewFloor = viewFloor; }
  place(e, scale = 1) {
    const y = heightAt(this.W || 12, this.floors || 1, e.floor || 0, e.x, e.z);
    e.obj.position.set(e.x, y, e.z); e.obj.rotation.y = e.rot;
    e.obj.visible = !(y > 1.9 && (this.viewFloor || 0) < 1) && !(e.local && this.hideLocal);
    // a punched person staggers: the whole body sways for a moment
    if (e.stun) { const t = performance.now() / 160; e.obj.rotation.z = Math.sin(t) * 0.12; e.obj.rotation.x = Math.cos(t * 0.7) * 0.06; } else if (e.obj.rotation.z) { e.obj.rotation.z = 0; e.obj.rotation.x = 0; }
  }
  swing(id) { const e = this.players.get(id); if (e) e.swingT = 0.3; }
  // the baton sits in the right hand, pointing forward
  setBaton(e, on) {
    if (on && !e.batonObj) { e.batonObj = makeBaton(); e.batonObj.position.set(0, -0.28, 0.03); e.obj.userData.parts.elbowR.add(e.batonObj); }
    if (e.batonObj) e.batonObj.visible = on;
    e.baton = on;
  }
  update(dt, local) {
    const k = 1 - Math.exp(-dt * 12);
    for (const [id, e] of this.players) {
      if (e.local && local) { e.x = local.x; e.z = local.z; e.rot = local.rot; e.moving = local.moving; e.floor = local.floor; }
      else { e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k); }
      this.place(e);
      const carrying = e.carryList && e.carryList.length;
      const pose = e.station ? 'work' : carrying ? 'carry' : (e.gesture && !e.moving) ? GESTURES[e.gesture] || 'walk' : 'walk';
      animateCharacter(e.obj, dt, e.moving, pose, 1.1);
      if (e.swingT > 0) { e.swingT -= dt; const P = e.obj.userData.parts; P.armR.rotation.x = -1.6 - Math.sin((0.3 - e.swingT) / 0.3 * Math.PI) * 0.6; P.armR.rotation.z = 0.2; }
      else if (e.baton && !carrying) { const P = e.obj.userData.parts; P.armR.rotation.x = -0.45; P.elbowR.rotation.x = -0.7; } // baton held ready
      if (e.stun) { const P = e.obj.userData.parts; P.head.rotation.z = Math.sin(performance.now() / 150) * 0.15; }
      e.tag.visible = !e.local;
    }
    for (const e of this.customers.values()) {
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k);
      this.place(e);
      animateCharacter(e.obj, dt, e.moving, e.cart ? 'cart' : 'basket', 0.85);
      if (e.upset) { const P = e.obj.userData.parts; P.head.rotation.y = Math.sin(performance.now() / 110) * 0.35; }
    }
    for (const e of this.staff.values()) {
      e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; e.rot = lerpAngle(e.rot, e.trot, k);
      this.place(e);
      const pose = e.carryPid ? 'carry' : (e.state === 'working' && !e.moving) || ['stocking', 'clearing', 'cutting', 'taking'].includes(e.state) ? 'work' : e.state === 'cleaning' ? 'clean' : 'walk';
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
