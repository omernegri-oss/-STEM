// Realistic product packaging: real-world sized geometries with printed labels, metal lids, caps and trays.
// Every geometry has material groups; productMaterials(p) returns the matching material array.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAPE_DIMS } from '/shared/data.js';


function based(g) { g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0); return g; }
function oneGroup(g, idx = 0) { g.clearGroups(); g.addGroup(0, g.index ? g.index.count : g.attributes.position.count, idx); return g; }
// merge parts, each part gets the given material index
function parts(list) {
  const geos = list.map(([g, i]) => { const c = (g.index ? g.toNonIndexed() : g.clone()); for (const k of Object.keys(c.attributes)) if (!['position', 'normal', 'uv'].includes(k)) c.deleteAttribute(k); oneGroup(c, i); return c; });
  const m = mergeGeometries(geos, true);
  // mergeGeometries(useGroups) makes group i = part i; restore our material indices
  m.groups.forEach((gr, i) => { gr.materialIndex = list[i][1]; });
  return m;
}
function lathe(points, seg = 12) { return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

const D = SHAPE_DIMS;
export const SHAPE_MATS = {}; // shape -> list of material roles for each material index
function build() {
  const G = {};
  // cereal-style carton box: faces +x,-x,+y,-y,+z,-z
  G.box = based(new THREE.BoxGeometry(D.box.w, D.box.h, D.box.d)); SHAPE_MATS.box = ['side', 'side', 'top', 'top', 'label', 'label'];
  G.flatbox = based(new THREE.BoxGeometry(D.flatbox.w, D.flatbox.h, D.flatbox.d)); SHAPE_MATS.flatbox = ['side', 'side', 'label', 'top', 'label', 'label'];
  // pillow bag: a box with bulged faces
  const bag = new THREE.BoxGeometry(D.bag.w, D.bag.h, D.bag.d, 4, 5, 2);
  const pos = bag.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (D.bag.w / 2), y = pos.getY(i) / (D.bag.h / 2), z = pos.getZ(i);
    const bulge = (1 - x * x) * (1 - Math.pow(Math.abs(y), 3));
    pos.setZ(i, z * (0.35 + 0.65 * bulge));
    if (Math.abs(y) > 0.92) pos.setX(i, pos.getX(i) * 1.04); // crimped seams
  }
  bag.computeVertexNormals();
  G.bag = based(bag); SHAPE_MATS.bag = ['side', 'side', 'top', 'top', 'label', 'label'];
  // tin can with rims
  const r = D.can.w / 2;
  G.can = based(parts([[new THREE.CylinderGeometry(r * 0.97, r * 0.97, D.can.h * 0.9, 12, 1, true).translate(0, D.can.h * 0.5, 0), 0],
    [new THREE.CylinderGeometry(r, r, D.can.h * 0.05, 12).translate(0, D.can.h * 0.975, 0), 1],
    [new THREE.CylinderGeometry(r, r, D.can.h * 0.05, 12).translate(0, D.can.h * 0.025, 0), 1]]));
  SHAPE_MATS.can = ['label', 'metal'];
  // bottle: lathe body + cap
  const br = D.bottle.w / 2, bh = D.bottle.h;
  G.bottle = based(parts([[lathe([[0.001, 0], [br * 0.92, 0.002], [br, 0.01], [br, bh * 0.55], [br * 0.8, bh * 0.7], [br * 0.36, bh * 0.82], [br * 0.33, bh * 0.92], [0.001, bh * 0.92]]), 0],
    [new THREE.CylinderGeometry(br * 0.38, br * 0.38, bh * 0.08, 12).translate(0, bh * 0.96, 0), 1]]));
  SHAPE_MATS.bottle = ['label', 'cap'];
  const jr = D.jar.w / 2, jh = D.jar.h;
  G.jar = based(parts([[lathe([[0.001, 0], [jr, 0.004], [jr, jh * 0.78], [jr * 0.85, jh * 0.86], [0.001, jh * 0.86]]), 0],
    [new THREE.CylinderGeometry(jr * 0.88, jr * 0.88, jh * 0.14, 10).translate(0, jh * 0.93, 0), 1]]));
  SHAPE_MATS.jar = ['label', 'lid'];
  // milk/juice carton with gable top
  const cw = D.carton.w, ch = D.carton.h * 0.8;
  const gable = new THREE.CylinderGeometry(0.001, cw * 0.71, D.carton.h * 0.16, 4, 1).rotateY(Math.PI / 4).translate(0, ch + D.carton.h * 0.08, 0);
  G.carton = based(parts([[new THREE.BoxGeometry(cw, ch, cw).translate(0, ch / 2, 0), 0], [gable, 1], [new THREE.BoxGeometry(cw * 0.95, D.carton.h * 0.05, 0.01).translate(0, ch + D.carton.h * 0.18, 0), 1]]));
  SHAPE_MATS.carton = ['label', 'top'];
  const tr = D.tub.w / 2;
  G.tub = based(parts([[new THREE.CylinderGeometry(tr, tr * 0.85, D.tub.h * 0.92, 12, 1, true).translate(0, D.tub.h * 0.46, 0), 0],
    [new THREE.CylinderGeometry(tr * 1.03, tr * 1.03, D.tub.h * 0.08, 12).translate(0, D.tub.h * 0.96, 0), 1]]));
  SHAPE_MATS.tub = ['label', 'foil'];
  // fruit with a little stem
  G.sphere = based(parts([[new THREE.SphereGeometry(D.sphere.w / 2, 10, 7).scale(1, 0.92, 1), 0], [new THREE.CylinderGeometry(0.003, 0.004, 0.018, 5).translate(0, D.sphere.w * 0.47, 0), 1]]));
  SHAPE_MATS.sphere = ['plain', 'stem'];
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-D.long.w / 2, 0.02, 0), new THREE.Vector3(0, 0.055, 0), new THREE.Vector3(D.long.w / 2, 0.02, 0));
  G.long = based(oneGroup(new THREE.TubeGeometry(curve, 6, D.long.h / 2, 6, false)));
  SHAPE_MATS.long = ['plain'];
  // meat on a foam tray
  G.slab = based(parts([[new THREE.BoxGeometry(D.slab.w, 0.012, D.slab.d).translate(0, 0.006, 0), 1],
    [new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(D.slab.w * 0.85, D.slab.h * 1.4, D.slab.d * 0.85).translate(0, 0.012, 0), 0]]));
  SHAPE_MATS.slab = ['plain', 'tray'];
  G.wedge = based(parts([[new THREE.CylinderGeometry(D.wedge.w / 2, D.wedge.w / 2, D.wedge.h, 16, 1, false, 0, Math.PI * 0.5).translate(0, D.wedge.h / 2, 0), 0]]));
  SHAPE_MATS.wedge = ['plain'];
  // toilet roll pack: plastic-wrapped block with soft, slightly bulged sides; the top shows the roll ends
  const pk = new THREE.BoxGeometry(D.pack.w, D.pack.h, D.pack.d, 3, 3, 2), pp = pk.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i) / (D.pack.w / 2), y = pp.getY(i) / (D.pack.h / 2), z = pp.getZ(i) / (D.pack.d / 2);
    const soft = 1 - 0.06 * Math.pow(Math.max(Math.abs(x), Math.abs(z)), 6) * (Math.abs(y) > 0.9 ? 1 : 0.3);
    pp.setX(i, pp.getX(i) * soft); pp.setZ(i, pp.getZ(i) * soft);
  }
  pk.computeVertexNormals();
  G.pack = based(pk); SHAPE_MATS.pack = ['label', 'label', 'rolls', 'top', 'label', 'label'];
  // handled jug (bleach, liquid detergent): rounded body, shoulder, cap, handle on the back corner
  const gw = D.jug.w, gh = D.jug.h, gd = D.jug.d;
  const jb = new THREE.BoxGeometry(gw, gh * 0.78, gd, 4, 2, 3), jp = jb.attributes.position;
  for (let i = 0; i < jp.count; i++) { const x = jp.getX(i) / (gw / 2), z = jp.getZ(i) / (gd / 2); const k = 1 - 0.12 * Math.pow(Math.abs(x * z), 2); jp.setX(i, jp.getX(i) * k); jp.setZ(i, jp.getZ(i) * k); }
  jb.computeVertexNormals();
  G.jug = based(parts([[jb.translate(0, gh * 0.39, 0), 0],
    [new THREE.CylinderGeometry(gw * 0.16, gw * 0.48, gh * 0.12, 10).scale(1, 1, gd / gw).translate(-gw * 0.18, gh * 0.84, 0), 2],
    [new THREE.CylinderGeometry(gw * 0.17, gw * 0.17, gh * 0.08, 14).translate(-gw * 0.18, gh * 0.94, 0), 1],
    [new THREE.TorusGeometry(gh * 0.12, 0.012, 5, 7, Math.PI).rotateZ(-Math.PI / 2).translate(gw * 0.36, gh * 0.7, 0), 2]]));
  SHAPE_MATS.jug = ['label', 'cap', 'side'];
  // squeeze bottle (shampoo, dish soap): flat oval body, flip cap
  const sq = new THREE.CylinderGeometry(D.squeeze.w / 2, D.squeeze.w / 2 * 0.92, D.squeeze.h * 0.84, 12, 1).scale(1, 1, D.squeeze.d / D.squeeze.w);
  G.squeeze = based(parts([[sq.translate(0, D.squeeze.h * 0.42, 0), 0],
    [new THREE.CylinderGeometry(D.squeeze.w * 0.3, D.squeeze.w * 0.36, D.squeeze.h * 0.16, 14).scale(1, 1, 0.8).translate(0, D.squeeze.h * 0.92, 0), 1]]));
  SHAPE_MATS.squeeze = ['label', 'cap'];
  // big gusseted bag of washing powder: like the pillow bag, wider and with a flat base
  const pb = new THREE.BoxGeometry(D.pouch.w, D.pouch.h, D.pouch.d, 4, 5, 2), ppb = pb.attributes.position;
  for (let i = 0; i < ppb.count; i++) {
    const x = ppb.getX(i) / (D.pouch.w / 2), y = ppb.getY(i) / (D.pouch.h / 2), z = ppb.getZ(i);
    const bulge = (1 - x * x * 0.6) * (y > 0.6 ? 1 - (y - 0.6) * 1.6 : 1);
    ppb.setZ(i, z * (0.45 + 0.55 * bulge));
  }
  pb.computeVertexNormals();
  G.pouch = based(pb); SHAPE_MATS.pouch = ['side', 'side', 'top', 'top', 'label', 'label'];
  return G;
}
export const PRODUCT_GEOS = build();

