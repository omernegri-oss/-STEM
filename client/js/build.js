// Build mode: shop for fixtures, placement preview with validity, move / rotate / upgrade / sell, styles, expansion.
import * as THREE from 'three';
import { FURNITURE, FIXTURE_UPGRADES, FLOORS, WALLS, LIGHTS, EXPANSIONS, PRODUCT_MAP, fmtMoney } from '/shared/data.js';
import { footprint, frontTiles, backTiles, needsBack, center, dims } from '/shared/grid.js';
import { makeFurniture, ghostify } from './models.js';

const TABS = {
  fixtures: { name: '🗄️ Shelving', types: ['shelf', 'shelf_large', 'endcap', 'produce', 'fridge', 'fridge_large', 'freezer', 'freezer_upright'] },
  service:  { name: '🛒 Service', types: ['checkout', 'selfcheckout', 'butcher', 'deli', 'rack', 'bin'] },
  decor:    { name: '🪴 Decor', types: ['plant', 'lamp', 'sign', 'bench', 'balloons', 'vending', 'flowers', 'fountain', 'neon', 'statue'] },
  style:    { name: '🎨 Style' },
  expand:   { name: '📐 Expand' },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class BuildMode {
  constructor({ scene, camera, world, net, G, ui, rig }) {
    Object.assign(this, { scene, camera, world, net, G, ui, rig });
    this.active = false; this.tab = 'fixtures'; this.type = null; this.rot = 0; this.moving = null; this.selected = null;
    this.focus = { x: 6, z: 5 };
    this.ray = new THREE.Raycaster(); this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.ghost = null; this.ghostKey = '';
    this.tiles = new THREE.Group(); scene.add(this.tiles);
    this.tileGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
    this.tileMats = { ok: new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false }),
      bad: new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.35, depthWrite: false }),
      front: new THREE.MeshBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.4, depthWrite: false }),
      back: new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.4, depthWrite: false }),
      sel: new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.35, depthWrite: false }) };
    this.gridLines = null;
    this.el = document.getElementById('buildbar');
    this.hint = document.createElement('div'); this.hint.id = 'build-hint'; this.hint.className = 'hidden';
    document.getElementById('hud').appendChild(this.hint);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  enter(px, pz) {
    if (this.active) return;
    this.active = true; this.focus = { x: px, z: pz }; this.rig.build = true;
    this.savedPitch = this.rig.pitch; this.savedDist = this.rig.dist;
    this.rig.pitch = 1.15; this.rig.dist = Math.max(16, (this.G.world?.w || 12) * 1.15);
    this.el.classList.remove('hidden'); this.hint.classList.remove('hidden');
    this.render(); this.showGrid(true);
  }
  exit() {
    if (!this.active) return;
    this.active = false; this.rig.build = false; this.rig.pitch = this.savedPitch; this.rig.dist = this.savedDist;
    this.type = null; this.moving = null; this.selected = null;
    this.el.classList.add('hidden'); this.hint.classList.add('hidden'); this.lastHtml = '';
    this.clearGhost(); this.tiles.clear(); this.showGrid(false);
  }
  toggle(px, pz) { this.active ? this.exit() : this.enter(px, pz); }

  showGrid(on) {
    if (this.gridLines) { this.scene.remove(this.gridLines); this.gridLines = null; }
    if (!on || !this.G.world) return;
    const W = this.G.world.w, D = this.G.world.d, pts = [];
    for (let x = 0; x <= W; x++) pts.push(x, 0.015, 0, x, 0.015, D);
    for (let z = 0; z <= D; z++) pts.push(0, 0.015, z, W, 0.015, z);
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
    // pan the build camera
    if (!input.typing()) {
      let mx = 0, mz = 0;
      if (input.down('w') || input.down('arrowup')) mz -= 1; if (input.down('s') || input.down('arrowdown')) mz += 1;
      if (input.down('a') || input.down('arrowleft')) mx -= 1; if (input.down('d') || input.down('arrowright')) mx += 1;
      const c = Math.cos(this.rig.yaw), s = Math.sin(this.rig.yaw), sp = 12 * dt;
      this.focus.x = Math.min(W.w + 4, Math.max(-4, this.focus.x + (mx * c + mz * s) * sp));
      this.focus.z = Math.min(W.d + 6, Math.max(-2, this.focus.z + (-mx * s + mz * c) * sp));
      if (input.hit('r')) this.rotate();
      if (input.hit('escape')) { if (this.type || this.moving) { this.type = null; this.moving = null; this.render(); } else if (this.selected) { this.selected = null; this.render(); } else this.exit(); return; }
      if (this.selected && !this.moving) {
        if (input.hit('m')) this.startMove();
        if (input.hit('delete') || input.hit('x') || input.hit('backspace')) this.sell();
        if (input.hit('u')) this.upgrade();
      }
    }
    const p = this.cursorPoint(input);
    this.tiles.clear();
    const placing = this.type || this.moving;
    if (placing && p) {
      const f0 = this.moving ? W.furniture.find(f => f.id === this.moving) : null;
      const type = this.moving ? f0?.type : this.type;
      if (!type) { this.moving = null; return; }
      const [w, d] = dims(type, this.rot);
      const x = Math.floor(p.x - w / 2 + 0.5), z = Math.floor(p.z - d / 2 + 0.5);
      const res = this.world.grid.canPlace(W.furniture, type, x, z, this.rot, this.moving || null);
      const cost = this.moving ? 0 : FURNITURE[type].cost;
      const afford = (this.G.meta?.cash ?? 0) >= cost;
      const ok = res.ok && afford;
      const key = `${type}|${ok}`;
      if (key !== this.ghostKey) { this.clearGhost(); this.ghost = ghostify(makeFurniture(type), ok); this.ghostKey = key; this.scene.add(this.ghost); }
      const [cx, cz] = center(type, x, z, this.rot);
      this.ghost.position.set(cx, 0.02 + Math.sin(performance.now() / 200) * 0.02, cz); this.ghost.rotation.y = this.rot * Math.PI / 2;
      for (const [tx, tz] of footprint(type, x, z, this.rot)) this.addTile(tx, tz, ok ? 'ok' : 'bad');
      for (const [tx, tz] of frontTiles(type, x, z, this.rot)) this.addTile(tx, tz, 'front');
      if (needsBack(type)) for (const [tx, tz] of backTiles(type, x, z, this.rot)) this.addTile(tx, tz, 'back');
      this.hint.innerHTML = ok ? `<span class="good">Click to ${this.moving ? 'move here' : 'place for ' + fmtMoney(cost)}</span> · <b>R</b> rotate · <b>Esc</b> cancel · <span style="color:#fde047">■</span> customer side${needsBack(type) ? ' · <span style="color:#93c5fd">■</span> staff side' : ''}`
        : `<span class="bad">✖ ${!afford ? 'Not enough cash' : esc(res.reason)}</span> · <b>R</b> rotate · <b>Esc</b> cancel`;
      const click = input.mouse.clicked;
      if (click && click.button === 0) {
        if (ok) {
          if (this.moving) { this.net.act('move', { id: this.moving, x, z, rot: this.rot }); this.moving = null; this.clearGhost(); this.render(); }
          else this.net.act('place', { type, x, z, rot: this.rot });
        } else this.ui.error(!afford ? 'Not enough cash!' : res.reason);
      }
      if (click && click.button === 2) { this.type = null; this.moving = null; this.clearGhost(); this.render(); }
    } else {
      this.clearGhost();
      let hover = null;
      if (p) { const o = this.world.grid.ownerAt(Math.floor(p.x), Math.floor(p.z)); if (o >= 0) hover = W.furniture.find(f => f.id === o); }
      const sel = this.selected ? W.furniture.find(f => f.id === this.selected) : null;
      if (this.selected && !sel) { this.selected = null; this.render(); }
      for (const f of [hover, sel]) if (f) for (const [tx, tz] of footprint(f.type, f.x, f.z, f.rot)) this.addTile(tx, tz, 'sel');
      this.hint.innerHTML = sel ? `<b>${esc(FURNITURE[sel.type].name)}</b> · <b>M</b> move · <b>R</b> rotate · <b>U</b> upgrade · <b>X</b> sell · <b>Esc</b> deselect`
        : 'Pick something from the shop to place it, or click a fixture to edit it · <b>WASD</b> pan · <b>B</b> exit';
      const click = input.mouse.clicked;
      if (click && click.button === 0) { this.selected = hover ? hover.id : null; if (hover) this.rot = hover.rot; this.render(); }
    }
  }

  addTile(x, z, kind) {
    const m = new THREE.Mesh(this.tileGeo, this.tileMats[kind]); m.position.set(x + 0.5, 0.03 + (kind === 'front' || kind === 'back' ? 0.002 : 0), z + 0.5); this.tiles.add(m);
  }

  rotate() {
    if (this.type || this.moving) { this.rot = (this.rot + 1) % 4; return; }
    const f = this.selectedFixture(); if (!f) return;
    this.net.act('move', { id: f.id, x: f.x, z: f.z, rot: (f.rot + 1) % 4 });
  }
  startMove() { const f = this.selectedFixture(); if (!f) return; this.moving = f.id; this.rot = f.rot; this.type = null; this.render(); }
  sell() { const f = this.selectedFixture(); if (!f) return; this.net.act('remove', { id: f.id }); this.selected = null; this.render(); }
  upgrade() { const f = this.selectedFixture(); if (!f) return; this.net.act('upgradeFixture', { id: f.id }); }
  selectedFixture() { return this.selected && this.G.world ? this.G.world.furniture.find(f => f.id === this.selected) : null; }

  onClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act, v = b.dataset.v;
    if (a === 'tab') { this.tab = v; this.type = null; this.render(); }
    else if (a === 'pick') { const def = FURNITURE[v]; if ((this.G.meta?.level || 1) < def.level) { this.ui.error(`Unlocks at level ${def.level}`); return; } this.type = this.type === v ? null : v; this.moving = null; this.selected = null; this.render(); }
    else if (a === 'rotate') this.rotate();
    else if (a === 'move') this.startMove();
    else if (a === 'sell') this.sell();
    else if (a === 'upgrade') this.upgrade();
    else if (a === 'floor') this.net.act('floor', { id: v });
    else if (a === 'wall') this.net.act('wall', { id: v });
    else if (a === 'light') this.net.act('lighting', { id: v });
    else if (a === 'expand') this.net.act('expand');
    else if (a === 'clearLabel') this.net.act('clearLabel', { id: this.selected, slot: +v });
    else if (a === 'close') this.exit();
  }

  render() {
    if (!this.active) return;
    const M = this.G.meta || {}, lvl = M.level || 1, cash = M.cash || 0;
    let h = `<div class="bb-head"><h3>🛠️ Build Mode <button class="x" style="float:right" data-act="close">✕</button></h3><p>Shared with your team — everyone can build.</p></div><div class="bb-tabs">`;
    for (const [k, t] of Object.entries(TABS)) h += `<button data-act="tab" data-v="${k}" class="${this.tab === k ? 'sel' : ''}">${t.name}</button>`;
    h += `</div>`;
    const sel = this.selectedFixture();
    if (sel) {
      const def = FURNITURE[sel.type]; const up = FIXTURE_UPGRADES[def.kind];
      const full = M.phase === 'prep' && sel.boughtDay === M.day && sel.boughtPhase === 'prep';
      const refund = Math.round(def.cost * (full ? 1 : 0.5));
      h += `<div class="sel-card"><h4>${def.icon} ${esc(def.name)} ${sel.upg ? '⭐' : ''}</h4><div>${esc(def.desc)}</div>`;
      if (sel.slots) {
        h += `<div style="margin-top:6px">`;
        sel.slots.forEach((s, i) => {
          const p = s.pid ? PRODUCT_MAP[s.pid] : null;
          h += `<div class="kv"><span>Slot ${i + 1}: ${p ? p.icon + ' ' + esc(p.name) : '<i>empty</i>'}${s.expired ? ' 🤢' : ''}</span><b>${s.qty}/${def.cap}${p && s.qty === 0 ? ` <button class="btn small" data-act="clearLabel" data-v="${i}" title="Free this slot for any product">↺</button>` : ''}</b></div>`;
        });
        h += `</div>`;
      }
      if (sel.temp !== undefined) h += `<div class="kv"><span>Temperature</span><b>${sel.temp}°C ${sel.broken ? '⚠️ broken' : '✅'}</b></div>`;
      h += `<div class="btns"><button class="btn small" data-act="move">✋ Move (M)</button><button class="btn small" data-act="rotate">🔄 Rotate (R)</button>`;
      if (up && !sel.upg) h += `<button class="btn small blue" data-act="upgrade" ${lvl < up.level || cash < up.cost ? 'disabled' : ''} title="${esc(up.desc)}">⬆️ ${esc(up.name)} ${fmtMoney(up.cost)}${lvl < up.level ? ` (Lv${up.level})` : ''}</button>`;
      h += `<button class="btn small bad" data-act="sell">♻️ Sell +${fmtMoney(refund)}</button></div>`;
      if (up && !sel.upg) h += `<div class="note" style="margin-top:4px">${esc(up.desc)}</div>`;
      h += `</div>`;
    }
    h += `<div class="bb-list">`;
    const t = TABS[this.tab];
    if (t.types) {
      for (const type of t.types) {
        const def = FURNITURE[type]; const locked = lvl < def.level;
        h += `<button class="bi ${this.type === type ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="pick" data-v="${type}"><span class="ic">${def.icon}</span><span class="tx"><b>${esc(def.name)}</b>${locked ? `🔒 Level ${def.level}` : esc(def.desc)}${def.slots ? `<br>${def.slots}×${def.cap} units` : ''}${def.power ? ` · ⚡$${def.power}/day` : ''}${def.appeal > 0 ? ` · ✨+${def.appeal}` : ''}</span><span class="pr">${fmtMoney(def.cost)}</span></button>`;
      }
    } else if (this.tab === 'style') {
      h += `<div class="section-title" style="margin:4px">Floors</div>`;
      for (const f of FLOORS) {
        const owned = (M.ownedFloors || []).includes(f.id), locked = lvl < f.level;
        h += `<button class="bi ${M.floor === f.id ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="floor" data-v="${f.id}"><span class="ic"><div class="swatch" style="background:repeating-conic-gradient(${f.a} 0 25%, ${f.b} 0 50%) 0 0/16px 16px;width:30px"></div></span><span class="tx"><b>${esc(f.name)}</b>${locked ? `🔒 Level ${f.level}` : owned ? 'Owned' : ''}</span><span class="pr">${owned ? '✓' : fmtMoney(f.cost)}</span></button>`;
      }
      h += `<div class="section-title" style="margin:4px">Walls</div>`;
      for (const w of WALLS) {
        const owned = (M.ownedWalls || []).includes(w.id), locked = lvl < w.level;
        h += `<button class="bi ${M.wall === w.id ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="wall" data-v="${w.id}"><span class="ic"><div class="swatch" style="background:${w.color};width:30px"></div></span><span class="tx"><b>${esc(w.name)}</b>${locked ? `🔒 Level ${w.level}` : owned ? 'Owned' : ''}</span><span class="pr">${owned ? '✓' : fmtMoney(w.cost)}</span></button>`;
      }
      h += `<div class="section-title" style="margin:4px">Lighting</div>`;
      for (const l of LIGHTS) {
        const owned = (M.ownedLights || []).includes(l.id), locked = lvl < l.level;
        const sw = l.color === 'rainbow' ? 'linear-gradient(90deg,#f43f5e,#facc15,#22c55e,#3b82f6,#a855f7)' : l.color;
        h += `<button class="bi ${M.lighting === l.id ? 'sel' : ''} ${locked ? 'locked' : ''}" data-act="light" data-v="${l.id}"><span class="ic"><div class="swatch" style="background:${sw};width:30px"></div></span><span class="tx"><b>${l.icon} ${esc(l.name)}</b>${locked ? `🔒 Level ${l.level}` : owned ? 'Owned' : ''}${l.appeal ? ` · ✨+${l.appeal}` : ''}</span><span class="pr">${owned ? '✓' : fmtMoney(l.cost)}</span></button>`;
      }
    } else if (this.tab === 'expand') {
      const cur = EXPANSIONS[M.expansion || 0], next = EXPANSIONS[(M.expansion || 0) + 1];
      h += `<div class="sel-card"><h4>Current size: ${cur.w}×${cur.d}</h4><div>Rent: ${fmtMoney(cur.rent)}/day</div></div>`;
      if (next) {
        const locked = lvl < next.level;
        h += `<div class="sel-card"><h4>📐 Next: ${next.w}×${next.d}</h4><div>+${next.w * next.d - cur.w * cur.d} tiles of floor space, more customers and more staff slots.<br>Rent becomes ${fmtMoney(next.rent)}/day.</div>
          <div class="btns"><button class="btn primary" data-act="expand" ${locked || cash < next.cost ? 'disabled' : ''}>${locked ? `🔒 Level ${next.level}` : `Expand for ${fmtMoney(next.cost)}`}</button></div>
          <div class="note">Expand while the store is closed (before opening).</div></div>`;
      } else h += `<div class="sel-card"><h4>🏟️ Maximum size reached!</h4></div>`;
    }
    h += `</div>`;
    if (h !== this.lastHtml) { const sc = this.el.querySelector('.bb-list')?.scrollTop || 0; this.el.innerHTML = h; this.lastHtml = h; const l = this.el.querySelector('.bb-list'); if (l) l.scrollTop = sc; }
  }
}
