// Transient visual effects: map pings and delivery trucks.
import * as THREE from 'three';
import { makeSprite, makeTruck, disposeOwned } from './models.js';
import { SUPPLIER_MAP } from '/shared/data.js';

const SUP_COLORS = { pantry: 0xf59e0b, dairy: 0x38bdf8, green: 0x16a34a, polar: 0x6366f1, prime: 0xdc2626, bella: 0x15803d, express: 0xec4899, mega: 0x475569 };

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.trucks = [];
  }
  ping(x, z, color, name) {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.45, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.userData.owned = ring.userData.ownGeo = true; g.add(ring);
    const pin = makeSprite('▼  ' + name, 0.22, { bg: 'rgba(17,20,24,0.78)', color: '#f4f6f2', size: 40, radius: 8, font: 'Barlow', weight: 600 }); pin.position.y = 1.4; pin.material.depthTest = false; g.add(pin);
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
      if (it.kind === 'ping') { const s = 1 + (it.t * 2 % 1) * 1.5; it.ring.scale.set(s, s, s); it.ring.material.opacity = 1 - (it.t * 2 % 1); }
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