// ---------------------------------------------------------------- packaging artwork
// Every product gets a brand identity (typeface, colours, layout) and a drawn product image ("photo window")
// instead of an emoji. Drawn once per product on a 256x256 canvas that wraps the package.
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function shade(c, f) { const col = new THREE.Color(c); col.multiplyScalar(f); return '#' + col.getHexString(); }
function lum(c) { const col = new THREE.Color(c); return 0.299 * col.r + 0.587 * col.g + 0.114 * col.b; }
function rnd(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const seedOf = (id) => [...id].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7);

// brand identities: background, ink, accent, typefaces, layout
const BRAND_STYLE = {
  'Golden Fields': { bg: '#efe6d2', ink: '#3b2f1e', accent: '#b8862b', brandFont: '700 26px "Playfair Display"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'heritage' },
  'Pantry Pride': { bg: '#ffffff', ink: '#1d1f22', accent: '#c8272d', brandFont: '700 22px "Barlow Condensed"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'band' },
  'Daily Fresh': { bg: '#f7faf6', ink: '#1f3a2a', accent: '#2f7d4a', brandFont: '600 21px Barlow', nameFont: 'Barlow', nameWeight: 700, layout: 'clean' },
  'Sunny Farm': { bg: '#f6efe0', ink: '#4a2c17', accent: '#d9822b', brandFont: '30px Pacifico', nameFont: '"Barlow Condensed"', nameWeight: 600, layout: 'heritage' },
  'Nordic Choice': { bg: '#eef3f6', ink: '#1c2b3a', accent: '#3a6f9a', brandFont: '500 20px Barlow', nameFont: 'Barlow', nameWeight: 600, layout: 'clean' },
  'Casa Bella': { bg: '#1f3b2c', ink: '#f3eee2', accent: '#c0392b', brandFont: 'italic 700 26px "Playfair Display"', nameFont: '"Playfair Display"', nameWeight: 700, layout: 'dark' },
  'Green Leaf': { bg: '#c9a97c', ink: '#2e2416', accent: '#3f6b35', brandFont: '22px "Archivo Black"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'kraft' },
  'Valley Farms': { bg: '#fbfaf7', ink: '#22303a', accent: '#5b8c3a', brandFont: '700 24px "Playfair Display"', nameFont: 'Barlow', nameWeight: 700, layout: 'clean' },
  'Blue Harbor': { bg: '#172a45', ink: '#ffffff', accent: '#4fa3d9', brandFont: '700 22px "Barlow Condensed"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'dark' },
  'Maple & Co': { bg: '#141414', ink: '#efe7d3', accent: '#c9a45c', brandFont: '900 24px "Playfair Display"', nameFont: '"Playfair Display"', nameWeight: 700, layout: 'premium' },
  // household brands (all invented)
  'CloudSoft': { bg: '#e8f3fc', ink: '#173a63', accent: '#2b7bd0', brandFont: 'italic 700 30px "Playfair Display"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'wave' },
  'Citrus Clean': { bg: '#ffffff', ink: '#1d2a12', accent: '#e8c21a', brandFont: '700 24px "Barlow Condensed"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'band' },
  'Brightwave': { bg: '#0f8a4a', ink: '#ffffff', accent: '#ffd400', brandFont: '26px "Archivo Black"', nameFont: '"Barlow Condensed"', nameWeight: 700, layout: 'burst' },
  'Silk & Shine': { bg: '#ffffff', ink: '#0d2a5c', accent: '#1d4ed8', brandFont: '700 24px Barlow', nameFont: 'Barlow', nameWeight: 700, layout: 'clean' },
  'Rosewood': { bg: '#fbe9ef', ink: '#5a1f35', accent: '#c2416c', brandFont: '28px Pacifico', nameFont: 'Barlow', nameWeight: 600, layout: 'heritage' },
};
const BRANDS = Object.keys(BRAND_STYLE);
const BRAND_FOR = { pasta: 'Casa Bella', tomsauce: 'Casa Bella', olives: 'Casa Bella', salami: 'Casa Bella', truffle: 'Maple & Co', wine: 'Maple & Co', wagyu: 'Maple & Co', honey: 'Golden Fields', flour: 'Golden Fields', cereal: 'Golden Fields',
  sugar: 'Pantry Pride', rice: 'Pantry Pride', beans: 'Pantry Pride', toiletpaper: 'CloudSoft', detergent: 'Brightwave', washpowder: 'Brightwave', bleach: 'Citrus Clean', dishsoap: 'Citrus Clean', shampoo: 'Silk & Shine', soap: 'Rosewood', water: 'Nordic Choice', fishsticks: 'Blue Harbor', sushi: 'Blue Harbor', milk: 'Valley Farms', butter: 'Valley Farms', cream: 'Valley Farms', eggs: 'Sunny Farm', yogurt: 'Sunny Farm',
  salad: 'Daily Fresh', hummus: 'Daily Fresh', potsalad: 'Daily Fresh', kombucha: 'Green Leaf', veggies: 'Green Leaf', coffee: 'Maple & Co', chocolate: 'Maple & Co' };
const DESCRIPTOR = { grocery: 'CLASSIC', fridge: 'KEEP REFRIGERATED', frozen: 'KEEP FROZEN  −18°C', produce: 'FRESH', meat: 'FRESH · BUTCHER CUT', deli: 'DELI SELECTION', household: 'HOME CARE' };
const SIZES = { box: '500 g', flatbox: '400 g', bag: '1 kg', can: '400 g', bottle: '1.5 L', jar: '350 g', carton: '1 L', tub: '150 g', slab: '500 g', wedge: '250 g', pack: '12 ROLLS', jug: '2 L', squeeze: '500 ml', pouch: '3 kg' };
const SIZE_FOR = { toiletpaper: '12 ROLLS', soap: '4 × 100 g', cereal: '750 g', milk: '1 L · 3%', water: '1.5 L', detergent: '1.5 L · 30 WASHES', washpowder: '3 kg · 40 WASHES' };

// --- small painting helpers for the product images (soft shading so they read like photos)
function ball(g, x, y, r, col, hi = 0.35) {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, shade(col, 1 + hi)); gr.addColorStop(0.55, hex(col)); gr.addColorStop(1, shade(col, 0.55));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function ell(g, x, y, rx, ry, col, rot = 0, hi = 0.3) {
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, ry / rx); ball(g, 0, 0, rx, col, hi); g.restore();
}
function shadow(g, x, y, rx) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(x, y, rx, rx * 0.22, 0, 0, Math.PI * 2); g.fill(); }
const MOTIFS = {
  cereal(g, w, h, r) { ell(g, w / 2, h * 0.62, w * 0.36, h * 0.16, 0xf2f2ee, 0, 0.1); for (let i = 0; i < 26; i++) ell(g, w * 0.22 + r() * w * 0.56, h * 0.42 + r() * h * 0.2, 10 + r() * 6, 6 + r() * 3, 0xe0a030, r() * 3); },
  pasta(g, w, h, r) { g.lineCap = 'round'; for (let i = 0; i < 22; i++) { g.strokeStyle = r() < 0.5 ? '#e8c46a' : '#d9b257'; g.lineWidth = 3; g.beginPath(); const x = w * 0.15 + r() * w * 0.7; g.moveTo(x, h * 0.25); g.bezierCurveTo(x + 30 * (r() - 0.5), h * 0.45, x + 40 * (r() - 0.5), h * 0.6, x + 20 * (r() - 0.5), h * 0.85); g.stroke(); } },
  rice(g, w, h, r) { for (let i = 0; i < 140; i++) ell(g, w * 0.15 + r() * w * 0.7, h * 0.35 + r() * h * 0.45, 5, 2.4, 0xf4f1e6, r() * 3, 0.15); },
  beans(g, w, h, r) { for (let i = 0; i < 40; i++) ell(g, w * 0.18 + r() * w * 0.64, h * 0.4 + r() * h * 0.4, 9, 6, 0xb5482a, r() * 3); },
  chips(g, w, h, r) { for (let i = 0; i < 12; i++) ell(g, w * 0.2 + r() * w * 0.6, h * 0.35 + r() * h * 0.45, 24, 15, 0xf0c35a, r() * 3, 0.25); },
  cookies(g, w, h, r) { for (const [x, y] of [[0.35, 0.55], [0.62, 0.5], [0.5, 0.72]]) { ell(g, w * x, h * y, 34, 30, 0xc98a45, 0, 0.2); for (let i = 0; i < 6; i++) ell(g, w * x + (r() - 0.5) * 40, h * y + (r() - 0.5) * 34, 4, 3.5, 0x3d2416, r() * 3, 0.1); } },
  soda(g, w, h, r) { for (let i = 0; i < 40; i++) { const x = w * 0.15 + r() * w * 0.7, y = h * 0.3 + r() * h * 0.55, s = 2 + r() * 6; g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.stroke(); } },
  water(g, w, h, r) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 4; for (let k = 0; k < 3; k++) { g.beginPath(); for (let x = 20; x <= w - 20; x += 4) g.lineTo(x, h * (0.5 + k * 0.1) + Math.sin(x / 18 + k) * 6); g.stroke(); } MOTIFS.soda(g, w, h, r); },
  coffee(g, w, h, r) { for (let i = 0; i < 18; i++) { const x = w * 0.18 + r() * w * 0.64, y = h * 0.38 + r() * h * 0.42, a = r() * 3; ell(g, x, y, 13, 9, 0x5a3420, a, 0.35); g.strokeStyle = '#2b170c'; g.lineWidth = 1.5; g.beginPath(); g.ellipse(x, y, 9, 1.5, a, 0, Math.PI * 2); g.stroke(); } },
  tomsauce(g, w, h, r) { ball(g, w * 0.4, h * 0.6, 34, 0xc8341f); ball(g, w * 0.62, h * 0.58, 28, 0xd9442a); g.fillStyle = '#2f6b2a'; for (const x of [0.4, 0.62]) { g.beginPath(); g.ellipse(w * x, h * 0.6 - 30, 10, 4, 0.4, 0, Math.PI * 2); g.fill(); } void r; },
  chocolate(g, w, h) { for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) { const x = w * 0.2 + i * 40, y = h * 0.45 + j * 40; g.fillStyle = '#4a2a1a'; g.fillRect(x, y, 36, 36); g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, y, 36, 5); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 31, 36, 5); } },
  oil(g, w, h) { const x = w / 2, y = h * 0.62; const gr = g.createRadialGradient(x - 10, y - 10, 4, x, y, 44); gr.addColorStop(0, '#f6e27a'); gr.addColorStop(1, '#8a7a12'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, y - 62); g.bezierCurveTo(x + 40, y - 10, x + 40, y + 34, x, y + 34); g.bezierCurveTo(x - 40, y + 34, x - 40, y - 10, x, y - 62); g.fill(); ell(g, w * 0.3, h * 0.78, 16, 10, 0x5b6b2a, 0.3); ell(g, w * 0.7, h * 0.8, 14, 9, 0x4f5e24, -0.2); },
  flour(g, w, h) { g.strokeStyle = '#b08433'; g.lineWidth = 3; for (const dx of [-40, 0, 40]) { const x = w / 2 + dx; g.beginPath(); g.moveTo(x, h * 0.88); g.quadraticCurveTo(x + dx * 0.2, h * 0.6, x + dx * 0.3, h * 0.36); g.stroke(); for (let k = 0; k < 6; k++) { ell(g, x + dx * 0.3 * (1 - k / 8) - 7, h * (0.4 + k * 0.05), 7, 4, 0xd9a443, -0.6); ell(g, x + dx * 0.3 * (1 - k / 8) + 7, h * (0.4 + k * 0.05), 7, 4, 0xd9a443, 0.6); } } },
  sugar(g, w, h, r) { for (let i = 0; i < 6; i++) { const x = w * 0.25 + (i % 3) * 46, y = h * 0.5 + Math.floor(i / 3) * 40; g.fillStyle = '#ffffff'; g.fillRect(x, y, 36, 34); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 30, y, 6, 34); g.fillRect(x, y + 28, 36, 6); } void r; },
  pbutter(g, w, h) { ball(g, w * 0.4, h * 0.62, 26, 0xb07a3c); ball(g, w * 0.62, h * 0.6, 22, 0xa56f35); ell(g, w * 0.52, h * 0.78, 60, 14, 0xc8914c, 0, 0.1); },
  honey(g, w, h) { g.strokeStyle = '#e0a020'; g.lineWidth = 3; for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { const x = w * 0.22 + i * 30 + (j % 2) * 15, y = h * 0.45 + j * 26; g.beginPath(); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + Math.PI / 6; g.lineTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15); } g.closePath(); g.fillStyle = 'rgba(232,170,40,0.55)'; g.fill(); g.stroke(); } },
  catfood(g, w, h) { const x = w / 2, y = h * 0.64; for (const [dx, dy, s] of [[-30, -20, 12], [-10, -36, 12], [14, -36, 12], [34, -20, 12]]) ball(g, x + dx, y + dy, s, 0x3a3a3a, 0.2); ell(g, x + 2, y + 6, 30, 24, 0x3a3a3a, 0, 0.2); },
  toiletpaper(g, w, h) { for (let i = 0; i < 3; i++) { const x = w * 0.28 + i * 52, y = h * 0.62; g.fillStyle = '#f7f7f4'; g.fillRect(x - 22, y - 30, 44, 60); ell(g, x, y - 30, 22, 8, 0xffffff, 0, 0.05); ell(g, x, y - 30, 7, 3, 0xb9a98a, 0, 0); } },
  energy(g, w, h) { g.fillStyle = '#e8f03a'; g.beginPath(); g.moveTo(w * 0.55, h * 0.3); g.lineTo(w * 0.38, h * 0.62); g.lineTo(w * 0.52, h * 0.62); g.lineTo(w * 0.44, h * 0.9); g.lineTo(w * 0.66, h * 0.52); g.lineTo(w * 0.52, h * 0.52); g.closePath(); g.fill(); },
  detergent(g, w, h, r) { for (let i = 0; i < 16; i++) { const x = w * 0.2 + r() * w * 0.6, y = h * 0.4 + r() * h * 0.45, s = 8 + r() * 16; const gr = g.createRadialGradient(x - s / 3, y - s / 3, 1, x, y, s); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(190,220,255,0.35)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); } },
  wine(g, w, h) { for (let i = 0; i < 9; i++) ball(g, w * 0.4 + (i % 3) * 22 - Math.floor(i / 3) * 4, h * 0.45 + Math.floor(i / 3) * 22, 12, 0x4a1630, 0.4); ell(g, w * 0.62, h * 0.38, 18, 9, 0x3f5a2a, -0.5); },
  truffle(g, w, h) { ball(g, w * 0.45, h * 0.62, 32, 0x2e2420, 0.15); ball(g, w * 0.62, h * 0.66, 20, 0x3a2e28, 0.15); MOTIFS.pasta(g, w, h * 0.6, rnd(3)); },
  milk(g, w, h) { const gr = g.createLinearGradient(0, h * 0.5, 0, h); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#dfe6ec'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, h * 0.68); for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.66 + Math.sin(x / 20) * 8); g.lineTo(w, h); g.lineTo(0, h); g.fill(); for (const [x, s] of [[0.3, 10], [0.55, 14], [0.75, 8]]) ball(g, w * x, h * 0.52 - s, s, 0xffffff, 0.05); },
  yogurt(g, w, h) { MOTIFS.milk(g, w, h); for (const [x, y] of [[0.38, 0.5], [0.6, 0.48]]) { ell(g, w * x, h * y, 22, 26, 0xc8202d, 0, 0.35); g.fillStyle = '#f5e08a'; for (let i = 0; i < 8; i++) g.fillRect(w * x - 12 + (i % 3) * 10, h * y - 12 + Math.floor(i / 3) * 10, 2, 3); } },
  butter(g, w, h) { g.fillStyle = '#f2d36b'; g.fillRect(w * 0.3, h * 0.52, w * 0.4, h * 0.22); g.fillStyle = '#f8e39a'; g.fillRect(w * 0.3, h * 0.52, w * 0.4, 8); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(w * 0.3, h * 0.72, w * 0.4, 6); },
  eggs(g, w, h) { for (const [x, y] of [[0.35, 0.62], [0.55, 0.58], [0.7, 0.68], [0.45, 0.76]]) ell(g, w * x, h * y, 22, 28, 0xead2b0, 0.2, 0.3); },
  cheese(g, w, h) { MOTIFS.gouda(g, w, h); },
  juice(g, w, h) { for (const [x, y, s] of [[0.38, 0.62, 40], [0.66, 0.58, 30]]) { ball(g, w * x, h * y, s, 0xf08a1a, 0.25); g.fillStyle = '#ffd27a'; g.beginPath(); g.arc(w * x, h * y, s * 0.82, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#f2a640'; g.lineWidth = 2; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.beginPath(); g.moveTo(w * x, h * y); g.lineTo(w * x + Math.cos(a) * s * 0.8, h * y + Math.sin(a) * s * 0.8); g.stroke(); } } },
  cream(g, w, h) { MOTIFS.milk(g, w, h); },
  salad(g, w, h, r) { for (let i = 0; i < 14; i++) ell(g, w * 0.2 + r() * w * 0.6, h * 0.4 + r() * h * 0.42, 22, 12, r() < 0.5 ? 0x5f9a3a : 0x86b84a, r() * 3); for (let i = 0; i < 5; i++) ball(g, w * 0.25 + r() * w * 0.5, h * 0.45 + r() * h * 0.35, 8, 0xd23a2a); },
  kombucha(g, w, h) { ell(g, w * 0.48, h * 0.62, 34, 22, 0xc89b4a, 0.4); ell(g, w * 0.62, h * 0.7, 16, 10, 0xb88a3a, -0.3); },
  pizza(g, w, h) { ball(g, w / 2, h * 0.62, 58, 0xd9a25a, 0.1); g.fillStyle = '#c4452c'; g.beginPath(); g.arc(w / 2, h * 0.62, 50, 0, Math.PI * 2); g.fill(); for (const [dx, dy] of [[-22, -14], [18, -20], [-6, 18], [26, 14], [-30, 20]]) ball(g, w / 2 + dx, h * 0.62 + dy, 9, 0x8a2a1e, 0.2); g.fillStyle = 'rgba(250,240,200,0.6)'; g.beginPath(); g.arc(w / 2 - 6, h * 0.6, 24, 0, Math.PI * 2); g.fill(); },
  icecream(g, w, h) { for (const [x, y, s] of [[0.4, 0.62, 30], [0.6, 0.6, 28], [0.5, 0.48, 26]]) ball(g, w * x, h * y, s, 0xf5ead0, 0.08); },
  fries(g, w, h, r) { for (let i = 0; i < 18; i++) { g.save(); g.translate(w * 0.25 + r() * w * 0.5, h * 0.5 + r() * h * 0.3); g.rotate((r() - 0.5) * 1.2); g.fillStyle = '#e8b84a'; g.fillRect(-4, -26, 8, 52); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(2, -26, 2, 52); g.restore(); } },
  veggies(g, w, h, r) { for (let i = 0; i < 26; i++) { const t = r(); ball(g, w * 0.2 + r() * w * 0.6, h * 0.4 + r() * h * 0.42, t < 0.4 ? 7 : 9, t < 0.4 ? 0x5a9a3a : t < 0.7 ? 0xe58a2a : 0xf0d040); } },
  fishsticks(g, w, h) { for (let i = 0; i < 4; i++) { g.save(); g.translate(w * 0.5, h * 0.48 + i * 20); g.rotate(-0.08 + i * 0.05); const gr = g.createLinearGradient(0, -8, 0, 8); gr.addColorStop(0, '#e7a64a'); gr.addColorStop(1, '#b8742c'); g.fillStyle = gr; g.fillRect(-60, -8, 120, 16); g.restore(); } },
  dumplings(g, w, h) { for (const [x, y] of [[0.35, 0.6], [0.6, 0.56], [0.48, 0.74]]) { ell(g, w * x, h * y, 30, 20, 0xf1e6d0, 0, 0.15); g.strokeStyle = 'rgba(0,0,0,0.15)'; g.lineWidth = 2; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(w * x + k * 9, h * y - 18); g.lineTo(w * x + k * 7, h * y - 6); g.stroke(); } } },
  popsicles(g, w, h) { [0xd23a3a, 0xf0a020, 0x6a3fb0].forEach((c, i) => { const x = w * (0.32 + i * 0.18); g.fillStyle = '#e2c79a'; g.fillRect(x - 4, h * 0.7, 8, 34); g.fillStyle = hex(c); g.beginPath(); g.roundRect ? g.roundRect(x - 18, h * 0.38, 36, h * 0.34, 16) : g.rect(x - 18, h * 0.38, 36, h * 0.34); g.fill(); }); },
  frozenmeat(g, w, h) { ell(g, w / 2, h * 0.62, 56, 18, 0x6a3a26, 0, 0.2); g.strokeStyle = '#3d2014'; g.lineWidth = 3; for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(w / 2 - 40, h * 0.62 + k * 6); g.lineTo(w / 2 + 40, h * 0.62 + k * 6 - 4); g.stroke(); } },
  steak(g, w, h, r, col = 0xa8322c) { ell(g, w / 2, h * 0.62, 62, 40, col, 0.1, 0.15); g.strokeStyle = 'rgba(255,240,230,0.55)'; g.lineWidth = 2; for (let i = 0; i < 12; i++) { g.beginPath(); const x = w / 2 + (r() - 0.5) * 90, y = h * 0.62 + (r() - 0.5) * 50; g.moveTo(x, y); g.quadraticCurveTo(x + 10, y + 6, x + 22 * r(), y + 10 * r()); g.stroke(); } g.strokeStyle = 'rgba(255,245,235,0.8)'; g.lineWidth = 7; g.beginPath(); g.ellipse(w / 2, h * 0.62, 60, 38, 0.1, 3.6, 5.2); g.stroke(); },
  gouda(g, w, h) { g.fillStyle = '#e8b93c'; g.beginPath(); g.moveTo(w * 0.22, h * 0.78); g.lineTo(w * 0.78, h * 0.78); g.lineTo(w * 0.7, h * 0.42); g.closePath(); g.fill(); g.fillStyle = '#f3cc58'; g.beginPath(); g.moveTo(w * 0.22, h * 0.78); g.lineTo(w * 0.7, h * 0.42); g.lineTo(w * 0.62, h * 0.4); g.closePath(); g.fill(); g.fillStyle = 'rgba(160,110,20,0.6)'; for (const [x, y, s] of [[0.5, 0.66, 7], [0.62, 0.7, 5], [0.65, 0.56, 4], [0.4, 0.72, 4]]) { g.beginPath(); g.arc(w * x, h * y, s, 0, Math.PI * 2); g.fill(); } },
  olives(g, w, h, r) { for (let i = 0; i < 14; i++) ell(g, w * 0.22 + r() * w * 0.56, h * 0.42 + r() * h * 0.38, 15, 11, r() < 0.5 ? 0x4f5a1e : 0x2c2a20, r() * 3, 0.45); },
  hummus(g, w, h) { ell(g, w / 2, h * 0.64, 60, 26, 0xd9bf8c, 0, 0.1); g.strokeStyle = 'rgba(150,110,60,0.6)'; g.lineWidth = 2; g.beginPath(); g.ellipse(w / 2, h * 0.64, 36, 14, 0, 0, Math.PI * 2); g.stroke(); g.fillStyle = 'rgba(200,120,40,0.7)'; g.beginPath(); g.ellipse(w / 2, h * 0.64, 14, 5, 0, 0, Math.PI * 2); g.fill(); },
  roast(g, w, h) { shadow(g, w / 2, h * 0.8, 60); ell(g, w / 2, h * 0.62, 58, 40, 0xb8732e, 0, 0.35); ell(g, w * 0.3, h * 0.68, 18, 12, 0xa8652a, 0.6); ell(g, w * 0.7, h * 0.68, 18, 12, 0xa8652a, -0.6); },
  bleach(g, w, h) { // a lemon half and a splash
    g.fillStyle = 'rgba(120,190,255,0.55)'; for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; g.beginPath(); g.ellipse(w / 2 + Math.cos(a) * 52, h * 0.62 + Math.sin(a) * 30, 12, 5, a, 0, Math.PI * 2); g.fill(); }
    ball(g, w / 2, h * 0.62, 40, 0xf2d21a, 0.3); g.fillStyle = '#fbeea0'; g.beginPath(); g.arc(w / 2, h * 0.62, 32, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#efd25a'; g.lineWidth = 2; for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; g.beginPath(); g.moveTo(w / 2, h * 0.62); g.lineTo(w / 2 + Math.cos(a) * 30, h * 0.62 + Math.sin(a) * 30); g.stroke(); } },
  dishsoap(g, w, h, r) { MOTIFS.bleach(g, w, h); for (let i = 0; i < 10; i++) { const x = w * 0.15 + r() * w * 0.7, y = h * 0.35 + r() * h * 0.5, s = 5 + r() * 12; const gr = g.createRadialGradient(x - s / 3, y - s / 3, 1, x, y, s); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0.15)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); } },
  shampoo(g, w, h, r) { // water drops on a blue swirl
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 6; g.beginPath(); for (let a = 0; a < Math.PI * 3; a += 0.1) g.lineTo(w / 2 + Math.cos(a) * a * 9, h * 0.6 + Math.sin(a) * a * 6); g.stroke();
    for (let i = 0; i < 7; i++) { const x = w * 0.2 + r() * w * 0.6, y = h * 0.38 + r() * h * 0.42, s = 6 + r() * 8; const gr = g.createRadialGradient(x - s / 3, y - s / 2, 1, x, y, s); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, 'rgba(120,180,255,0.4)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, y - s * 1.6); g.quadraticCurveTo(x + s, y, x, y + s); g.quadraticCurveTo(x - s, y, x, y - s * 1.6); g.fill(); } },
  soap(g, w, h, r) { for (const [x, y, c] of [[0.38, 0.6, 0xf6c3d5], [0.6, 0.66, 0xf9d9e4]]) { g.save(); g.translate(w * x, h * y); g.rotate(-0.15); const gr = g.createLinearGradient(0, -24, 0, 24); gr.addColorStop(0, shade(c, 1.1)); gr.addColorStop(1, shade(c, 0.8)); g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(-44, -24, 88, 48, 20) : g.rect(-44, -24, 88, 48); g.fill(); g.restore(); } MOTIFS.dishsoap.call(null, g, w, h * 0.7, r); },
  washpowder(g, w, h, r) { // a white flower and fresh laundry swirl on a sunburst
    g.fillStyle = 'rgba(255,212,0,0.85)'; for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; g.beginPath(); g.moveTo(w / 2, h * 0.6); g.lineTo(w / 2 + Math.cos(a) * 90, h * 0.6 + Math.sin(a) * 90); g.lineTo(w / 2 + Math.cos(a + 0.18) * 90, h * 0.6 + Math.sin(a + 0.18) * 90); g.fill(); }
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; ell(g, w / 2 + Math.cos(a) * 18, h * 0.6 + Math.sin(a) * 18, 16, 10, 0xffffff, a, 0.1); } ball(g, w / 2, h * 0.6, 9, 0xf2c21a); void r; },
  sushi(g, w, h) { for (let i = 0; i < 3; i++) { const x = w * 0.3 + i * 50, y = h * 0.64; ell(g, x, y, 22, 14, 0xf6f4ee, 0, 0.1); ell(g, x, y - 10, 22, 9, i === 1 ? 0xe8774a : 0xf08a6a, 0, 0.3); } },
};
const MOTIF_FOR = { detergent: 'washpowder', cheese: 'gouda', groundbeef: 'steak', ribeye: 'steak', wagyu: 'steak', lamb: 'steak', ribs: 'steak', chicken: 'steak', ham: 'steak', salami: 'steak', sausages: 'frozenmeat', potsalad: 'salad', roastchicken: 'roast', strawberry: 'yogurt' };
const MEAT_COL = { chicken: 0xe8b8a0, ham: 0xe8a0a0, lamb: 0xb04a3c, salami: 0x9a2a2a, wagyu: 0xc04a44 };

