// Realistic product packaging: real-world sized geometries with printed labels, metal lids, caps and trays.
// Every geometry has material groups; productMaterials(p) returns the matching material array.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAPE_DIMS } from '/shared/data.js';

const BRANDS = ['Golden Fields', 'Pantry Pride', 'Daily Fresh', 'Sunny Farm', 'Nordic Choice', 'Casa Bella', 'Green Leaf', 'Happy Valley', 'Blue Harbor', 'Maple & Co'];
const SIZES = { box: '500 g', flatbox: '400 g', bag: '1 kg', can: '400 g', bottle: '1.5 L', jar: '350 g', carton: '1 L', tub: '150 g', slab: '500 g', wedge: '250 g' };

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
function lathe(points, seg = 20) { return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg); }

const D = SHAPE_DIMS;
export const SHAPE_MATS = {}; // shape -> list of material roles for each material index
function build() {
  const G = {};
  // cereal-style carton box: faces +x,-x,+y,-y,+z,-z
  G.box = based(new THREE.BoxGeometry(D.box.w, D.box.h, D.box.d)); SHAPE_MATS.box = ['side', 'side', 'top', 'top', 'label', 'label'];
  G.flatbox = based(new THREE.BoxGeometry(D.flatbox.w, D.flatbox.h, D.flatbox.d)); SHAPE_MATS.flatbox = ['side', 'side', 'label', 'top', 'label', 'label'];
  // pillow bag: a box with bulged faces
  const bag = new THREE.BoxGeometry(D.bag.w, D.bag.h, D.bag.d, 6, 8, 2);
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
  G.can = based(parts([[new THREE.CylinderGeometry(r * 0.97, r * 0.97, D.can.h * 0.9, 18, 1, true).translate(0, D.can.h * 0.5, 0), 0],
    [new THREE.CylinderGeometry(r, r, D.can.h * 0.05, 18).translate(0, D.can.h * 0.975, 0), 1],
    [new THREE.CylinderGeometry(r, r, D.can.h * 0.05, 18).translate(0, D.can.h * 0.025, 0), 1]]));
  SHAPE_MATS.can = ['label', 'metal'];
  // bottle: lathe body + cap
  const br = D.bottle.w / 2, bh = D.bottle.h;
  G.bottle = based(parts([[lathe([[0.001, 0], [br * 0.92, 0.002], [br, 0.01], [br, bh * 0.55], [br * 0.8, bh * 0.7], [br * 0.36, bh * 0.82], [br * 0.33, bh * 0.92], [0.001, bh * 0.92]]), 0],
    [new THREE.CylinderGeometry(br * 0.38, br * 0.38, bh * 0.08, 12).translate(0, bh * 0.96, 0), 1]]));
  SHAPE_MATS.bottle = ['label', 'cap'];
  const jr = D.jar.w / 2, jh = D.jar.h;
  G.jar = based(parts([[lathe([[0.001, 0], [jr, 0.004], [jr, jh * 0.78], [jr * 0.85, jh * 0.86], [0.001, jh * 0.86]]), 0],
    [new THREE.CylinderGeometry(jr * 0.88, jr * 0.88, jh * 0.14, 16).translate(0, jh * 0.93, 0), 1]]));
  SHAPE_MATS.jar = ['label', 'lid'];
  // milk/juice carton with gable top
  const cw = D.carton.w, ch = D.carton.h * 0.8;
  const gable = new THREE.CylinderGeometry(0.001, cw * 0.71, D.carton.h * 0.16, 4, 1).rotateY(Math.PI / 4).translate(0, ch + D.carton.h * 0.08, 0);
  G.carton = based(parts([[new THREE.BoxGeometry(cw, ch, cw).translate(0, ch / 2, 0), 0], [gable, 1], [new THREE.BoxGeometry(cw * 0.95, D.carton.h * 0.05, 0.01).translate(0, ch + D.carton.h * 0.18, 0), 1]]));
  SHAPE_MATS.carton = ['label', 'top'];
  const tr = D.tub.w / 2;
  G.tub = based(parts([[new THREE.CylinderGeometry(tr, tr * 0.85, D.tub.h * 0.92, 18, 1, true).translate(0, D.tub.h * 0.46, 0), 0],
    [new THREE.CylinderGeometry(tr * 1.03, tr * 1.03, D.tub.h * 0.08, 18).translate(0, D.tub.h * 0.96, 0), 1]]));
  SHAPE_MATS.tub = ['label', 'foil'];
  // fruit with a little stem
  G.sphere = based(parts([[new THREE.SphereGeometry(D.sphere.w / 2, 14, 10).scale(1, 0.92, 1), 0], [new THREE.CylinderGeometry(0.003, 0.004, 0.018, 5).translate(0, D.sphere.w * 0.47, 0), 1]]));
  SHAPE_MATS.sphere = ['plain', 'stem'];
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-D.long.w / 2, 0.02, 0), new THREE.Vector3(0, 0.055, 0), new THREE.Vector3(D.long.w / 2, 0.02, 0));
  G.long = based(oneGroup(new THREE.TubeGeometry(curve, 10, D.long.h / 2, 8, false)));
  SHAPE_MATS.long = ['plain'];
  // meat on a foam tray
  G.slab = based(parts([[new THREE.BoxGeometry(D.slab.w, 0.012, D.slab.d).translate(0, 0.006, 0), 1],
    [new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(D.slab.w * 0.85, D.slab.h * 1.4, D.slab.d * 0.85).translate(0, 0.012, 0), 0]]));
  SHAPE_MATS.slab = ['plain', 'tray'];
  G.wedge = based(parts([[new THREE.CylinderGeometry(D.wedge.w / 2, D.wedge.w / 2, D.wedge.h, 16, 1, false, 0, Math.PI * 0.5).translate(0, D.wedge.h / 2, 0), 0]]));
  SHAPE_MATS.wedge = ['plain'];
  return G;
}
export const PRODUCT_GEOS = build();

