// The look of a modern neighbourhood supermarket (dark, warm spotlights, illustrated wall graphics): wall murals,
// hanging department signs, the storefront sign, window decals, a black ceiling with track spotlights and a stack
// of shopping baskets. All text is English. Everything is drawn in code on canvases.
// (Heebo stays in the font stacks so a store name typed in Hebrew still shows properly.)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeBasket } from './models.js';

const INK = '#262422', PAPER = '#ebe5d9';
const HE = '"Heebo", "Barlow", Arial, sans-serif';
const canvasTex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };

// ------------------------------------------------------------------ line drawings (ink on paper, like the photos)
function ink(g, w = 5) { g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; }
const DRAW = {
  salad(g, x, y, s) { // a bowl of salad with leaves
    ink(g); g.beginPath(); g.ellipse(x, y, 120 * s, 26 * s, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x - 120 * s, y); g.quadraticCurveTo(x - 110 * s, y + 110 * s, x, y + 112 * s); g.quadraticCurveTo(x + 110 * s, y + 110 * s, x + 120 * s, y); g.stroke();
    for (let i = 0; i < 7; i++) { const lx = x - 90 * s + i * 30 * s, ly = y - 8 * s - (i % 2) * 22 * s; g.beginPath(); g.ellipse(lx, ly, 22 * s, 11 * s, -0.6 + i * 0.25, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.moveTo(lx - 16 * s, ly + 6 * s); g.lineTo(lx + 16 * s, ly - 6 * s); g.stroke(); }
    g.beginPath(); g.arc(x + 40 * s, y - 30 * s, 14 * s, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x - 50 * s, y - 34 * s, 12 * s, 0, Math.PI * 2); g.stroke();
  },
  bread(g, x, y, s) { // a round loaf and a baguette
    ink(g); g.beginPath(); g.ellipse(x - 30 * s, y + 20 * s, 95 * s, 60 * s, 0, Math.PI, 0); g.lineTo(x + 65 * s, y + 40 * s); g.lineTo(x - 125 * s, y + 40 * s); g.closePath(); g.stroke();
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x - 80 * s + i * 32 * s, y - 20 * s); g.quadraticCurveTo(x - 66 * s + i * 32 * s, y - 2 * s, x - 70 * s + i * 32 * s, y + 18 * s); g.stroke(); }
    g.save(); g.translate(x + 70 * s, y - 20 * s); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, 120 * s, 22 * s, 0, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(-80 * s + i * 38 * s, -10 * s); g.lineTo(-60 * s + i * 38 * s, 10 * s); g.stroke(); } g.restore();
  },
  fresh(g, x, y, s) { // an apple, a pear and a carrot
    ink(g); g.beginPath(); g.arc(x - 60 * s, y + 20 * s, 55 * s, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x - 60 * s, y - 35 * s); g.quadraticCurveTo(x - 55 * s, y - 60 * s, x - 45 * s, y - 70 * s); g.stroke();
    g.beginPath(); g.ellipse(x - 30 * s, y - 62 * s, 22 * s, 10 * s, -0.4, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x + 30 * s, y - 50 * s); g.lineTo(x + 130 * s, y + 70 * s); g.lineTo(x + 60 * s, y - 70 * s); g.closePath(); g.stroke();
    for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + 50 * s + i * 12 * s, y - 30 * s + i * 24 * s); g.lineTo(x + 70 * s + i * 12 * s, y - 40 * s + i * 24 * s); g.stroke(); }
    for (const a of [-0.5, 0, 0.5]) { g.beginPath(); g.moveTo(x + 45 * s, y - 60 * s); g.lineTo(x + 45 * s + Math.sin(a) * 45 * s, y - 60 * s - Math.cos(a) * 45 * s); g.stroke(); }
  },
  deli(g, x, y, s) { // a salami, slices and a sausage chain
    ink(g); g.save(); g.translate(x - 30 * s, y); g.rotate(-0.25); g.beginPath(); g.ellipse(0, 0, 105 * s, 34 * s, 0, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(-70 * s + i * 18 * s, (i % 3 - 1) * 10 * s, 3 * s, 0, Math.PI * 2); g.fill(); } g.restore();
    for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(x + 90 * s + i * 22 * s, y + 55 * s - i * 6 * s, 30 * s, 30 * s, 0, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); for (let i = 0; i < 3; i++) g.ellipse(x - 100 * s + i * 62 * s, y + 75 * s, 30 * s, 14 * s, 0.1, 0, Math.PI * 2); g.stroke();
  },
  dairy(g, x, y, s) { // a milk bottle and a wedge of cheese
    ink(g); g.beginPath(); g.moveTo(x - 90 * s, y - 80 * s); g.lineTo(x - 50 * s, y - 80 * s); g.lineTo(x - 50 * s, y - 50 * s); g.quadraticCurveTo(x - 15 * s, y - 30 * s, x - 15 * s, y); g.lineTo(x - 15 * s, y + 90 * s); g.lineTo(x - 125 * s, y + 90 * s); g.lineTo(x - 125 * s, y); g.quadraticCurveTo(x - 125 * s, y - 30 * s, x - 90 * s, y - 50 * s); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x - 125 * s, y + 20 * s); g.lineTo(x - 15 * s, y + 20 * s); g.stroke();
    g.beginPath(); g.moveTo(x + 10 * s, y + 90 * s); g.lineTo(x + 140 * s, y + 90 * s); g.lineTo(x + 140 * s, y + 20 * s); g.lineTo(x + 10 * s, y + 50 * s); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(x + 10 * s, y + 50 * s); g.lineTo(x + 10 * s, y + 90 * s); g.stroke();
    for (const [cx, cy, r] of [[60, 65, 9], [105, 55, 7], [120, 75, 6]]) { g.beginPath(); g.arc(x + cx * s, y + cy * s, r * s, 0, Math.PI * 2); g.stroke(); }
  },
  market(g, x, y, s) { // a shopping cart full of groceries
    ink(g); g.beginPath(); g.moveTo(x - 140 * s, y - 60 * s); g.lineTo(x - 110 * s, y - 60 * s); g.lineTo(x - 80 * s, y + 50 * s); g.lineTo(x + 100 * s, y + 50 * s); g.lineTo(x + 125 * s, y - 30 * s); g.lineTo(x - 98 * s, y - 30 * s); g.stroke();
    for (const cx of [-60, 80]) { g.beginPath(); g.arc(x + cx * s, y + 75 * s, 14 * s, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.rect(x - 60 * s, y - 80 * s, 50 * s, 50 * s); g.stroke(); g.beginPath(); g.arc(x + 30 * s, y - 55 * s, 26 * s, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(x + 75 * s, y - 30 * s); g.lineTo(x + 85 * s, y - 100 * s); g.lineTo(x + 100 * s, y - 30 * s); g.stroke();
  },
};
// what goes on the walls: the big word, a second line, a drawing and a small handwritten line
export const MURALS = [
  { en: 'SALAD', he: 'BAR', draw: 'salad', sub: 'hummus · tahini · matbucha' },
  { en: 'BAKERY', he: 'BAKED DAILY', draw: 'bread', sub: 'fresh every morning' },
  { en: 'FRESH', he: 'FRUIT & VEG', draw: 'fresh', sub: 'from the farm' },
  { en: 'DELI', he: 'COLD CUTS', draw: 'deli', sub: 'roast beef · salami' },
  { en: 'DAIRY', he: 'MILK & CHEESE', draw: 'dairy', sub: 'milk · cheese · yogurt' },
  { en: 'MARKET', he: 'NEIGHBOURHOOD', draw: 'market', sub: 'your local store' },
];
const muralCache = new Map();
export function muralTexture(i) {
  const m = MURALS[i % MURALS.length];
  if (muralCache.has(m.en)) return muralCache.get(m.en);
  const W = 1280, H = 448, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
  // paper grain and a thin inner frame
  for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(80,60,40,${Math.random() * 0.05})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  g.strokeStyle = INK; g.lineWidth = 6; g.strokeRect(26, 26, W - 52, H - 52); g.lineWidth = 2; g.strokeRect(40, 40, W - 80, H - 80);
  const flip = i % 2;
  DRAW[m.draw](g, flip ? 960 : 300, 210, 1.1);
  g.fillStyle = INK; g.textBaseline = 'alphabetic';
  const tx = flip ? 140 : 560;
  g.textAlign = 'left';
  g.font = '900 120px "Playfair Display", Georgia, serif'; g.fillText(m.en, tx, 230);
  g.font = '600 52px "Barlow Condensed", Arial, sans-serif'; g.fillText(m.he.split('').join(String.fromCharCode(8202)), tx + 6, 305);
  g.font = '400 40px Pacifico, cursive'; g.fillText(m.sub, tx + 4, 390);
  const t = canvasTex(c); muralCache.set(m.en, t); return t;
}

// ------------------------------------------------------------------ hanging department sign (black board, orange band)
const DEPT = { grocery: 'GROCERY', household: 'HOUSEHOLD', fridge: 'DAIRY', frozen: 'FROZEN', produce: 'FRUIT & VEG', meat: 'BUTCHER', deli: 'DELI' };
export const departmentName = (cat) => DEPT[cat] || 'GROCERY';
export function hangingSignTexture(num, english, dept) {
  const W = 768, H = 384, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#17181a'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3a3c40'; g.lineWidth = 8; g.strokeRect(4, 4, W - 8, H - 8);
  // aisle number and the products on the shelf, chalk-white on black
  g.fillStyle = '#f2efe8'; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.font = '700 120px "Barlow Condensed", Arial, sans-serif'; g.fillText(String(num), 40, 120);
  const words = english.split('  ·  ').slice(0, 3), fs = words.length > 2 ? 62 : 74;
  g.font = `600 ${fs}px "Barlow Condensed", Arial, sans-serif`;
  words.forEach((w, i) => g.fillText(w, 175, 120 + (i - (words.length - 1) / 2) * (fs + 6), W - 200));
  // the orange department band
  g.fillStyle = '#e8892b'; g.fillRect(0, 240, W, H - 240);
  g.fillStyle = '#ffffff'; g.font = '700 96px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.fillText(dept, W / 2, 314, W - 60);
  return canvasTex(c);
}

// ------------------------------------------------------------------ storefront: store name, tagline, cart logo
export function storeSignTexture(name) {
  const W = 2048, H = 400, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2f3237'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
  // cart logo in a rounded square
  g.fillStyle = '#e0457b'; g.beginPath(); g.roundRect ? g.roundRect(70, 80, 240, 240, 36) : g.rect(70, 80, 240, 240); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(105, 140); g.lineTo(135, 140); g.lineTo(165, 250); g.lineTo(265, 250); g.lineTo(285, 170); g.lineTo(150, 170); g.stroke();
  for (const x of [180, 250]) { g.beginPath(); g.arc(x, 285, 13, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); }
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'left';
  let size = 170; g.font = `800 ${size}px "Barlow Condensed", ${HE}`;
  while (g.measureText(name).width > W - 470 && size > 70) { size -= 8; g.font = `800 ${size}px "Barlow Condensed", ${HE}`; }
  g.fillText(name, 380, 165);
  g.fillStyle = '#ff6fa3'; g.font = '600 64px "Barlow Condensed", Arial, sans-serif'; g.fillText('NEIGHBOURHOOD MARKET  ·  FRESH EVERY DAY', 384, 305);
  return { tex: canvasTex(c), aspect: W / H };
}
// big words on the shop windows (white on black), like FRESH · FRUITS · BAKERY
export function decalTexture(en, sub) {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#121315'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f5f1ea'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 190px "Barlow Condensed", Arial, sans-serif'; g.fillText(en, W / 2, 200);
  g.fillStyle = '#ff6fa3'; g.font = '600 84px "Barlow Condensed", Arial, sans-serif'; g.fillText(sub, W / 2, 380);
  return canvasTex(c);
}
// a promotion board on a stand by the entrance (yellow / blue / orange price tiles like the photo)
export function promoTexture() {
  const W = 512, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#17181a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 84px "Barlow Condensed", Arial, sans-serif'; g.fillText('MIX & MATCH', W / 2, 110);
  g.font = '500 40px "Barlow Condensed", Arial, sans-serif'; g.fillText('combine any products', W / 2, 180);
  [['#e0453b', '2 for $5'], ['#f2c230', '3 for $7'], ['#3d8fe0', '5 for $10']].forEach(([col, t], i) => {
    const y = 270 + i * 210; g.fillStyle = col; g.fillRect(60, y, W - 120, 170);
    g.fillStyle = i === 1 ? '#17181a' : '#ffffff'; g.font = '700 96px "Barlow Condensed", Arial, sans-serif'; g.fillText(t, W / 2, y + 88);
  });
  return canvasTex(c);
}

// ------------------------------------------------------------------ black open ceiling with track spotlights
// All the spotlights of a ceiling are merged into three meshes (bodies, lenses, rails): dozens of lights, 4 draw calls.
let trackMats = null;
function placedGeo(geo, pos, rot) {
  const o = new THREE.Object3D(); o.position.set(...pos); if (rot) o.rotation.set(...rot); o.updateMatrix();
  const g = geo.clone().applyMatrix4(o.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g.index ? g.toNonIndexed() : g;
}
export function buildTrackLights(group, W, D, y) {
  trackMats ||= { rail: new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.5, metalness: 0.5 }),
    body: new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.35, metalness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffe6bf, emissiveIntensity: 3.2 }),
    led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e2, emissiveIntensity: 2.2 }) };
  const bodyG = new THREE.CylinderGeometry(0.05, 0.042, 0.16, 10), lensG = new THREE.CircleGeometry(0.036, 10), stemG = new THREE.CylinderGeometry(0.008, 0.008, 0.08, 5);
  const rails = [], bodies = [], lenses = [];
  for (let z = 1.6; z < D - 0.3; z += 2.6) {
    rails.push(placedGeo(new THREE.BoxGeometry(W - 1.2, 0.035, 0.045), [W / 2, y - 0.3, z]));
    for (const x of [1, W - 1]) rails.push(placedGeo(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), [x, y - 0.15, z]));
    let k = 0;
    for (let x = 1.2; x < W - 0.9; x += 1.5, k++) {
      const rx = (k % 2 ? 1 : -1) * 0.45, rz = ((k >> 1) % 2 ? 1 : -1) * 0.15;
      const head = new THREE.Object3D(); head.position.set(x, y - 0.42, z); head.rotation.set(rx, 0, rz); head.updateMatrix();
      bodies.push(placedGeo(stemG, [x, y - 0.36, z]));
      bodies.push(bodyG.clone().toNonIndexed().applyMatrix4(head.matrix));
      const lens = lensG.clone().rotateX(Math.PI / 2).translate(0, -0.081, 0).applyMatrix4(head.matrix); lenses.push(lens.index ? lens.toNonIndexed() : lens);
    }
  }
  const add = (list, m) => { if (!list.length) return; const mesh = new THREE.Mesh(mergeGeometries(list), m); mesh.userData.owned = mesh.userData.ownGeo = true; group.add(mesh); };
  add(rails, trackMats.rail); add(bodies, trackMats.body); add(lenses, trackMats.lens);
  // a long linear LED along the middle, like the strip lights in the aisle photo
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 0.03, 0.08), trackMats.led); strip.position.set(W / 2, y - 0.05, D / 2 + 0.3); strip.userData.owned = strip.userData.ownGeo = true; group.add(strip);
}

// a stack of green shopping baskets by the entrance
export function basketStack(n = 8) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) { const b = makeBasket(0x2f9e57); b.position.y = i * 0.045; b.rotation.y = (i % 2 ? 0.04 : -0.03); g.add(b); }
  return g;
}