const texCache = new Map();
export function packagingTexture(p) {
  if (texCache.has(p.id)) return texCache.get(p.id);
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d'); g.scale(2, 2); // drawn at 2x for sharp print
  const r = rnd(seedOf(p.id));
  const brand = BRAND_FOR[p.id] || BRANDS[seedOf(p.id) % BRANDS.length];
  const S = BRAND_STYLE[brand];
  // background
  g.fillStyle = S.bg; g.fillRect(0, 0, W, H);
  if (S.layout === 'kraft') { for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(80,55,25,${r() * 0.12})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1); } }
  if (S.layout === 'premium') { g.strokeStyle = S.accent; g.lineWidth = 2; g.strokeRect(8, 8, W - 16, H - 16); }
  // dairy cartons: gingham print on the top half, like classic milk cartons
  if (p.shape === 'carton') { const check = shade(p.id === 'milk' ? 0x2f5fb3 : p.id === 'cream' ? 0xc8272d : p.color === 0xffffff ? 0x2f5fb3 : p.color, p.id === 'milk' ? 1 : 0.8); g.fillStyle = check; for (let y = 0; y < 66; y += 12) for (let x = 0; x < W; x += 12) { g.globalAlpha = ((x + y) / 12) % 2 ? 0.85 : 0.35; g.fillRect(x, y, 12, 12); } g.globalAlpha = 1; }
  if (S.layout === 'wave') { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#bcdcf6'); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = 'rgba(43,123,208,0.18)'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(0, H * (0.75 + k * 0.08)); for (let x = 0; x <= W; x += 8) g.lineTo(x, H * (0.75 + k * 0.08) + Math.sin(x / 26 + k) * 8); g.lineTo(W, H); g.lineTo(0, H); g.fill(); } }
  if (S.layout === 'burst') { const gr = g.createRadialGradient(W / 2, H * 0.5, 10, W / 2, H * 0.5, W * 0.8); gr.addColorStop(0, '#2cc46c'); gr.addColorStop(1, '#0a6a36'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
  // product colour field behind the image
  const fieldTop = 70, fieldH = 116;
  const fg = g.createLinearGradient(0, fieldTop, 0, fieldTop + fieldH);
  fg.addColorStop(0, shade(p.color, 1.12)); fg.addColorStop(1, shade(p.color, 0.72));
  g.fillStyle = fg;
  if (S.layout === 'band' || S.layout === 'clean') g.fillRect(0, fieldTop, W, fieldH);
  else { g.beginPath(); g.ellipse(W / 2, fieldTop + fieldH / 2, W * 0.46, fieldH * 0.5, 0, 0, Math.PI * 2); g.fill(); }
  // the product image
  g.save(); g.beginPath(); g.rect(0, fieldTop - 20, W, fieldH + 22); g.clip();
  const motif = MOTIFS[p.id] || MOTIFS[MOTIF_FOR[p.id]];
  if (motif) { g.save(); g.translate(0, fieldTop - 72); motif(g, W, 230, r, MEAT_COL[p.id] || 0xa8322c); g.restore(); }
  else { shadow(g, W / 2, fieldTop + fieldH - 14, 50); ball(g, W / 2, fieldTop + fieldH / 2, 42, p.color); }
  g.restore();
  // brand line
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (S.layout === 'band') { g.fillStyle = S.accent; g.fillRect(0, 0, W, 50); g.fillStyle = '#ffffff'; g.font = S.brandFont; g.fillText(brand.toUpperCase(), W / 2, 26); }
  else { g.fillStyle = S.layout === 'dark' || S.layout === 'premium' ? S.accent : S.ink; g.font = S.brandFont; g.fillText(S.layout === 'premium' ? brand.toUpperCase() : brand, W / 2, 34); }
  if (S.layout === 'heritage') { g.strokeStyle = S.accent; g.lineWidth = 1.5; g.beginPath(); g.moveTo(40, 56); g.lineTo(W - 40, 56); g.stroke(); }
  // product name (fits the width; up to two lines)
  const name = S.layout === 'premium' || S.nameFont.includes('Playfair') ? p.name : p.name.toUpperCase();
  const words = name.split(' ');
  const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
  g.fillStyle = S.ink;
  lines.forEach((ln, i) => {
    let size = lines.length > 1 ? 26 : 32;
    const font = () => `${S.nameWeight} ${size}px ${S.nameFont}, "Barlow", Arial, sans-serif`;
    g.font = font(); while (g.measureText(ln).width > W - 24 && size > 12) { size--; g.font = font(); }
    g.fillText(ln, W / 2, fieldTop + fieldH + 22 + i * (size + 1) - (lines.length > 1 ? 4 : 0));
  });
  // descriptor, size and barcode
  g.font = '600 12px Barlow, Arial, sans-serif'; g.fillStyle = S.layout === 'dark' || S.layout === 'premium' ? S.accent : S.accent;
  g.fillText(p.id === 'wine' ? 'RESERVE 2021' : DESCRIPTOR[p.cat] || '', W / 2, fieldTop - 9);
  g.font = '600 15px "Barlow Condensed", Arial, sans-serif'; g.fillStyle = S.ink; g.textAlign = 'left'; g.fillText(SIZE_FOR[p.id] || SIZES[p.shape] || '', 12, H - 18);
  // weight / count badge in the corner (a starburst on boxes and bags, a roundel on bottles)
  if (['box', 'bag', 'pouch', 'pack', 'flatbox'].includes(p.shape)) {
    const bx = W - 34, by = 84, rr = 24; g.fillStyle = S.layout === 'burst' ? '#ffd400' : S.accent; g.beginPath();
    for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2, rad = k % 2 ? rr : rr * 0.82; g.lineTo(bx + Math.cos(a) * rad, by + Math.sin(a) * rad); } g.closePath(); g.fill();
    g.fillStyle = S.layout === 'burst' ? '#0a3a1e' : '#ffffff'; g.textAlign = 'center'; g.font = '700 11px "Barlow Condensed", Arial, sans-serif';
    const t = (SIZE_FOR[p.id] || SIZES[p.shape] || '').split(' · ')[0].split(' '); t.slice(0, 2).forEach((s, i) => g.fillText(s, bx, by - (t.length > 1 ? 5 : 0) + i * 11));
  }
  g.fillStyle = '#fff'; g.fillRect(W - 74, H - 36, 62, 28); g.fillStyle = '#111';
  for (let i = 0, x = W - 70; x < W - 16; i++) { const bw = 1 + ((i * 7 + p.id.length) % 3); g.fillRect(x, H - 33, bw, 20); x += bw + 1 + (i % 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  texCache.set(p.id, t);
  return t;
}
// the side of a carton or bag: brand colour stripe, product name and small print
const sideCache = new Map();
function sideTexture(p) {
  if (sideCache.has(p.id)) return sideCache.get(p.id);
  const brand = BRAND_FOR[p.id] || BRANDS[seedOf(p.id) % BRANDS.length], S = BRAND_STYLE[brand];
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = S.layout === 'burst' ? '#0f8a4a' : S.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = S.accent; g.fillRect(0, 0, W, 34);
  g.fillStyle = '#ffffff'; g.font = '700 16px "Barlow Condensed", Arial, sans-serif'; g.textAlign = 'center'; g.fillText(brand.toUpperCase(), W / 2, 23, W - 10);
  g.fillStyle = S.layout === 'burst' || S.layout === 'dark' || S.layout === 'premium' ? '#e8e8e8' : '#3a3a3a';
  g.font = '700 12px Barlow, Arial, sans-serif'; g.fillText(p.cat === 'household' ? 'DIRECTIONS' : 'NUTRITION FACTS', W / 2, 54);
  g.fillRect(10, 60, W - 20, 1.5);
  g.font = '500 9px Barlow, Arial, sans-serif'; g.textAlign = 'left';
  const r = rnd(seedOf(p.id) + 5);
  for (let i = 0; i < 12; i++) { const y = 74 + i * 12; g.fillRect(10, y, 30 + r() * 50, 4); g.fillRect(W - 28, y, 18, 4); }
  g.fillRect(10, 222, W - 20, 1.5);
  g.font = '600 10px Barlow, Arial, sans-serif'; g.fillText('Best before: see top', 10, 240);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  sideCache.set(p.id, t); return t;
}
// the top of a toilet-roll pack: roll ends seen through the wrap
let rollsTex = null;
function rollsTexture() {
  if (rollsTex) return rollsTex;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#dfe8f0'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) { const x = 44 + i * 84, y = 64 + j * 128; ball(g, x, y, 40, 0xf7f7f4, 0.08); g.fillStyle = '#c9b48e'; g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); g.fillStyle = '#8a7350'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, 256, 256);
  rollsTex = new THREE.CanvasTexture(c); rollsTex.colorSpace = THREE.SRGBColorSpace; return rollsTex;
}
// small product picture for the interface (data URL of the packaging art)
export function productThumb(p) { const t = packagingTexture(p); return t.image.toDataURL ? t.image.toDataURL('image/png') : ''; }

const matCache = new Map();
const shared = {
  metal: new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.9, roughness: 0.28 }),
  lid: new THREE.MeshStandardMaterial({ color: 0xb91c1c, metalness: 0.7, roughness: 0.35 }),
  foil: new THREE.MeshStandardMaterial({ color: 0xe5e7eb, metalness: 0.85, roughness: 0.3 }),
  tray: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 }),
  stem: new THREE.MeshStandardMaterial({ color: 0x5b3a1a, roughness: 0.9 }),
};
// One material array per product, indexed like the shape's groups.
export function productMaterials(p) {
  let arr = matCache.get(p.id);
  if (arr) return arr;
  const glossy = ['bottle', 'jar', 'squeeze', 'jug', 'pack'].includes(p.shape);
  const label = new THREE.MeshPhysicalMaterial({ map: packagingTexture(p), roughness: glossy ? 0.2 : 0.45, clearcoat: glossy ? 0.8 : 0.2, clearcoatRoughness: 0.3 });
  const side = ['box', 'flatbox', 'bag', 'pouch'].includes(p.shape) ? new THREE.MeshStandardMaterial({ map: sideTexture(p), roughness: 0.5 }) : new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
  const top = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.85), roughness: 0.55 });
  const plain = new THREE.MeshPhysicalMaterial({ color: p.color, roughness: p.cat === 'meat' ? 0.55 : 0.35, clearcoat: p.cat === 'produce' ? 0.5 : 0.1 });
  const cap = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).lerp(new THREE.Color(0xffffff), 0.3), roughness: 0.4 });
  const rolls = new THREE.MeshPhysicalMaterial({ map: rollsTexture(), roughness: 0.2, clearcoat: 0.6 });
  const roles = { label, side, top, plain, cap, rolls, ...shared };
  arr = SHAPE_MATS[p.shape].map(r => roles[r]);
  matCache.set(p.id, arr);
  return arr;
}
