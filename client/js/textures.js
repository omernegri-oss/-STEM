// Procedural "photo-like" materials: every texture is generated in code (no image files), as three maps:
// colour (albedo), surface relief (normal map from a height field) and gloss (roughness map).
// All patterns tile seamlessly. Each kind is generated once and shared; materials only change the repeat.
import * as THREE from 'three';

let SIZE = 512;
export function setTextureQuality(low) { SIZE = low ? 256 : 512; }

// ------------------------------------------------------------------ tileable value noise
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
const fade = (t) => t * t * (3 - 2 * t);
// noise over a grid of `period` cells, wrapping at the edges so the texture tiles
function vnoise(u, v, period, seed) {
  const x = u * period, y = v * period, xi = Math.floor(x), yi = Math.floor(y), xf = fade(x - xi), yf = fade(y - yi);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period, x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed), b = hash(x1, y0, seed), c = hash(x0, y1, seed), d = hash(x1, y1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}
function fbm(u, v, period, octaves = 4, seed = 1) {
  let sum = 0, amp = 0.5, tot = 0, p = period;
  for (let o = 0; o < octaves; o++) { sum += vnoise(u, v, p, seed + o * 17) * amp; tot += amp; amp *= 0.5; p *= 2; }
  return sum / tot;
}
const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];

// ------------------------------------------------------------------ generator
// fn(u, v, out) fills out = [r, g, b, height, roughness] (0..1) for one pixel
function generate(fn, { normal = 2.5, size = SIZE } = {}) {
  const N = size, H = new Float32Array(N * N);
  const cA = document.createElement('canvas'), cR = document.createElement('canvas'), cN = document.createElement('canvas');
  for (const c of [cA, cR, cN]) { c.width = c.height = N; }
  const gA = cA.getContext('2d'), gR = cR.getContext('2d'), gN = cN.getContext('2d');
  const iA = gA.createImageData(N, N), iR = gR.createImageData(N, N), iN = gN.createImageData(N, N);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    fn((x + 0.5) / N, (y + 0.5) / N, out);
    const i = (y * N + x) * 4;
    iA.data[i] = clamp01(out[0]) * 255; iA.data[i + 1] = clamp01(out[1]) * 255; iA.data[i + 2] = clamp01(out[2]) * 255; iA.data[i + 3] = 255;
    const r = clamp01(out[4]) * 255; iR.data[i] = r; iR.data[i + 1] = r; iR.data[i + 2] = r; iR.data[i + 3] = 255;
    H[y * N + x] = out[3];
  }
  // normal map from the height field (wrapping, so it tiles)
  const s = normal * N / 256;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hl = H[y * N + (x + N - 1) % N], hr = H[y * N + (x + 1) % N], hu = H[((y + N - 1) % N) * N + x], hd = H[((y + 1) % N) * N + x];
    let nx = (hl - hr) * s, ny = (hu - hd) * s, nz = 1; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * N + x) * 4;
    iN.data[i] = (nx * 0.5 + 0.5) * 255; iN.data[i + 1] = (ny * 0.5 + 0.5) * 255; iN.data[i + 2] = (nz * 0.5 + 0.5) * 255; iN.data[i + 3] = 255;
  }
  gA.putImageData(iA, 0, 0); gR.putImageData(iR, 0, 0); gN.putImageData(iN, 0, 0);
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  return { map: tex(cA, true), roughnessMap: tex(cR, false), normalMap: tex(cN, false) };
}

