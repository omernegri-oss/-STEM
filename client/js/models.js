// Procedural stylized low-poly models built from primitives (no external assets).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURNITURE, CATEGORIES, PRODUCT_MAP, slotRegions } from '/shared/data.js';
import { PRODUCT_GEOS, productMaterials, packagingTexture } from './products3d.js';
import { surfaceMaps, pbrShared } from './textures.js';

// clothing: woven fabric or denim texture, tinted; skin with a soft sheen
const clothCache = new Map();
function cloth(color, kind = 'fabric', rough = 0.9) {
  const k = color + kind;
  if (!clothCache.has(k)) { const m = new THREE.MeshStandardMaterial({ color, ...surfaceMaps(kind, 0.12, 0.12), roughness: rough }); m.normalScale.set(0.6, 0.6); clothCache.set(k, m); }
  return clothCache.get(k);
}

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
// any other shared geometry, built once per key
export function cachedGeo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }
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

// ------------------------------------------------------------------ product geometries (see products3d.js)
export const UNIT_GEOS = PRODUCT_GEOS;
export function slotLayout(type) { return slotRegions(type); }

// free the per-object GPU resources of a removed object (only things marked as owned; caches stay)
export function disposeOwned(obj) {
  obj.traverse(o => {
    if (!o.userData.owned) return;
    if (o.material) o.material.dispose();
    if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
  });
}

