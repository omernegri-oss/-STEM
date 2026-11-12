// Renderer, camera, lighting with a day/night cycle, and the street environment around the store.
import * as THREE from 'three';
import { B, C, S, mat, makeTree, makeStreetLamp, rng, textTexture, mergeStatic } from './models.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pbr, setTextureQuality } from './textures.js';

// quality: 'low' (no shadows, no effects), 'medium' (shadows, one render pass: the default), 'high' (adds ambient
// occlusion and bloom, which draw the whole scene again and need a good graphics card)
const PIXEL_RATIO = { low: 1, medium: 1.25, high: 1.5 };
export function createScene(canvas, { quality = 'medium' } = {}) {
  const low = quality === 'low';
  let level = quality;
  setTextureQuality(low);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[quality]));
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // AgX: a photographic response curve (keeps bright packaging and lights from looking cartoon-saturated)
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa7bfd6);
  scene.fog = new THREE.Fog(0xb4c4d2, 40, 120);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 300);
  scene.add(camera); // so first-person view models attached to the camera render
  // image-based lighting for realistic reflections on glass, steel and packaging
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.4;
  const hemi = new THREE.HemisphereLight(0xdfe7f0, 0x6f6658, 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1de, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun); scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xc7d2fe, 0.35); fill.position.set(-20, 15, -10); scene.add(fill);

  // interior night lights (no shadows: cheap)
  const interior = [];
  for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xfff1d0, 0, 18, 1.6); l.visible = false; scene.add(l); interior.push(l); }

  const env = new THREE.Group(); scene.add(env);
  const state = { W: 12, D: 9, streetLamps: [], windows: [] };

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    if (composer) { composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); }
  }
  // high quality: ambient occlusion + soft bloom on the fluorescent lights
  let composer = null;
  const makeComposer = () => {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const ao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
    ao.blendIntensity = 0.75;
    composer.addPass(ao);
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.3, 1.8));
    composer.addPass(new OutputPass());
  };
  if (quality === 'high') { try { makeComposer(); } catch (e) { console.warn('post-processing unavailable', e); composer = null; } }
  sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  function render() { if (composer) composer.render(); else renderer.render(scene, camera); }
  window.addEventListener('resize', resize); resize();

  function buildEnvironment(W, D) {
    state.W = W; state.D = D;
    env.clear(); state.streetLamps = []; state.windows = [];
    const r = rng(1234);
    // ground
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), pbr('grass', 260, 260));
    grass.rotation.x = -Math.PI / 2; grass.position.set(W / 2, -0.02, D / 2); grass.receiveShadow = true; env.add(grass);
    // sidewalk with tile texture
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(W + 60, 4.4), pbr('concrete', W + 60, 4.4));
    sw.rotation.x = -Math.PI / 2; sw.position.set(W / 2, 0.005, D + 2.7); sw.receiveShadow = true; env.add(sw);
    B(env, W + 60, 0.14, 0.25, 0, W / 2, 0.05, D + 4.95, { shadow: false, material: pbr('concrete', W + 60, 0.4, { color: 0xbdbbb6 }) });
    // store apron / patio in front
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.4, 0.6), pbr('concrete', W, 0.6, { color: 0xcfcdc8 })); ap.rotation.x = -Math.PI / 2; ap.position.set(W / 2, 0.008, D + 0.8); env.add(ap);
    // road
    const road = new THREE.Mesh(new THREE.PlaneGeometry(W + 140, 7), pbr('asphalt', W + 140, 7));
    road.rotation.x = -Math.PI / 2; road.position.set(W / 2, -0.005, D + 8.6); road.receiveShadow = true; env.add(road);
    for (let x = -60; x < W + 70; x += 6) B(env, 3, 0.01, 0.12, 0xe8e6df, x, 0.005, D + 8.6, { shadow: false, rough: 0.7 });
    for (const z of [D + 5.4, D + 11.8]) B(env, W + 140, 0.01, 0.1, 0xe8e6df, W / 2, 0.004, z, { shadow: false, rough: 0.7 });
    // sidewalk across the street + buildings
    const swM = pbr('concrete', W + 140, 3);
    B(env, W + 140, 0.1, 3, 0, W / 2, 0.03, D + 13.6, { shadow: false, material: swM });
    B(env, W + 140, 0.1, 3, 0, W / 2, 0.03, D + 26.5, { shadow: false, material: swM });
    // a little park between the street and the far buildings
    for (let i = 0; i < 14; i++) { const t = makeTree(r); t.position.set(-20 + r() * (W + 40), 0, D + 16.5 + r() * 7); t.scale.setScalar(0.7 + r() * 0.5); env.add(t); }
    for (let x = -24; x < W + 26; x += 9) { B(env, 1.6, 0.08, 0.5, 0x92400e, x, 0.45, D + 15.6); B(env, 0.1, 0.45, 0.4, 0x334155, x - 0.7, 0.22, D + 15.6); B(env, 0.1, 0.45, 0.4, 0x334155, x + 0.7, 0.22, D + 15.6); }
    const colors = [0xb9a68d, 0xd2cbbd, 0x8f9a9e, 0xc8b8a2, 0xa89f94, 0xd9d3c7, 0x9c8f80]; // plaster tones (brick facades alternate)
    const awnCols = [0x2d4a3a, 0x5a2a2a, 0x24324a, 0x3b3b3b];
    const brickM = pbr('brick', 12, 12), plasterM = pbr('plaster', 12, 12);
    const winOn = new THREE.MeshStandardMaterial({ color: 0x2c3a44, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.08, metalness: 0.4 });
    const winOff = new THREE.MeshStandardMaterial({ color: 0x27323a, roughness: 0.08, metalness: 0.5 });
    state.windows = [winOn]; let wi = 0;
    for (let x = -40, i = 0; x < W + 44; i++) {
      const w = 5 + Math.floor(r() * 5), h = 4 + Math.floor(r() * 7), d = 6;
      const bx = x + w / 2, bz = D + 31;
      const fac = i % 3 === 0 ? brickM : plasterM.clone(); if (fac !== brickM) fac.color.setHex(colors[i % colors.length]);
      B(env, w - 0.3, h, d, 0, bx, h / 2, bz, { material: fac });
      B(env, w - 0.1, 0.3, d + 0.2, 0x55595d, bx, h + 0.15, bz);
      for (let fy = 1.6; fy < h - 0.6; fy += 2.2) for (let fx = -w / 2 + 1.2; fx < w / 2 - 0.6; fx += 1.6) {
        B(env, 0.8, 1.0, 0.05, 0x93c5fd, bx + fx, fy, bz - d / 2 - 0.02, { shadow: false, material: (wi++ * 7919) % 3 ? winOn : winOff });
      }
      if (r() < 0.5) { // awning
        for (let k = 0; k < 4; k++) { const a = B(env, (w - 1) / 4, 0.05, 1.0, k % 2 ? 0xffffff : awnCols[(i + k) % 2 ? i % awnCols.length : (i + 1) % awnCols.length], bx - (w - 1) / 2 + (w - 1) / 8 + k * (w - 1) / 4, 2.6, bz - d / 2 - 0.4, { shadow: false }); a.rotation.x = 0.3; }
      }
      x += w;
    }
    // trees along both sidewalks, avoiding the door and delivery pad
    for (let x = -18; x < W + 20; x += 5.5) {
      if (x > -7 && x < W + 1) continue;
      const t = makeTree(r); t.position.set(x, 0, D + 4.2); env.add(t);
    }
    for (let x = -30; x < W + 34; x += 7) { const t = makeTree(r); t.position.set(x + r() * 2, 0, D + 13.5); t.scale.setScalar(0.8); env.add(t); }
    for (let x = -36; x < W + 40; x += 12) { const l = makeStreetLamp(); l.position.set(x, 0, D + 12.6); l.rotation.y = -Math.PI / 2; env.add(l); state.streetLamps.push(l); }
    // trees and fence behind/beside the store
    for (let i = 0; i < 18; i++) { const t = makeTree(r); t.position.set(-6 - r() * 20 + (i % 2 ? W + 32 * r() + 6 : 0), 0, -4 - r() * 14); t.scale.setScalar(0.8 + r() * 0.6); env.add(t); }
    for (let i = 0; i < 10; i++) { const t = makeTree(r); t.position.set(W / 2 + (r() - 0.5) * (W + 20), 0, -5 - r() * 10); t.scale.setScalar(0.9 + r() * 0.5); env.add(t); }
    // street lamps
    for (let x = -10; x < W + 12; x += 8) {
      if (x > -2 && x < W + 1) continue;
      const l = makeStreetLamp(); l.position.set(x, 0, D + 4.6); l.rotation.y = Math.PI / 2; env.add(l); state.streetLamps.push(l);
    }
    // parking lot to the right with cars
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(10, D + 1), pbr('asphalt', 10, D + 1));
    lot.rotation.x = -Math.PI / 2; lot.position.set(W + 6.5, 0.004, (D + 1) / 2 - 0.3); lot.receiveShadow = true; env.add(lot);
    for (let z = 0.5; z < D; z += 2.4) B(env, 4, 0.01, 0.08, 0xffffff, W + 6.5, 0.008, z, { shadow: false });
    const carCols = [0xc7cacd, 0x1c1f22, 0xf2f2f0, 0x3d4b5c, 0x7a1e1e, 0x5d6166];
    for (let i = 0, z = 1.7; z < D - 1; z += 2.4, i++) { if (r() < 0.35) continue; env.add(makeCar(carCols[i % carCols.length], W + 6.5, z)); }
    // delivery pad markings
    const padTex = textTexture('LOADING ZONE', { size: 60, bg: null, color: '#e9d27a', font: 'Barlow Condensed', weight: 700 });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: 0xe9d27a, transparent: true, opacity: 0.06 }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(2, 0.012, D + 2); env.add(pad);
    for (let k = 0; k < 7; k++) { const h = B(env, 0.1, 0.011, 2.4, 0xd8c26a, 0.4 + k * 0.55, 0.011, D + 2, { shadow: false, rough: 0.8 }); h.rotation.y = 0.6; h.scale.z = 0.8; }
    for (const [x, z, w, d] of [[2, D + 1.02, 4, 0.08], [2, D + 2.98, 4, 0.08], [0.04, D + 2, 0.08, 2], [3.96, D + 2, 0.08, 2]]) B(env, w, 0.012, d, 0xd8c26a, x, 0.012, z, { shadow: false });
    const lbl = new THREE.Mesh(new THREE.PlaneGeometry(3, 3 / padTex.aspect), new THREE.MeshBasicMaterial({ map: padTex.tex, transparent: true }));
    lbl.rotation.x = -Math.PI / 2; lbl.position.set(2, 0.015, D + 3.45); env.add(lbl);
    // overflow pad (beside the building)
    const pad2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 2), new THREE.MeshBasicMaterial({ color: 0xd8c26a, transparent: true, opacity: 0.05 }));
    pad2.rotation.x = -Math.PI / 2; pad2.position.set(-2.5, 0.011, D + 2); env.add(pad2);
    mergeStatic(env);
    // sun & shadow frustum around the store
    const cx = W / 2, cz = D / 2 + 2;
    sun.target.position.set(cx, 0, cz);
    const ext = Math.max(W, D) * 0.8 + 6;
    Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
    sun.shadow.camera.updateProjectionMatrix();
    interior.forEach((l, i) => l.position.set((W / 4) * (1 + (i % 2) * 2), 3.2, (D / 4) * (1 + Math.floor(i / 2) * 2)));
  }

  const SKY = { day: new THREE.Color(0xa7bfd6), dusk: new THREE.Color(0xd9a07a), night: new THREE.Color(0x141c2b), dawn: new THREE.Color(0xe6c0a4) };
  const tmp = new THREE.Color();
  const lightCol = new THREE.Color();
  function updateLighting(minute, phase, style = 'standard', styleColor = '#fff1d0') {
    let h = minute / 60;
    if (phase === 'report' || phase === 'bankrupt') h = 23;
    // night factor 0 day -> 1 night
    let night = 0, dusk = 0;
    if (h < 7.5) { night = 0.25; dusk = 0.6; }
    else if (h < 17) { night = 0; dusk = 0; }
    else if (h < 19.5) { dusk = (h - 17) / 2.5; }
    else if (h < 21.5) { dusk = 1 - (h - 19.5) / 2; night = (h - 19.5) / 2; }
    else { night = 1; }
    tmp.copy(SKY.day).lerp(h < 12 ? SKY.dawn : SKY.dusk, dusk * 0.8).lerp(SKY.night, night * 0.9);
    scene.background.copy(tmp); scene.fog.color.copy(tmp);
    hemi.intensity = 1.15 - night * 0.55;
    sun.intensity = 2.3 * (1 - night * 0.85) * (1 - dusk * 0.25);
    sun.color.setHSL(0.1, 0.6 + dusk * 0.4, 0.92 - dusk * 0.15);
    const ang = (Math.max(7, Math.min(21, h)) - 7) / 14 * Math.PI; // east->west
    sun.position.set(state.W / 2 - Math.cos(ang) * 30, 12 + Math.sin(ang) * 28, state.D / 2 + 22);
    const storeOpen = phase === 'open' || phase === 'closing' || phase === 'prep';
    const base = style === 'gallery' ? 6 : 3.5;
    interior.forEach((l, i) => {
      if (style === 'disco') lightCol.setHSL(((performance.now() / 4000) + i * 0.25) % 1, 0.9, 0.6); else lightCol.set(styleColor);
      l.color.copy(lightCol);
      l.intensity = night * 18 + dusk * 5 + (storeOpen ? base : 0);
      l.visible = l.intensity > 0.05;
    });
    const lampOn = night > 0.3 || dusk > 0.6;
    for (const l of state.streetLamps) l.userData.bulb.material.emissiveIntensity = lampOn ? 1.5 : 0.1;
    for (const w of state.windows) w.emissiveIntensity = lampOn ? 0.7 : 0;
    renderer.toneMappingExposure = 0.98 + night * 0.1;
    return { night, dusk };
  }

  function setQuality(q) {
    if (q === level) return;
    level = q;
    renderer.shadowMap.enabled = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) { sun.shadow.mapSize.set(size, size); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_RATIO[q]));
    scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
    if (q !== 'high') { if (composer) { try { composer.dispose(); } catch {} } composer = null; }
    else if (!composer) { try { makeComposer(); } catch { composer = null; } }
    resize();
  }
  return { renderer, scene, camera, sun, hemi, resize, buildEnvironment, updateLighting, setQuality, render, get composer() { return composer; }, get quality() { return level; } };
}

