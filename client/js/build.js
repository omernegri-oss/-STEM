// Build mode: place furniture from a carried box, and move / rotate / pack / sell / upgrade fixtures.
// Buying happens on the store computer; furniture arrives in boxes you carry to where you want it.
import * as THREE from 'three';
import { FURNITURE, FIXTURE_UPGRADES, PRODUCT_MAP, FLOOR_H, fmtMoney, slotCap } from '/shared/data.js';
import { footprint, frontTiles, backTiles, needsBack, center, dims } from '/shared/grid.js';
import { makeFurniture, ghostify } from './models.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BuildMode {
  constructor({ scene, camera, world, net, G, ui, rig }) {
    Object.assign(this, { scene, camera, world, net, G, ui, rig });
    this.active = false; this.placing = null; this.rot = 0; this.moving = null; this.selected = null; this.floor = 0;
    this.focus = { x: 6, z: 5, y: 0 };
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ghost = null; this.ghostKey = '';
    this.tiles = new THREE.Group(); scene.add(this.tiles);
    this.tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    const tm = (c, o = 0.35) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
    this.tileMats = { ok: tm(0x22c55e), bad: tm(0xef4444), front: tm(0xfacc15, 0.4), back: tm(0x60a5fa, 0.4), sel: tm(0xf97316) };
    this.gridLines = null;
    this.el = document.getElementById('buildbar');
    this.hint = document.createElement('div'); this.hint.id = 'build-hint'; this.hint.className = 'hidden';
    document.getElementById('hud').appendChild(this.hint);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  // edit mode (B) or placing mode (carrying a furniture box + E)
  enter(me, placingType = null) {
    this.placing = placingType; this.floor = me.floor || 0;
    if (!this.active) {
      this.active = true; this.focus = { x: me.x, z: me.z, y: this.floor * FLOOR_H }; this.rig.build = true;
      this.savedPitch = this.rig.pitch; this.savedDist = this.rig.dist;
      this.rig.pitch = 1.15; this.rig.dist = Math.max(14, (this.G.world?.w || 12) * 0.9);
    }
    this.focus.y = this.floor * FLOOR_H;
    this.plane.constant = -this.floor * FLOOR_H;
    this.el.classList.remove('hidden'); this.hint.classList.remove('hidden');
    this.lastHtml = ''; this.render(); this.showGrid(true);
  }
  exit() {
    if (!this.active) return;
    this.active = false; this.rig.build = false; this.rig.pitch = this.savedPitch; this.rig.dist = this.savedDist;
    this.placing = null; this.moving = null; this.selected = null;
    this.el.classList.add('hidden'); this.hint.classList.add('hidden'); this.lastHtml = '';
    this.clearGhost(); this.tiles.clear(); this.showGrid(false);
  }
  toggle(me) { this.active ? this.exit() : this.enter(me); }

  showGrid(on) {
    if (this.gridLines) { this.scene.remove(this.gridLines); this.gridLines = null; }
    if (!on || !this.G.world) return;
    const W = this.G.world.w, D = this.G.world.d, y = this.floor * FLOOR_H + 0.015, pts = [];
    for (let x = 0; x <= W; x++) pts.push(x, y, 0, x, y, D);
    for (let z = 0; z <= D; z++) pts.push(0, y, z, W, y, z);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.gridLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.18 }));
    this.scene.add(this.gridLines);
  }
  clearGhost() { if (this.ghost) { this.scene.remove(this.ghost); this.ghost = null; this.ghostKey = ''; } }
  cursorPoint(input) {
    this.ray.setFromCamera({ x: input.mouse.nx, y: input.mouse.ny }, this.camera);
    const p = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, p) ? p : null;
  }

  update(dt, input) {
    if (!this.active || !this.G.world) return;
    const W = this.G.world;
    if (this.placing && !(this.G.carry || []).includes('f:' + this.placing)) { this.exit(); return; } // box placed or dropped
    if (!input.typing()) {
      let mx = 0, mz = 0;
      if (input.down('w') || input.down('arrowup')) mz -= 1; if (input.down('s') || input.down('arrowdown')) mz += 1;
      if (input.down('a') || input.down('arrowleft')) mx -= 1; if (input.down('d') || input.down('arrowright')) mx += 1;
      const c = Math.cos(this.rig.yaw), s = Math.sin(this.rig.yaw), sp = 12 * dt;
      this.focus.x = Math.min(W.w + 4, Math.max(-4, this.focus.x + (mx * c + mz * s) * sp));
      this.focus.z = Math.min(W.d + 6, Math.max(-2, this.focus.z + (-mx * s + mz * c) * sp));
      if (input.hit('r')) this.rotate();
      if (input.hit('escape')) { if (this.moving) { this.moving = null; this.render(); } else if (this.selected && !this.placing) { this.selected = null; this.render(); } else this.exit(); return; }
      if (this.selected && !this.moving && !this.placing) {
        if (input.hit('m')) this.startMove();
        if (input.hit('x') || input.hit('delete')) this.sell();
        if (input.hit('p')) this.pack();
        if (input.hit('u')) this.upgrade();
      }
    }
    const p = this.cursorPoint(input);
    this.tiles.clear();
    const grid = this.world.gridFor(this.floor);
    const placingType = this.placing || (this.moving ? W.furniture.find(f => f.id === this.moving)?.type : null);
    const yb = this.floor * FLOOR_H;
    if (placingType && p) {
      const [w, d] = dims(placingType, this.rot);
      const x = Math.floor(p.x - w / 2 + 0.5), z = Math.floor(p.z - d / 2 + 0.5);
      const res = grid.canPlace(W.furniture, placingType, x, z, this.rot, this.moving || null);
      const key = `${placingType}|${res.ok}`;
      if (key !== this.ghostKey) { this.clearGhost(); this.ghost = ghostify(makeFurniture(placingType), res.ok); this.ghostKey = key; this.scene.add(this.ghost); }
      const [cx, cz] = center(placingType, x, z, this.rot);
      this.ghost.position.set(cx, yb + 0.02 + Math.sin(performance.now() / 200) * 0.02, cz); this.ghost.rotation.y = this.rot * Math.PI / 2;
      for (const [tx, tz] of footprint(placingType, x, z, this.rot)) this.addTile(tx, tz, res.ok ? 'ok' : 'bad');
      for (const [tx, tz] of frontTiles(placingType, x, z, this.rot)) this.addTile(tx, tz, 'front');
      if (needsBack(placingType)) for (const [tx, tz] of backTiles(placingType, x, z, this.rot)) this.addTile(tx, tz, 'back');
      this.hint.innerHTML = res.ok ? `<span class="good">Click to ${this.moving ? 'move it here' : 'place it'}</span> · <b>R</b> rotate · <b>Esc</b> cancel · <span style="color:#fde047">■</span> customers${needsBack(placingType) ? ' · <span style="color:#93c5fd">■</span> staff' : ''}`
        : `<span class="bad">✖ ${esc(res.reason)}</span> · <b>R</b> rotate · <b>Esc</b> cancel`;
      const click = input.mouse.clicked;
      if (click && click.button === 0) {
        if (!res.ok) this.ui.error(res.reason);
        else if (this.moving) { this.net.act('move', { id: this.moving, x, z, rot: this.rot }); this.moving = null; this.clearGhost(); this.render(); }
        else this.net.act('place', { x, z, rot: this.rot });
      }
      if (click && click.button === 2) { if (this.moving) { this.moving = null; this.render(); } else this.exit(); }
    } else {
      this.clearGhost();
      let hover = null;
      if (p) { const o = grid.ownerAt(Math.floor(p.x), Math.floor(p.z)); if (o >= 0) hover = W.furniture.find(f => f.id === o); }
      const sel = this.selected ? W.furniture.find(f => f.id === this.selected) : null;
      if (this.selected && !sel) { this.selected = null; this.render(); }
      for (const f of [hover, sel]) if (f) for (const [tx, tz] of footprint(f.type, f.x, f.z, f.rot)) this.addTile(tx, tz, 'sel');
      this.hint.innerHTML = sel ? `<b>${esc(FURNITURE[sel.type].name)}</b> · <b>M</b> move · <b>R</b> rotate · <b>P</b> pack into box · <b>X</b> sell · <b>Esc</b> deselect`
        : 'Click a fixture to edit it · <b>WASD</b> pan · <b>B</b> exit · buy new things on the computer';
      const click = input.mouse.clicked;
      if (click && click.button === 0) { this.selected = hover ? hover.id : null; if (hover) this.rot = hover.rot; this.render(); }
    }
    this.tiles.position.y = yb;
  }

  addTile(x, z, kind) { const m = new THREE.Mesh(this.tileGeo, this.tileMats[kind]); m.position.set(x + 0.5, 0.03, z + 0.5); this.tiles.add(m); }
  rotate() {
    if (this.placing || this.moving) { this.rot = (this.rot + 1) % 4; return; }
    const f = this.selectedFixture(); if (!f) return;
    this.net.act('move', { id: f.id, x: f.x, z: f.z, rot: (f.rot + 1) % 4 });
  }
  startMove() { const f = this.selectedFixture(); if (!f) return; this.moving = f.id; this.rot = f.rot; this.render(); }
  sell() { const f = this.selectedFixture(); if (!f) return; this.net.act('remove', { id: f.id }); this.selected = null; this.render(); }
  pack() { const f = this.selectedFixture(); if (!f) return; this.net.act('pack', { id: f.id }); this.selected = null; this.render(); }
  upgrade() { const f = this.selectedFixture(); if (!f) return; this.net.act('upgradeFixture', { id: f.id }); }
  selectedFixture() { return this.selected && this.G.world ? this.G.world.furniture.find(f => f.id === this.selected) : null; }

  onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'rotate') this.rotate();
    else if (a === 'move') this.startMove();
    else if (a === 'sell') this.sell();
    else if (a === 'pack') this.pack();
    else if (a === 'upgrade') this.upgrade();
    else if (a === 'clearLabel') this.net.act('clearLabel', { id: this.selected, slot: +b.dataset.v });
    else if (a === 'close') this.exit();
  }

  render() {
    if (!this.active) return;
    const M = this.G.meta || {}, lvl = M.level || 1, cash = M.cash || 0;
    let h = `<div class="bb-head"><h3>🛠️ ${this.placing ? 'Placing' : 'Arrange'} <button class="x" style="float:right" data-act="close">✕</button></h3><p>Floor ${this.floor + 1} · arrange your store however you like.</p></div>`;
    if (this.placing) {
      const def = FURNITURE[this.placing];
      h += `<div class="sel-card"><h4>${def.icon} ${esc(def.name)}</h4><div>${esc(def.desc)}</div><div class="note" style="margin-top:6px">Click on the floor to place it. R rotates. Esc keeps it in your hands.</div></div>`;
    }
    const sel = this.selectedFixture();
    if (sel && !this.placing) {
      const def = FURNITURE[sel.type]; const up = FIXTURE_UPGRADES[def.kind];
      h += `<div class="sel-card"><h4>${def.icon} ${esc(def.name)} ${sel.upg ? '⭐' : ''}</h4><div>${esc(def.desc)}</div>`;
      if (sel.slots) {
        h += `<div style="margin-top:6px">`;
        sel.slots.forEach((s, i) => {
          const p = s.pid ? PRODUCT_MAP[s.pid] : null;
          h += `<div class="kv"><span>Slot ${i + 1}: ${p ? esc(p.name) : '<i>empty</i>'}${s.expired ? ' 🤢' : ''}</span><b>${s.qty}/${p ? slotCap(sel.type, p.id) : '–'}${p && s.qty === 0 ? ` <button class="btn small" data-act="clearLabel" data-v="${i}" title="Free this slot for any product">↺</button>` : ''}</b></div>`;
        });
        h += `</div>`;
      }
      if (sel.temp !== undefined) h += `<div class="kv"><span>Temperature</span><b>${sel.temp}°C ${sel.broken ? '⚠️ broken' : '✅'}</b></div>`;
      h += `<div class="btns"><button class="btn small" data-act="move">✋ Move (M)</button><button class="btn small" data-act="rotate">🔄 Rotate (R)</button><button class="btn small" data-act="pack">📦 Pack into box (P)</button>`;
      if (up && !sel.upg) h += `<button class="btn small blue" data-act="upgrade" ${lvl < up.level || cash < up.cost ? 'disabled' : ''} title="${esc(up.desc)}">⬆️ ${esc(up.name)} ${fmtMoney(up.cost)}${lvl < up.level ? ` (Lv${up.level})` : ''}</button>`;
      h += `<button class="btn small bad" data-act="sell">♻️ Sell +${fmtMoney(Math.round(def.cost * 0.5))}</button></div>`;
      h += `<p class="note">Pack it into a box to carry it somewhere else — even upstairs.</p></div>`;
    } else if (!this.placing) h += `<div class="sel-card">Click any fixture on this floor to move, rotate, pack or sell it.<br><br>New shelves, fridges, decorations and plants are bought on the 🖥️ store computer and delivered in boxes.</div>`;
    if (h !== this.lastHtml) { this.el.innerHTML = h; this.lastHtml = h; }
  }
}
