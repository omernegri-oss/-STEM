// HUD, the store computer, info panels and overlays.
import {
  PRODUCTS, PRODUCT_MAP, SUPPLIERS, SUPPLIER_MAP, FURNITURE, CATEGORIES, ROLES, SHIFTS, TEAM_UPGRADES, ACHIEVEMENTS,
  LEVEL_XP, MAX_LEVEL, EVENT_TYPES, PLAYER_ROLES, EXPANSIONS, FURNITURE_SUPPLIER, fmtMoney, fmtTime, licenseCost, priceLimits, slotCap,
} from '/shared/data.js';
import { play, audio, setSfx, setMusic } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (rep) => { const s = Math.max(0, Math.min(5, rep / 20)); const full = Math.floor(s), half = s - full >= 0.5; return '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0)); };
const skillStars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const discountFor = (sup, boxes) => { let d = 0; for (const [n, pct] of sup.discounts) if (boxes >= n) d = pct; return d; };
const COMPUTER_TABS = { orders: '🛒 Order stock', licenses: '🔑 Products', furniture: '🪑 Furniture', prices: '🏷️ Prices', staff: '👥 Staff', upgrades: '⬆️ Upgrades', bills: '🧾 Bills', messages: '📨 Messages' };
const BUY_GROUPS = [['Shelving & coolers', ['shelf', 'shelf_large', 'endcap', 'produce', 'fridge', 'fridge_large', 'freezer', 'freezer_upright']],
  ['Service', ['checkout', 'selfcheckout', 'butcher', 'deli', 'rack', 'bin', 'computer']],
  ['Plants & decor', ['plant', 'flowerpot', 'cactus', 'plant_tall', 'lamp', 'sign', 'bench', 'balloons', 'vending', 'flowers', 'fountain', 'neon', 'statue']]];

export class UI {
  constructor({ G, net, onPanel }) {
    this.G = G; this.net = net; this.onPanel = onPanel;
    this.panel = null; this.tab = {}; this.cart = {}; this.lastRender = 0; this.panelDirty = false;
    this.lastCash = null; this.cashDeltaT = 0;
    this.bind();
  }

  bind() {
    document.querySelectorAll('#dock button').forEach(b => b.addEventListener('click', () => this.onPanel(b.dataset.panel)));
    $('p-close').addEventListener('click', () => this.closePanel());
    $('p-body').addEventListener('click', (e) => this.panelClick(e));
    $('p-body').addEventListener('change', (e) => this.panelChange(e));
    $('h-open').addEventListener('click', () => this.net.act('open'));
    document.querySelectorAll('.tb-speed button').forEach(b => b.addEventListener('click', () => { const v = +b.dataset.speed; if (v === 0) this.net.act('pause'); else this.net.act('speed', { v }); }));
    $('h-sfx').addEventListener('click', () => { setSfx(!audio.sfx); this.audioButtons(); });
    $('h-music').addEventListener('click', () => { setMusic(!audio.music); this.audioButtons(); });
    $('h-code').addEventListener('click', () => { navigator.clipboard?.writeText(this.G.code); });
    this.audioButtons();
    $('n-input').addEventListener('input', (e) => this.net.act('nameDraft', { name: e.target.value }));
    $('n-vote').addEventListener('click', () => this.net.act('nameVote'));
    const ci = $('chat-input');
    ci.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const t = ci.value.trim(); if (t) this.net.send({ t: 'chat', text: t }); ci.value = ''; ci.blur(); e.preventDefault(); }
      if (e.key === 'Escape') ci.blur();
      e.stopPropagation();
    });
  }
  audioButtons() { $('h-sfx').classList.toggle('off', !audio.sfx); $('h-music').classList.toggle('off', !audio.music); }

  // ------------------------------------------------------------------------------------------ HUD
  updateHud() {
    const G = this.G, M = G.meta; if (!M) return;
    const time = G.snap ? G.snap.time : 420, phase = G.snap ? G.snap.phase : M.phase, cash = G.snap ? G.snap.cash : M.cash;
    setText('h-name', M.name || M.nameDraft || 'New Store');
    setText('h-code', G.code);
    setText('h-day', `Day ${M.day}`);
    setText('h-time', fmtTime(time));
    const ph = $('h-phase');
    const label = { naming: 'NAMING', prep: 'CLOSED', open: 'OPEN', closing: 'CLOSING', report: 'NIGHT', bankrupt: 'CLOSED DOWN' }[phase] || phase;
    if (ph.textContent !== label) { ph.textContent = label; ph.className = 'phase-chip ' + phase; }
    const cEl = $('h-cash'), ct = fmtMoney(cash);
    if (cEl.textContent !== ct) { cEl.textContent = ct; cEl.classList.toggle('neg', cash < 0); }
    if (this.lastCash !== null && Math.abs(cash - this.lastCash) >= 0.01) {
      const d = cash - this.lastCash; const el = $('h-cashdelta');
      el.textContent = (d > 0 ? '+' : '') + fmtMoney(d); el.className = 'delta ' + (d > 0 ? 'up' : 'down'); el.style.opacity = 1; this.cashDeltaT = 1.6;
    }
    this.lastCash = cash;
    setText('h-stars', stars(M.rep));
    setText('h-level', `Lv ${M.level}`);
    const cur = LEVEL_XP[M.level - 1], next = LEVEL_XP[M.level] ?? cur;
    $('h-xp').style.width = (M.level >= MAX_LEVEL ? 100 : Math.min(100, (M.xp - cur) / (next - cur) * 100)) + '%';
    document.querySelectorAll('.tb-speed button').forEach(b => { const v = +b.dataset.speed; b.classList.toggle('sel', v === 0 ? M.paused : (!M.paused && M.speed === v)); });
    $('h-open').classList.toggle('hidden', phase !== 'prep');
    // unread computer messages + unpaid bills
    const unread = this.unread();
    const unpaid = (M.bills || []).filter(b => !b.paid).length;
    const mb = $('h-msgs');
    mb.textContent = `📨 ${unread}${unpaid ? ` · 🧾 ${unpaid}` : ''}`;
    mb.classList.toggle('hot', unread > 0 || unpaid > 0);
    $('naming').classList.toggle('hidden', phase !== 'naming');
    if (phase === 'naming') this.renderNaming();
    if (phase !== 'report' && !$('report').classList.contains('hidden')) $('report').classList.add('hidden');
    if (phase === 'report' && M.report && $('report').classList.contains('hidden')) this.showReport(M.report);
    $('bankrupt').classList.toggle('hidden', phase !== 'bankrupt');
    if (phase === 'bankrupt') this.renderBankrupt();
  }
  tickHud(dt) { if (this.cashDeltaT > 0) { this.cashDeltaT -= dt; if (this.cashDeltaT <= 0) $('h-cashdelta').style.opacity = 0; } }

  lastSeen() { try { return +localStorage.getItem('st_seen_' + this.G.code) || 0; } catch { return 0; } }
  markSeen() { const inbox = this.G.meta?.inbox || []; const seq = inbox.reduce((a, m) => Math.max(a, m.seq), 0); try { localStorage.setItem('st_seen_' + this.G.code, seq); } catch {} }
  unread() { const seen = this.lastSeen(); return (this.G.meta?.inbox || []).filter(m => m.seq > seen).length; }

  renderNaming() {
    const M = this.G.meta; const inp = $('n-input');
    if (document.activeElement !== inp && inp.value !== M.nameDraft) inp.value = M.nameDraft || '';
    $('n-votes').innerHTML = (this.G.players || []).map(p => `<span class="${M.nameVotes.includes(p.id) ? 'yes' : ''}" style="border:2px solid ${esc(p.color)}">${M.nameVotes.includes(p.id) ? '✅' : '⏳'} ${esc(p.name)}</span>`).join('');
    $('n-vote').textContent = M.nameVotes.includes(this.G.me) ? '↩️ Take back my vote' : '👍 I like this name!';
  }
  renderBankrupt() {
    const M = this.G.meta;
    const why = M.bankruptReason === 'evicted' ? 'You never paid the rent, so the landlord changed the locks.' : 'Three days in the red… the bank took the keys.';
    $('bk-body').innerHTML = `<h2>${M.bankruptReason === 'evicted' ? '🔒 Evicted!' : '💸 Bankrupt!'}</h2><p>${why}</p>
      <div class="report-hero"><div><small>Days</small><div class="big-num">${M.day}</div></div><div><small>Customers</small><div class="big-num">${M.stats.customers}</div></div><div><small>Revenue</small><div class="big-num">${fmtMoney(M.stats.revenue)}</div></div></div>
      <button class="btn big primary" id="bk-restart">🌱 Start over with the same name</button>`;
    $('bk-restart').onclick = () => this.net.act('restart');
  }
  renderSide() {
    const G = this.G;
    $('playerlist').innerHTML = (G.players || []).map(p => `<div class="pp"><i style="background:${esc(p.color)}"></i>${esc(PLAYER_ROLES[p.role]?.icon || '')} ${esc(p.name)}${p.id === G.me ? ' (you)' : ''}</div>`).join('');
  }

  // ------------------------------------------------------------------------------------------ chat & errors
  // The chat only shows team messages, level-ups and arrived deliveries.
  system(text) {
    const el = document.createElement('div'); el.className = 'sys'; el.textContent = text;
    const log = $('chat-log'); log.appendChild(el); while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 14000);
  }
  chat(from, color, text) {
    const el = document.createElement('div'); el.innerHTML = `<b style="color:${esc(color)}">${esc(from)}:</b> ${esc(text)}`;
    const log = $('chat-log'); log.appendChild(el); while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 12000);
  }
  toast(text) { this.system(text); }
  error(text) {
    const el = document.createElement('div'); el.className = 'e'; el.textContent = text;
    const box = $('toast-err'); box.prepend(el); while (box.children.length > 2) box.lastChild.remove();
    setTimeout(() => el.remove(), 2200); play('error');
  }
  showReport(r) {
    const el = $('report'); el.classList.remove('hidden');
    const row = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    const top = r.top.map(([pid, n]) => `${esc(PRODUCT_MAP[pid]?.name)} ×${n}`).join('<br>') || '<i>No sales</i>';
    const dem = r.demand.map(([pid, n]) => `${esc(PRODUCT_MAP[pid]?.name)} (${n})`).join('<br>') || '<i>Nothing</i>';
    $('r-body').innerHTML = `<h2>🌙 Day ${r.day} Report</h2>
      <div class="report-hero"><div><small>Profit</small><div class="big-num" style="color:${r.profit >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(r.profit)}</div></div>
        <div><small>Customers served</small><div class="big-num">${r.served}</div></div><div><small>Satisfaction</small><div class="big-num">${r.avgSat}%</div></div>
        <div><small>Reputation</small><div class="big-num stars" style="font-size:22px">${stars(r.rep)}</div></div></div>
      <div class="report-grid"><div><div class="section-title">💰 Income</div>${row('Sales', fmtMoney(r.revenue), 'pos')}${row('Tips', fmtMoney(r.tips), 'pos')}${row('Bonuses', fmtMoney(r.bonus), 'pos')}
        <div class="section-title">💸 Spent today</div>${row('Stock orders', fmtMoney(r.cogs), 'neg')}${row('Salaries (paid automatically)', fmtMoney(r.salaries), 'neg')}${row('Bills paid', fmtMoney(r.rent + r.power + r.maint), 'neg')}${row('Furniture, licenses & other', fmtMoney(r.other), 'neg')}
        ${row('<b>New bill to pay (rent, power, upkeep)</b>', fmtMoney(r.bill || 0), 'neg')}${row('<b>Cash now</b>', fmtMoney(r.cash), r.cash >= 0 ? 'pos' : 'neg')}</div>
        <div>${r.challenge ? `<div class="section-title">⭐ Daily challenge</div>${row(r.challenge.done ? '✅ Completed' : '❌ Missed', r.challenge.done ? '+' + fmtMoney(r.challenge.reward) : '—')}` : ''}
        <div class="section-title">👥 Customers</div>${row('Visitors', r.customers)}${row('Checked out', r.served)}${row('Left empty-handed', r.lost)}${row('Left angry', r.angry, r.angry ? 'neg' : '')}${row('Products wasted', r.waste, r.waste ? 'neg' : '')}
        <div class="section-title">🏆 Best sellers</div><div class="note" style="font-size:13px">${top}</div><div class="section-title">🗣️ Customers asked for</div><div class="note" style="font-size:13px">${dem}</div></div></div>
      <div style="text-align:center;margin-top:16px"><button class="btn big primary" id="r-next">☀️ Start Day ${r.day + 1}</button><p class="note">Pay the new bill on the computer within 2 days.</p></div>`;
    $('r-next').onclick = () => this.net.act('continue');
  }

  // ------------------------------------------------------------------------------------------ panels
  isComputerTab(name) { return !!COMPUTER_TABS[name]; }
  openPanel(name) {
    if (this.panel === name) { this.closePanel(); return; }
    this.panel = name; $('panel').classList.remove('hidden');
    $('panel').classList.toggle('computer', this.isComputerTab(name));
    document.querySelectorAll('#dock button').forEach(b => b.classList.toggle('sel', b.dataset.panel === name));
    this.lastHtml = ''; this.renderPanel(true); play('click');
  }
  openComputer() { this.openPanel(this.tab.computer || 'orders'); }
  closePanel() {
    if (this.panel === 'messages') this.markSeen();
    this.panel = null; $('panel').classList.add('hidden');
    document.querySelectorAll('#dock button').forEach(b => b.classList.remove('sel'));
  }
  markDirty() { this.panelDirty = true; }
  maybeRender() {
    if (!this.panel || !this.panelDirty) return;
    if (performance.now() - this.lastRender < 400 || performance.now() - (this.lastClick || 0) < 1500) return;
    const ae = document.activeElement;
    if (ae && ae.closest && ae.closest('#p-body') && ae.tagName === 'INPUT') return;
    this.renderPanel();
  }
  renderPanel(scrollTop = false) {
    const body = $('p-body'); const sc = body.scrollTop;
    this.panelDirty = false; this.lastRender = performance.now();
    const fn = { orders: this.pOrders, licenses: this.pLicenses, furniture: this.pFurniture, prices: this.pPrices, staff: this.pStaff, upgrades: this.pUpgrades,
      bills: this.pBills, messages: this.pMessages, inventory: this.pInventory, finance: this.pFinance, stats: this.pStats }[this.panel];
    if (!fn || !this.G.meta || !this.G.world) return;
    let [title, html] = fn.call(this);
    if (this.isComputerTab(this.panel)) {
      this.tab.computer = this.panel;
      const unread = this.unread(), unpaid = (this.G.meta.bills || []).filter(b => !b.paid).length;
      title = `🖥️ SuperOS — ${title}`;
      html = `<div class="tabs comp-tabs">${Object.entries(COMPUTER_TABS).map(([k, v]) => `<button data-goto="${k}" class="${k === this.panel ? 'sel' : ''}">${v}${k === 'messages' && unread ? ` <span class="chip bad">${unread}</span>` : ''}${k === 'bills' && unpaid ? ` <span class="chip bad">${unpaid}</span>` : ''}</button>`).join('')}</div>` + html;
      if (this.panel === 'messages') this.markSeen();
    }
    if (html === this.lastHtml && !scrollTop) return;
    this.lastHtml = html;
    $('p-title').innerHTML = title; body.innerHTML = html;
    body.scrollTop = scrollTop ? 0 : sc;
    if (this.panel === 'finance') this.drawChart();
  }

  stockCounts() {
    const W = this.G.world, c = {};
    const add = (pid, k, n) => { (c[pid] ||= { shelf: 0, box: 0, rack: 0, exp: 0 })[k] += n; };
    for (const f of W.furniture) {
      if (f.slots) for (const s of f.slots) if (s.pid && s.qty) add(s.pid, s.expired ? 'exp' : 'shelf', s.qty);
      if (f.boxes) for (const b of f.boxes) add(b.pid, 'rack', b.qty);
    }
    for (const b of W.boxes) if (b.pid) add(b.pid, 'box', b.qty);
    return c;
  }

  pOrders() {
    const M = this.G.meta, lvl = M.level;
    let sid = this.tab.orders || 'pantry';
    let h = '<div class="tabs">';
    for (const s of SUPPLIERS) h += `<button data-tab="orders" data-v="${s.id}" class="${s.id === sid ? 'sel' : ''} ${lvl < s.level ? 'locked' : ''}">${s.icon} ${esc(s.name)}${lvl < s.level ? ` 🔒${s.level}` : ''}</button>`;
    h += '</div>';
    const sup = SUPPLIER_MAP[sid], cart = (this.cart[sid] ||= {}), counts = this.stockCounts();
    const shortage = (M.events || []).find(e => e.type === 'shortage');
    h += `<p class="note">${esc(sup.desc)} · Delivery fee <b>${fmtMoney(sup.fee)}</b> · ~<b>${Math.round(sup.time)}s</b> · Min <b>${sup.minOrder}</b> box${sup.minOrder > 1 ? 'es' : ''}${sup.discounts.length ? ' · Bulk: ' + sup.discounts.map(([n, p]) => `${n}+ −${p}%`).join(', ') : ''}</p>`;
    if (lvl < sup.level) h += `<p class="chip warn">🔒 Unlocks at store level ${sup.level}</p>`;
    h += `<table class="t"><tr><th>Product</th><th>Box</th><th>Box cost</th><th>Your price</th><th>In store</th><th>Shelf life</th><th>Boxes</th></tr>`;
    let boxes = 0, sub = 0;
    for (const p of PRODUCTS.filter(p => sup.cats.includes(p.cat))) {
      const licensed = M.licenses.includes(p.id), short = shortage && shortage.pid === p.id;
      const boxCost = p.box * p.cost * sup.markup;
      const q = cart[p.id] || 0; boxes += q; sub += q * boxCost;
      const c = counts[p.id] || { shelf: 0, box: 0, rack: 0 };
      h += `<tr class="${licensed ? '' : 'locked'}"><td><b>${esc(p.name)}</b> <span class="chip" style="background:${CATEGORIES[p.cat].color}22">${CATEGORIES[p.cat].name}</span>${short ? ' <span class="chip bad">OUT</span>' : ''}${licensed ? '' : ` <span class="chip">🔑 ${lvl < p.level ? 'Lv' + p.level : 'needs license'}</span>`}</td>
        <td>${p.box}×</td><td>${fmtMoney(boxCost)}</td><td>${fmtMoney(this.G.world.prices[p.id] ?? p.price)}</td><td>${c.shelf}${c.box + c.rack ? ` <span class="note">+${c.box + c.rack} boxed</span>` : ''}</td><td>${p.life}d</td>
        <td>${!licensed || short ? '' : `<span class="stepper"><button data-act="qty" data-pid="${p.id}" data-d="-1">−</button><b>${q}</b><button data-act="qty" data-pid="${p.id}" data-d="1">+</button><button data-act="qty" data-pid="${p.id}" data-d="5">⁺⁵</button></span>`}</td></tr>`;
    }
    h += '</table>';
    const disc = discountFor(sup, boxes), total = boxes ? sub * (1 - disc / 100) + sup.fee : 0, okMin = boxes >= sup.minOrder;
    h += `<div class="order-foot"><div class="sum">${boxes} box${boxes !== 1 ? 'es' : ''} · Subtotal ${fmtMoney(sub)}${disc ? ` · <span class="chip good">−${disc}%</span>` : ''} · Delivery ${fmtMoney(boxes ? sup.fee : 0)}<br>Total: <b>${fmtMoney(total)}</b> ${total > M.cash ? '<span class="chip bad">Not enough cash</span>' : ''}</div>
      <div><button class="btn small" data-act="clearcart">Clear</button> <button class="btn primary" data-act="order" ${!boxes || !okMin || total > M.cash || lvl < sup.level ? 'disabled' : ''}>🚚 Order</button></div></div>`;
    h += this.ordersOnTheWay();
    return ['Order stock', h];
  }
  ordersOnTheWay() {
    const M = this.G.meta; if (!M.orders.length) return '';
    let h = `<div class="section-title">🚚 On the way</div>`;
    for (const o of M.orders) {
      const eta = Math.max(5, Math.ceil(o.remaining / (this.G.meta.speed || 1) / 5) * 5);
      const name = o.supplier === 'fixtures' ? FURNITURE_SUPPLIER.name : SUPPLIER_MAP[o.supplier].name;
      const what = o.furniture && o.furniture.length ? o.furniture.map(f => `${f.n}× ${FURNITURE[f.type].name}`).join(', ') : o.items.map(i => `${i.boxes}× ${PRODUCT_MAP[i.pid].name}`).join(', ');
      h += `<div class="kv"><span>${esc(name)}: ${esc(what)}</span><b>~${eta}s</b></div>`;
    }
    return h;
  }

  pLicenses() {
    const M = this.G.meta;
    let h = `<p class="note">Before you can order a product you need to unlock it (one-time license, $50–$200). New products become available as your store levels up.</p><table class="t"><tr><th>Product</th><th>Section</th><th>Sells for</th><th>Level</th><th></th></tr>`;
    for (const p of PRODUCTS) {
      const owned = M.licenses.includes(p.id), lock = M.level < p.level, cost = licenseCost(p);
      h += `<tr class="${lock ? 'locked' : ''}"><td><b>${esc(p.name)}</b></td><td>${CATEGORIES[p.cat].name}</td><td>${fmtMoney(p.price)}</td><td>${p.level}</td>
        <td>${owned ? '<span class="chip good">✅ Unlocked</span>' : lock ? `<span class="chip">🔒 Level ${p.level}</span>` : `<button class="btn small primary" data-act="license" data-pid="${p.id}" ${M.cash < cost ? 'disabled' : ''}>Unlock ${fmtMoney(cost)}</button>`}</td></tr>`;
    }
    return ['Products & licenses', h + '</table>'];
  }

  pFurniture() {
    const M = this.G.meta;
    let h = `<p class="note">Everything is delivered by ${esc(FURNITURE_SUPPLIER.name)} in a box to the loading area (delivery ${fmtMoney(FURNITURE_SUPPLIER.fee)}, ~${FURNITURE_SUPPLIER.time}s). Carry the box inside and press E to place it wherever you like.</p>`;
    for (const [title, types] of BUY_GROUPS) {
      h += `<div class="section-title">${title}</div><div class="cards">`;
      for (const type of types) {
        const d = FURNITURE[type], lock = M.level < d.level;
        h += `<div class="card ${lock ? 'locked' : ''}"><div class="row"><span class="ci">${d.icon}</span><span class="price">${fmtMoney(d.cost)}</span></div><h4>${esc(d.name)}</h4><p>${esc(d.desc)}${d.slots ? `<br>${d.slots} product sections` : ''}${d.power ? ` · ⚡$${d.power}/day` : ''}${d.appeal > 0 ? ` · ✨+${d.appeal}` : ''}</p>
          <button class="btn small primary" data-act="buyf" data-type="${type}" ${lock || M.cash < d.cost + FURNITURE_SUPPLIER.fee ? 'disabled' : ''}>${lock ? `🔒 Level ${d.level}` : '🛒 Buy'}</button></div>`;
      }
      h += '</div>';
    }
    return ['Furniture & decor', h + this.ordersOnTheWay()];
  }

  pPrices() {
    const W = this.G.world, M = this.G.meta;
    const list = PRODUCTS.filter(p => M.licenses.includes(p.id));
    let h = `<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><span class="note" style="align-self:center">All products:</span><button class="btn small" data-act="priceall" data-v="0.9">−10%</button><button class="btn small" data-act="priceall" data-v="1">Suggested</button><button class="btn small" data-act="priceall" data-v="1.1">+10%</button><button class="btn small" data-act="priceall" data-v="1.25">+25%</button></div>`;
    h += `<table class="t"><tr><th>Product</th><th>Cost</th><th>Suggested</th><th>Allowed</th><th>Your price</th><th>Profit</th><th>Customers think</th></tr>`;
    for (const p of list) {
      const price = W.prices[p.id] ?? p.price, [lo, hi] = priceLimits(p), ratio = price / p.price;
      const react = ratio <= 0.85 ? ['🤑 Bargain', 'good'] : ratio <= 1.02 ? ['🙂 Fair', 'good'] : ratio <= 1.15 ? ['🤔 Pricey', 'warn'] : ratio <= 1.35 ? ['😒 Expensive', 'bad'] : ['😡 Rip-off', 'bad'];
      h += `<tr><td><b>${esc(p.name)}</b></td><td>${fmtMoney(p.cost)}</td><td>${fmtMoney(p.price)}</td><td class="note">${fmtMoney(lo)} – ${fmtMoney(hi)}</td>
        <td><span class="stepper"><button data-act="price" data-pid="${p.id}" data-d="-0.1">−</button><input data-price="${p.id}" value="${price.toFixed(2)}" /><button data-act="price" data-pid="${p.id}" data-d="0.1">+</button></span></td>
        <td><b style="color:${price - p.cost > 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(price - p.cost)}</b></td><td><span class="chip ${react[1]}">${react[0]}</span></td></tr>`;
    }
    return ['Prices', h + '</table><p class="note">Prices must stay between just above cost and twice the suggested price.</p>'];
  }

  pStaff() {
    const M = this.G.meta;
    const payroll = M.staff.reduce((a, s) => a + Math.round(s.salary * SHIFTS[s.shift].pay), 0), max = 4 + M.expansion * 3;
    let h = `<div class="section-title">👥 Your team (${M.staff.length}/${max}) · Payroll ${fmtMoney(payroll)}/day</div><div class="cards">`;
    for (const s of M.staff) {
      const r = ROLES[s.role], hc = s.happiness > 60 ? '#22c55e' : s.happiness > 30 ? '#f59e0b' : '#ef4444';
      h += `<div class="card"><div class="row"><span class="ci">${r.icon}</span><span class="chip ${s.absent ? 'bad' : s.present ? 'good' : ''}">${s.absent ? 'Sick' : s.present ? 'Working' : 'Off duty'}</span></div>
        <h4>${esc(s.name)}</h4><p>${r.name} · <span class="stars">${skillStars(s.skill)}</span><br>Speed ${s.speed.toFixed(2)} · ${fmtMoney(s.salary)}/day</p>
        <div title="Happiness ${s.happiness}%">😊 <div class="bar" style="display:inline-block;width:70%;vertical-align:middle"><div style="width:${s.happiness}%;background:${hc}"></div></div></div>
        <select data-shift="${s.id}">${Object.entries(SHIFTS).map(([k, v]) => `<option value="${k}" ${s.shift === k ? 'selected' : ''}>${v.name} ${v.start}:00–${v.end}:00 (${Math.round(v.pay * 100)}% pay)</option>`).join('')}</select>
        <div class="row"><button class="btn small good" data-act="raise" data-id="${s.id}">💸 Raise</button><button class="btn small bad" data-act="fire" data-id="${s.id}">Fire</button></div></div>`;
    }
    h += `</div><div class="section-title">📝 Job applicants</div><div class="cards">`;
    for (const c of M.candidates) {
      const r = ROLES[c.role], lock = M.level < r.level;
      h += `<div class="card ${lock ? 'locked' : ''}"><div class="row"><span class="ci">${r.icon}</span><span class="price">${fmtMoney(c.salary)}<span class="note">/day</span></span></div>
        <h4>${esc(c.name)}</h4><p>${r.name} — ${esc(r.desc)}<br><span class="stars">${skillStars(c.skill)}</span> · Speed ${c.speed.toFixed(2)}</p>
        <button class="btn small primary" data-act="hire" data-id="${c.id}" ${lock || M.staff.length >= max ? 'disabled' : ''}>${lock ? `🔒 Level ${r.level}` : '🤝 Hire'}</button></div>`;
    }
    return ['Staff', h + '</div>'];
  }

  pUpgrades() {
    const M = this.G.meta;
    const cur = EXPANSIONS[M.expansion], next = EXPANSIONS[M.expansion + 1];
    let h = `<div class="section-title">📐 Store size</div><div class="sel-card">Now: ${cur.w}×${cur.d}${M.floors > 1 ? ' on 2 floors' : ''} · rent ${fmtMoney(cur.rent)}/day`;
    if (next) {
      const lock = M.level < next.level;
      h += `<br><b>Next: ${next.floors ? '🏢 A second floor with stairs' : `${next.w}×${next.d}`}</b> · rent becomes ${fmtMoney(next.rent)}/day<div class="btns"><button class="btn primary" data-act="expand" ${lock || M.cash < next.cost ? 'disabled' : ''}>${lock ? `🔒 Level ${next.level}` : `Expand for ${fmtMoney(next.cost)}`}</button></div><div class="note">Only while the store is closed.</div>`;
    } else h += '<br>🏟️ Maximum size reached!';
    h += '</div><div class="section-title">⬆️ Team upgrades</div><div class="cards">';
    for (const u of TEAM_UPGRADES) {
      const owned = M.upgrades[u.id], lock = M.level < u.level, needs = u.requires && !M.upgrades[u.requires];
      h += `<div class="card ${owned ? 'owned' : ''} ${lock ? 'locked' : ''}"><span class="ci">${u.icon}</span><h4>${esc(u.name)}</h4><p>${esc(u.desc)}</p>
        <div class="row"><span class="price">${owned ? '✅ Owned' : fmtMoney(u.cost)}</span>${owned ? '' : `<button class="btn small primary" data-act="upgrade" data-id="${u.id}" ${lock || needs || M.cash < u.cost ? 'disabled' : ''}>${lock ? `🔒 Lv${u.level}` : needs ? 'Needs ' + TEAM_UPGRADES.find(x => x.id === u.requires).name : 'Buy'}</button>`}</div></div>`;
    }
    return ['Upgrades & expansion', h + '</div>'];
  }

  pBills() {
    const M = this.G.meta;
    const bills = [...(M.bills || [])].sort((a, b) => (a.paid - b.paid) || b.day - a.day);
    let h = `<p class="note">Rent, electricity and maintenance are billed every evening. Pay within 2 days — late bills get a fee, and 3 days late means eviction. Salaries are paid automatically.</p>`;
    if (!bills.length) h += '<p class="note">No bills yet.</p>';
    for (const b of bills) {
      const late = !b.paid && M.day > b.due;
      h += `<div class="sel-card" style="${late ? 'border-color:#f87171;background:#fef2f2' : ''}"><h4>🧾 Bill for day ${b.day} ${b.paid ? '<span class="chip good">Paid</span>' : late ? '<span class="chip bad">OVERDUE</span>' : `<span class="chip warn">Due end of day ${b.due}</span>`}</h4>
        <div class="kv"><span>Rent</span><b>${fmtMoney(b.items.rent)}</b></div><div class="kv"><span>Electricity</span><b>${fmtMoney(b.items.power)}</b></div><div class="kv"><span>Maintenance</span><b>${fmtMoney(b.items.maint)}</b></div>${b.items.late ? `<div class="kv"><span>Late fees</span><b class="neg">${fmtMoney(b.items.late)}</b></div>` : ''}
        <div class="row" style="margin-top:6px"><span class="price">${fmtMoney(b.total)}</span>${b.paid ? '' : `<button class="btn small primary" data-act="paybill" data-id="${b.id}" ${M.cash < b.total ? 'disabled' : ''}>Pay now</button>`}</div></div>`;
    }
    return ['Bills', h];
  }

  pMessages() {
    const M = this.G.meta, seen = this.lastSeen();
    let h = '';
    if (M.pendingSale) h += `<div class="sel-card"><h4>🏷️ Flash sale offer</h4>Run a store-wide 15% discount today to attract a crowd?<div class="btns"><button class="btn small good" data-act="sale" data-v="1">Run the sale</button><button class="btn small" data-act="sale" data-v="0">No thanks</button></div></div>`;
    const ch = M.challenge;
    if (ch) h += `<div class="sel-card"><h4>⭐ Today's challenge ${ch.done ? '✅' : ch.failed ? '❌' : ''}</h4>${esc(challengeText(ch))} · ${challengeProgress(ch, M)} · reward ${fmtMoney(ch.reward)}</div>`;
    const list = [...(M.inbox || [])].sort((a, b) => b.seq - a.seq);
    if (!list.length) h += '<p class="note">No messages yet.</p>';
    for (const m of list) h += `<div class="msg ${m.seq > seen ? 'new' : ''}"><span class="mi">${m.icon}</span><div><div class="mt">${esc(m.text)}</div><div class="note">Day ${m.day}, ${fmtTime(m.min)}</div></div></div>`;
    return ['Messages', h];
  }

  pInventory() {
    const W = this.G.world, M = this.G.meta, counts = this.stockCounts();
    let h = `<div class="section-title">📦 Products in the store</div><table class="t"><tr><th>Product</th><th>On shelves</th><th>In boxes</th><th>In racks</th><th>Expired</th><th>Sold today</th></tr>`;
    const list = PRODUCTS.filter(p => counts[p.id] || (M.ledger.sold || {})[p.id]);
    if (!list.length) h += `<tr><td colspan="6" class="note">Nothing in stock yet. Order products on the store computer.</td></tr>`;
    for (const p of list) {
      const c = counts[p.id] || { shelf: 0, box: 0, rack: 0, exp: 0 };
      h += `<tr><td><b>${esc(p.name)}</b></td><td>${c.shelf || '<span class="chip bad">0</span>'}</td><td>${c.box}</td><td>${c.rack}</td><td>${c.exp ? `<span class="chip bad">${c.exp}</span>` : '-'}</td><td>${M.ledger.sold[p.id] || 0}</td></tr>`;
    }
    h += `</table><div class="section-title">🧊 Fixtures</div><table class="t"><tr><th>Fixture</th><th>Floor</th><th>Contents</th><th>Fill</th><th>Status</th></tr>`;
    for (const f of W.furniture.filter(f => f.slots || f.boxes)) {
      const def = FURNITURE[f.type];
      let fill = 0, cont = '';
      if (f.slots) { fill = f.slots.reduce((a, s) => a + (s.pid ? s.qty / slotCap(f.type, s.pid) : 0), 0) / def.slots; cont = f.slots.map(s => s.pid ? `${esc(PRODUCT_MAP[s.pid].name)} ${s.qty}${s.expired ? '🤢' : ''}` : '—').join(', '); }
      else { fill = f.boxes.length / (def.boxes + (f.upg ? 4 : 0)); cont = `${f.boxes.length} boxes`; }
      const st = f.broken ? `<span class="chip bad">BROKEN ${f.temp}°C</span>` : f.temp !== undefined ? `<span class="chip blue">${f.temp}°C</span>${f.open ? ' <span class="chip warn">door open</span>' : ''}` : '';
      h += `<tr><td><b>${esc(def.name)}</b>${f.upg ? ' ⭐' : ''}</td><td>${(f.floor || 0) + 1}</td><td style="font-size:12px">${cont}</td><td style="width:110px"><div class="bar"><div style="width:${Math.round(fill * 100)}%;background:${fill < 0.25 ? '#ef4444' : fill < 0.5 ? '#f59e0b' : '#22c55e'}"></div></div></td><td>${st}</td></tr>`;
    }
    return ['📦 Stock', h + '</table>'];
  }

  pFinance() {
    const M = this.G.meta, L = M.ledger, fc = M.fixed || { rent: 0, power: 0, maint: 0 };
    const salaries = M.staff.filter(s => !s.absent).reduce((a, s) => a + Math.round(s.salary * SHIFTS[s.shift].pay), 0);
    const row = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    const inc = L.revenue + L.tips + L.bonus, spent = L.cogs + L.other + L.salaries + L.rent + L.power + L.maint;
    const unpaid = (M.bills || []).filter(b => !b.paid).reduce((a, b) => a + b.total, 0);
    let h = `<div class="grid2"><div><div class="section-title">💰 Cash</div><div class="big-num" style="color:${M.cash >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(M.cash)}</div>
      ${unpaid ? `<p class="chip bad">Unpaid bills: ${fmtMoney(unpaid)} — pay on the computer</p>` : ''}
      <div class="section-title">📅 Today so far</div>${row('Sales', fmtMoney(L.revenue), 'pos')}${row('Tips', fmtMoney(L.tips), 'pos')}${row('Bonuses', fmtMoney(L.bonus), 'pos')}
      ${row('Stock purchases', fmtMoney(L.cogs), 'neg')}${row('Furniture, licenses & other', fmtMoney(L.other), 'neg')}${row('Bills paid', fmtMoney(L.rent + L.power + L.maint), 'neg')}${row('<b>Net</b>', fmtMoney(inc - spent), inc - spent >= 0 ? 'pos' : 'neg')}
      <div class="section-title">🌙 Tonight</div>${row('Salaries (automatic)', fmtMoney(salaries), 'neg')}${row('New bill: rent', fmtMoney(fc.rent), 'neg')}${row('New bill: electricity', fmtMoney(fc.power), 'neg')}${row('New bill: maintenance', fmtMoney(fc.maint), 'neg')}</div>
      <div><div class="section-title">📈 Last days</div><canvas class="chart" id="fin-chart"></canvas><div class="note">green revenue · red expenses · blue profit</div>
      <div class="section-title">🏆 Best sellers</div>`;
    h += Object.entries(M.stats.sold).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([pid, n]) => row(esc(PRODUCT_MAP[pid].name), `${n} sold`)).join('') || '<p class="note">No sales yet.</p>';
    return ['📊 Money', h + '</div></div>'];
  }
  drawChart() {
    const cv = $('fin-chart'); if (!cv) return;
    const H = this.G.meta.history.slice(-14);
    const dpr = devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    if (!H.length) { g.fillStyle = '#94a3b8'; g.font = '700 13px Nunito'; g.fillText('Finish a day to see history', 10, h / 2); return; }
    const max = Math.max(100, ...H.map(d => Math.max(d.revenue, d.expenses))), bw = w / H.length;
    const y = v => h - 18 - (v / max) * (h - 30);
    H.forEach((d, i) => {
      const x = i * bw;
      g.fillStyle = '#4ade80'; g.fillRect(x + bw * 0.12, y(d.revenue), bw * 0.36, y(0) - y(d.revenue));
      g.fillStyle = '#f87171'; g.fillRect(x + bw * 0.52, y(d.expenses), bw * 0.36, y(0) - y(d.expenses));
      g.fillStyle = '#64748b'; g.font = '700 10px Nunito'; g.textAlign = 'center'; g.fillText('D' + d.day, x + bw / 2, h - 4);
    });
    g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.beginPath();
    H.forEach((d, i) => { const x = i * bw + bw / 2, yy = y(Math.max(0, d.profit)); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke();
  }

  pStats() {
    const M = this.G.meta, cur = LEVEL_XP[M.level - 1], next = LEVEL_XP[M.level];
    const row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    const ch = M.challenge;
    let h = `<div class="grid2"><div><div class="section-title">⭐ Store</div>${row('Level', `${M.level} / ${MAX_LEVEL}${next ? ` (${M.xp - cur}/${next - cur} XP)` : ' (MAX)'}`)}<div class="bar" style="margin:4px 0 8px"><div style="width:${next ? (M.xp - cur) / (next - cur) * 100 : 100}%;background:linear-gradient(90deg,#a855f7,#ec4899)"></div></div>
      ${row('Reputation', `<span class="stars">${stars(M.rep)}</span>`)}${row('Store appeal', M.appeal)}${row('Days open', M.day)}${row('Customers served', M.stats.customers)}${row('Total revenue', fmtMoney(M.stats.revenue))}${row('Customers punched 🥊', M.stats.punched || 0)}
      ${ch ? `<div class="section-title">⭐ Today's challenge</div><div class="sel-card">${esc(challengeText(ch))}<br><b>${challengeProgress(ch, M)}</b> · reward ${fmtMoney(ch.reward)} ${ch.done ? '✅' : ch.failed ? '❌' : ''}</div>` : ''}</div>
      <div><div class="section-title">🏆 Achievements (${Object.keys(M.achievements).length}/${ACHIEVEMENTS.length})</div><div class="ach">`;
    for (const a of ACHIEVEMENTS) { const got = M.achievements[a.id]; h += `<div class="${got ? 'yes' : 'no'}" title="${esc(a.desc)}"><i>${a.icon}</i><b>${esc(a.name)}</b>${esc(a.desc)}</div>`; }
    return ['🏆 Progress', h + '</div></div></div>'];
  }

  panelClick(e) {
    this.lastClick = performance.now();
    const b = e.target.closest('[data-tab],[data-act],[data-goto]'); if (!b) return;
    if (b.dataset.goto) { this.panel = null; this.openPanel(b.dataset.goto); return; }
    if (b.dataset.tab) { this.tab[b.dataset.tab] = b.dataset.v; this.lastHtml = ''; this.renderPanel(true); play('click'); return; }
    const a = b.dataset.act, net = this.net;
    switch (a) {
      case 'qty': { const sid = this.tab.orders || 'pantry'; const cart = (this.cart[sid] ||= {}); cart[b.dataset.pid] = Math.max(0, (cart[b.dataset.pid] || 0) + +b.dataset.d); play('click'); this.renderPanel(); break; }
      case 'clearcart': this.cart[this.tab.orders || 'pantry'] = {}; this.renderPanel(); break;
      case 'order': {
        const sid = this.tab.orders || 'pantry'; const cart = this.cart[sid] || {};
        net.act('order', { supplier: sid, items: Object.entries(cart).filter(([, n]) => n > 0).map(([pid, boxes]) => ({ pid, boxes })) });
        this.cart[sid] = {}; setTimeout(() => this.renderPanel(), 200); break;
      }
      case 'license': net.act('license', { pid: b.dataset.pid }); break;
      case 'buyf': net.act('buyFurniture', { type: b.dataset.type, n: 1 }); break;
      case 'paybill': net.act('payBill', { id: +b.dataset.id }); break;
      case 'sale': net.act('sale', { accept: b.dataset.v === '1' }); break;
      case 'expand': net.act('expand'); break;
      case 'price': {
        const pid = b.dataset.pid; const p = PRODUCT_MAP[pid]; const [lo, hi] = priceLimits(p);
        const v = Math.max(lo, Math.min(hi, Math.round(((this.G.world.prices[pid] ?? p.price) + +b.dataset.d) * 100) / 100));
        this.G.world.prices[pid] = v; net.act('setPrice', { pid, price: v }); this.renderPanel(); break;
      }
      case 'priceall': net.act('priceAll', { mult: +b.dataset.v }); break;
      case 'hire': net.act('hire', { id: +b.dataset.id }); break;
      case 'fire': if (confirm('Let this employee go?')) net.act('fire', { id: +b.dataset.id }); break;
      case 'raise': net.act('raise', { id: +b.dataset.id }); break;
      case 'upgrade': net.act('buyUpgrade', { id: b.dataset.id }); break;
    }
  }
  panelChange(e) {
    const t = e.target;
    if (t.dataset.price) {
      const p = PRODUCT_MAP[t.dataset.price], [lo, hi] = priceLimits(p);
      let v = parseFloat(t.value);
      if (!isNaN(v)) { if (v < lo || v > hi) this.error(`Price must be between ${fmtMoney(lo)} and ${fmtMoney(hi)}`); v = Math.max(lo, Math.min(hi, v)); this.G.world.prices[p.id] = v; this.net.act('setPrice', { pid: p.id, price: v }); }
      t.blur();
    }
    if (t.dataset.shift) this.net.act('shift', { id: +t.dataset.shift, shift: t.value });
  }

  // checkout / department status bar for the local player
  stationBar(inter) {
    const el = $('station-bar');
    if (!inter || !inter.station) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = inter.station;
    if (s.kind === 'checkout') {
      $('sb-title').textContent = s.idle ? `💵 Register open — ${s.queue || 0} in line` : s.pay ? '💳 All scanned! Press E to take payment' : `🛒 Scanning ${s.scanned}/${s.total}`;
      $('sb-items').innerHTML = s.idle ? '⌛' : s.pids.map((pid, i) => `<span class="${i < s.scanned ? 'done' : ''}">${esc(PRODUCT_MAP[pid].name)}</span>`).join(' · ');
      $('sb-fill').style.width = s.idle ? '0%' : (s.scanned / Math.max(1, s.total) * 100) + '%';
      $('sb-hint').textContent = s.idle ? 'Customers will line up here. Walk away to leave.' : 'Click each product on the belt to pass it over the scanner (or press E)';
    } else {
      const p = s.req ? PRODUCT_MAP[s.req.pid] : null;
      $('sb-title').textContent = p ? `${s.meat ? '🔪' : '🧀'} Order: ${s.req.qty}× ${p.name} (${p.unit})` : `${s.meat ? '🔪 Butcher' : '🧀 Deli'} — no orders waiting`;
      const steps = [['1. Take from fridge', s.dept === null && s.where === 'fridge'], ['2. Cut & wrap', s.dept === 'raw'], ['3. Hand over', s.dept === 'pack']];
      $('sb-items').innerHTML = steps.map(([t, on]) => `<span class="${on ? '' : 'done'}" style="font-size:14px">${t}</span>`).join('  ');
      $('sb-fill').style.width = s.dept === 'raw' ? Math.min(100, s.progress / s.presses * 100) + '%' : s.dept === 'pack' ? '100%' : '0%';
      $('sb-hint').textContent = 'Fridge (back left) → station (back right) → counter (front)';
    }
  }
}

function challengeText(ch) {
  return { serve: `Check out ${ch.target} customers today`, revenue: `Earn ${fmtMoney(ch.target)} in sales today`, noangry: `Serve ${ch.target}+ customers with no angry walk-outs`,
    sat: `Average satisfaction ${ch.target}%+ today`, cat: `Sell ${ch.target} ${CATEGORIES[ch.cat]?.name || ''} items today` }[ch.type] || '';
}
function challengeProgress(ch, M) {
  return ch.type === 'revenue' ? `${fmtMoney(ch.progress)} / ${fmtMoney(ch.target)}` : ch.type === 'sat' ? `${ch.progress}% now` : `${ch.progress}/${ch.target}`;
}
function setText(id, t) { const el = $(id); if (el && el.textContent !== String(t)) el.textContent = t; }
export { esc, stars };