// ------------------------------------------------------------------ recipes
// each covers a real-world patch (`meters` wide) so repeats can be set from object sizes
const RECIPES = {
  // vinyl composition tile, the classic supermarket floor: 30 cm off-white tiles with grey chips, waxed
  vct: { meters: 1.2, normal: 1.6, fn(u, v, o) {
    const tu = u * 4, tv = v * 4, ti = Math.floor(tu), tj = Math.floor(tv), fu = tu - ti, fv = tv - tj;
    const tile = hash(ti, tj, 7), base = tile < 0.12 ? 0.80 : tile < 0.2 ? 0.86 : 0.9;
    const chip = vnoise(u, v, 210, 3), chip2 = vnoise(u, v, 330, 5);
    let c = base - (chip > 0.8 ? (chip - 0.8) * 0.9 : 0) - (chip2 > 0.86 ? (chip2 - 0.86) * 0.9 : 0) + (fbm(u, v, 6, 3, 9) - 0.5) * 0.04;
    const edge = Math.min(fu, fv, 1 - fu, 1 - fv), grout = edge < 0.006 ? 1 : 0;
    const scuff = fbm(u, v, 3, 5, 11);
    o[0] = (c - grout * 0.12) * 0.99; o[1] = (c - grout * 0.12) * 0.98; o[2] = (c - grout * 0.12) * 0.95;
    o[3] = grout ? 0.15 : 0.5 + (chip - 0.5) * 0.02; o[4] = 0.16 + scuff * 0.22 + grout * 0.4;
  } },
  // large-format porcelain tiles (60 cm), dark charcoal with a soft stone mottle and thin light grout: modern stores
  porcelain: { meters: 1.2, normal: 1.2, fn(u, v, o) {
    const tu = u * 2, tv = v * 2, ti = Math.floor(tu), tj = Math.floor(tv), fu = tu - ti, fv = tv - tj;
    const tone = (hash(ti, tj, 13) - 0.5) * 0.035, mott = fbm(u, v, 10, 4, 14), speck = vnoise(u, v, 260, 15);
    const edge = Math.min(fu, fv, 1 - fu, 1 - fv), grout = edge < 0.004;
    const c = 0.3 + tone + (mott - 0.5) * 0.06 + (speck > 0.85 ? 0.03 : 0);
    if (grout) { o[0] = 0.42; o[1] = 0.42; o[2] = 0.41; o[3] = 0.1; o[4] = 0.9; return; }
    o[0] = c; o[1] = c; o[2] = c * 1.01; o[3] = 0.5 + (mott - 0.5) * 0.05; o[4] = 0.32 + (mott - 0.5) * 0.12 + fbm(u, v, 3, 4, 16) * 0.12;
  } },
  // painted brick (tinted by the material colour): bricks and mortar in one coat of paint, mortar recessed
  paintbrick: { meters: 1.2, normal: 3, fn(u, v, o) {
    const rows = 16, cols = 5.5, rv = v * rows, row = Math.floor(rv), cu = u * cols + (row % 2 ? 0.5 : 0), ci = Math.floor(cu), fu = cu - ci, fv = rv - row;
    const mortar = Math.min(fu, 1 - fu) < 0.035 || Math.min(fv, 1 - fv) < 0.09;
    const b = hash(ci, row, 63), n = fbm(u, v, 40, 3, 64), roll = fbm(u, v, 12, 2, 65);
    const c = 0.9 + (b - 0.5) * 0.06 + (n - 0.5) * 0.06 + (roll - 0.5) * 0.04 - (mortar ? 0.08 : 0);
    o[0] = c; o[1] = c; o[2] = c; o[3] = mortar ? 0.15 : 0.6 + (n - 0.5) * 0.3; o[4] = 0.8 + n * 0.1;
  } },
  // acoustic ceiling tiles (60 cm) in a white T-bar grid
  ceiling: { meters: 1.2, normal: 3, fn(u, v, o) {
    const tu = u * 2, tv = v * 2, fu = tu - Math.floor(tu), fv = tv - Math.floor(tv), edge = Math.min(fu, fv, 1 - fu, 1 - fv);
    const bar = edge < 0.02, holes = vnoise(u, v, 220, 2) > 0.8 ? 1 : 0, fis = fbm(u, v, 40, 3, 4);
    const c = bar ? 0.95 : 0.88 - holes * 0.18 - (fis - 0.5) * 0.06;
    o[0] = c; o[1] = c; o[2] = c * 0.985; o[3] = bar ? 0.9 : 0.5 - holes * 0.25 + fis * 0.1; o[4] = bar ? 0.45 : 0.95;
  } },
  // painted concrete block walls (40x20 cm blocks, running bond)
  block: { meters: 1.2, normal: 2.2, fn(u, v, o) {
    const rows = 6, cols = 3, rv = v * rows, row = Math.floor(rv), cu = u * cols + (row % 2 ? 0.5 : 0), fu = cu - Math.floor(cu), fv = rv - row;
    const mortar = Math.min(fu, 1 - fu) * 0.4 < 0.004 || Math.min(fv, 1 - fv) * 0.2 < 0.0035;
    const pores = fbm(u, v, 48, 4, 3), blot = fbm(u, v, 4, 3, 8);
    const c = 0.9 - (pores - 0.5) * 0.08 - (blot - 0.5) * 0.04 - (mortar ? 0.04 : 0);
    o[0] = c; o[1] = c; o[2] = c; o[3] = mortar ? 0.2 : 0.55 + (pores - 0.5) * 0.25; o[4] = 0.78 + pores * 0.15;
  } },
  // smooth painted plaster / drywall
  plaster: { meters: 2, normal: 0.8, fn(u, v, o) {
    const n = fbm(u, v, 24, 4, 21), b = fbm(u, v, 3, 3, 22);
    const c = 0.92 - (n - 0.5) * 0.04 - (b - 0.5) * 0.04; o[0] = c; o[1] = c; o[2] = c; o[3] = n; o[4] = 0.85;
  } },
  // brushed stainless / painted steel
  metal: { meters: 0.6, normal: 0.6, fn(u, v, o) {
    const streak = vnoise(u * 0.02, v, 200, 4) * 0.6 + vnoise(u * 0.05, v, 90, 6) * 0.4, wear = fbm(u, v, 5, 3, 7);
    const c = 0.72 + (streak - 0.5) * 0.12; o[0] = c; o[1] = c * 1.01; o[2] = c * 1.03; o[3] = streak; o[4] = 0.28 + streak * 0.2 + wear * 0.1;
  } },
  // oak veneer for counters and desks
  wood: { meters: 1, normal: 1.2, fn(u, v, o) {
    const w = fbm(u, v, 3, 3, 31) * 6, grain = Math.sin((u * 18 + w) * Math.PI * 2) * 0.5 + 0.5, fine = vnoise(u, v * 0.1, 240, 32);
    const t = grain * 0.6 + fine * 0.4;
    o[0] = mix(0.55, 0.68, t); o[1] = mix(0.38, 0.5, t); o[2] = mix(0.22, 0.31, t); o[3] = t * 0.4; o[4] = 0.5 + fine * 0.2;
  } },
  // concrete sidewalk slabs (1.2 m) with tooled joints and exposed aggregate
  concrete: { meters: 2.4, normal: 2.4, fn(u, v, o) {
    const fu = (u * 2) % 1, fv = (v * 2) % 1, joint = Math.min(fu, 1 - fu, fv, 1 - fv) < 0.006;
    const agg = vnoise(u, v, 300, 41), stain = fbm(u, v, 4, 4, 42), pore = fbm(u, v, 60, 3, 43);
    const c = 0.72 - (stain - 0.5) * 0.12 - (agg > 0.82 ? 0.08 : 0) + (pore - 0.5) * 0.05 - (joint ? 0.15 : 0);
    o[0] = c; o[1] = c * 0.99; o[2] = c * 0.96; o[3] = joint ? 0.1 : 0.5 + (pore - 0.5) * 0.3; o[4] = 0.9;
  } },
  // asphalt with aggregate and a few darker patches
  asphalt: { meters: 4, normal: 2, fn(u, v, o) {
    const agg = vnoise(u, v, 420, 51), agg2 = vnoise(u, v, 260, 52), patch = fbm(u, v, 3, 4, 53);
    let c = 0.26 + (agg - 0.5) * 0.08 + (agg2 > 0.8 ? 0.05 : 0) - (patch - 0.5) * 0.06;
    o[0] = c; o[1] = c; o[2] = c * 1.03; o[3] = agg * 0.6 + agg2 * 0.4; o[4] = 0.88 + agg * 0.1;
  } },
  // red brick with mortar (exterior)
  brick: { meters: 1.2, normal: 2.6, fn(u, v, o) {
    const rows = 16, cols = 5.5, rv = v * rows, row = Math.floor(rv), cu = u * cols + (row % 2 ? 0.5 : 0), ci = Math.floor(cu), fu = cu - ci, fv = rv - row;
    const mortar = Math.min(fu, 1 - fu) < 0.03 || Math.min(fv, 1 - fv) < 0.08;
    const b = hash(ci, row, 61), n = fbm(u, v, 40, 3, 62);
    if (mortar) { const m = 0.62 + (n - 0.5) * 0.1; o[0] = m; o[1] = m * 0.97; o[2] = m * 0.92; o[3] = 0.2; o[4] = 0.95; return; }
    o[0] = 0.5 + b * 0.12 + (n - 0.5) * 0.08; o[1] = 0.25 + b * 0.06 + (n - 0.5) * 0.05; o[2] = 0.19 + b * 0.04; o[3] = 0.6 + (n - 0.5) * 0.3; o[4] = 0.85;
  } },
  // lawn
  grass: { meters: 3, normal: 1.5, fn(u, v, o) {
    const blade = vnoise(u, v, 380, 71), clump = fbm(u, v, 8, 4, 72), dry = fbm(u, v, 3, 3, 73);
    const g = 0.36 + blade * 0.14 + (clump - 0.5) * 0.12;
    o[0] = g * mix(0.48, 0.75, dry); o[1] = g; o[2] = g * 0.35; o[3] = blade; o[4] = 0.95;
  } },
  // woven fabric (tinted by the material colour) for clothes
  fabric: { meters: 0.25, normal: 1.2, fn(u, v, o) {
    const wx = Math.sin(u * Math.PI * 2 * 64) * 0.5 + 0.5, wy = Math.sin(v * Math.PI * 2 * 64) * 0.5 + 0.5, n = vnoise(u, v, 128, 81);
    const t = ((Math.floor(u * 64) + Math.floor(v * 64)) % 2 ? wx : wy) * 0.6 + n * 0.4;
    const c = 0.86 + t * 0.14; o[0] = c; o[1] = c; o[2] = c; o[3] = t; o[4] = 0.92;
  } },
  // denim twill
  denim: { meters: 0.25, normal: 1.4, fn(u, v, o) {
    const tw = Math.sin((u + v) * Math.PI * 2 * 70) * 0.5 + 0.5, n = vnoise(u, v, 160, 91), fadeN = fbm(u, v, 3, 3, 92);
    const c = 0.8 + tw * 0.15 + (n - 0.5) * 0.1 + fadeN * 0.1; o[0] = c; o[1] = c; o[2] = c; o[3] = tw; o[4] = 0.9;
  } },
  // rubber anti-fatigue mat / checkout belt
  rubber: { meters: 0.5, normal: 2, fn(u, v, o) {
    const ribs = Math.sin(v * Math.PI * 2 * 40) * 0.5 + 0.5, n = vnoise(u, v, 200, 101);
    const c = 0.16 + n * 0.04; o[0] = c; o[1] = c; o[2] = c; o[3] = ribs; o[4] = 0.75;
  } },
};

