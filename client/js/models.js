// Procedural stylized low-poly models built from primitives (no external assets).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURNITURE, CATEGORIES } from '/shared/data.js';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.65, metalness: opts.metal ?? 0.0,
      transparent: !!opts.opacity && opts.opacity < 1, opacity: opts.opacity ?? 1, emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.ei ?? 1, depthWrite: opts.opacity ? opts.opacity > 0.6 : true, side: opts.side ?? THREE.FrontSide, flatShading: !!opts.flat });
    matCache.set(key, m);
  }
  return m;
}
const geoCache = new Map();
function boxGeo(w, h, d) {
  const k = `b${w},${h},${d}`; let g = geoCache.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); geoCache.set(k, g); }
  return g;
}
function cylGeo(rt, rb, h, seg = 12) {
  const k = `c${rt},${rb},${h},${seg}`; let g = geoCache.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); geoCache.set(k, g); }
  return g;
}
function sphGeo(r, w = 12, h = 10) {
  const k = `s${r},${w},${h}`; let g = geoCache.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, w, h); geoCache.set(k, g); }
  return g;
}
export function B(parent, w, h, d, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(boxGeo(w, h, d), opts.material || mat(color, opts));
  m.position.set(x, y, z); m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  parent.add(m); return m;
}
export function C(parent, rt, rb, h, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(cylGeo(rt, rb, h, opts.seg || 12), opts.material || mat(color, opts));
  m.position.set(x, y, z); m.castShadow = opts.shadow !== false; m.receiveShadow = true;
  parent.add(m); return m;
}
export function S(parent, r, color, x = 0, y = 0, z = 0, opts = {}) {
  const m = new THREE.Mesh(sphGeo(r, opts.w || 12, opts.h || 10), opts.material || mat(color, opts));
  m.position.set(x, y, z); m.castShadow = opts.shadow !== false; parent.add(m); return m;
}

// ------------------------------------------------------------------ product unit geometries
function based(g) { g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); return g; }
export const UNIT_GEOS = {
  box: based(new THREE.BoxGeometry(0.17, 0.27, 0.08)),
  flatbox: based(new THREE.BoxGeometry(0.21, 0.15, 0.12)),
  bag: based(new THREE.SphereGeometry(0.11, 8, 6).scale(1, 1.15, 0.55)),
  can: based(new THREE.CylinderGeometry(0.058, 0.058, 0.15, 10)),
  bottle: based(new THREE.CylinderGeometry(0.035, 0.058, 0.28, 8)),
  jar: based(new THREE.CylinderGeometry(0.065, 0.068, 0.14, 10)),
  carton: based(new THREE.BoxGeometry(0.1, 0.22, 0.1)),
  tub: based(new THREE.CylinderGeometry(0.085, 0.07, 0.09, 12)),
  sphere: based(new THREE.SphereGeometry(0.07, 10, 8)),
  long: based(new THREE.CapsuleGeometry(0.035, 0.16, 3, 8).rotateZ(Math.PI / 2)),
  slab: based(new THREE.BoxGeometry(0.2, 0.05, 0.14)),
  wedge: based(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 10, 1, false, 0, Math.PI * 0.6)),
};
// small cap/label accents drawn on top of some shapes
export const ACCENT_GEOS = {
  bottle: based(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 6)).translate(0, 0.28, 0),
  can: based(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10)).translate(0, 0.05, 0),
  jar: based(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10)).translate(0, 0.14, 0),
  box: based(new THREE.BoxGeometry(0.175, 0.08, 0.085)).translate(0, 0.12, 0),
  carton: based(new THREE.ConeGeometry(0.075, 0.06, 4).rotateY(Math.PI / 4)).translate(0, 0.22, 0),
};

// Where products sit inside each storage fixture (local coords, centred, front = +z).
// returns array per slot: { x0, y, z0, cols, rows, dx, dz }
export function slotLayout(type) {
  switch (type) {
    case 'shelf': return [0.1, 0.5, 0.9, 1.3].map(y => ({ x0: -0.75, y, z0: 0.14, cols: 6, rows: 2, dx: 0.3, dz: -0.24 }));
    case 'shelf_large': return [0.1, 0.48, 0.86, 1.24, 1.62].map(y => ({ x0: -1.2, y, z0: 0.14, cols: 9, rows: 2, dx: 0.3, dz: -0.24 }));
    case 'endcap': return [0.15, 0.55, 0.95].map(y => ({ x0: -0.3, y, z0: 0.14, cols: 4, rows: 2, dx: 0.2, dz: -0.24 }));
    case 'fridge': return [0.22, 0.62, 1.02, 1.42].map(y => ({ x0: -0.66, y, z0: 0.12, cols: 5, rows: 2, dx: 0.33, dz: -0.24 }));
    case 'freezer_upright': return [0.22, 0.62, 1.02, 1.42].map(y => ({ x0: -0.66, y, z0: 0.12, cols: 5, rows: 2, dx: 0.33, dz: -0.24 }));
    case 'fridge_large': return [0.2, 0.55, 0.9, 1.25, 1.6].map(y => ({ x0: -1.14, y, z0: 0.16, cols: 7, rows: 2, dx: 0.38, dz: -0.24 }));
    case 'freezer': return [-0.45, 0.45].map(x => ({ x0: x - 0.36, y: 0.42, z0: 0.22, cols: 5, rows: 3, dx: 0.18, dz: -0.22 }));
    case 'produce': return [[-0.48, 0.42, 0.2], [0.48, 0.42, 0.2], [-0.48, 0.72, -0.18], [0.48, 0.72, -0.18]].map(([x, y, z]) => ({ x0: x - 0.3, y, z0: z + 0.08, cols: 4, rows: 3, dx: 0.2, dz: -0.08, pile: true }));
    case 'butcher': case 'deli': return [-1.05, -0.35, 0.35, 1.05].map(x => ({ x0: x - 0.225, y: 0.62, z0: 0.18, cols: 4, rows: 2, dx: 0.15, dz: -0.2 }));
  }
  return [];
}