// ------------------------------------------------------------------ text sprites
const spriteTexCache = new Map();
export function textTexture(text, { size = 48, color = '#1e293b', bg = 'rgba(255,255,255,0.95)', pad = 14, radius = 18, bold = true, border = null, font = 'Barlow', weight = null } = {}) {
  const key = [text, size, color, bg, border, font, weight, bold, pad, radius].join('|');
  if (spriteTexCache.has(key)) { const hit = spriteTexCache.get(key); spriteTexCache.delete(key); spriteTexCache.set(key, hit); return hit; }
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  const f = `${weight || (bold ? '700' : '500')} ${size}px "${font}", "Barlow", "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  g.font = f; const w = Math.ceil(g.measureText(text).width) + pad * 2; const h = size + pad * 1.3;
  c.width = w; c.height = h; g.font = f;
  if (bg) { g.fillStyle = bg; roundRect(g, 2, 2, w - 4, h - 4, radius); g.fill(); if (border) { g.lineWidth = 4; g.strokeStyle = border; g.stroke(); } }
  g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const res = { tex: t, aspect: w / h };
  spriteTexCache.set(key, res);
  // keep the cache bounded (floating "+$4.35" texts are almost all unique): free the least recently used.
  // A sprite still showing an evicted texture just re-uploads it on its next frame.
  if (spriteTexCache.size > 400) { const [k0, old] = spriteTexCache.entries().next().value; spriteTexCache.delete(k0); old.tex.dispose(); }
  return res;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
export function makeSprite(text, height = 0.4, opts = {}) {
  const { tex, aspect } = textTexture(text, opts);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: opts.depthTest ?? true, transparent: true }));
  s.scale.set(height * aspect, height, 1); s.renderOrder = 10; s.userData.owned = true;
  return s;
}
export function makeLabel(text, height = 0.2, opts = {}, maxW = 10) {
  const { tex, aspect } = textTexture(text, opts);
  let w = height * aspect, h = height;
  if (w > maxW) { h *= maxW / w; w = maxW; }
  const m = new THREE.Mesh(cachedGeo('plane1', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  m.scale.set(w, h, 1); m.userData.owned = true; m.renderOrder = 2;
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
      // metal gondola shelving: kick plate, pegboard back, steel decks with price rails, header
      const h = type === 'shelf_large' ? 1.9 : type === 'endcap' ? 1.48 : 1.7;
      const regs = slotRegions(type), ys = [...new Set(regs.map(r => r.y))];
      const steel = mat(0xdfe3e8, { metal: 0.55, rough: 0.35 }), upr = mat(0x4b5563, { metal: 0.6, rough: 0.4 });
      B(g, W - 0.02, 0.15, 0.03, 0x2d333b, 0, 0.075, 0.3, { material: mat(0x2d333b, { metal: 0.4, rough: 0.5 }) });
      const peg = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, h - 0.15, 0.025), pegboardMat(W, h)); peg.position.set(0, h / 2 + 0.07, -0.29); peg.castShadow = true; peg.receiveShadow = true; g.add(peg);
      const xs = [-W / 2 + 0.03, W / 2 - 0.03, ...[...new Set(regs.map(r => r.x1))].filter(x => x < W / 2 - 0.1).map(x => x + 0.03)];
      for (const x of xs) { B(g, 0.05, h, 0.05, 0, x, h / 2, -0.29, { material: upr }); B(g, 0.03, 0.35, 0.56, 0, x, 0.3, 0.01, { material: upr }); }
      for (const y of ys) {
        B(g, W - 0.08, 0.022, 0.56, 0, 0, y - 0.011, -0.01, { material: steel });
        B(g, W - 0.08, 0.05, 0.016, 0xe5e7eb, 0, y - 0.022, 0.275, { material: mat(0xf3f4f6, { rough: 0.3 }) });
        B(g, W - 0.08, 0.008, 0.017, cc, 0, y + 0.005, 0.276, { shadow: false });
      }
      B(g, W - 0.06, 0.022, 0.56, 0, 0, h - 0.011, -0.01, { material: steel });
      B(g, W, 0.2, 0.035, 0xffffff, 0, h + 0.1, -0.29, { material: mat(0xf8fafc, { rough: 0.4 }) });
      B(g, W, 0.025, 0.04, cc, 0, h + 0.01, -0.29, { shadow: false });
      const lbl = makeLabel(type === 'endcap' ? 'SPECIAL OFFER' : CATEGORIES[def.cat].name, 0.07, { bg: null, color: '#334155', size: 32 }, 0.6);
      lbl.position.set(-W / 2 + 0.35, h + 0.1, -0.27); g.add(lbl);
      if (type === 'endcap') B(g, W - 0.06, 0.2, 0.02, 0x8a1c1c, 0, h + 0.1, -0.268, { shadow: false });
      break;
    }
    case 'fridge': case 'freezer_upright': case 'fridge_large': {
      // glass-door merchandiser (or open multideck for the large one) with LED lighting
      const h = 2.05, open = type === 'fridge_large', frozen = type === 'freezer_upright';
      const body = mat(open ? 0x1f2937 : 0x111827, { metal: 0.5, rough: 0.35 });
      const inner = mat(frozen ? 0xdbeafe : 0xf1f5f9, { rough: 0.5, emissive: 0xffffff, ei: 0.12 });
      B(g, W, 0.18, 0.92, 0, 0, 0.09, 0, { material: body });
      B(g, W - 0.04, 0.12, 0.02, 0x374151, 0, 0.09, 0.465, { material: mat(0x374151, { metal: 0.7, rough: 0.3 }) }); // grille
      B(g, W, h - 0.18, 0.05, 0, 0, h / 2 + 0.09, -0.44, { material: body });
      B(g, W - 0.1, h - 0.3, 0.02, 0, 0, h / 2 + 0.06, -0.41, { material: inner });
      B(g, 0.05, h, 0.92, 0, -W / 2 + 0.025, h / 2, 0, { material: body }); B(g, 0.05, h, 0.92, 0, W / 2 - 0.025, h / 2, 0, { material: body });
      B(g, W, 0.16, 0.92, 0, 0, h + 0.08, 0, { material: body });
      const wire = mat(0xe5e7eb, { metal: 0.7, rough: 0.3, opacity: 0.95 });
      for (const y of [...new Set(slotRegions(type).map(r => r.y))]) {
        B(g, W - 0.12, 0.015, 0.6, 0, 0, y - 0.008, 0.0, { material: wire });
        B(g, W - 0.12, 0.04, 0.012, 0xffffff, 0, y - 0.02, 0.305, { material: mat(0xf8fafc) });
        if (open) B(g, W - 0.12, 0.012, 0.02, 0xffffff, 0, y + 0.29, 0.28, { material: mat(0xffffff, { emissive: 0xffffff, ei: 1.2 }), shadow: false });
      }
      const header = B(g, W, 0.16, 0.03, 0, 0, h + 0.08, 0.465, { material: mat(cc, { rough: 0.4 }) });
      void header;
      const lbl = makeLabel(frozen ? 'Frozen' : 'Chilled', 0.08, { bg: null, color: '#fff', size: 32 }, 0.4);
      lbl.position.set(-W / 2 + 0.25, h + 0.08, 0.483); g.add(lbl);
      if (!open) {
        const doors = W > 2.5 ? 3 : 2;
        g.userData.doors = [];
        const frame = mat(0x9ca3af, { metal: 0.85, rough: 0.25 });
        for (let i = 0; i < doors; i++) {
          const dw = W / doors;
          const door = new THREE.Group(); door.position.set(-W / 2 + dw * i + 0.02, 0, 0.45);
          B(door, dw - 0.04, h - 0.3, 0.02, 0xdbeafe, dw / 2 - 0.02, h / 2 + 0.04, 0, { material: mat(0xdbeafe, { opacity: 0.16, rough: 0.02, metal: 0.1 }), shadow: false });
          for (const [w_, hh, x, y] of [[0.04, h - 0.26, 0.0, h / 2 + 0.04], [0.04, h - 0.26, dw - 0.04, h / 2 + 0.04], [dw - 0.04, 0.04, dw / 2 - 0.02, 0.21], [dw - 0.04, 0.04, dw / 2 - 0.02, h - 0.11]]) B(door, w_, hh, 0.03, 0, x, y, 0, { material: frame });
          B(door, 0.025, 0.9, 0.04, 0, dw - 0.12, h / 2, 0.035, { material: frame });
          // vertical LED strip behind each door frame
          B(g, 0.02, h - 0.4, 0.02, 0xffffff, -W / 2 + dw * i + 0.05, h / 2 + 0.06, 0.36, { material: mat(0xffffff, { emissive: 0xffffff, ei: 1.4 }), shadow: false });
          g.add(door); g.userData.doors.push(door);
        }
      } else {
        B(g, W - 0.1, 0.03, 0.06, 0x111827, 0, 0.3, 0.42, { material: mat(0x111827) });
        B(g, W - 0.1, 0.06, 0.08, 0x9ca3af, 0, h - 0.05, 0.43, { material: mat(0x9ca3af, { metal: 0.6 }) }); // night blind roll
      }
      const led = B(g, 0.08, 0.04, 0.02, 0x22c55e, W / 2 - 0.15, 0.09, 0.47, { emissive: 0x22c55e });
      g.userData.led = led;
      break;
    }
    case 'freezer': {
      // island chest freezer with sliding glass lids
      const white = mat(0xf8fafc, { rough: 0.35 }), trim = mat(0x9ca3af, { metal: 0.85, rough: 0.25 });
      B(g, W, 0.72, 0.92, 0, 0, 0.36, 0, { material: white });
      B(g, W - 0.08, 0.04, 0.84, 0xbfdbfe, 0, 0.3, 0, { material: mat(0xbfdbfe, { emissive: 0x93c5fd, ei: 0.4 }) });
      B(g, W, 0.12, 0.94, 0, 0, 0.06, 0, { material: mat(0x374151, { metal: 0.4 }) });
      for (const z of [-0.46, 0.46]) B(g, W, 0.08, 0.03, 0, 0, 0.76, z, { material: trim });
      for (const x of [-W / 2 + 0.015, W / 2 - 0.015, 0]) B(g, 0.03, 0.08, 0.94, 0, x, 0.76, 0, { material: trim });
      B(g, W - 0.04, 0.16, 0.01, cc, 0, 0.56, 0.466, { shadow: false });
      const lid = new THREE.Group(); g.add(lid); g.userData.lid = lid;
      B(lid, W / 2 - 0.04, 0.02, 0.88, 0, -W / 4, 0.8, 0, { material: mat(0xdbeafe, { opacity: 0.2, rough: 0.02 }), shadow: false });
      B(g, W / 2 - 0.04, 0.02, 0.88, 0, W / 4, 0.79, 0, { material: mat(0xdbeafe, { opacity: 0.2, rough: 0.02 }), shadow: false });
      const led = B(g, 0.08, 0.04, 0.02, 0x22c55e, W / 2 - 0.15, 0.4, 0.465, { emissive: 0x22c55e });
      g.userData.led = led;
      const lbl = makeLabel('Frozen', 0.07, { bg: null, color: '#fff', size: 30 }, 0.3);
      lbl.position.set(-W / 2 + 0.22, 0.56, 0.473); g.add(lbl);
      break;
    }
    case 'produce': {
      const wood = mat(0xb7834f, { rough: 0.8 }), wood2 = mat(0x8b5a2b, { rough: 0.85 });
      B(g, W, 0.36, 0.86, 0, 0, 0.18, 0, { material: wood2 });
      for (const r of slotRegions(type)) {
        const cx = (r.x0 + r.x1) / 2, cw = r.x1 - r.x0, cz = r.zf - r.depth / 2;
        B(g, cw, 0.03, r.depth, 0, cx, r.y - 0.015, cz, { material: wood });
        for (const zz of [r.zf, r.zf - r.depth]) for (const yy of [0.03, 0.09]) B(g, cw, 0.04, 0.02, 0, cx, r.y + yy, zz, { material: wood });
        for (const xx of [r.x0, r.x1]) B(g, 0.02, 0.12, r.depth, 0, xx, r.y + 0.05, cz, { material: wood });
        if (r.y > 0.6) B(g, cw, r.y - 0.36, r.depth, 0, cx, (r.y + 0.36) / 2, cz, { material: wood2 });
      }
      for (const x of [-W / 2 + 0.04, W / 2 - 0.04]) C(g, 0.025, 0.025, 1.7, 0, x, 0.85, -0.38, { material: wood2 });
      B(g, W, 0.24, 0.04, 0x166534, 0, 1.75, -0.38, { material: mat(0x166534, { rough: 0.6 }) });
      const lbl = makeLabel('Fresh Produce', 0.09, { bg: null, color: '#fff', size: 32 }, 0.7); lbl.position.set(-W / 2 + 0.45, 1.75, -0.355); g.add(lbl);
      break;
    }
    case 'butcher': case 'deli': {
      // 3x3 department: back row = walk-in fridge + prep station, middle = staff aisle, front = display counter
      const meat = type === 'butcher';
      const accent = meat ? 0xdc2626 : 0xeab308;
      // --- big fridge (back left, 2 tiles)
      const fx = -0.5, fz = -1;
      B(g, 2, 0.12, 0.9, DARK, fx, 0.06, fz);
      B(g, 2, 2.3, 0.08, 0xe2e8f0, fx, 1.15, fz - 0.41);
      B(g, 0.08, 2.3, 0.9, 0xe2e8f0, fx - 0.96, 1.15, fz); B(g, 0.08, 2.3, 0.9, 0xe2e8f0, fx + 0.96, 1.15, fz);
      B(g, 2, 0.12, 0.9, 0xe2e8f0, fx, 2.32, fz);
      B(g, 1.85, 2.1, 0.02, meat ? 0xfee2e2 : 0xfef9c3, fx, 1.15, fz - 0.36, { emissive: 0xffffff, ei: 0.18 });
      for (const y of [0.55, 1.15]) B(g, 1.85, 0.03, 0.75, 0xcbd5e1, fx, y, fz);
      if (meat) {
        B(g, 1.85, 0.03, 0.03, 0x64748b, fx, 2.1, fz - 0.1, { metal: 0.8 });
        for (let i = 0; i < 4; i++) { const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.38, 3, 8), mat(i % 2 ? 0xb91c1c : 0x991b1b)); h.position.set(fx - 0.65 + i * 0.43, 1.7, fz - 0.1); h.castShadow = true; g.add(h); B(g, 0.02, 0.15, 0.02, 0x94a3b8, fx - 0.65 + i * 0.43, 2.02, fz - 0.1); }
        for (let i = 0; i < 5; i++) { B(g, 0.28, 0.06, 0.2, [0xb91c1c, 0xfda4af, 0x9a3412][i % 3], fx - 0.7 + i * 0.35, 0.6, fz); B(g, 0.28, 0.06, 0.2, [0x991b1b, 0xbe123c][i % 2], fx - 0.7 + i * 0.35, 1.2, fz); }
      } else {
        for (let i = 0; i < 4; i++) { C(g, 0.17, 0.17, 0.14, i % 2 ? 0xfacc15 : 0xfde68a, fx - 0.6 + i * 0.4, 0.64, fz, { seg: 14 }); C(g, 0.15, 0.15, 0.12, 0xfbbf24, fx - 0.6 + i * 0.4, 1.24, fz, { seg: 14 }); }
        for (let i = 0; i < 4; i++) { const sal = C(g, 0.05, 0.05, 0.35, 0x9f1239, fx - 0.6 + i * 0.4, 1.75, fz - 0.1); sal.rotation.z = Math.PI / 2; }
      }
      g.userData.doors = [];
      for (let i = 0; i < 2; i++) {
        const door = new THREE.Group(); door.position.set(fx - 1 + i, 0, fz + 0.45);
        B(door, 0.96, 2.05, 0.03, 0xbae6fd, 0.5, 1.15, 0, { opacity: 0.25, rough: 0.05, shadow: false });
        B(door, 0.04, 2.05, 0.05, 0x94a3b8, 0.02, 1.15, 0); B(door, 0.96, 0.05, 0.05, 0x94a3b8, 0.5, 0.15, 0); B(door, 0.96, 0.05, 0.05, 0x94a3b8, 0.5, 2.15, 0);
        B(door, 0.03, 0.5, 0.06, 0x334155, 0.88, 1.15, 0.03);
        g.add(door); g.userData.doors.push(door);
      }
      const plaque = makeLabel(meat ? 'Butcher' : 'Deli', 0.12, { bg: meat ? '#dc2626' : '#ca8a04', color: '#fff', size: 34 }, 0.6);
      plaque.position.set(fx - 0.6, 2.2, fz + 0.47); g.add(plaque);
      // --- prep station (back right)
      const sx = 1, sz = -1;
      B(g, 0.92, 0.9, 0.8, 0xcbd5e1, sx, 0.45, sz, { metal: 0.5, rough: 0.35 });
      B(g, 0.96, 0.05, 0.84, 0xe5e7eb, sx, 0.92, sz, { metal: 0.6, rough: 0.2 });
      if (meat) {
        B(g, 0.6, 0.12, 0.45, 0xb7834f, sx - 0.05, 1.0, sz + 0.05);
        const cleaver = new THREE.Group(); cleaver.position.set(sx + 0.05, 1.09, sz + 0.1); g.add(cleaver);
        B(cleaver, 0.22, 0.01, 0.12, 0xe5e7eb, 0, 0, 0, { metal: 0.9, rough: 0.15 }); B(cleaver, 0.03, 0.03, 0.14, 0x1e293b, -0.15, 0.01, 0);
        C(g, 0.1, 0.12, 0.28, 0x94a3b8, sx + 0.28, 1.08, sz - 0.2, { metal: 0.7 }); C(g, 0.12, 0.05, 0.1, 0x94a3b8, sx + 0.28, 1.27, sz - 0.2, { metal: 0.7 });
        g.userData.tool = cleaver;
      } else {
        // cheese slicer machine with a round blade
        B(g, 0.5, 0.12, 0.4, 0xef4444, sx, 1.0, sz);
        B(g, 0.12, 0.3, 0.3, 0xef4444, sx - 0.18, 1.2, sz);
        const blade = new THREE.Group(); blade.position.set(sx - 0.05, 1.22, sz); g.add(blade);
        const bl = C(blade, 0.17, 0.17, 0.02, 0xe5e7eb, 0, 0, 0, { metal: 0.9, rough: 0.15, seg: 24 }); bl.rotation.z = Math.PI / 2;
        B(g, 0.3, 0.02, 0.25, 0x94a3b8, sx + 0.12, 1.08, sz, { metal: 0.7 });
        C(g, 0.09, 0.09, 0.2, 0xfacc15, sx + 0.12, 1.16, sz, { seg: 12 }).rotation.z = Math.PI / 2;
        g.userData.tool = blade;
      }
      // --- display counter (front row)
      const cz = 1;
      B(g, 3, 0.55, 0.85, meat ? 0x7f1d1d : 0x713f12, 0, 0.28, cz);
      B(g, 3, 0.06, 0.85, 0xf8fafc, 0, 0.58, cz);
      B(g, 2.92, 0.02, 0.6, meat ? 0xfecaca : 0xfef9c3, 0, 0.615, cz + 0.03, { emissive: 0xffffff, ei: 0.08 });
      const glass = B(g, 2.96, 0.5, 0.03, 0xe0f2fe, 0, 0.88, cz + 0.32, { opacity: 0.25, rough: 0.05, shadow: false }); glass.rotation.x = -0.35;
      B(g, 2.96, 0.03, 0.4, 0xe0f2fe, 0, 1.12, cz + 0.02, { opacity: 0.3, shadow: false });
      B(g, 3, 0.06, 0.06, accent, 0, 0.62, cz + 0.43);
      B(g, 3, 0.05, 0.28, 0xe2e8f0, 0, 1.1, cz - 0.3);
      B(g, 0.5, 0.1, 0.28, 0xf8fafc, 0.9, 1.15, cz - 0.3); // scale
      const led = B(g, 0.1, 0.05, 0.02, 0x22c55e, 1.35, 0.4, cz + 0.43, { emissive: 0x22c55e });
      g.userData.led = led;
      // staff aisle mat
      const mt = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x2f3236, ...surfaceMaps('rubber', 1, 1), roughness: 1 }));
      mt.rotation.x = -Math.PI / 2; mt.position.set(0, 0.006, 0); mt.receiveShadow = true; g.add(mt);
      break;
    }
    case 'computer': {
      const woodM = pbrShared('wood', 'desk', 1.2, { color: 0xc8b8a0 });
      B(g, 1.8, 0.05, 0.7, 0, 0, 0.76, 0, { material: woodM });
      for (const x of [-0.85, 0.85]) for (const z of [-0.3, 0.3]) B(g, 0.05, 0.75, 0.05, 0x2b2f33, x, 0.37, z, { metal: 0.6, rough: 0.4 });
      B(g, 1.7, 0.4, 0.04, 0, 0, 0.55, -0.32, { material: woodM });
      // monitor facing the front (+z)
      C(g, 0.1, 0.14, 0.03, 0x1e293b, -0.2, 0.8, -0.15); B(g, 0.05, 0.3, 0.05, 0x1e293b, -0.2, 0.95, -0.17);
      B(g, 0.85, 0.52, 0.05, 0x111827, -0.2, 1.3, -0.15);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.45), new THREE.MeshBasicMaterial({ map: textTexture('StoreOS', { size: 40, bg: '#1d2b26', color: '#e9efe9', pad: 30, radius: 2, font: 'Barlow', weight: 600 }).tex }));
      scr.position.set(-0.2, 1.3, -0.12); g.add(scr); g.userData.screen = scr;
      B(g, 0.5, 0.02, 0.16, 0x334155, -0.2, 0.79, 0.12);
      B(g, 0.07, 0.02, 0.1, 0x334155, 0.2, 0.79, 0.12);
      B(g, 0.3, 0.14, 0.26, 0xe5e7eb, 0.6, 0.85, -0.1); // printer
      B(g, 0.16, 0.06, 0.1, 0x1e293b, 0.65, 0.8, 0.18); // phone
      break;
    }
    case 'flowerpot': {
      C(g, 0.14, 0.1, 0.24, 0x7c3aed, 0, 0.12, 0);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; C(g, 0.008, 0.008, 0.28, 0x16a34a, Math.cos(a) * 0.05, 0.36, Math.sin(a) * 0.05); S(g, 0.045, [0xf43f5e, 0xfacc15, 0xf97316][i % 3], Math.cos(a) * 0.06, 0.52, Math.sin(a) * 0.06, { flat: true }); }
      break;
    }
    case 'cactus': {
      C(g, 0.18, 0.14, 0.26, 0xc2410c, 0, 0.13, 0);
      C(g, 0.11, 0.12, 0.7, 0x15803d, 0, 0.6, 0, { seg: 8, flat: true });
      const arm = C(g, 0.06, 0.06, 0.3, 0x16a34a, 0.15, 0.7, 0, { seg: 8 }); arm.rotation.z = -0.9;
      C(g, 0.06, 0.06, 0.25, 0x16a34a, 0.26, 0.88, 0, { seg: 8 });
      S(g, 0.04, 0xf472b6, 0, 0.98, 0);
      break;
    }
    case 'plant_tall': {
      C(g, 0.24, 0.2, 0.4, 0xe7e5e4, 0, 0.2, 0);
      C(g, 0.04, 0.06, 1.3, 0x7c4a1e, 0, 1.0, 0);
      for (let i = 0; i < 7; i++) S(g, 0.28 - (i % 3) * 0.04, i % 2 ? 0x15803d : 0x22c55e, Math.cos(i * 0.9) * 0.22, 1.5 + (i % 3) * 0.2, Math.sin(i * 0.9) * 0.22, { flat: true, w: 8, h: 6 });
      break;
    }
    case 'checkout': {
      // checkout lane: conveyor belt -> flatbed scanner -> bagging area, POS facing the cashier (-z)
      const body = mat(0xe5e7eb, { rough: 0.5 }), wood = mat(0x9a6b3f, { rough: 0.6 }), steel = mat(0xcbd5e1, { metal: 0.8, rough: 0.25 });
      B(g, W, 0.84, 0.66, 0, 0, 0.42, 0, { material: body });
      B(g, W - 0.04, 0.5, 0.01, 0, 0, 0.45, 0.335, { material: wood });
      B(g, W, 0.04, 0.72, 0, 0, 0.86, 0, { material: steel });
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.025, 0.42), beltMat()); belt.position.set(-0.42, 0.89, 0.06); belt.receiveShadow = true; g.add(belt);
      g.userData.belt = belt;
      for (const z of [-0.17, 0.29]) B(g, 1.08, 0.04, 0.03, 0, -0.42, 0.9, z, { material: steel });
      B(g, 0.32, 0.03, 0.03, 0x111827, -0.7, 0.92, 0.06, { material: mat(0x111827) }); // divider bar
      // flatbed scanner + tower
      B(g, 0.28, 0.02, 0.3, 0x111827, 0.27, 0.885, 0.06, { material: mat(0x0f172a, { rough: 0.05, metal: 0.3 }) });
      B(g, 0.2, 0.004, 0.02, 0xef4444, 0.27, 0.897, 0.06, { material: mat(0xef4444, { emissive: 0xef4444, ei: 2 }), shadow: false });
      B(g, 0.28, 0.2, 0.05, 0x1f2937, 0.27, 0.98, -0.11, { material: mat(0x1f2937) });
      B(g, 0.22, 0.12, 0.005, 0x0f172a, 0.27, 0.98, -0.083, { material: mat(0x0f172a, { rough: 0.05 }) });
      // bagging area with bags
      B(g, 0.52, 0.02, 0.62, 0, 0.72, 0.87, 0.0, { material: steel });
      for (const x of [0.6, 0.85]) { const bag = B(g, 0.2, 0.26, 0.14, 0xf8fafc, x, 1.01, 0.12, { material: mat(0xf8fafc, { opacity: 0.85, rough: 0.6 }) }); bag.castShadow = false; }
      // POS: monitor facing cashier, customer display, receipt printer, card terminal
      C(g, 0.02, 0.02, 0.25, 0, 0.62, 1.0, -0.22, { material: steel });
      const scr = B(g, 0.32, 0.22, 0.03, 0x0ea5e9, 0.62, 1.2, -0.24, { emissive: 0x0ea5e9, ei: 0.7 }); scr.rotation.y = Math.PI; scr.rotation.x = 0.2;
      g.userData.screen = scr;
      B(g, 0.34, 0.24, 0.02, 0x111827, 0.62, 1.2, -0.23, { material: mat(0x111827) }).rotation.x = -0.2;
      B(g, 0.16, 0.1, 0.03, 0x22c55e, 0.62, 1.32, -0.2, { emissive: 0x16a34a, ei: 0.5 });
      B(g, 0.14, 0.1, 0.16, 0x374151, 0.9, 0.93, -0.22, { material: mat(0x374151) });
      B(g, 0.08, 0.005, 0.05, 0xffffff, 0.9, 0.985, -0.16, { shadow: false });
      C(g, 0.015, 0.015, 0.12, 0, 0.9, 0.94, 0.2, { material: steel });
      B(g, 0.09, 0.14, 0.03, 0x111827, 0.9, 1.06, 0.2, { material: mat(0x111827) }).rotation.x = -0.4;
      B(g, 0.07, 0.05, 0.005, 0x38bdf8, 0.9, 1.08, 0.217, { emissive: 0x38bdf8, ei: 0.8, shadow: false }).rotation.x = -0.4;
      // cash drawer and lane light
      B(g, 0.4, 0.1, 0.05, 0x1f2937, 0.62, 0.78, -0.335, { material: mat(0x1f2937) });
      C(g, 0.025, 0.025, 1.3, 0, -W / 2 + 0.06, 1.5, -0.28, { material: steel });
      const lamp = B(g, 0.22, 0.22, 0.06, 0x22c55e, -W / 2 + 0.06, 2.2, -0.28, { emissive: 0x22c55e, ei: 0.25 });
      g.userData.lamp = lamp;
      // cashier stool
      C(g, 0.17, 0.17, 0.05, 0x1f2937, -0.4, 0.68, -0.85, { material: mat(0x1f2937) }); C(g, 0.025, 0.025, 0.66, 0, -0.4, 0.34, -0.85, { material: steel });
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
      for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-0.38, 0.38]) B(g, 0.06, 1.95, 0.06, 0x2a4a7a, x, 0.98, z, { metal: 0.4, rough: 0.5 });
      for (const y of [0.1, 0.65, 1.2, 1.75]) { B(g, W - 0.04, 0.05, 0.8, 0xa58a5c, 0, y, 0); B(g, W, 0.08, 0.05, 0xd0682a, 0, y, 0.4, { metal: 0.4, rough: 0.5 }); }
      break;
    }
    case 'bin': {
      C(g, 0.2, 0.17, 0.6, 0x16a34a, 0, 0.3, 0); C(g, 0.22, 0.22, 0.06, 0x14532d, 0, 0.62, 0);
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
      // cardboard promo display (POS stand) with product trays and a header card
      const card = 0xc9a97c;
      B(g, 0.7, 0.08, 0.5, card, 0, 0.04, 0); B(g, 0.66, 1.3, 0.04, card, 0, 0.69, -0.23);
      for (const x of [-0.33, 0.33]) B(g, 0.03, 1.3, 0.48, card, x, 0.69, 0);
      for (const y of [0.32, 0.72, 1.12]) { B(g, 0.64, 0.02, 0.46, card, 0, y, 0); for (let i = 0; i < 4; i++) B(g, 0.13, 0.18, 0.12, [0x1f5135, 0x8a1c1c, 0xe9e4d8][(i + Math.round(y * 10)) % 3], -0.22 + i * 0.15, y + 0.1, 0.06); }
      const hd = makeLabel('WEEKLY OFFER', 0.16, { bg: '#8a1c1c', color: '#ffffff', size: 34, font: 'Barlow Condensed', weight: 700, radius: 2 }, 0.62); hd.position.set(0, 1.5, -0.2); g.add(hd);
      break;
    }
    case 'vending': {
      B(g, 0.8, 1.9, 0.75, 0x1d2023, 0, 0.95, -0.05);
      B(g, 0.55, 1.3, 0.03, 0xe0f2fe, -0.08, 1.15, 0.33, { emissive: 0x93c5fd, ei: 0.4 });
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) C(g, 0.04, 0.04, 0.13, [0xc8272d, 0xb9bdc2, 0x1f5135, 0xe9a23b][c], -0.28 + c * 0.13, 0.65 + r * 0.3, 0.25, { seg: 8, metal: 0.6, rough: 0.3 });
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
      // café seating: round tables and chairs (deli/café corner)
      const metal = { metal: 0.7, rough: 0.35 };
      for (const [tx, tz] of [[-0.45, -0.45], [0.5, 0.45]]) {
        C(g, 0.38, 0.38, 0.03, 0xe9e4d8, tx, 0.74, tz, { seg: 24, rough: 0.4 }); C(g, 0.03, 0.03, 0.72, 0x2b2f33, tx, 0.37, tz, metal); C(g, 0.22, 0.22, 0.02, 0x2b2f33, tx, 0.01, tz, metal);
        for (const a of [0, Math.PI]) { const cx = tx + Math.cos(a) * 0.55, cz = tz + Math.sin(a) * 0.55; B(g, 0.4, 0.04, 0.4, 0x6b4a2a, cx, 0.46, cz); for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) C(g, 0.015, 0.015, 0.46, 0x2b2f33, cx + lx, 0.23, cz + lz, metal); B(g, 0.04, 0.4, 0.4, 0x6b4a2a, cx + Math.cos(a) * 0.2, 0.68, cz); }
      }
      break;
    }
    case 'neon': {
      // digital signage screen on a stand
      C(g, 0.18, 0.2, 0.03, 0x2b2f33, 0, 0.015, 0, { metal: 0.6 }); C(g, 0.03, 0.03, 1.3, 0x2b2f33, 0, 0.65, 0, { metal: 0.6 });
      B(g, 0.8, 0.48, 0.05, 0x111316, 0, 1.45, 0);
      const s = makeLabel('FRESH DEALS THIS WEEK', 0.14, { bg: '#1f5135', color: '#f4f6f2', size: 34, font: 'Barlow Condensed', weight: 700, radius: 0, pad: 30 }, 0.74); s.position.set(0, 1.45, 0.03); s.material.toneMapped = false; g.add(s);
      break;
    }
    case 'statue': {
      // coffee bar kiosk: counter with an espresso machine and cups
      B(g, 0.9, 0.95, 0.7, 0, 0, 0.475, 0, { material: mat(0x2b2f33, { rough: 0.5 }) });
      B(g, 0.92, 0.04, 0.72, 0xe9e4d8, 0, 0.97, 0, { rough: 0.3 });
      B(g, 0.4, 0.35, 0.3, 0xb9bdc2, -0.1, 1.17, -0.1, { metal: 0.85, rough: 0.25 });
      for (let i = 0; i < 4; i++) C(g, 0.035, 0.03, 0.09, 0xf2f2ef, 0.22 + (i % 2) * 0.09, 1.04, 0.12 + Math.floor(i / 2) * 0.1, { seg: 10 });
      const hd = makeLabel('COFFEE TO GO', 0.12, { bg: '#2b2f33', color: '#e9e4d8', size: 34, font: 'Barlow Condensed', weight: 700, radius: 0 }, 0.8); hd.position.set(0, 0.6, 0.36); g.add(hd);
      break;
    }
    default: B(g, W, 1, D, 0x94a3b8, 0, 0.5, 0);
  }
  const ud = g.userData;
  mergeStatic(g, new Set([ud.led, ud.belt, ud.screen, ud.lamp, ud.lid, ud.tool, ...(ud.doors || []), ...ud.anim.map(a => a.obj)]));
  return g;
}

let pegTex = null, beltTex = null, pegM = null, beltM = null;
function pegboardMat() {
  if (!pegTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#e7eaee'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#9aa3ad';
    for (let x = 8; x < 64; x += 16) for (let y = 8; y < 64; y += 16) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); }
    pegTex = new THREE.CanvasTexture(c); pegTex.wrapS = pegTex.wrapT = THREE.RepeatWrapping; pegTex.repeat.set(8, 7); pegTex.colorSpace = THREE.SRGBColorSpace;
  }
  return pegM ||= new THREE.MeshStandardMaterial({ map: pegTex, roughness: 0.55, metalness: 0.3 });
}
export function beltMat() {
  if (!beltTex) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#1f2328'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#2b3036';
    for (let x = 0; x < 64; x += 8) g.fillRect(x, 0, 3, 64);
    beltTex = new THREE.CanvasTexture(c); beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping; beltTex.repeat.set(6, 1);
  }
  return beltM ||= new THREE.MeshStandardMaterial({ map: beltTex, roughness: 0.85 });
}
export function beltTexture() { return beltTex; }

function staffMat(g, x) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ color: 0x2f3236, ...surfaceMaps('rubber', 1, 1), roughness: 1 }));
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
const SKINS = [0xf6d3b8, 0xeac09a, 0xd9a07a, 0xc68642, 0x9c6a45, 0x6b4428, 0x4a2e1a, 0xfbe0cc];
const HAIRS = [0x2b1d0e, 0x3b2414, 0x6b4423, 0x9a6a3a, 0xc9a26b, 0x111111, 0x7a1f12, 0xd8d8d8];
// everyday clothes in real-world colours (heather grey, navy, olive, burgundy, cream, black...)
const TOPS = [0xd9d9d6, 0x8a8d8f, 0x3c4048, 0x1f2a3a, 0x2f3b2f, 0x55603a, 0x5e2129, 0x7a5a3c, 0xe9e4d8, 0x1a1a1a, 0x41566e, 0xb5a58a, 0x6b2f2f, 0xf2f2ef];
const BOTTOMS = [0x2c3e5a, 0x3b4f70, 0x1f2b40, 0x5a6f8c, 0x1a1a1a, 0x3a3a3a, 0x8b7d63, 0x4a4238]; // first four are denim
const SHOES = [0x1a1a1a, 0xeeeeea, 0x4a3426, 0x5a5d61, 0x2b2b2b];

export function lookFromSeed(seed) {
  const r = rng(seed);
  const p = (arr) => arr[Math.floor(r() * arr.length)];
  const kid = r() < 0.08, elder = !kid && r() < 0.16, female = r() < 0.5;
  return {
    female, kid, skin: p(SKINS), hair: elder ? 0xd4d4d4 : p(HAIRS),
    hairStyle: female ? p([1, 1, 3, 4, 0]) : p([0, 0, 0, 2, 5]),
    shirt: p(TOPS), pants: p(BOTTOMS), shoes: p(SHOES), skirt: female && r() < 0.3, longSleeves: r() < 0.45,
    jacket: r() < 0.22 ? p([0x262a30, 0x4a3a2a, 0x2f3b2f, 0x1f2a3a, 0x5a4a3a]) : null,
    scale: kid ? 0.66 + r() * 0.08 : (female ? 0.9 : 0.95) + r() * 0.08, width: 1.12 + r() * 0.38, belly: r() * 0.9,
    glasses: r() < (elder ? 0.55 : 0.18), beard: !female && !kid && r() < 0.25, hat: r() < 0.06 ? p([0x262a30, 0x3a3226, 0x2f3b2f]) : null,
  };
}

const capsuleCache = new Map();
function capsule(r, len) { const k = r + ':' + len; if (!capsuleCache.has(k)) capsuleCache.set(k, new THREE.CapsuleGeometry(r, len, 4, 10)); return capsuleCache.get(k); }
let torsoGeo = null;
function torsoGeometry() {
  if (!torsoGeo) torsoGeo = new THREE.LatheGeometry([[0.001, 0], [0.15, 0.0], [0.168, 0.07], [0.175, 0.17], [0.178, 0.28], [0.18, 0.37], [0.172, 0.44], [0.12, 0.5], [0.055, 0.53], [0.001, 0.535]].map(([x, y]) => new THREE.Vector2(x, y)), 20).scale(1, 1, 0.72);
  return torsoGeo;
}
function part(parent, geo, material, x, y, z) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

// A realistically proportioned person (~1.75 m) with hips, knees, shoulders and elbows that animate.
// a geometry copy moved/rotated/scaled into place, for merging
function placed(geo, [x, y, z], [sx, sy, sz] = [1, 1, 1], rx = 0) {
  const o = new THREE.Object3D(); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.x = rx; o.updateMatrix();
  const g = geo.clone().applyMatrix4(o.matrix);
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
let faceCache = null;
function faceGeos() {
  if (faceCache) return faceCache;
  const pair = (fn) => [fn(-1), fn(1)];
  faceCache = {
    skin: mergeGeometries([
      placed(sphGeo(0.5, 18, 14), [0, 0, 0], [0.2, 0.235, 0.215]),
      placed(sphGeo(0.5, 12, 8), [0, -0.065, 0.03], [0.17, 0.13, 0.16]), // round cheeks & jaw
      ...pair(sd => placed(sphGeo(0.025, 8, 6), [sd * 0.095, 0, -0.005], [0.6, 1.1, 1])), // ears
      placed(new THREE.ConeGeometry(0.016, 0.045, 8), [0, -0.005, 0.105], [1, 1, 1], Math.PI / 2 - 0.25), // nose
    ]),
    whites: mergeGeometries(pair(sd => placed(sphGeo(0.016, 10, 8), [sd * 0.037, 0.02, 0.09], [0.85, 0.62, 0.6]))),
    pupils: mergeGeometries(pair(sd => placed(sphGeo(0.0075, 8, 6), [sd * 0.037, 0.02, 0.1]))),
    brows: mergeGeometries(pair(sd => placed(new THREE.BoxGeometry(0.032, 0.006, 0.008), [sd * 0.038, 0.042, 0.096]))),
  };
  return faceCache;
}
export function makeCharacter(look) {
  const g = new THREE.Group();
  const root = new THREE.Group(); g.add(root);
  root.scale.setScalar(look.scale || 1);
  const W = Math.round((look.width || 1) * 20) / 20;
  const denim = BOTTOMS.indexOf(look.pants) >= 0 && BOTTOMS.indexOf(look.pants) < 4;
  const skin = mat(look.skin, { rough: 0.55 }), shirt = cloth(look.shirt), pants = cloth(look.pants, denim ? 'denim' : 'fabric'), shoe = mat(look.shoes ?? 0x111827, { rough: 0.45 });
  const sleeve = look.jacket ? cloth(look.jacket, 'fabric', 0.8) : shirt;
  const P = {};
  const hips = new THREE.Group(); hips.position.y = 0.78; root.add(hips); P.hips = hips;
  for (const side of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(side * 0.095 * W, 0, 0); hips.add(hip);
    part(hip, capsule(0.075 * Math.min(1.3, W), 0.22), look.skirt ? skin : pants, 0, -0.17, 0);
    const knee = new THREE.Group(); knee.position.y = -0.37; hip.add(knee);
    part(knee, capsule(0.06 * Math.min(1.25, W), 0.2), look.skirt ? skin : pants, 0, -0.16, 0);
    part(knee, boxGeo(0.11, 0.075, 0.25), shoe, 0, -0.37, 0.045);
    P[side < 0 ? 'legL' : 'legR'] = hip; P[side < 0 ? 'kneeL' : 'kneeR'] = knee;
  }
  const torso = new THREE.Group(); hips.add(torso); P.torso = torso;
  part(torso, sphGeo(0.5, 14, 8), pants, 0, 0.02, 0).scale.set(0.34 * W, 0.22, 0.25);
  if (look.skirt) { const sk = part(torso, cachedGeo('skirt' + W, () => new THREE.CylinderGeometry(0.15 * W, 0.24 * W, 0.42, 16, 1, true)), pants, 0, -0.17, 0); sk.material = mat(look.pants, { rough: 0.9, side: THREE.DoubleSide }); }
  const body = part(torso, torsoGeometry(), look.jacket ? sleeve : shirt, 0, 0.0, 0); body.scale.set(W, 1, 0.9 + (W - 1) * 0.6);
  const belly = part(torso, sphGeo(0.5, 16, 12), look.jacket ? sleeve : shirt, 0, 0.2, 0.05); belly.scale.set(0.3 * W, 0.34, 0.2 + (look.belly || 0) * 0.12 + (W - 1) * 0.15);
  if (look.jacket) { B(torso, 0.06, 0.4, 0.01, look.shirt, 0, 0.27, 0.15 + (look.belly || 0) * 0.05, { shadow: false }); }
  if (look.apron) { const ap = B(torso, 0.32 * W, 0.6, 0.02, look.apron, 0, 0.12, 0.17 + (look.belly || 0) * 0.06, { shadow: false }); void ap; }
  if (look.badge) B(torso, 0.06, 0.03, 0.006, look.badge, 0.08, 0.4, 0.15, { rough: 0.4, shadow: false });
  part(torso, cylGeo(0.05, 0.058, 0.08, 10), skin, 0, 0.56, 0);
  // arms
  for (const side of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(side * 0.215 * W, 0.46, 0); torso.add(sh);
    part(sh, sphGeo(0.07, 10, 8), sleeve, 0, 0, 0);
    part(sh, capsule(0.058, 0.17), sleeve, 0, -0.12, 0);
    const el = new THREE.Group(); el.position.y = -0.25; sh.add(el);
    part(el, capsule(0.049, 0.15), look.longSleeves || look.jacket ? sleeve : skin, 0, -0.1, 0);
    part(el, sphGeo(0.05, 10, 8), skin, 0, -0.23, 0.005).scale.set(0.85, 1.2, 0.6);
    P[side < 0 ? 'armL' : 'armR'] = sh; P[side < 0 ? 'elbowL' : 'elbowR'] = el;
  }
  // head
  const head = new THREE.Group(); head.position.y = 0.72; torso.add(head); P.head = head;
  // the face is the same shape for everyone: a few merged, shared meshes (skin, eye whites, pupils, brows)
  const F = faceGeos();
  part(head, F.skin, skin, 0, 0, 0);
  part(head, F.whites, mat(0xffffff, { rough: 0.2 }), 0, 0, 0).castShadow = false;
  part(head, F.pupils, mat(0x3b2a1a, { rough: 0.1 }), 0, 0, 0).castShadow = false;
  part(head, F.brows, mat(look.hair, {}), 0, 0, 0).castShadow = false;
  const mouth = B(head, 0.04, 0.008, 0.008, look.female ? 0xbe123c : 0x9f4f4f, 0, -0.05, 0.096, { shadow: false }); P.mouth = mouth;
  if (look.glasses) { for (const sd of [-1, 1]) { const rim = new THREE.Mesh(cachedGeo('rim', () => new THREE.TorusGeometry(0.02, 0.003, 6, 14)), mat(0x111111)); rim.position.set(sd * 0.038, 0.02, 0.105); head.add(rim); } B(head, 0.03, 0.003, 0.003, 0x111111, 0, 0.022, 0.106, { shadow: false }); }
  if (look.beard) { const bd = part(head, sphGeo(0.5, 12, 8, 0), mat(look.hair, { rough: 0.95 }), 0, -0.075, 0.045); bd.scale.set(0.15, 0.1, 0.13); }
  const hm = mat(look.hair, { rough: 0.9 });
  if (look.hairStyle !== 2) {
    const hk = look.hairStyle === 5 ? 0.38 : 0.55;
    const hair = new THREE.Mesh(cachedGeo('hair' + hk, () => new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI * hk)), hm);
    hair.scale.set(0.205, 0.25, 0.225); hair.rotation.x = -0.35; hair.position.set(0, 0.025, -0.01); hair.castShadow = true; head.add(hair);
    if (look.hairStyle === 1) part(head, boxGeo(0.2, 0.26, 0.08), hm, 0, -0.1, -0.08);
    if (look.hairStyle === 3) part(head, sphGeo(0.05, 10, 8), hm, 0, 0.11, -0.09);
    if (look.hairStyle === 4) { part(head, sphGeo(0.035, 8, 6), hm, 0, 0.02, -0.12); part(head, capsule(0.03, 0.14), hm, 0, -0.08, -0.13); }
  }
  if (look.hat) { C(head, 0.112, 0.112, 0.07, look.hat, 0, 0.1, 0, { seg: 18 }); B(head, 0.12, 0.012, 0.09, look.hat, 0, 0.07, 0.12); }
  if (look.cap) { const c = C(head, 0.112, 0.112, 0.075, look.cap, 0, 0.1, -0.005, { seg: 18 }); void c; B(head, 0.13, 0.012, 0.11, look.cap, 0, 0.07, 0.13); }
  if (look.chef) { C(head, 0.1, 0.115, 0.14, 0xffffff, 0, 0.17, 0, { seg: 16 }); S(head, 0.12, 0xffffff, 0, 0.26, 0, { w: 12, h: 8 }); }
  if (look.hairnet) { const n = new THREE.Mesh(cachedGeo('hairnet', () => new THREE.SphereGeometry(0.5, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), mat(0xffffff, { opacity: 0.55 })); n.scale.set(0.215, 0.26, 0.235); n.position.y = 0.02; head.add(n); }
  const hold = new THREE.Group(); hold.position.set(0, 0.98, 0.42); root.add(hold); P.hold = hold;
  const sideHold = new THREE.Group(); sideHold.position.set(0.3 * W, 0.4, 0.04); root.add(sideHold); P.side = sideHold;
  g.userData.parts = P;
  g.userData.phase = Math.random() * 6;
  return g;
}

// pose: 'walk' | 'carry' | 'work' | 'cart' | 'basket' | 'wave' | 'clean'
export function animateCharacter(ch, dt, moving, pose, speed = 1) {
  const P = ch.userData.parts; if (!P) return;
  ch.userData.phase += dt * (moving ? 7.5 * speed : 1.6);
  const ph = ch.userData.phase;
  const sw = moving ? Math.sin(ph) * 0.5 : 0;
  P.legL.rotation.x = sw; P.legR.rotation.x = -sw;
  P.kneeL.rotation.x = moving ? 0.08 + 0.75 * Math.max(0, Math.sin(ph + 1.9)) : 0.03;
  P.kneeR.rotation.x = moving ? 0.08 + 0.75 * Math.max(0, Math.sin(ph + 1.9 + Math.PI)) : 0.03;
  P.hips.position.y = 0.78 - (moving ? Math.abs(Math.sin(ph)) * 0.025 : 0) + (moving ? 0 : Math.sin(ph) * 0.003);
  P.torso.rotation.y = moving ? Math.sin(ph) * 0.06 : 0;
  P.torso.rotation.x = pose === 'cart' ? 0.12 : moving ? 0.04 : 0;
  const arms = (lx, rx, le, re, lz = 0.06, rz = -0.06) => { P.armL.rotation.x = lx; P.armR.rotation.x = rx; P.elbowL.rotation.x = le; P.elbowR.rotation.x = re; P.armL.rotation.z = lz; P.armR.rotation.z = rz; };
  if (pose === 'carry') arms(-1.0, -1.0, -0.55, -0.55, 0.22, -0.22);
  else if (pose === 'cart') arms(-0.85, -0.85, -0.45, -0.45, 0.1, -0.1);
  else if (pose === 'work') { const w = Math.sin(ph * 5) * 0.18; arms(-0.7 + w, -0.7 - w, -0.9, -0.9, 0.15, -0.15); }
  else if (pose === 'basket') arms(-sw * 0.7, -0.08, -0.2, -0.12, 0.06, -0.12);
  else if (pose === 'wave') { arms(-sw * 0.7, -2.7, -0.2, -0.5 + Math.sin(ph * 6) * 0.4, 0.06, -0.2); }
  else if (pose === 'point') arms(0, -1.5, -0.1, -0.05, 0.06, -0.05);
  else if (pose === 'thumbs') arms(0, -1.1, -0.1, -1.4, 0.06, -0.3);
  else if (pose === 'shrug') arms(-0.25, -0.25, -1.3, -1.3, 0.5, -0.5);
  else if (pose === 'clap') { const c = Math.abs(Math.sin(ph * 8)) * 0.25; arms(-1.1, -1.1, -0.9, -0.9, 0.55 - c, -0.55 + c); }
  else if (pose === 'nod') arms(-sw * 0.7, sw * 0.7, -0.2, -0.2, 0.06, -0.06);
  else if (pose === 'clean') { const w = Math.sin(ph * 6) * 0.35; arms(-0.6 + w, -0.6 + w, -0.5, -0.5, 0.1, -0.1); }
  else arms(-sw * 0.75, sw * 0.75, -0.18 - (moving ? 0.18 : 0), -0.18 - (moving ? 0.18 : 0));
  P.head.rotation.y = moving ? 0 : Math.sin(ph * 0.35) * 0.3;
  P.head.rotation.x = pose === 'work' || pose === 'clean' ? 0.25 : pose === 'nod' ? Math.abs(Math.sin(ph * 4)) * 0.35 : pose === 'shrug' ? -0.1 : 0;
  P.head.rotation.y = 0;
}

// ------------------------------------------------------------------ props
export function productTexture(p) { return packagingTexture(p); }
export function productMaterial(p) { return productMaterials(p); }
export function makeFBox(type) {
  const def = FURNITURE[type];
  const g = new THREE.Group();
  B(g, 0.95, 0.5, 0.75, 0xb98b55, 0, 0.25, 0);
  B(g, 0.1, 0.005, 0.76, 0xe7d3a8, 0, 0.502, 0, { shadow: false });
  const lbl = makeLabel(def.icon + ' ' + def.name, 0.12, { bg: '#ffffff', color: '#1e293b', size: 34 }, 0.85);
  lbl.position.set(0, 0.3, 0.38); g.add(lbl);
  const l2 = lbl.clone(); l2.rotation.y = Math.PI; l2.position.z = -0.38; g.add(l2);
  return g;
}

const boxLabelMats = new Map();
export function makeBox(pid, color) {
  const g = new THREE.Group();
  B(g, 0.5, 0.36, 0.42, 0xc8a26b, 0, 0.18, 0);
  B(g, 0.08, 0.005, 0.43, 0xe7d3a8, 0, 0.362, 0, { shadow: false });
  const p = PRODUCT_MAP[pid];
  const lm = p ? (boxLabelMats.get(pid) || boxLabelMats.set(pid, new THREE.MeshStandardMaterial({ map: productTexture(p), roughness: 0.6 })).get(pid)) : mat(color);
  for (const [z, ry] of [[0.212, 0], [-0.212, Math.PI]]) { const l = new THREE.Mesh(cachedGeo('boxlabel', () => new THREE.PlaneGeometry(0.26, 0.26)), lm); l.position.set(0, 0.19, z); l.rotation.y = ry; g.add(l); }
  return g;
}
let latticeTex = null;
function latticeMap() {
  if (!latticeTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff';
    for (let i = 0; i <= 64; i += 8) { g.fillRect(i - 1, 0, 2, 64); g.fillRect(0, i - 1, 64, 2); }
    latticeTex = new THREE.CanvasTexture(c); latticeTex.wrapS = latticeTex.wrapT = THREE.RepeatWrapping;
  }
  return latticeTex;
}
const latticeMats = new Map();
export function makeBasket(color = 0xdc2626) {
  // plastic shopping basket with slotted sides and two handles
  const g = new THREE.Group();
  const m = latticeMats.get(color) || latticeMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5, alphaMap: latticeMap(), alphaTest: 0.5, side: THREE.DoubleSide })).get(color);
  const W = 0.4, H = 0.2, D = 0.28;
  B(g, W * 0.9, 0.01, D * 0.9, color, 0, 0.005, 0, { material: mat(color, { rough: 0.5 }) });
  for (const [w, d, x, z] of [[W, 0.005, 0, D / 2], [W, 0.005, 0, -D / 2], [0.005, D, W / 2, 0], [0.005, D, -W / 2, 0]]) { const p = new THREE.Mesh(boxGeo(w, H, d), m); p.position.set(x, H / 2, z); g.add(p); }
  B(g, W + 0.01, 0.02, D + 0.01, color, 0, H, 0, { material: mat(color, { rough: 0.5 }), shadow: false });
  for (const sd of [-1, 1]) { const h = new THREE.Mesh(cachedGeo('handle', () => new THREE.TorusGeometry(0.13, 0.008, 6, 14, Math.PI)), mat(0x111827)); h.position.set(0, H, sd * 0.05); g.add(h); }
  return g;
}
export function makeCart() {
  // wire shopping trolley: mesh basket, tubular frame, red handle, casters, child seat
  const g = new THREE.Group();
  const wire = latticeMats.get('wire') || latticeMats.set('wire', new THREE.MeshStandardMaterial({ color: 0xc0c7d0, metalness: 0.85, roughness: 0.3, alphaMap: latticeMap(), alphaTest: 0.5, side: THREE.DoubleSide })).get('wire');
  const tube = mat(0xb6bec8, { metal: 0.9, rough: 0.25 });
  const W = 0.52, L = 0.8, H = 0.42, y0 = 0.5;
  for (const [w, h, d, x, y, z] of [[W, H, 0.005, 0, y0 + H / 2, L / 2], [W * 0.85, H, 0.005, 0, y0 + H / 2, -L / 2], [0.005, H, L, W / 2, y0 + H / 2, 0], [0.005, H, L, -W / 2, y0 + H / 2, 0], [W, 0.005, L, 0, y0, 0]]) { const p = new THREE.Mesh(boxGeo(w, h, d), wire); p.position.set(x, y, z); g.add(p); }
  for (const x of [-W / 2, W / 2]) { const r = C(g, 0.01, 0.01, L, 0, x, y0 + H, 0, { material: tube }); r.rotation.x = Math.PI / 2; const b = C(g, 0.012, 0.012, L, 0, x * 0.8, 0.12, -0.02, { material: tube }); b.rotation.x = Math.PI / 2; C(g, 0.012, 0.012, y0, 0, x, y0 / 2 + 0.06, -L / 2, { material: tube }); }
  const handle = C(g, 0.018, 0.018, W + 0.04, 0xdc2626, 0, y0 + H + 0.12, -L / 2 - 0.08, { material: mat(0xdc2626, { rough: 0.4 }) }); handle.rotation.z = Math.PI / 2;
  for (const x of [-W / 2, W / 2]) { const a = C(g, 0.01, 0.01, 0.2, 0, x, y0 + H + 0.05, -L / 2 - 0.04, { material: tube }); a.rotation.x = -0.6; }
  for (const [x, z] of [[-0.22, -0.32], [0.22, -0.32], [-0.18, 0.32], [0.18, 0.32]]) { const w = C(g, 0.045, 0.045, 0.03, 0x1f2937, x, 0.045, z, { material: mat(0x1f2937) }); w.rotation.z = Math.PI / 2; }
  B(g, W * 0.8, 0.02, 0.2, 0xdc2626, 0, y0 + H - 0.05, -L / 2 + 0.12, { material: mat(0xdc2626, { rough: 0.45 }) });
  g.userData.itemsAt = new THREE.Vector3(0, y0 + 0.02, 0.05);
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
  C(g, 0.12, 0.16, 1.2, 0x4b3a2c, 0, 0.6, 0, { rough: 0.95 });
  const cols = [0x3c5a2c, 0x46663a, 0x557445]; // natural foliage greens
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
