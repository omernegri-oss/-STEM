// Transient visual effects: floating money text, sparkles, confetti, pings, delivery trucks.
import * as THREE from 'three';
import { makeSprite, makeTruck, mat, UNIT_GEOS, disposeOwned } from './models.js';
import { SUPPLIER_MAP } from '/shared/data.js';

const SUP_COLORS = { pantry: 0xf59e0b, dairy: 0x38bdf8, green: 0x16a34a, polar: 0x6366f1, prime: 0xdc2626, bella: 0x15803d, express: 0xec4899, mega: 0x475569 };

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.trucks = [];
    this.partGeo = new THREE.BoxGeometry(0.08, 0.08, 0.02);
  }
  float(text, x, z, color = '#16a34a', y = 1.8) {
    const s = makeSprite(text, 0.36, { bg: null, color, size: 54 });
    s.position.set(x, y, z); s.material.depthTest = false;
    this.scene.add(s);
    this.items.push({ obj: s, t: 0, life: 1.6, vy: 0.9, kind: 'float' });
  }
  burst(x, y, z, n = 14, colors = [0xfacc15, 0xf97316, 0xec4899, 0x22c55e, 0x3b82f6], speed = 3) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.partGeo, mat(colors[i % colors.length]));
      m.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2, u = Math.random();
      this.scene.add(m);
      this.items.push({ obj: m, t: 0, life: 1.2 + Math.random() * 0.5, v: new THREE.Vector3(Math.cos(a) * speed * u, 2 + Math.random() * speed, Math.sin(a) * speed * u), spin: Math.random() * 10, kind: 'part' });
    }
  }
  // products hop from a carried box onto the shelf
  fly(shape, color, from, to, n = 2) {
    for (let i = 0; i < Math.min(4, n); i++) {
      const m = new THREE.Mesh(UNIT_GEOS[shape] || UNIT_GEOS.box, mat(color));
      const yb = from.y || 0;
      m.position.set(from.x, yb + 1.1, from.z); m.visible = false; this.scene.add(m);
      this.items.push({ obj: m, t: -i * 0.07, life: 0.38, kind: 'fly', from: new THREE.Vector3(from.x, yb + 1.1, from.z), to: new THREE.Vector3(to.x + (Math.random() - 0.5) * 0.8, yb + 0.6 + Math.random() * 0.9, to.z + (Math.random() - 0.5) * 0.3) });
    }
  }
  sparkle(x, z) { this.burst(x, 0.3, z, 8, [0xffffff, 0x7dd3fc, 0xfef08a], 1.5); }
  ping(x, z, color, name) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.userData.owned = ring.userData.ownGeo = true; g.add(ring);
    const pin = makeSprite('📍 ' + name, 0.35, { bg: color, color: '#fff', size: 40 }); pin.position.y = 1.4; pin.material.depthTest = false; g.add(pin);
    g.position.set(x, 0, z); this.scene.add(g);
    this.items.push({ obj: g, ring, t: 0, life: 4, kind: 'ping' });
  }
  truck(padX, padZ, supplier) {
    const sup = SUPPLIER_MAP[supplier];
    const t = makeTruck(SUP_COLORS[supplier] || 0xf97316, sup ? `${sup.icon} ${sup.name}` : '');
    const z = padZ + 5.2;
    t.position.set(padX - 40, 0, z);
    this.scene.add(t);
    this.trucks.push({ obj: t, t: 0, x0: padX - 40, x1: padX, x2: padX + 60, z });
  }
  update(dt) {
    for (const it of this.items) {
      it.t += dt;
      const k = it.t / it.life;
      if (it.kind === 'float') { it.obj.position.y += it.vy * dt; it.obj.material.opacity = 1 - Math.max(0, k - 0.6) / 0.4; }
      else if (it.kind === 'part') {
        it.v.y -= 9 * dt; it.obj.position.addScaledVector(it.v, dt);
        if (it.obj.position.y < 0.02) { it.obj.position.y = 0.02; it.v.multiplyScalar(0.3); }
        it.obj.rotation.x += it.spin * dt; it.obj.rotation.y += it.spin * dt;
      } else if (it.kind === 'fly') {
        const k2 = Math.max(0, Math.min(1, it.t / it.life)); it.obj.visible = it.t >= 0;
        it.obj.position.lerpVectors(it.from, it.to, k2); it.obj.position.y += Math.sin(k2 * Math.PI) * 0.6; it.obj.rotation.y = k2 * 6;
      } else if (it.kind === 'ping') { const s = 1 + (it.t * 2 % 1) * 1.5; it.ring.scale.set(s, s, s); it.ring.material.opacity = 1 - (it.t * 2 % 1); }
    }
    this.items = this.items.filter(it => { if (it.t >= it.life) { this.scene.remove(it.obj); disposeOwned(it.obj); return false; } return true; });
    for (const tr of this.trucks) {
      tr.t += dt;
      // drive in (2.5s), wait (2s), drive out (3s)
      let x;
      if (tr.t < 2.5) { const k = tr.t / 2.5; x = tr.x0 + (tr.x1 - tr.x0) * (1 - Math.pow(1 - k, 3)); }
      else if (tr.t < 4.5) x = tr.x1;
      else { const k = (tr.t - 4.5) / 3; x = tr.x1 + (tr.x2 - tr.x1) * k * k; }
      tr.obj.position.x = x;
      tr.obj.position.y = tr.t > 2.5 && tr.t < 4.5 ? 0 : Math.abs(Math.sin(tr.t * 20)) * 0.02;
    }
    this.trucks = this.trucks.filter(tr => { if (tr.t > 8) { this.scene.remove(tr.obj); disposeOwned(tr.obj); return false; } return true; });
  }
}