// ------------------------------------------------------------------ text sprites
const spriteTexCache = new Map();
export function textTexture(text, { size = 48, color = '#1e293b', bg = 'rgba(255,255,255,0.95)', pad = 14, radius = 18, bold = true, border = null, font = 'Nunito' } = {}) {
  const key = [text, size, color, bg, border].join('|');
  if (spriteTexCache.has(key)) return spriteTexCache.get(key);
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const f = `${bold ? '800' : '600'} ${size}px ${font}, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  g.font = f; const w = Math.ceil(g.measureText(text).width) + pad * 2; const h = size + pad * 1.3;
  c.width = w; c.height = h; g.font = f;
  if (bg) { g.fillStyle = bg; roundRect(g, 2, 2, w - 4, h - 4, radius); g.fill(); if (border) { g.lineWidth = 4; g.strokeStyle = border; g.stroke(); } }
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const res = { tex: t, aspect: w / h };
  spriteTexCache.set(key, res);
  return res;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
export function makeSprite(text, height = 0.4, opts = {}) {
  const { tex, aspect } = textTexture(text, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: opts.depthTest ?? true, transparent: true }));
  s.scale.set(height * aspect, height, 1); s.renderOrder = 10;
  return s;
}
export function makeLabel(text, height = 0.2, opts = {}, maxW = 10) {
  const { tex, aspect } = textTexture(text, opts);
  let w = height * aspect, h = height;
  if (w > maxW) { h *= maxW / w; w = maxW; }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.renderOrder = 2;
  return m;
}
export function setSpriteText(s, text, height = 0.4, opts = {}) {
  if (s.userData.text === text) return;
  s.userData.text = text;
  const { tex, aspect } = textTexture(text, opts);
  s.material.map = tex; s.material.needsUpdate = true; s.scale.set(height * aspect, height, 1);
}

// ------------------------------------------------------------------ furniture
const STEEL = 0xcbd5e1, DARK = 0x334155, WHITE = 0xf8fafc, WOOD = 0xb7834f, WOOD2 = 0x8b5a2b;
export function catColor(cat) { return new THREE.Color(CATEGORIES[cat]?.color || '#94a3b8').getHex(); }

export function makeFurniture(type, f = {}) {
  const def = FURNITURE[type];
  const g = new THREE.Group();
  const W = def.w, D = def.d;
  const cc = def.cat ? catColor(def.cat) : 0x94a3b8;
  g.userData.anim = [];
  switch (type) {
    case 'shelf': case 'shelf_large': case 'endcap': {
      const h = type === 'shelf_large' ? 2.05 : type === 'endcap' ? 1.3 : 1.72;
      const ys = slotLayout(type).map(s => s.y);
      B(g, W - 0.04, h, 0.06, 0xe2e8f0, 0, h / 2, -0.38);
      B(g, 0.06, h, 0.86, 0xf1f5f9, -W / 2 + 0.05, h / 2, 0);
      B(g, 0.06, h, 0.86, 0xf1f5f9, W / 2 - 0.05, h / 2, 0);
      for (const y of ys) { B(g, W - 0.12, 0.04, 0.8, 0xffffff, 0, y - 0.02, 0); B(g, W - 0.12, 0.06, 0.02, cc, 0, y - 0.04, 0.41, { shadow: false }); }
      B(g, W - 0.04, 0.08, 0.86, 0x94a3b8, 0, 0.04, 0);
      B(g, W - 0.04, 0.22, 0.04, type === 'endcap' ? 0xef4444 : cc, 0, h + 0.11, -0.36);
      if (type === 'endcap') { const s = makeSprite('SALE!', 0.22, { bg: '#ef4444', color: '#fff', size: 40 }); s.position.set(0, h + 0.4, 0); g.add(s); }
      break;
    }
    case 'fridge': case 'freezer_upright': case 'fridge_large': {
      const h = type === 'fridge_large' ? 2.0 : 1.9;
      const body = type === 'freezer_upright' ? 0xdbeafe : 0xf1f5f9;
      B(g, W, 0.16, 0.9, DARK, 0, 0.08, 0);
      B(g, W, h - 0.16, 0.06, body, 0, h / 2 + 0.08, -0.42);
      B(g, 0.06, h, 0.9, body, -W / 2 + 0.03, h / 2, 0);
      B(g, 0.06, h, 0.9, body, W / 2 - 0.03, h / 2, 0);
      B(g, W, 0.12, 0.9, body, 0, h + 0.02, 0);
      B(g, W - 0.1, h - 0.3, 0.02, type === 'freezer_upright' ? 0x93c5fd : 0xe0f2fe, 0, h / 2 + 0.05, -0.39, { emissive: 0x7dd3fc, ei: 0.35 });
      for (const s of slotLayout(type)) B(g, W - 0.12, 0.03, 0.78, 0xe2e8f0, 0, s.y - 0.015, -0.02, { opacity: 0.9 });
      B(g, W, 0.24, 0.05, cc, 0, h + 0.2, 0.4);
      const lbl = makeLabel(CATEGORIES[def.cat].icon + ' ' + (type === 'freezer_upright' ? 'FROZEN' : 'CHILLED'), 0.2, { bg: null, color: '#fff', size: 40 }, W - 0.3);
      lbl.position.set(0, h + 0.2, 0.43); g.add(lbl);
      if (type !== 'fridge_large') {
        const doors = W > 2.5 ? 3 : 2;
        for (let i = 0; i < doors; i++) {
          const dw = W / doors;
          const door = new THREE.Group(); door.position.set(-W / 2 + dw * i, 0, 0.44);
          B(door, dw - 0.04, h - 0.25, 0.03, 0xbae6fd, dw / 2, h / 2 + 0.06, 0, { opacity: 0.22, rough: 0.05, shadow: false });
          B(door, 0.04, h - 0.25, 0.05, 0x94a3b8, 0.02, h / 2 + 0.06, 0);
          B(door, 0.03, 0.4, 0.06, 0x475569, dw - 0.1, h / 2, 0.03);
          g.add(door);
        }
      } else {
        B(g, W, 0.08, 0.2, 0x0f172a, 0, 0.22, 0.38); // air curtain strip
      }
      const led = B(g, 0.1, 0.06, 0.02, 0x22c55e, W / 2 - 0.2, h + 0.02, 0.46, { emissive: 0x22c55e });
      g.userData.led = led;
      break;
    }
    case 'freezer': {
      B(g, W, 0.78, 0.9, 0xf1f5f9, 0, 0.39, 0);
      B(g, W - 0.1, 0.05, 0.8, 0xbfdbfe, 0, 0.4, 0, { emissive: 0x93c5fd, ei: 0.4 });
      B(g, W - 0.06, 0.03, 0.84, 0xbae6fd, 0, 0.82, 0, { opacity: 0.25, rough: 0.05, shadow: false });
      B(g, 0.04, 0.06, 0.86, 0x94a3b8, 0, 0.82, 0);
      B(g, W, 0.12, 0.92, cc, 0, 0.74, 0);
      B(g, W, 0.1, 0.92, DARK, 0, 0.05, 0);
      const led = B(g, 0.1, 0.05, 0.02, 0x22c55e, W / 2 - 0.15, 0.6, 0.46, { emissive: 0x22c55e });
      g.userData.led = led;
      const lbl = makeLabel('🧊 FROZEN', 0.16, { bg: '#818cf8', color: '#fff', size: 40 }, W - 0.4);
      lbl.position.set(0, 0.62, 0.465); g.add(lbl);
      break;
    }
    case 'produce': {
      B(g, W, 0.35, 0.9, WOOD2, 0, 0.17, 0);
      for (const s of slotLayout(type)) {
        const cx = s.x0 + 0.3, cz = s.z0 - 0.08;
        B(g, 0.9, 0.04, 0.36, WOOD, cx, s.y - 0.02, cz);
        B(g, 0.9, 0.12, 0.03, WOOD, cx, s.y + 0.04, cz + 0.18);
        B(g, 0.9, 0.12, 0.03, WOOD, cx, s.y + 0.04, cz - 0.18);
        B(g, 0.03, 0.12, 0.36, WOOD, cx - 0.45, s.y + 0.04, cz);
        B(g, 0.03, 0.12, 0.36, WOOD, cx + 0.45, s.y + 0.04, cz);
        if (s.y > 0.6) B(g, 0.9, s.y - 0.36, 0.3, WOOD2, cx, (s.y + 0.34) / 2, cz);
      }
      // awning
      for (let i = 0; i < 6; i++) B(g, W / 6, 0.04, 0.5, i % 2 ? 0xffffff : 0x16a34a, -W / 2 + W / 12 + i * W / 6, 1.55, 0.1, { shadow: false }).rotation.x = 0.3;
      C(g, 0.025, 0.025, 1.5, WOOD2, -W / 2 + 0.05, 0.78, -0.38); C(g, 0.025, 0.025, 1.5, WOOD2, W / 2 - 0.05, 0.78, -0.38);
      break;
    }
    case 'butcher': case 'deli': {
      const accent = type === 'butcher' ? 0xdc2626 : 0xeab308;
      B(g, W, 0.55, 0.85, type === 'butcher' ? 0x7f1d1d : 0x713f12, 0, 0.28, 0);
      B(g, W, 0.06, 0.85, 0xf8fafc, 0, 0.58, 0);
      B(g, W - 0.08, 0.02, 0.6, type === 'butcher' ? 0xfecaca : 0xfef9c3, 0, 0.615, 0.03, { emissive: 0xffffff, ei: 0.08 });
      const glass = B(g, W - 0.04, 0.5, 0.03, 0xe0f2fe, 0, 0.88, 0.32, { opacity: 0.25, rough: 0.05, shadow: false }); glass.rotation.x = -0.35;
      B(g, W - 0.04, 0.03, 0.4, 0xe0f2fe, 0, 1.12, 0.02, { opacity: 0.3, shadow: false });
      B(g, W, 0.06, 0.06, accent, 0, 0.62, 0.43);
      // back work top
      B(g, W, 0.06, 0.3, 0xe2e8f0, 0, 1.0, -0.36);
      B(g, 0.6, 0.04, 0.26, type === 'butcher' ? 0xd6a76c : 0xf8fafc, -0.6, 1.05, -0.36);
      if (type === 'butcher') { B(g, 0.03, 0.02, 0.22, 0x94a3b8, -0.5, 1.08, -0.36, { metal: 0.8, rough: 0.2 }); B(g, 0.05, 0.03, 0.1, 0x1e293b, -0.5, 1.08, -0.5); }
      else { C(g, 0.12, 0.12, 0.08, 0xfacc15, 0.6, 1.07, -0.36); C(g, 0.08, 0.08, 0.1, 0xfde68a, 0.9, 1.08, -0.36); }
      // sign + awning
      for (let i = 0; i < 8; i++) B(g, W / 8, 0.04, 0.45, i % 2 ? 0xffffff : accent, -W / 2 + W / 16 + i * W / 8, 2.2, 0.05, { shadow: false }).rotation.x = 0.35;
      C(g, 0.03, 0.03, 2.2, 0x475569, -W / 2 + 0.05, 1.1, -0.4); C(g, 0.03, 0.03, 2.2, 0x475569, W / 2 - 0.05, 1.1, -0.4);
      const s = makeSprite(type === 'butcher' ? '🔪 BUTCHER' : '🧀 DELI', 0.32, { bg: type === 'butcher' ? '#dc2626' : '#ca8a04', color: '#fff', size: 44 });
      s.position.set(0, 2.55, 0); g.add(s);
      if (type === 'butcher') for (let i = 0; i < 4; i++) { const sg = C(g, 0.03, 0.03, 0.25, 0xb45309, -1.2 + i * 0.12, 1.85, -0.3); sg.rotation.z = 0.1; }
      const led = B(g, 0.1, 0.05, 0.02, 0x22c55e, W / 2 - 0.15, 0.4, 0.43, { emissive: 0x22c55e });
      g.userData.led = led;
      staffMat(g, 0);
      break;
    }
    case 'checkout': {
      B(g, W, 0.85, 0.7, 0x1e40af, 0, 0.42, 0);
      B(g, W, 0.05, 0.75, 0xe2e8f0, 0, 0.87, 0);
      const belt = B(g, W - 0.5, 0.03, 0.45, 0x1f2937, -0.2, 0.9, 0.05); g.userData.belt = belt;
      B(g, 0.45, 0.05, 0.6, 0x94a3b8, W / 2 - 0.25, 0.9, 0);
      // register
      B(g, 0.32, 0.12, 0.28, 0x111827, W / 2 - 0.3, 0.98, -0.18);
      const scr = B(g, 0.3, 0.2, 0.03, 0x0ea5e9, W / 2 - 0.3, 1.15, -0.22, { emissive: 0x0ea5e9, ei: 0.6 }); scr.rotation.x = -0.4;
      g.userData.screen = scr;
      // scanner glass
      B(g, 0.22, 0.02, 0.22, 0xef4444, 0.35, 0.91, 0.05, { emissive: 0xef4444, ei: 0.5 });
      // lane light
      C(g, 0.02, 0.02, 1.2, 0x475569, -W / 2 + 0.08, 1.4, -0.28);
      const lamp = B(g, 0.22, 0.22, 0.22, 0x22c55e, -W / 2 + 0.08, 2.05, -0.28, { emissive: 0x22c55e, ei: 0.2 });
      g.userData.lamp = lamp;
      // bags
      B(g, 0.18, 0.22, 0.12, 0xfef3c7, W / 2 - 0.15, 1.02, 0.15);
      staffMat(g, -0.5);
      break;
    }
    case 'selfcheckout': {
      B(g, 0.7, 0.9, 0.6, 0xf1f5f9, 0, 0.45, -0.1);
      B(g, 0.72, 0.04, 0.62, 0x334155, 0, 0.92, -0.1);
      C(g, 0.03, 0.03, 0.5, 0x475569, 0, 1.2, -0.3);
      const scr = B(g, 0.4, 0.3, 0.04, 0x10b981, 0, 1.4, -0.25, { emissive: 0x10b981, ei: 0.7 }); scr.rotation.x = -0.3;
      g.userData.screen = scr;
      B(g, 0.2, 0.02, 0.2, 0xef4444, 0.12, 0.95, 0.05, { emissive: 0xef4444, ei: 0.5 });
      break;
    }
    case 'rack': {
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-0.38, 0.38]) B(g, 0.06, 1.95, 0.06, 0x2563eb, x, 0.98, z);
      for (const y of [0.1, 0.65, 1.2, 1.75]) { B(g, W - 0.04, 0.05, 0.8, 0xf59e0b, 0, y, 0); B(g, W, 0.08, 0.05, 0xf97316, 0, y, 0.4); }
      break;
    }
    case 'bin': {
      C(g, 0.2, 0.17, 0.6, 0x16a34a, 0, 0.3, 0); C(g, 0.22, 0.22, 0.06, 0x14532d, 0, 0.62, 0);
      const s = makeSprite('🗑️', 0.18, { bg: null }); s.position.set(0, 0.9, 0); g.add(s);
      break;
    }
    case 'plant': {
      C(g, 0.2, 0.15, 0.35, 0xc2410c, 0, 0.18, 0);
      for (let i = 0; i < 6; i++) S(g, 0.16 + (i % 3) * 0.03, i % 2 ? 0x16a34a : 0x22c55e, Math.cos(i) * 0.14, 0.55 + (i % 3) * 0.15, Math.sin(i * 2) * 0.12, { flat: true });
      break;
    }
    case 'lamp': {
      C(g, 0.16, 0.18, 0.04, DARK, 0, 0.02, 0); C(g, 0.02, 0.02, 1.6, DARK, 0, 0.8, 0);
      C(g, 0.12, 0.24, 0.28, 0xfef3c7, 0, 1.65, 0, { emissive: 0xfde68a, ei: 0.8 });
      break;
    }
    case 'sign': {
      const b1 = B(g, 0.6, 0.8, 0.04, 0x1e293b, 0, 0.45, 0.12); b1.rotation.x = -0.25;
      const b2 = B(g, 0.6, 0.8, 0.04, 0x1e293b, 0, 0.45, -0.12); b2.rotation.x = 0.25;
      const s = makeSprite('FRESH DEALS!', 0.14, { bg: '#1e293b', color: '#fde047', size: 36 }); s.position.set(0, 0.95, 0); g.add(s);
      break;
    }
    case 'bench': {
      B(g, 1.6, 0.06, 0.42, WOOD, 0, 0.45, 0); B(g, 1.6, 0.35, 0.05, WOOD, 0, 0.7, -0.2);
      for (const x of [-0.7, 0.7]) B(g, 0.06, 0.45, 0.4, DARK, x, 0.22, 0);
      break;
    }
    case 'balloons': {
      C(g, 0.1, 0.12, 0.08, 0x475569, 0, 0.04, 0);
      const cols = [0xef4444, 0x3b82f6, 0xfacc15, 0x22c55e, 0xec4899];
      const bg = new THREE.Group(); g.add(bg);
      cols.forEach((c, i) => { const a = i / cols.length * Math.PI * 2; S(bg, 0.17, c, Math.cos(a) * 0.2, 1.7 + (i % 2) * 0.2, Math.sin(a) * 0.2, { rough: 0.3 }); C(bg, 0.005, 0.005, 1.6, 0xffffff, Math.cos(a) * 0.1, 0.85, Math.sin(a) * 0.1); });
      g.userData.anim.push({ kind: 'bob', obj: bg });
      break;
    }
    case 'vending': {
      B(g, 0.8, 1.9, 0.75, 0xdc2626, 0, 0.95, -0.05);
      B(g, 0.55, 1.3, 0.03, 0xe0f2fe, -0.08, 1.15, 0.33, { emissive: 0x93c5fd, ei: 0.4 });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) C(g, 0.04, 0.04, 0.13, [0xfacc15, 0x22c55e, 0x3b82f6, 0xf97316][c], -0.28 + c * 0.13, 0.65 + r * 0.3, 0.25, { seg: 8 });
      B(g, 0.12, 0.3, 0.03, 0x111827, 0.3, 1.2, 0.33);
      break;
    }
    case 'flowers': {
      B(g, 1.8, 0.5, 0.7, WOOD, 0, 0.25, 0);
      const cols = [0xf43f5e, 0xfacc15, 0xa855f7, 0xffffff, 0xfb923c, 0xec4899];
      for (let i = 0; i < 6; i++) {
        const x = -0.75 + i * 0.3; C(g, 0.12, 0.1, 0.25, 0x0ea5e9, x, 0.62, 0);
        for (let j = 0; j < 5; j++) S(g, 0.06, cols[(i + j) % 6], x + Math.cos(j * 1.3) * 0.07, 0.85 + j * 0.03, Math.sin(j * 1.3) * 0.07, { flat: true });
      }
      break;
    }
    case 'fountain': {
      C(g, 0.95, 1.0, 0.45, 0xe7e5e4, 0, 0.22, 0, { seg: 24 });
      const water = C(g, 0.88, 0.88, 0.05, 0x38bdf8, 0, 0.42, 0, { seg: 24, opacity: 0.8, rough: 0.1, emissive: 0x0284c7, ei: 0.2 });
      C(g, 0.12, 0.16, 1.1, 0xd6d3d1, 0, 0.75, 0);
      C(g, 0.4, 0.3, 0.12, 0xe7e5e4, 0, 1.3, 0, { seg: 16 });
      const jet = C(g, 0.04, 0.08, 0.5, 0x7dd3fc, 0, 1.6, 0, { opacity: 0.7, emissive: 0x38bdf8, ei: 0.4 });
      g.userData.anim.push({ kind: 'jet', obj: jet }, { kind: 'water', obj: water });
      break;
    }
    case 'neon': {
      B(g, 0.9, 0.06, 0.06, DARK, 0, 1.0, 0); C(g, 0.03, 0.03, 1.0, DARK, 0, 0.5, 0);
      const s = makeSprite('★ OPEN ★', 0.28, { bg: '#0f172a', color: '#f0abfc', size: 44, border: '#e879f9' }); s.position.set(0, 1.3, 0); g.add(s);
      g.userData.anim.push({ kind: 'blink', obj: s });
      break;
    }
    case 'statue': {
      B(g, 0.7, 0.6, 0.7, 0xe7e5e4, 0, 0.3, 0);
      const gold = { metal: 0.9, rough: 0.25 };
      const cart = new THREE.Group(); cart.position.y = 0.6; g.add(cart);
      B(cart, 0.5, 0.3, 0.35, 0xfbbf24, 0, 0.35, 0, gold); C(cart, 0.05, 0.05, 0.04, 0xfbbf24, -0.18, 0.08, 0.15, gold).rotation.x = Math.PI / 2;
      C(cart, 0.05, 0.05, 0.04, 0xfbbf24, 0.18, 0.08, 0.15, gold).rotation.x = Math.PI / 2; B(cart, 0.04, 0.35, 0.04, 0xfbbf24, -0.27, 0.5, 0, gold);
      g.userData.anim.push({ kind: 'spin', obj: cart });
      break;
    }
    default: B(g, W, 1, D, 0x94a3b8, 0, 0.5, 0);
  }
  const ud = g.userData;
  mergeStatic(g, new Set([ud.led, ud.belt, ud.screen, ud.lamp, ...ud.anim.map(a => a.obj)]));
  return g;
}

function staffMat(g, x) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.9 }));
  m.rotation.x = -Math.PI / 2; m.position.set(x, 0.006, -1); m.receiveShadow = true; g.add(m);
  const t = makeSprite('STAFF', 0.12, { bg: null, color: '#bfdbfe', size: 30 }); t.position.set(x, 0.1, -1.3); g.add(t);
}

// Merge static meshes of a group into one mesh per material. Objects in `exclude` (and their children) stay separate.
export function mergeStatic(group, exclude = new Set()) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), keep = [];
  const skip = new Set();
  for (const o of exclude) o && o.traverse(c => skip.add(c));
  group.traverse(o => {
    if (o === group || skip.has(o)) return;
    if (!o.isMesh || o.material.map || o.material.transparent) { if (o.isMesh || o.isSprite) keep.push(o); return; }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + (o.castShadow ? 's' : '');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, shadow: o.castShadow, geos: [] });
    buckets.get(key).geos.push(g);
  });
  // re-parent kept objects directly under the group with their baked local transform
  const kept = keep.map(o => { const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); return { o, m }; });
  const excluded = [...exclude].filter(Boolean).map(o => { const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld); return { o, m }; });
  group.clear();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false); if (!merged) continue;
    const m = new THREE.Mesh(merged, b.mat); m.castShadow = b.shadow; m.receiveShadow = true;
    group.add(m);
  }
  for (const { o, m } of [...kept, ...excluded]) { o.removeFromParent(); m.decompose(o.position, o.quaternion, o.scale); group.add(o); }
  return group;
}

export function ghostify(obj, ok) {
  const m = new THREE.MeshBasicMaterial({ color: ok ? 0x22c55e : 0xef4444, transparent: true, opacity: 0.45, depthWrite: false });
  obj.traverse(o => { if (o.isMesh) { o.material = m; o.castShadow = false; } if (o.isSprite) o.visible = false; });
  obj.userData.ghostMat = m;
  return obj;
}

// ------------------------------------------------------------------ characters
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const SKINS = [0xffdbac, 0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0x5c3a21, 0xfde3cf];
const HAIRS = [0x2b1d0e, 0x4a2c17, 0x8b5a2b, 0xd6a75c, 0x111111, 0xb91c1c, 0xe5e7eb, 0x7c3aed];
const SHIRTS = [0xf87171, 0xfb923c, 0xfacc15, 0x4ade80, 0x2dd4bf, 0x60a5fa, 0xa78bfa, 0xf472b6, 0xffffff, 0x94a3b8, 0x1e293b, 0x84cc16];
const PANTS = [0x1e3a8a, 0x334155, 0x78350f, 0x111827, 0x6b7280, 0x065f46, 0x9a3412];

export function lookFromSeed(seed) {
  const r = rng(seed);
  const p = (arr) => arr[Math.floor(r() * arr.length)];
  const kid = r() < 0.1, elder = !kid && r() < 0.15;
  return { skin: p(SKINS), hair: elder ? 0xe5e7eb : p(HAIRS), shirt: p(SHIRTS), pants: p(PANTS), hairStyle: Math.floor(r() * 4),
    scale: kid ? 0.68 : 0.9 + r() * 0.16, hat: r() < 0.12 ? p([0xef4444, 0x1e293b, 0x22c55e, 0xfacc15]) : null, glasses: r() < 0.2, width: 0.9 + r() * 0.25 };
}

export function makeCharacter(look) {
  const g = new THREE.Group();
  const root = new THREE.Group(); g.add(root);
  const sc = look.scale || 1; root.scale.setScalar(sc);
  const skin = mat(look.skin), shirt = mat(look.shirt), pants = mat(look.pants);
  const P = {};
  // legs
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.1, 0.58, 0); root.add(hip);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.38, 3, 8), pants); leg.position.y = -0.27; leg.castShadow = true; hip.add(leg);
    const shoe = B(hip, 0.14, 0.08, 0.22, 0x1f2937, 0, -0.54, 0.04);
    P[side < 0 ? 'legL' : 'legR'] = hip;
    void shoe;
  }
  const torso = new THREE.Group(); torso.position.y = 0.58; root.add(torso); P.torso = torso;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2 * (look.width || 1), 0.32, 4, 12), shirt); body.position.y = 0.33; body.castShadow = true; torso.add(body);
  if (look.apron) { const ap = B(torso, 0.34, 0.5, 0.05, look.apron, 0, 0.26, 0.19); ap.castShadow = false; }
  if (look.badge) B(torso, 0.08, 0.05, 0.02, look.badge, 0.1, 0.5, 0.21, { emissive: look.badge, ei: 0.3 });
  // arms
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.27 * (look.width || 1), 0.55, 0); torso.add(sh);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.32, 3, 8), shirt); arm.position.y = -0.2; arm.castShadow = true; sh.add(arm);
    S(sh, 0.065, look.skin, 0, -0.42, 0, { material: skin });
    P[side < 0 ? 'armL' : 'armR'] = sh;
  }
  // head
  const head = new THREE.Group(); head.position.y = 0.88; torso.add(head); P.head = head;
  S(head, 0.2, look.skin, 0, 0.0, 0, { material: skin, w: 16, h: 12 });
  S(head, 0.028, 0x111111, -0.07, 0.03, 0.18, { shadow: false });
  S(head, 0.028, 0x111111, 0.07, 0.03, 0.18, { shadow: false });
  const mouth = B(head, 0.07, 0.015, 0.01, 0x7f1d1d, 0, -0.07, 0.19, { shadow: false }); P.mouth = mouth;
  S(head, 0.035, look.skin, 0, -0.01, 0.2, { material: skin, shadow: false });
  if (look.glasses) { B(head, 0.2, 0.02, 0.01, 0x111111, 0, 0.04, 0.2, { shadow: false }); }
  const hm = mat(look.hair);
  if (look.hairStyle !== 2) {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.215, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hm);
    hair.rotation.x = -0.25; hair.position.set(0, 0.02, -0.02); hair.castShadow = true; head.add(hair);
    if (look.hairStyle === 1) { const lh = B(head, 0.36, 0.3, 0.12, look.hair, 0, -0.1, -0.13, { material: hm }); void lh; }
    if (look.hairStyle === 3) S(head, 0.09, look.hair, 0, 0.17, -0.15, { material: hm });
  }
  if (look.hat) {
    C(head, 0.21, 0.21, 0.1, look.hat, 0, 0.16, 0, { seg: 16 });
    B(head, 0.2, 0.025, 0.14, look.hat, 0, 0.12, 0.2);
  }
  if (look.chef) { C(head, 0.17, 0.2, 0.22, 0xffffff, 0, 0.27, 0, { seg: 14 }); S(head, 0.2, 0xffffff, 0, 0.4, 0, { w: 12, h: 8 }); }
  if (look.cap) { C(head, 0.21, 0.21, 0.12, look.cap, 0, 0.16, 0, { seg: 16 }); B(head, 0.22, 0.025, 0.18, look.cap, 0, 0.12, 0.22); }
  if (look.hairnet) { const n = new THREE.Mesh(new THREE.SphereGeometry(0.225, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(0xffffff, { opacity: 0.7 })); n.position.y = 0.03; head.add(n); }
  // hands attach point for carried things
  const hold = new THREE.Group(); hold.position.set(0, 0.95, 0.36); root.add(hold); P.hold = hold;
  const side = new THREE.Group(); side.position.set(0.34, 0.2, 0.05); root.add(side); P.side = side;
  g.userData.parts = P;
  g.userData.phase = Math.random() * 6;
  return g;
}

// pose: 'walk' | 'idle' | 'carry' | 'work' | 'cart'
export function animateCharacter(ch, dt, moving, pose, speed = 1) {
  const P = ch.userData.parts; if (!P) return;
  ch.userData.phase += dt * (moving ? 9 * speed : 2);
  const ph = ch.userData.phase;
  const sw = moving ? Math.sin(ph) * 0.65 : 0;
  P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
  P.torso.position.y = 0.58 + (moving ? Math.abs(Math.cos(ph)) * 0.04 : Math.sin(ph) * 0.006);
  if (pose === 'carry' || pose === 'cart') {
    P.armL.rotation.x = P.armR.rotation.x = -1.25 + (moving ? Math.sin(ph * 2) * 0.03 : 0);
    P.armL.rotation.z = 0.15; P.armR.rotation.z = -0.15;
  } else if (pose === 'work') {
    P.armL.rotation.x = -0.9 + Math.sin(ph * 5) * 0.25; P.armR.rotation.x = -0.9 - Math.sin(ph * 5) * 0.25;
    P.armL.rotation.z = 0.1; P.armR.rotation.z = -0.1;
  } else if (pose === 'basket') {
    P.armL.rotation.x = -sw * 0.8; P.armR.rotation.x = -0.15; P.armL.rotation.z = 0.05; P.armR.rotation.z = -0.05;
  } else if (pose === 'wave') {
    P.armR.rotation.x = -2.6; P.armR.rotation.z = -0.3 + Math.sin(ph * 6) * 0.4; P.armL.rotation.x = 0;
  } else if (pose === 'clean') {
    P.armL.rotation.x = -0.6 + Math.sin(ph * 6) * 0.4; P.armR.rotation.x = -0.6 + Math.sin(ph * 6) * 0.4;
  } else {
    P.armL.rotation.x = -sw * 0.8; P.armR.rotation.x = sw * 0.8; P.armL.rotation.z = 0.05; P.armR.rotation.z = -0.05;
  }
  P.head.rotation.y = moving ? 0 : Math.sin(ph * 0.4) * 0.25;
}

// ------------------------------------------------------------------ props
export function makeBox(pid, color) {
  const g = new THREE.Group();
  B(g, 0.5, 0.36, 0.42, 0xc8a26b, 0, 0.18, 0);
  B(g, 0.08, 0.005, 0.43, 0xe7d3a8, 0, 0.362, 0, { shadow: false });
  B(g, 0.26, 0.16, 0.005, color, 0, 0.2, 0.213, { shadow: false });
  B(g, 0.005, 0.16, 0.26, color, 0.253, 0.2, 0, { shadow: false });
  return g;
}
export function makeBasket(color = 0xef4444) {
  const g = new THREE.Group();
  B(g, 0.32, 0.16, 0.22, color, 0, 0.08, 0, { opacity: 0.95 });
  B(g, 0.3, 0.02, 0.2, 0x111827, 0, 0.16, 0);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 12, Math.PI), mat(0x111827)); handle.position.y = 0.16; g.add(handle);
  return g;
}
export function makeCart() {
  const g = new THREE.Group();
  const wire = mat(0x94a3b8, { metal: 0.7, rough: 0.3 });
  const basket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.7), mat(0x94a3b8, { opacity: 0.35, metal: 0.6 })); basket.position.set(0, 0.75, 0); g.add(basket);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.5, 0.35, 0.7)), new THREE.LineBasicMaterial({ color: 0x64748b })); edges.position.copy(basket.position); g.add(edges);
  for (const [x, z] of [[-0.2, -0.3], [0.2, -0.3], [-0.2, 0.3], [0.2, 0.3]]) { C(g, 0.05, 0.05, 0.04, 0x111827, x, 0.06, z).rotation.z = Math.PI / 2; C(g, 0.012, 0.012, 0.55, 0x64748b, x, 0.33, z, { material: wire }); }
  B(g, 0.52, 0.03, 0.03, 0xef4444, 0, 1.02, -0.38);
  g.userData.itemsAt = new THREE.Vector3(0, 0.62, 0);
  return g;
}
export function makeHandTruck() {
  const g = new THREE.Group();
  B(g, 0.05, 1.1, 0.05, 0xef4444, -0.22, 0.55, -0.05); B(g, 0.05, 1.1, 0.05, 0xef4444, 0.22, 0.55, -0.05);
  B(g, 0.5, 0.03, 0.3, 0x94a3b8, 0, 0.03, 0.12, { metal: 0.6 });
  for (const x of [-0.26, 0.26]) C(g, 0.09, 0.09, 0.06, 0x111827, x, 0.09, -0.05).rotation.z = Math.PI / 2;
  return g;
}

export function makeTruck(color = 0xf97316, label = '') {
  const g = new THREE.Group();
  B(g, 2.4, 1.7, 1.6, 0xffffff, -0.5, 1.35, 0);
  B(g, 2.42, 0.35, 1.62, color, -0.5, 1.0, 0, { shadow: false });
  B(g, 1.0, 1.15, 1.5, color, 1.25, 1.0, 0);
  B(g, 0.05, 0.5, 1.3, 0x93c5fd, 1.76, 1.3, 0, { opacity: 0.7, rough: 0.05 });
  B(g, 3.4, 0.2, 1.4, 0x334155, 0, 0.4, 0);
  for (const x of [-1.2, 1.2]) for (const z of [-0.72, 0.72]) { const w = C(g, 0.32, 0.32, 0.22, 0x111827, x, 0.32, z, { seg: 14 }); w.rotation.x = Math.PI / 2; }
  B(g, 0.1, 0.12, 0.25, 0xfde047, 1.76, 0.75, 0.5, { emissive: 0xfde047, ei: 0.5 }); B(g, 0.1, 0.12, 0.25, 0xfde047, 1.76, 0.75, -0.5, { emissive: 0xfde047, ei: 0.5 });
  if (label) { const s = makeSprite(label, 0.4, { bg: null, color: '#1e293b', size: 44 }); s.position.set(-0.5, 1.6, 0.82); g.add(s); }
  return g;
}

export function makeTree(r) {
  const g = new THREE.Group();
  C(g, 0.12, 0.16, 1.2, 0x7c4a1e, 0, 0.6, 0);
  const cols = [0x16a34a, 0x15803d, 0x22c55e];
  for (let i = 0; i < 3; i++) S(g, 0.75 - i * 0.15, cols[i], (r() - 0.5) * 0.3, 1.5 + i * 0.45, (r() - 0.5) * 0.3, { flat: true, w: 8, h: 6 });
  return g;
}
export function makeStreetLamp() {
  const g = new THREE.Group();
  C(g, 0.06, 0.08, 3.6, 0x334155, 0, 1.8, 0);
  B(g, 0.6, 0.08, 0.15, 0x334155, 0.25, 3.6, 0);
  const bulb = B(g, 0.25, 0.08, 0.2, 0xfef9c3, 0.45, 3.55, 0, { emissive: 0xfde68a, ei: 0.2 });
  g.userData.bulb = bulb;
  return g;
}
export function makePigeon() {
  const g = new THREE.Group();
  S(g, 0.12, 0x9ca3af, 0, 0, 0).scale.set(1, 0.8, 1.3);
  S(g, 0.07, 0x6b7280, 0, 0.1, 0.12);
  B(g, 0.03, 0.02, 0.06, 0xf59e0b, 0, 0.09, 0.2);
  const wl = B(g, 0.22, 0.02, 0.12, 0x6b7280, -0.12, 0.03, 0); const wr = B(g, 0.22, 0.02, 0.12, 0x6b7280, 0.12, 0.03, 0);
  g.userData.wings = [wl, wr];
  return g;
}
