// Renders the shared world state: the store building (1 or 2 floors), furniture, labelled products, boxes, dirt.
import * as THREE from 'three';
import { FURNITURE, PRODUCT_MAP, FLOORS, WALLS, FLOOR_H, stairInfo, SHAPE_DIMS, slotCap } from '/shared/data.js';
import { Grid, center, dims } from '/shared/grid.js';
import { B, C, mat, makeFurniture, slotLayout, UNIT_GEOS, makeSprite, setSpriteText, textTexture, makeLabel, productMaterial, makeBox, makeFBox, beltTexture, disposeOwned } from './models.js';
import { tileTexture } from './scene.js';

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), tmpC = new THREE.Color();
const EXPIRED = new THREE.Color(0x6b5b3e);
const UP = new THREE.Vector3(0, 1, 0);
const DOOR_TYPES = new Set(['fridge', 'freezer_upright', 'freezer', 'butcher', 'deli']);
let vinylTex = null;
function vinylTexture() {
  if (vinylTex) return vinylTex.clone();
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#e9eaec' : '#f1f2f3'; g.fillRect(i * 128, j * 128, 128, 128); }
  for (let k = 0; k < 2600; k++) { const v = Math.round(150 + Math.random() * 80); g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 5) + ',' + (0.25 + Math.random() * 0.4) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5); }
  g.strokeStyle = 'rgba(150,155,160,0.55)'; g.lineWidth = 1.5;
  for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 256); g.stroke(); g.beginPath(); g.moveTo(0, i * 128); g.lineTo(256, i * 128); g.stroke(); }
  vinylTex = new THREE.CanvasTexture(c); vinylTex.wrapS = vinylTex.wrapT = THREE.RepeatWrapping; vinylTex.colorSpace = THREE.SRGBColorSpace; vinylTex.anisotropy = 8;
  return vinylTex.clone();
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.shell = new THREE.Group(); this.root.add(this.shell);
    this.floorRoots = [new THREE.Group(), new THREE.Group()];
    this.floorRoots[1].position.y = FLOOR_H;
    for (const r of this.floorRoots) this.root.add(r);
    this.upperShell = new THREE.Group(); this.root.add(this.upperShell); // upper floor slab & walls (hidden when you're downstairs)
    this.furn = new Map();
    this.state = null;
    this.grids = [new Grid(12, 9, 5)];
    this.grid = this.grids[0];
    this.shellKey = '';
    this.doors = []; this.fadeWalls = []; this.frontMats = [];
    this.time = 0;
    this.units = new Map();      // `${floor}:${pid}` -> InstancedMesh
    this.boxRoots = [new THREE.Group(), new THREE.Group()];
    this.floorRoots.forEach((r, i) => r.add(this.boxRoots[i]));
    this.boxMeshes = new Map(); this.boxList = [];
    this.dirtMeshes = new Map();
    this.beltRoot = new THREE.Group(); this.root.add(this.beltRoot); this.beltItems = [];
    this.beltKey = '';
    this.viewFloor = 0;
    this.chars = [];
  }

  set(w) {
    this.state = w;
    const key = [w.w, w.d, w.doorX, w.floor, w.wall, w.name, w.floors].join('|');
    if (key !== this.shellKey) { this.shellKey = key; this.buildShell(w); this.shellChanged = true; }
    this.grids = [new Grid(w.w, w.d, w.doorX, 0, w.floors || 1)];
    if ((w.floors || 1) > 1) this.grids.push(new Grid(w.w, w.d, w.doorX, 1, w.floors));
    for (const g of this.grids) g.build(w.furniture);
    this.grid = this.grids[0];
    this.syncFurniture(w);
    this.rebuildUnits(w);
    this.syncBoxes(w);
    this.syncDirt(w);
  }
  gridFor(floor) { return this.grids[floor] || this.grids[0]; }

  setViewFloor(f) {
    this.viewFloor = f;
    this.floorRoots[1].visible = f >= 1;
    this.upperShell.visible = f >= 1;
  }

  // ---------------------------------------------------------------------------- building
  buildShell(w) {
    this.shell.clear(); this.upperShell.clear(); this.doors = []; this.fadeWalls = [];
    const W = w.w, D = w.d, floors = w.floors || 1;
    const fl = FLOORS.find(f => f.id === w.floor) || FLOORS[0];
    const wl = WALLS.find(x => x.id === w.wall) || WALLS[0];
    const floorTex = () => { const t = vinylTexture(); t.repeat.set(W / 1.2, D / 1.2); return t; };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.32, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0.002, D / 2); floor.receiveShadow = true; this.shell.add(floor);
    const sill = new THREE.Mesh(new THREE.PlaneGeometry(W, 1), mat(0xd6d3d1)); sill.rotation.x = -Math.PI / 2; sill.position.set(W / 2, 0.003, D + 0.5); this.shell.add(sill);
    const H = 3.4, wc = new THREE.Color(wl.color).getHex();
    const mkWall = (parent, w_, d_, x, z, side, y0 = 0, h = H) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w_, h, d_), new THREE.MeshStandardMaterial({ color: wc, roughness: 0.9, transparent: true })); m.position.set(x, y0 + h / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w_ + 0.02, 0.18, d_ + 0.02), new THREE.MeshStandardMaterial({ color: 0x475569, transparent: true })); base.position.set(x, y0 + 0.09, z); g.add(base);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w_ + 0.02, 0.22, d_ + 0.02), new THREE.MeshStandardMaterial({ color: 0xf97316, transparent: true })); stripe.position.set(x, y0 + 2.7, z); g.add(stripe);
      parent.add(g); this.fadeWalls.push({ side, mats: [m.material, base.material, stripe.material] });
    };
    mkWall(this.shell, W + 0.4, 0.2, W / 2, -0.1, 'back');
    mkWall(this.shell, 0.2, D + 1, -0.1, (D + 1) / 2, 'left');
    mkWall(this.shell, 0.2, D + 1, W + 0.1, (D + 1) / 2, 'right');
    // storefront
    const front = new THREE.Group(); this.shell.add(front);
    const fz = D + 0.5, dx0 = w.doorX, dx1 = w.doorX + 2;
    const glassM = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const baseM = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8, transparent: true });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, transparent: true });
    const fasciaM = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, transparent: true });
    const glassRow = (parent, x0, x1, y0, withBase) => {
      if (x1 - x0 <= 0.01) return;
      const cx = (x0 + x1) / 2, ww = x1 - x0;
      if (withBase) { const b = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.5, 0.25), baseM); b.position.set(cx, y0 + 0.25, fz); b.castShadow = true; parent.add(b); }
      const gl = new THREE.Mesh(new THREE.BoxGeometry(ww, 2.1, 0.04), glassM); gl.position.set(cx, y0 + 1.55, fz); parent.add(gl);
      for (let x = x0; x <= x1 + 0.01; x += Math.max(1, ww / Math.round(ww / 2))) { const mu = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.1, 0.08), frameM); mu.position.set(Math.min(x, x1), y0 + 1.55, fz); parent.add(mu); }
    };
    glassRow(front, 0, dx0, 0, true); glassRow(front, dx1, W, 0, true);
    const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.1, 0.3), frameM); top.position.set(W / 2, 2.62, fz); front.add(top);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.95, 0.3), fasciaM); fascia.position.set(W / 2, 3.12, fz); fascia.castShadow = true; front.add(fascia);
    const name = w.name || 'Your Supermarket';
    const sign = textTexture(name.toUpperCase(), { size: 96, bg: '#ffffff', color: '#ea580c', pad: 26, radius: 30, border: '#fdba74', font: 'Fredoka' });
    const sh = 0.78, swid = Math.min(W - 1, sh * sign.aspect);
    const signM = new THREE.MeshStandardMaterial({ map: sign.tex, emissive: 0xffffff, emissiveMap: sign.tex, emissiveIntensity: 0.25, transparent: true });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(swid, swid / sign.aspect), signM); signMesh.position.set(W / 2, 3.12, fz + 0.16); front.add(signMesh);
    for (const x of [dx0, dx1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.2), frameM); p.position.set(x, 1.3, fz); front.add(p); }
    for (let i = 0; i < 2; i++) {
      const door = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.4, 0.05), glassM); pane.position.y = 1.2; door.add(pane);
      for (const y of [2.38, 0.04]) { const fr = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.07), frameM); fr.position.y = y; door.add(fr); }
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.07), frameM); edge.position.set(i === 0 ? 0.47 : -0.47, 1.2, 0); door.add(edge);
      const base = dx0 + 0.5 + i;
      door.position.set(base, 0, fz + (i ? 0.03 : -0.03));
      door.userData = { base, dir: i === 0 ? -1 : 1, open: 0 };
      front.add(door); this.doors.push(door);
    }
    for (let i = 0; i < 6; i++) B(front, 0.52, 0.05, 1.3, i % 2 ? 0xffffff : 0xef4444, dx0 - 0.5 + 0.26 + i * 0.52, 2.45, fz + 0.65).rotation.x = 0.28;
    const matM = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), mat(0x7f1d1d)); matM.rotation.x = -Math.PI / 2; matM.position.set(dx0 + 1, 0.006, D - 0.6); this.shell.add(matM);
    this.frontMats = [baseM, frameM, fasciaM, signM];
    // entrance pylon sign with the store name (outside, next to the door)
    const py = new THREE.Group(); py.position.set(dx0 - 1.2, 0, D + 1.6); this.shell.add(py);
    C(py, 0.08, 0.1, 2.6, 0x334155, 0, 1.3, 0);
    B(py, 1.9, 0.7, 0.18, 0xf97316, 0, 2.75, 0);
    const pt = textTexture(name, { size: 64, bg: '#ffffff', color: '#ea580c', pad: 18, radius: 16, font: 'Fredoka' });
    const pw = Math.min(1.75, 0.55 * pt.aspect), pm = new THREE.MeshStandardMaterial({ map: pt.tex, emissive: 0xffffff, emissiveMap: pt.tex, emissiveIntensity: 0.35 });
    for (const [z, r] of [[0.1, 0], [-0.1, Math.PI]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, pw / pt.aspect), pm); m.position.set(0, 2.75, z); m.rotation.y = r; py.add(m); }
    const op = makeLabel('OPEN 8:00 – 22:00', 0.12, { bg: '#1e293b', color: '#fde047', size: 32 }, 1.2); op.position.set(0, 2.25, 0.1); py.add(op);

    this.ceiling = new THREE.Group(); this.shell.add(this.ceiling);
    this.buildCeiling(this.ceiling, W, D, floors > 1 ? FLOOR_H - 0.2 : 3.35);
    this.ceiling2 = null;
    if (floors > 1) { this.ceiling2 = new THREE.Group(); this.upperShell.add(this.ceiling2); this.buildCeiling(this.ceiling2, W, D, FLOOR_H + 3.35); }
    if (floors > 1) this.buildUpperFloor(w, floorTex, mkWall, glassRow, glassM, frameM, fasciaM);
    this.setCeilingVisible(this.ceilingOn || false);
  }

  buildCeiling(group, W, D, y) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#d1d5db'; g.fillRect(0, 0, 128, 3); g.fillRect(0, 0, 3, 128);
    for (let i = 0; i < 260; i++) { g.fillStyle = 'rgba(120,120,120,' + (Math.random() * 0.15) + ')'; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
    const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(W / 1.2, D / 1.2); tex.colorSpace = THREE.SRGBColorSpace;
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D + 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(W / 2, y, (D + 1) / 2); group.add(ceil);
    const panelM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfffbf2, emissiveIntensity: 2.2 });
    const frameM = mat(0xd1d5db, { metal: 0.5 });
    for (let x = 2; x < W - 1; x += 3) for (let z = 1.6; z < D - 0.5; z += 2.4) {
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.03, 0.45), frameM); fr.position.set(x, y - 0.015, z); group.add(fr);
      const pn = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 0.38), panelM); pn.rotation.x = Math.PI / 2; pn.position.set(x, y - 0.032, z); group.add(pn);
    }
  }
  setCeilingVisible(v) { this.ceilingOn = v; if (this.ceiling) this.ceiling.visible = v; if (this.ceiling2) this.ceiling2.visible = v; }

  buildUpperFloor(w, floorTex, mkWall, glassRow, glassM, frameM, fasciaM) {
    const W = w.w, D = w.d, s = stairInfo(W), U = this.upperShell;
    // slab with a hole for the stairwell
    const slabM = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.8 });
    const slab = (x0, x1, z0, z1) => { if (x1 <= x0 || z1 <= z0) return; const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.2, z1 - z0), slabM); m.position.set((x0 + x1) / 2, FLOOR_H - 0.1, (z0 + z1) / 2); m.receiveShadow = true; m.castShadow = true; U.add(m); };
    slab(0, s.x, 0, D + 1); slab(s.x, W, 0, s.z0); slab(s.x, W, s.z1, D + 1);
    const tex = floorTex();
    const top = (x0, x1, z0, z1) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 })); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, FLOOR_H + 0.003, (z0 + z1) / 2); m.receiveShadow = true; U.add(m); };
    top(0, s.x, 0, D); top(s.x, W, 0, s.z0); top(s.x, W, s.z1, D);
    // railings around the stairwell
    const railM = new THREE.MeshStandardMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.35, depthWrite: false });
    const rail = (x, z, w_, d_) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w_, 1, d_), railM); m.position.set(x, FLOOR_H + 0.5, z); U.add(m); B(U, w_ + 0.02, 0.05, d_ + 0.02, 0x475569, x, FLOOR_H + 1.02, z); };
    rail(s.x, (s.z0 + s.z1) / 2, 0.05, s.z1 - s.z0); rail(s.x + 1, s.z1, 2, 0.05);
    // upper walls + storefront glass
    mkWall(U, W + 0.4, 0.2, W / 2, -0.1, 'back', FLOOR_H);
    mkWall(U, 0.2, D + 1, -0.1, (D + 1) / 2, 'left', FLOOR_H);
    mkWall(U, 0.2, D + 1, W + 0.1, (D + 1) / 2, 'right', FLOOR_H);
    const fz = D + 0.5;
    const up = new THREE.Group(); U.add(up);
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.5, 0.25), new THREE.MeshStandardMaterial({ color: 0xb45309, transparent: true })); base.position.set(W / 2, FLOOR_H + 0.25, fz); up.add(base);
    glassRow(up, 0, W, FLOOR_H, false);
    const fas = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.6, 0.3), fasciaM); fas.position.set(W / 2, FLOOR_H + 2.95, fz); up.add(fas);
    this.frontMats.push(base.material);
    // stairs (always visible, part of the ground floor)
    const st = new THREE.Group(); this.shell.add(st);
    const steps = 14, run = (s.z1 - s.z0) / steps, rise = FLOOR_H / steps;
    for (let i = 0; i < steps; i++) {
      const z = s.z1 - (i + 0.5) * run, y = (i + 1) * rise;
      B(st, 1.96, rise, run + 0.01, i % 2 ? 0xd6d3d1 : 0xe7e5e4, s.x + 1, y - rise / 2, z);
    }
    const stringer = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, Math.hypot(s.z1 - s.z0, FLOOR_H)), mat(0x475569));
    stringer.position.set(s.x + 0.02, FLOOR_H / 2 + 0.25, (s.z0 + s.z1) / 2); stringer.rotation.x = Math.atan2(FLOOR_H, s.z1 - s.z0); st.add(stringer);
    const handrail = stringer.clone(); handrail.scale.set(0.5, 0.25, 1); handrail.position.y += 0.9; st.add(handrail);
    for (let i = 0; i <= 4; i++) { const z = s.z1 - i * (s.z1 - s.z0) / 4; C(st, 0.025, 0.025, 1, 0x475569, s.x + 0.02, (s.z1 - z) / (s.z1 - s.z0) * FLOOR_H + 0.5, z); }
    B(st, 2, FLOOR_H, 1, 0xcbd5e1, s.x + 1, FLOOR_H / 2, s.z0 - 0.5); // closet under the landing
    const lb = makeLabel('⬆️ Floor 2', 0.18, { bg: '#1e293b', color: '#fff', size: 34 }, 1); lb.position.set(s.x + 1, 0.9, s.z1 + 0.02); st.add(lb);
  }

  // ---------------------------------------------------------------------------- furniture
  syncFurniture(w) {
    const seen = new Set();
    for (const f of w.furniture) {
      seen.add(f.id);
      let e = this.furn.get(f.id);
      const key = `${f.type}|${f.upg}|${f.floor || 0}`;
      if (!e || e.key !== key) {
        if (e) { e.group.removeFromParent(); disposeOwned(e.group); }
        const group = makeFurniture(f.type, f);
        if (f.upg) { const s = makeLabel('⭐', 0.18, { bg: null }, 0.3); s.position.set(FURNITURE[f.type].w / 2 - 0.15, 0.3, 0.47); group.add(s); }
        group.traverse(o => { o.userData.fid = f.id; });
        this.floorRoots[f.floor || 0].add(group);
        e = { group, key, data: f, label: null, tags: new THREE.Group(), tagKey: '', doorOpen: 0 };
        group.add(e.tags);
        this.furn.set(f.id, e);
        e.pop = 1;
      }
      e.data = f;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      e.group.position.set(cx, 0, cz);
      e.group.rotation.y = f.rot * Math.PI / 2;
      const def = FURNITURE[f.type];
      let text = '';
      const expired = f.slots && f.slots.some(s => s.expired && s.qty > 0);
      if (f.broken) text = `⚠️ BROKEN ${f.temp}°C${f.techEta != null ? ' 🧑‍🔧' : ` 🔧${f.repair || 0}/6`}`;
      else if (def.temp !== undefined && f.temp > def.temp + 1) text = `🌡️ ${f.temp}°C`;
      else if (expired) text = '🤢 Expired';
      if (text) {
        if (!e.label) { e.label = makeSprite(text, 0.26, { bg: f.broken ? '#dc2626' : '#f59e0b', color: '#fff', size: 36 }); e.group.add(e.label); }
        setSpriteText(e.label, text, 0.26, { bg: f.broken ? '#dc2626' : '#f59e0b', color: '#fff', size: 36 });
        e.label.position.set(0, f.type === 'freezer' ? 1.3 : 2.5, 0); e.label.visible = true;
      } else if (e.label) e.label.visible = false;
      if (e.group.userData.led) e.group.userData.led.material = mat(f.broken ? 0xef4444 : 0x22c55e, { emissive: f.broken ? 0xef4444 : 0x22c55e });
      e.broken = f.broken;
      this.priceTags(e, f, w);
    }
    for (const [id, e] of this.furn) if (!seen.has(id)) { e.group.removeFromParent(); disposeOwned(e.group); this.furn.delete(id); }
  }

  // small shelf-edge tags with the product name and price under each section
  priceTags(e, f, w) {
    if (!f.slots) return;
    const key = f.slots.map(s => s.pid ? `${s.pid}:${w.prices[s.pid]}` : '-').join(',') + (w.saleActive ? 's' : '');
    if (key === e.tagKey) return;
    e.tagKey = key; disposeOwned(e.tags); e.tags.clear();
    const layout = slotLayout(f.type);
    f.slots.forEach((sl, i) => {
      const L = layout[i]; if (!L || !sl.pid) return;
      const p = PRODUCT_MAP[sl.pid]; if (!p) return;
      const price = (w.prices[p.id] ?? p.price) * (w.saleActive ? 0.85 : 1);
      const tag = makeLabel(p.name + '  $' + price.toFixed(2), 0.042, { bg: w.saleActive ? '#fde047' : '#ffffff', color: '#111827', size: 30, pad: 8, radius: 2 }, 0.42);
      tag.position.set(L.x0 + 0.24, Math.max(0.03, L.y - 0.022), L.zf + 0.022);
      e.tags.add(tag);
    });
  }

  // one InstancedMesh per (floor, product) so every package shows its printed label.
  // Sections are filled front row first (like a faced shelf), then further back, then stacked.
  rebuildUnits(w) {
    const groups = new Map();
    for (const f of w.furniture) {
      if (!f.slots) continue;
      const layout = slotLayout(f.type);
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      f.slots.forEach((sl, si) => {
        const L = layout[si]; if (!L || !sl.pid || sl.qty <= 0) return;
        const p = PRODUCT_MAP[sl.pid]; if (!p) return;
        const d = SHAPE_DIMS[p.shape] || SHAPE_DIMS.box;
        const width = L.x1 - L.x0;
        const cols = Math.max(1, Math.floor(width / (d.w + 0.012)));
        const rows = Math.max(1, Math.floor(L.depth / (d.d + 0.01)));
        const layers = Math.max(1, Math.min(d.stack, Math.floor(L.h / (d.h + 0.005))));
        const dx = width / cols, dz = L.depth / rows;
        const n = Math.min(sl.qty, slotCap(f.type, p.id), cols * rows * layers);
        const key = (f.floor || 0) + ':' + p.id;
        if (!groups.has(key)) groups.set(key, { p, floor: f.floor || 0, items: [] });
        const list = groups.get(key).items;
        for (let i = 0; i < n; i++) {
          const row = Math.floor(i / (cols * layers)), rem = i % (cols * layers), layer = Math.floor(rem / cols), col = rem % cols;
          const j = ((i * 9301 + f.id * 49297) % 233280) / 233280;
          const lx = L.x0 + dx * (col + 0.5) + (L.pile ? (j - 0.5) * 0.03 : 0);
          const lz = L.zf - dz * (row + 0.5) - 0.005;
          const ly = L.y + layer * (d.h + 0.003) + (L.pile && layer ? -0.02 : 0);
          const spin = L.pile || p.shape === 'sphere' || p.shape === 'can' ? j * 6 : (j - 0.5) * 0.08;
          list.push({ x: cx + lx * cos + lz * sin, y: ly, z: cz - lx * sin + lz * cos, ang: ang + spin, j, expired: sl.expired });
        }
      });
    }
    for (const [key, im] of this.units) if (!groups.has(key)) { im.removeFromParent(); im.dispose(); this.units.delete(key); }
    for (const [key, gr] of groups) {
      let im = this.units.get(key);
      if (!im || im.userData.cap < gr.items.length) {
        if (im) { im.removeFromParent(); im.dispose(); }
        const cap = Math.max(32, 1 << Math.ceil(Math.log2(gr.items.length + 1)));
        im = new THREE.InstancedMesh(UNIT_GEOS[gr.p.shape] || UNIT_GEOS.box, productMaterial(gr.p), cap);
        im.userData.cap = cap; im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
        this.floorRoots[gr.floor].add(im); this.units.set(key, im);
      }
      gr.items.forEach((it, i) => {
        tmpQ.setFromAxisAngle(UP, it.ang); tmpV.set(it.x, it.y, it.z); tmpS.set(1, 1, 1);
        tmpM.compose(tmpV, tmpQ, tmpS); im.setMatrixAt(i, tmpM);
        tmpC.setRGB(1, 1, 1).multiplyScalar(0.94 + it.j * 0.08);
        if (it.expired) tmpC.lerp(EXPIRED, 0.7);
        im.setColorAt(i, tmpC);
      });
      im.count = gr.items.length; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // product boxes and furniture boxes on the floor and in racks (individual meshes with printed labels)
  syncBoxes(w) {
    const list = [];
    for (const b of w.boxes) list.push({ id: b.id, key: 'b' + b.id, x: b.x, y: b.y * (b.ftype ? 0.5 : 0.37), z: b.z, floor: b.floor || 0, pid: b.pid, ftype: b.ftype, expired: b.expired, rot: (b.id * 0.7) % 0.5 - 0.25 });
    for (const f of w.furniture) {
      if (!f.boxes) continue;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      const ys = [0.13, 0.68, 1.23, 1.78];
      f.boxes.forEach((b, i) => {
        const lx = -0.72 + (i % 4) * 0.48;
        list.push({ id: -1, key: `r${f.id}:${i}:${b.pid}`, x: cx + lx * cos, y: ys[Math.min(3, Math.floor(i / 4))], z: cz - lx * sin, floor: f.floor || 0, pid: b.pid, expired: b.expired, rot: ang, rack: f.id, scale: 0.9 });
      });
    }
    this.boxList = list;
    const seen = new Set();
    for (const b of list) {
      seen.add(b.key);
      let m = this.boxMeshes.get(b.key);
      const look = (b.ftype || b.pid) + (b.expired ? 'x' : '');
      if (!m || m.userData.look !== look || m.userData.floor !== b.floor) {
        if (m) { m.removeFromParent(); disposeOwned(m); }
        m = b.ftype ? makeFBox(b.ftype) : makeBox(b.pid);
        if (b.expired) m.children[0].material = mat(0x7c8a5a);
        m.userData.look = look; m.userData.floor = b.floor;
        this.boxRoots[b.floor].add(m); this.boxMeshes.set(b.key, m);
      }
      m.position.set(b.x, b.y, b.z); m.rotation.y = b.rot; m.scale.setScalar(b.scale || 1);
    }
    for (const [k, m] of this.boxMeshes) if (!seen.has(k)) { m.removeFromParent(); disposeOwned(m); this.boxMeshes.delete(k); }
  }

  syncDirt(w) {
    const seen = new Set();
    for (const d of w.dirt) {
      seen.add(d.id);
      let m = this.dirtMeshes.get(d.id);
      if (!m) {
        m = new THREE.Group();
        if (d.kind === 'spill') {
          const c = new THREE.Mesh(new THREE.CircleGeometry(0.32, 14), new THREE.MeshStandardMaterial({ color: [0x92400e, 0x7dd3fc, 0xfde047, 0xdc2626][d.id % 4], roughness: 0.15, transparent: true, opacity: 0.8 }));
          c.rotation.x = -Math.PI / 2; c.scale.set(1, 0.7, 1); c.position.y = 0.01; m.add(c);
          const c2 = c.clone(); c2.scale.set(0.5, 0.45, 1); c2.position.set(0.28, 0.011, 0.12); m.add(c2);
        } else if (d.kind === 'pigeon') {
          const c = new THREE.Mesh(new THREE.CircleGeometry(0.14, 8), mat(0xf8fafc)); c.rotation.x = -Math.PI / 2; c.position.y = 0.012; m.add(c);
        } else {
          const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(0xffffff, { flat: true })); p.position.y = 0.07; p.castShadow = true; m.add(p);
          B(m, 0.18, 0.01, 0.1, [0xef4444, 0x3b82f6, 0xfacc15][d.id % 3], 0.15, 0.01, 0.08).rotation.y = 0.6;
        }
        m.rotation.y = d.r || 0;
        this.floorRoots[d.floor || 0].add(m); this.dirtMeshes.set(d.id, m);
      }
      m.position.set(d.x, 0, d.z);
    }
    for (const [id, m] of this.dirtMeshes) if (!seen.has(id)) { m.removeFromParent(); this.dirtMeshes.delete(id); }
  }

  // items on checkout belts (from snapshot K entries); unscanned ones are clickable
  setCheckouts(K) {
    if (!this.state) return;
    const key = K.map(k => `${k[0]}:${k[1]}:${k[2]}:${k[4].length}`).join(',');
    if (key === this.beltKey) return;
    this.beltKey = key;
    this.beltRoot.clear(); this.beltItems = [];
    for (const [fid, cid, scanned, total, pids] of K) {
      if (!cid) continue;
      const e = this.furn.get(fid); if (!e) continue;
      const f = e.data; if (f.type !== 'checkout') continue;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      const yb = (f.floor || 0) * FLOOR_H;
      pids.forEach((pid, i) => {
        const p = PRODUCT_MAP[pid]; if (!p) return;
        const done = i < scanned;
        const lx = done ? 0.62 + (i % 3) * 0.12 - 0.12 : -0.8 + (i - scanned) * 0.2;
        const lz = done ? -0.05 + Math.floor(i / 3) % 2 * 0.1 - 0.1 : 0.05;
        if (!done && lx > 0.35) return;
        const m = new THREE.Mesh(UNIT_GEOS[p.shape], productMaterial(p));
        m.position.set(cx + lx * cos + lz * sin, yb + 0.92 + (done ? Math.floor(i / 6) * 0.1 : 0), cz - lx * sin + lz * cos);
        m.rotation.y = ang; m.castShadow = true;
        m.userData = { fid, belt: !done };
        this.beltRoot.add(m); if (!done) this.beltItems.push(m);
      });
    }
  }

  // ---------------------------------------------------------------------------- per-frame
  update(dt, chars, camera, focus) {
    this.time += dt;
    if (this.state) {
      const D = this.state.d, cx = this.state.doorX + 1;
      let near = false;
      for (const c of chars) if (Math.abs(c.x - cx) < 2 && Math.abs(c.z - (D + 0.5)) < 2.2) { near = true; break; }
      for (const d of this.doors) {
        d.userData.open += ((near ? 1 : 0) - d.userData.open) * Math.min(1, dt * 6);
        d.position.x = d.userData.base + d.userData.dir * d.userData.open * 0.9;
      }
      if (near && !this.doorWas) this.onDoor && this.onDoor();
      this.doorWas = near;
    }
    const bt = beltTexture(); if (bt && this.beltItems.length) bt.offset.x -= dt * 0.35;
    for (const e of this.furn.values()) {
      const g = e.group, f = e.data;
      if (e.pop > 0) { e.pop = Math.max(0, e.pop - dt * 4); const s = 1 + Math.sin(e.pop * Math.PI) * 0.12; g.scale.set(s, 1 - Math.sin(e.pop * Math.PI) * 0.1, s); }
      for (const a of g.userData.anim) {
        if (a.kind === 'bob') a.obj.position.y = Math.sin(this.time * 1.5 + f.id) * 0.06;
        if (a.kind === 'jet') a.obj.scale.y = 1 + Math.sin(this.time * 8) * 0.15;
        if (a.kind === 'water') a.obj.rotation.y += dt * 0.5;
        if (a.kind === 'blink') a.obj.material.opacity = 0.7 + Math.sin(this.time * 6) * 0.3;
        if (a.kind === 'spin') a.obj.rotation.y += dt * 0.6;
      }
      // fridge doors: open when a player opened it, or while someone is taking items out
      const ud = g.userData;
      if (ud.doors || ud.lid) {
        let want = f.open ? 1 : 0;
        if (!want) want = this.someoneAt(f, chars) ? 1 : 0;
        e.doorOpen += (want - e.doorOpen) * Math.min(1, dt * 7);
        if (ud.doors) ud.doors.forEach(d => { d.rotation.y = -e.doorOpen * 1.5; });
        if (ud.lid) ud.lid.position.x = e.doorOpen * FURNITURE[f.type].w * 0.45;
      }
      if (ud.tool) { const sp = this.deptPoint(f, 'stationSpot'); e.working = chars.some(c => (c.floor || 0) === (f.floor || 0) && Math.hypot(c.x - sp[0], c.z - sp[1]) < 0.75 && (c.stage === 'cutting' || c.cutting)); }
      if (ud.tool && e.working) { if (f.type === 'deli') ud.tool.rotation.x += dt * 25; else ud.tool.rotation.z = Math.sin(this.time * 18) * 0.4; }
      if (e.broken && ud.led) ud.led.visible = Math.sin(this.time * 10) > 0;
      if (e.label && e.label.visible) e.label.position.y = (f.type === 'freezer' ? 1.3 : 2.5) + Math.sin(this.time * 3) * 0.05;
    }
    if (camera && this.state) {
      const W = this.state.w, D = this.state.d;
      for (const fw of this.fadeWalls) {
        let o = 1;
        if (fw.side === 'left' && camera.position.x < 0.5) o = 0.15;
        if (fw.side === 'right' && camera.position.x > W - 0.5) o = 0.15;
        if (fw.side === 'back' && camera.position.z < 0) o = 0.15;
        for (const m of fw.mats) { m.opacity += (o - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.9; }
      }
      const inside = focus && focus.z < D + 0.3;
      const o = inside && camera.position.z > D ? 0.18 : 1;
      for (const m of this.frontMats) { m.opacity += (o - m.opacity) * Math.min(1, dt * 8); m.depthWrite = m.opacity > 0.9; }
    }
  }
  someoneAt(f, chars) {
    const fl = f.floor || 0;
    if (FURNITURE[f.type].kind === 'counter') {
      const sp = this.deptPoint(f, 'fridgeSpot');
      return chars.some(c => (c.floor || 0) === fl && Math.hypot(c.x - sp[0], c.z - sp[1]) < 0.7 && (c.carryDept || c.stage === 'taking'));
    }
    return chars.some(c => !c.moving && (c.floor || 0) === fl && this.fixtureDistance(f, c.x, c.z) < 0.8 && (c.kind === 'customer' || c.state === 'stocking'));
  }
  deptPoint(f, name) {
    const def = FURNITURE[f.type];
    const map = { fridgeSpot: [0, 1], stationSpot: [2, 1], counterSpot: [1, 1], fridge: [0.5, 0], station: [2, 0], counter: [1, 2] };
    const [i, j] = map[name];
    const rt = (a, b) => { switch (f.rot) { case 1: return [b, def.w - 1 - a]; case 2: return [def.w - 1 - a, def.d - 1 - b]; case 3: return [def.d - 1 - b, a]; default: return [a, b]; } };
    const [a, b] = rt(i, j);
    return [f.x + a + 0.5, f.z + b + 0.5];
  }
  fixtureDistance(f, x, z) {
    const [w, d] = dims(f.type, f.rot);
    const dx = Math.max(f.x - x, 0, x - (f.x + w)), dz = Math.max(f.z - z, 0, z - (f.z + d));
    return Math.hypot(dx, dz);
  }
}