// ---------------------------------------------------------------- packaging artwork
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
function shade(c, f) { const col = new THREE.Color(c); col.multiplyScalar(f); return '#' + col.getHexString(); }
function lum(c) { const col = new THREE.Color(c); return 0.299 * col.r + 0.587 * col.g + 0.114 * col.b; }
const texCache = new Map();
export function packagingTexture(p) {
  if (texCache.has(p.id)) return texCache.get(p.id);
  const W = 256, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const base = hex(p.color), dark = lum(p.color) < 0.55;
  const ink = dark ? '#ffffff' : '#1e293b';
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, shade(p.color, 1.15)); grad.addColorStop(1, shade(p.color, 0.78));
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // decorative swoosh
  g.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(0, H * 0.62); g.bezierCurveTo(W * 0.3, H * 0.48, W * 0.7, H * 0.8, W, H * 0.6); g.lineTo(W, H); g.lineTo(0, H); g.fill();
  const brand = BRANDS[(p.id.length * 7 + p.id.charCodeAt(0)) % BRANDS.length];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = dark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.6)'; g.fillRect(0, 10, W, 34);
  g.fillStyle = ink; g.font = 'italic 700 22px Georgia, serif'; g.fillText(brand, W / 2, 28);
  g.font = '72px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; g.fillText(p.icon, W / 2, 104);
  const words = p.name.toUpperCase().split(' ');
  const lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : words.length === 2 && p.name.length > 12 ? words : [words.join(' ')];
  g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 5; g.lineJoin = 'round';
  lines.forEach((ln, i) => {
    let size = 34; g.font = `900 ${size}px Nunito, Arial, sans-serif`;
    while (g.measureText(ln).width > W - 20 && size > 14) { size--; g.font = `900 ${size}px Nunito, Arial, sans-serif`; }
    const y = 168 + i * (size + 2) - (lines.length - 1) * 16;
    g.strokeText(ln, W / 2, y); g.fillText(ln, W / 2, y);
  });
  g.font = '700 18px Nunito, Arial'; g.fillStyle = ink; g.textAlign = 'left'; g.fillText(SIZES[p.shape] || '', 12, H - 18);
  // barcode
  g.fillStyle = '#fff'; g.fillRect(W - 78, H - 38, 66, 30); g.fillStyle = '#111';
  for (let i = 0, x = W - 74; x < W - 16; i++) { const w = 1 + ((i * 7 + p.id.length) % 3); g.fillRect(x, H - 35, w, 24); x += w + 1 + (i % 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  texCache.set(p.id, t);
  return t;
}

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
  const label = new THREE.MeshPhysicalMaterial({ map: packagingTexture(p), roughness: p.shape === 'bottle' ? 0.15 : 0.45, clearcoat: p.shape === 'bottle' || p.shape === 'jar' ? 0.8 : 0.2, clearcoatRoughness: 0.3 });
  const side = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5 });
  const top = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).multiplyScalar(0.85), roughness: 0.55 });
  const plain = new THREE.MeshPhysicalMaterial({ color: p.color, roughness: p.cat === 'meat' ? 0.55 : 0.35, clearcoat: p.cat === 'produce' ? 0.5 : 0.1 });
  const cap = new THREE.MeshStandardMaterial({ color: new THREE.Color(p.color).lerp(new THREE.Color(0xffffff), 0.3), roughness: 0.4 });
  const roles = { label, side, top, plain, cap, ...shared };
  arr = SHAPE_MATS[p.shape].map(r => roles[r]);
  matCache.set(p.id, arr);
  return arr;
}