const cache = new Map();
function base(kind) {
  if (!cache.has(kind)) { const r = RECIPES[kind]; cache.set(kind, { ...generate(r.fn, { normal: r.normal }), meters: r.meters }); }
  return cache.get(kind);
}
// textures for a surface of w x h metres (repeat follows the real size of the pattern)
export function surfaceMaps(kind, w = 1, h = 1) {
  const b = base(kind), rx = w / b.meters, ry = h / b.meters;
  const out = {};
  for (const k of ['map', 'normalMap', 'roughnessMap']) { const t = b[k].clone(); t.repeat.set(rx, ry); t.needsUpdate = true; out[k] = t; }
  return out;
}
// a ready material: pbr('vct', 12, 9, { color: 0xffffff })
export function pbr(kind, w = 1, h = 1, opts = {}) {
  const { normalScale = 1, ...rest } = opts;
  const m = new THREE.MeshStandardMaterial({ ...surfaceMaps(kind, w, h), roughness: 1, metalness: 0, ...rest });
  m.normalScale.set(normalScale, normalScale);
  return m;
}
// shared materials for many small objects whose UVs are 0..1 per face (boxes): one repeat for all
const shared = new Map();
export function pbrShared(kind, key, repeat = 1, opts = {}) {
  const k = kind + '|' + key + '|' + repeat;
  if (!shared.has(k)) shared.set(k, pbr(kind, repeat * base(kind).meters, repeat * base(kind).meters, opts));
  return shared.get(k);
}
export const TEXTURE_KINDS = Object.keys(RECIPES);
export { hex as hexToRgb };
