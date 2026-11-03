// Renders the shared world state: the store building, furniture, products on shelves, boxes, dirt.
import * as THREE from 'three';
import { FURNITURE, PRODUCT_MAP, FLOORS, WALLS, CATEGORIES } from '/shared/data.js';
import { Grid, center, dims, footprint, frontTiles } from '/shared/grid.js';
import { B, C, mat, makeFurniture, slotLayout, UNIT_GEOS, ACCENT_GEOS, makeSprite, setSpriteText, textTexture, catColor } from './models.js';
import { tileTexture } from './scene.js';

const MAX_UNITS = 5000;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3(1, 1, 1), tmpC = new THREE.Color();
const EXPIRED = new THREE.Color(0x6b5b3e);
const UP = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.shell = new THREE.Group(); this.root.add(this.shell);
    this.furnRoot = new THREE.Group(); this.root.add(this.furnRoot);
    this.furn = new Map();       // id -> { group, key, data }
    this.state = null;
    this.grid = new Grid(12, 9, 5);
    this.shellKey = '';
    this.doors = [];
    this.fadeWalls = [];
    this.time = 0;
    // product instancing
    this.units = {};
    for (const [shape, geo] of Object.entries(UNIT_GEOS)) {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 }), MAX_UNITS);
      m.count = 0; m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(m); this.units[shape] = m;
    }
    this.accents = {};
    for (const [shape, geo] of Object.entries(ACCENT_GEOS)) {
      const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }), MAX_UNITS);
      m.count = 0; m.frustumCulled = false; this.root.add(m); this.accents[shape] = m;
    }
    // boxes (instanced: body, tape, label front, label side)
    const bg = new THREE.BoxGeometry(0.5, 0.36, 0.42).translate(0, 0.18, 0);
    this.boxBody = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), 600);
    this.boxBody.castShadow = true; this.boxBody.receiveShadow = true; this.boxBody.frustumCulled = false; this.root.add(this.boxBody);
    this.boxTape = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.006, 0.43).translate(0, 0.363, 0), mat(0xe7d3a8), 600);
    this.boxTape.frustumCulled = false; this.root.add(this.boxTape);
    this.boxLabel = new THREE.InstancedMesh(new THREE.BoxGeometry(0.26, 0.16, 0.43).translate(0, 0.2, 0.0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }), 600);
    this.boxLabel.frustumCulled = false; this.root.add(this.boxLabel);
    this.boxList = [];  // rendered box positions for picking: {id, x, y, z, pid, rack}
    // dirt
    this.dirtRoot = new THREE.Group(); this.root.add(this.dirtRoot);
    this.dirtMeshes = new Map();
    // checkout belt items
    this.beltRoot = new THREE.Group(); this.root.add(this.beltRoot);
    this.beltKey = '';
    this.counterKey = '';
  }

  // ---------------------------------------------------------------------------- full sync
  set(w) {
    const prev = this.state;
    this.state = w;
    const key = [w.w, w.d, w.doorX, w.floor, w.wall, w.name].join('|');
    if (key !== this.shellKey) { this.shellKey = key; this.buildShell(w); this.shellChanged = true; }
    this.grid = new Grid(w.w, w.d, w.doorX);
    this.grid.build(w.furniture);
    this.syncFurniture(w);
    this.rebuildUnits(w);
    this.rebuildBoxes(w);
    this.syncDirt(w);
    void prev;
  }

  buildShell(w) {
    this.shell.clear(); this.doors = []; this.fadeWalls = [];
    const W = w.w, D = w.d;
    const fl = FLOORS.find(f => f.id === w.floor) || FLOORS[0];
    const wl = WALLS.find(x => x.id === w.wall) || WALLS[0];
    const tex = tileTexture(fl.a, fl.b, 64, 2, { checker: fl.id === 'checker' || fl.id === 'terra' || fl.id === 'night' || fl.id === 'mint' || fl.id === 'white', plank: fl.plank, marble: fl.marble });
    tex.repeat.set(W / 2, D / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: tex, roughness: fl.marble ? 0.25 : 0.6, metalness: 0.02 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0.002, D / 2); floor.receiveShadow = true; this.shell.add(floor);
    // floor under the storefront wall row
    const sill = new THREE.Mesh(new THREE.PlaneGeometry(W, 1), mat(0xd6d3d1)); sill.rotation.x = -Math.PI / 2; sill.position.set(W / 2, 0.003, D + 0.5); this.shell.add(sill);
    const H = 3.4, wc = new THREE.Color(wl.color).getHex();
    const wallMat = () => new THREE.MeshStandardMaterial({ color: wc, roughness: 0.9, transparent: true, opacity: 1 });
    const mkWall = (w_, d_, x, z, side) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.BoxGeometry(w_, H, d_), wallMat()); m.position.set(x, H / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w_ + 0.02, 0.18, d_ + 0.02), new THREE.MeshStandardMaterial({ color: 0x475569, transparent: true })); base.position.set(x, 0.09, z); g.add(base);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(w_ + 0.02, 0.22, d_ + 0.02), new THREE.MeshStandardMaterial({ color: 0xf97316, transparent: true })); stripe.position.set(x, 2.7, z); g.add(stripe);
      this.shell.add(g); this.fadeWalls.push({ g, side, mats: [m.material, base.material, stripe.material] });
      return g;
    };
    mkWall(W + 0.4, 0.2, W / 2, -0.1, 'back');
    mkWall(0.2, D + 1, -0.1, (D + 1) / 2, 'left');
    mkWall(0.2, D + 1, W + 0.1, (D + 1) / 2, 'right');
    // department signage on the back wall
    // storefront
    const front = new THREE.Group(); this.shell.add(front);
    const fz = D + 0.5, dx0 = w.doorX, dx1 = w.doorX + 2;
    const glassM = new THREE.MeshStandardMaterial({ color: 0xbae6fd, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false });
    const baseM = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.8, transparent: true });
    const frameM = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, transparent: true });
    const fasciaM = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6, transparent: true });
    const seg = (x0, x1) => {
      if (x1 - x0 <= 0.01) return;
      const cx = (x0 + x1) / 2, ww = x1 - x0;
      const b = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.5, 0.25), baseM); b.position.set(cx, 0.25, fz); b.castShadow = true; front.add(b);
      const gl = new THREE.Mesh(new THREE.BoxGeometry(ww, 2.1, 0.04), glassM); gl.position.set(cx, 1.55, fz); front.add(gl);
      for (let x = x0; x <= x1 + 0.01; x += Math.max(1, ww / Math.round(ww / 2))) {
        const mu = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.1, 0.08), frameM); mu.position.set(Math.min(x, x1), 1.55, fz); front.add(mu);
      }
    };
    seg(0, dx0); seg(dx1, W);
    const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.1, 0.3), frameM); top.position.set(W / 2, 2.62, fz); front.add(top);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.95, 0.3), fasciaM); fascia.position.set(W / 2, 3.12, fz); fascia.castShadow = true; front.add(fascia);
    // store name sign
    const name = w.name || 'Your Supermarket';
    const sign = textTexture(name.toUpperCase(), { size: 96, bg: '#ffffff', color: '#ea580c', pad: 26, radius: 30, border: '#fdba74', font: 'Fredoka' });
    const sh = 0.78, swid = Math.min(W - 1, sh * sign.aspect);
    const signM = new THREE.MeshStandardMaterial({ map: sign.tex, emissive: 0xffffff, emissiveMap: sign.tex, emissiveIntensity: 0.25, transparent: true });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(swid, swid / sign.aspect), signM); signMesh.position.set(W / 2, 3.12, fz + 0.16); front.add(signMesh);
    // door frame + sliding doors
    for (const x of [dx0, dx1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.6, 0.2), frameM); p.position.set(x, 1.3, fz); front.add(p); }
    for (let i = 0; i < 2; i++) {
      const door = new THREE.Group();
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.98, 2.4, 0.05), glassM); pane.position.y = 1.2; door.add(pane);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.07), frameM); fr.position.y = 2.38; door.add(fr);
      const fr2 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.07), frameM); fr2.position.y = 0.04; door.add(fr2);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.4, 0.07), frameM); edge.position.set(i === 0 ? 0.47 : -0.47, 1.2, 0); door.add(edge);
      const base = dx0 + 0.5 + i;
      door.position.set(base, 0, fz + (i ? 0.03 : -0.03));
      door.userData = { base, dir: i === 0 ? -1 : 1, open: 0 };
      front.add(door); this.doors.push(door);
    }
    // awning over the entrance
    for (let i = 0; i < 6; i++) {
      const a = B(front, 0.52, 0.05, 1.3, i % 2 ? 0xffffff : 0xef4444, dx0 - 0.5 + 0.26 + i * 0.52 + 0.0, 2.45, fz + 0.65, { shadow: true });
      a.rotation.x = 0.28;
    }
    // welcome mat
    const matM = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2), mat(0x7f1d1d)); matM.rotation.x = -Math.PI / 2; matM.position.set(dx0 + 1, 0.006, D - 0.6); this.shell.add(matM);
    this.frontMats = [baseM, frameM, fasciaM, signM];
    this.fasciaGroup = front;
  }

  syncFurniture(w) {
    const seen = new Set();
    for (const f of w.furniture) {
      seen.add(f.id);
      let e = this.furn.get(f.id);
      const key = `${f.type}|${f.upg}`;
      if (!e || e.key !== key) {
        if (e) this.furnRoot.remove(e.group);
        const group = makeFurniture(f.type, f);
        if (f.upg) { const s = makeSprite('⭐', 0.22, { bg: null }); s.position.set(FURNITURE[f.type].w / 2 - 0.15, 2.3, 0.3); group.add(s); }
        group.traverse(o => { o.userData.fid = f.id; });
        this.furnRoot.add(group);
        e = { group, key, data: f, label: null };
        this.furn.set(f.id, e);
        e.pop = 1; // spawn pop animation
      }
      e.data = f;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      e.group.position.set(cx, 0, cz);
      e.group.rotation.y = f.rot * Math.PI / 2;
      // indicator label (broken / warm / expired)
      const def = FURNITURE[f.type];
      let text = '';
      const expired = f.slots && f.slots.some(s => s.expired && s.qty > 0);
      if (f.broken) text = `⚠️ BROKEN ${f.temp}°C${f.techEta != null ? ' 🧑‍🔧' : ` 🔧${f.repair || 0}/6`}`;
      else if (def.temp !== undefined && f.temp > def.temp + 1) text = `🌡️ ${f.temp}°C`;
      else if (expired) text = '🤢 Expired!';
      if (text) {
        if (!e.label) { e.label = makeSprite(text, 0.3, { bg: f.broken ? '#dc2626' : '#f59e0b', color: '#fff', size: 40 }); e.group.add(e.label); }
        setSpriteText(e.label, text, 0.3, { bg: f.broken ? '#dc2626' : '#f59e0b', color: '#fff', size: 40 });
        e.label.position.set(0, (f.type === 'freezer' ? 1.5 : 2.6), 0); e.label.visible = true;
      } else if (e.label) e.label.visible = false;
      if (e.group.userData.led) e.group.userData.led.material = mat(f.broken ? 0xef4444 : 0x22c55e, { emissive: f.broken ? 0xef4444 : 0x22c55e });
      e.broken = f.broken;
    }
    for (const [id, e] of this.furn) if (!seen.has(id)) { this.furnRoot.remove(e.group); this.furn.delete(id); }
  }

  // place every product unit as an instance
  rebuildUnits(w) {
    const counts = {}, acc = {};
    for (const s in this.units) counts[s] = 0;
    for (const s in this.accents) acc[s] = 0;
    for (const f of w.furniture) {
      if (!f.slots) continue;
      const layout = slotLayout(f.type);
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      tmpQ.setFromAxisAngle(UP, ang);
      f.slots.forEach((sl, si) => {
        const L = layout[si]; if (!L || !sl.pid || sl.qty <= 0) return;
        const p = PRODUCT_MAP[sl.pid]; if (!p) return;
        const cap = FURNITURE[f.type].cap;
        const per = L.cols * L.rows;
        const n = Math.min(sl.qty, cap);
        const shape = p.shape;
        const im = this.units[shape];
        // spread units across the slot proportional to capacity (shows emptiness as gaps on the right)
        const scale = per / cap;
        for (let i = 0; i < n; i++) {
          const k = Math.min(per - 1, Math.floor(i * scale));
          const col = Math.floor(k / L.rows), row = k % L.rows;
          let lx = L.x0 + col * L.dx, lz = L.z0 + row * L.dz, ly = L.y;
          if (L.pile) ly += (i % 3 === 2 ? 0.06 : 0) ;
          if (n > per && i >= per) ly += 0.12 * Math.floor(i / per);
          const jitter = ((i * 9301 + f.id * 49297) % 233280) / 233280;
          const wx = cx + lx * cos + lz * sin, wz = cz - lx * sin + lz * cos;
          tmpV.set(wx, ly, wz);
          const q = tmpQ.clone();
          if (L.pile || shape === 'sphere') q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, jitter * 6));
          tmpS.set(1, 1, 1);
          tmpM.compose(tmpV, q, tmpS);
          const idx = counts[shape]++;
          if (idx >= MAX_UNITS) continue;
          im.setMatrixAt(idx, tmpM);
          tmpC.setHex(p.color).multiplyScalar(0.88 + jitter * 0.2);
          if (sl.expired) tmpC.lerp(EXPIRED, 0.7);
          im.setColorAt(idx, tmpC);
          const am = this.accents[shape];
          if (am) {
            const ai = acc[shape]++;
            am.setMatrixAt(ai, tmpM);
            tmpC.setHex(shape === 'box' || shape === 'can' ? 0xffffff : shape === 'carton' ? p.color : 0xe5e7eb);
            if (shape === 'carton') tmpC.multiplyScalar(0.8);
            am.setColorAt(ai, tmpC);
          }
        }
      });
    }
    for (const s in this.units) { const m = this.units[s]; m.count = Math.min(counts[s], MAX_UNITS); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const s in this.accents) { const m = this.accents[s]; m.count = acc[s]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  rebuildBoxes(w) {
    const list = [];
    for (const b of w.boxes) list.push({ id: b.id, x: b.x, y: b.y * 0.37, z: b.z, pid: b.pid, expired: b.expired, rot: (b.id * 0.7) % 0.5 - 0.25 });
    // rack contents
    for (const f of w.furniture) {
      if (!f.boxes) continue;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      f.boxes.forEach((b, i) => {
        const level = Math.floor(i / 4), col = i % 4;
        const ys = [0.13, 0.68, 1.23, 1.78];
        const lx = -0.72 + (col % 4) * 0.48 * (FURNITURE.rack.w / 2) * 0.99, lz = 0.0;
        list.push({ id: -1, x: cx + lx * cos + lz * sin, y: ys[Math.min(3, level)], z: cz - lx * sin + lz * cos, pid: b.pid, expired: b.expired, rot: ang, rack: f.id, scale: 0.9 });
      });
    }
    this.boxList = list;
    let n = 0;
    for (const b of list) {
      if (n >= 600) break;
      tmpQ.setFromAxisAngle(UP, b.rot); tmpV.set(b.x, b.y, b.z); tmpS.setScalar(b.scale || 1);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.boxBody.setMatrixAt(n, tmpM); this.boxTape.setMatrixAt(n, tmpM); this.boxLabel.setMatrixAt(n, tmpM);
      this.boxBody.setColorAt(n, tmpC.setHex(b.expired ? 0x7c8a5a : 0xc8a26b));
      this.boxLabel.setColorAt(n, tmpC.setHex(PRODUCT_MAP[b.pid]?.color ?? 0xffffff));
      n++;
    }
    for (const m of [this.boxBody, this.boxTape, this.boxLabel]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
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
          const c3 = new THREE.Mesh(new THREE.CircleGeometry(0.05, 6), mat(0x57534e)); c3.rotation.x = -Math.PI / 2; c3.position.set(0.03, 0.014, 0.02); m.add(c3);
        } else {
          const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), mat(0xffffff, { flat: true })); p.position.y = 0.07; p.castShadow = true; m.add(p);
          B(m, 0.18, 0.01, 0.1, [0xef4444, 0x3b82f6, 0xfacc15][d.id % 3], 0.15, 0.01, 0.08).rotation.y = 0.6;
        }
        m.rotation.y = d.r || 0;
        this.dirtRoot.add(m); this.dirtMeshes.set(d.id, m);
      }
      m.position.set(d.x, 0, d.z);
    }
    for (const [id, m] of this.dirtMeshes) if (!seen.has(id)) { this.dirtRoot.remove(m); this.dirtMeshes.delete(id); }
  }

  // items on checkout belts (from snapshot K entries)
  setCheckouts(K) {
    if (!this.state) return;
    const key = K.map(k => `${k[0]}:${k[1]}:${k[2]}:${k[4].length}`).join(',');
    if (key === this.beltKey) return;
    this.beltKey = key;
    this.beltRoot.clear();
    for (const [fid, cid, scanned, total, pids] of K) {
      if (!cid) continue;
      const e = this.furn.get(fid); if (!e) continue;
      const f = e.data; if (f.type !== 'checkout') continue;
      const [cx, cz] = center(f.type, f.x, f.z, f.rot);
      const ang = f.rot * Math.PI / 2, cos = Math.cos(ang), sin = Math.sin(ang);
      pids.forEach((pid, i) => {
        const p = PRODUCT_MAP[pid]; if (!p) return;
        const done = i < scanned;
        // unscanned items line up on the belt (left), scanned go to bagging (right)
        const lx = done ? 0.62 + (i % 3) * 0.12 - 0.12 : -0.8 + (i - scanned) * 0.2;
        const lz = done ? -0.05 + Math.floor(i / 3) * 0.1 - 0.1 : 0.05;
        if (!done && lx > 0.35) return;
        const m = new THREE.Mesh(UNIT_GEOS[p.shape], mat(p.color));
        m.position.set(cx + lx * cos + lz * sin, 0.92 + (done ? Math.floor(i / 6) * 0.1 : 0), cz - lx * sin + lz * cos);
        m.rotation.y = ang; m.castShadow = true;
        this.beltRoot.add(m);
      });
    }
  }

  // ---------------------------------------------------------------------------- per-frame
  update(dt, chars, camera, focus) {
    this.time += dt;
    // sliding doors open when anyone is near
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
    // furniture animations
    for (const e of this.furn.values()) {
      const g = e.group;
      if (e.pop > 0) { e.pop = Math.max(0, e.pop - dt * 4); const s = 1 + Math.sin(e.pop * Math.PI) * 0.12; g.scale.set(s, 1 - Math.sin(e.pop * Math.PI) * 0.1, s); }
      for (const a of g.userData.anim) {
        if (a.kind === 'bob') a.obj.position.y = Math.sin(this.time * 1.5 + e.data.id) * 0.06;
        if (a.kind === 'jet') { a.obj.scale.y = 1 + Math.sin(this.time * 8) * 0.15; }
        if (a.kind === 'water') a.obj.rotation.y += dt * 0.5;
        if (a.kind === 'blink') a.obj.material.opacity = 0.7 + Math.sin(this.time * 6) * 0.3;
        if (a.kind === 'spin') a.obj.rotation.y += dt * 0.6;
      }
      if (e.broken && g.userData.led) g.userData.led.visible = Math.sin(this.time * 10) > 0;
      if (e.label && e.label.visible) e.label.position.y = (e.data.type === 'freezer' ? 1.5 : 2.6) + Math.sin(this.time * 3) * 0.05;
    }
    // fade walls that block the view
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

  // nearest-interaction helpers -----------------------------------------------------
  fixtureDistance(f, x, z) {
    const [w, d] = dims(f.type, f.rot);
    const dx = Math.max(f.x - x, 0, x - (f.x + w)), dz = Math.max(f.z - z, 0, z - (f.z + d));
    return Math.hypot(dx, dz);
  }
}