function makeCar(color, x, z) {
  const g = new THREE.Group();
  B(g, 1.7, 0.5, 3.4, color, 0, 0.45, 0);
  B(g, 1.5, 0.45, 1.8, color, 0, 0.92, -0.2);
  B(g, 1.52, 0.38, 1.6, 0x93c5fd, 0, 0.92, -0.2, { opacity: 0.7, rough: 0.1 });
  for (const sx of [-0.85, 0.85]) for (const sz of [-1.1, 1.1]) { const w = C(g, 0.3, 0.3, 0.2, 0x111827, sx, 0.3, sz, { seg: 12 }); w.rotation.z = Math.PI / 2; }
  g.position.set(x, 0, z); g.rotation.y = Math.PI / 2;
  return g;
}

export function tileTexture(a, b, px = 64, n = 2, opts = {}) {
  const c = document.createElement('canvas'); c.width = c.height = px * n;
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    g.fillStyle = opts.checker ? ((i + j) % 2 ? b : a) : a;
    g.fillRect(i * px, j * px, px, px);
  }
  if (opts.plank) {
    g.fillStyle = a; g.fillRect(0, 0, px * n, px * n);
    for (let j = 0; j < n * 4; j++) {
      g.fillStyle = j % 2 ? a : b; g.fillRect(0, j * px / 4, px * n, px / 4);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, j * px / 4, px * n, 2);
      g.fillRect(((j * 37) % n) * px + px / 2, j * px / 4, 2, px / 4);
    }
  } else if (opts.marble) {
    g.strokeStyle = 'rgba(120,113,108,0.18)'; g.lineWidth = 2;
    for (let k = 0; k < 9; k++) { g.beginPath(); g.moveTo(Math.random() * px * n, 0); g.bezierCurveTo(Math.random() * px * n, px, Math.random() * px * n, px * 1.2, Math.random() * px * n, px * n); g.stroke(); }
  }
  g.strokeStyle = opts.grout || 'rgba(100,116,139,0.25)'; g.lineWidth = 2;
  if (!opts.plank) for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * px, 0); g.lineTo(i * px, px * n); g.stroke(); g.beginPath(); g.moveTo(0, i * px); g.lineTo(px * n, i * px); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export { B, C, S };
