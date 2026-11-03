// HUD, task list, management panels and overlays.
import {
  PRODUCTS, PRODUCT_MAP, SUPPLIERS, SUPPLIER_MAP, FURNITURE, CATEGORIES, ROLES, SHIFTS, TEAM_UPGRADES, ACHIEVEMENTS, GOALS,
  LEVEL_XP, MAX_LEVEL, EVENT_TYPES, PLAYER_ROLES, EXPANSIONS, fmtMoney, fmtTime, OPEN_HOUR,
} from '/shared/data.js';
import { play, audio, setSfx, setMusic } from './audio.js';

const $ = (id) => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (rep) => { const s = Math.max(0, Math.min(5, rep / 20)); const full = Math.floor(s), half = s - full >= 0.5; return '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0)); };
const skillStars = n => '★'.repeat(n) + '☆'.repeat(5 - n);
const discountFor = (sup, boxes) => { let d = 0; for (const [n, pct] of sup.discounts) if (boxes >= n) d = pct; return d; };

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
    $('h-open').addEventListener('click', () => { this.net.act('open'); });
    document.querySelectorAll('.tb-speed button').forEach(b => b.addEventListener('click', () => {
      const v = +b.dataset.speed;
      if (v === 0) this.net.act('pause'); else this.net.act('speed', { v });
    }));
    $('h-sfx').addEventListener('click', () => { setSfx(!audio.sfx); this.audioButtons(); });
    $('h-music').addEventListener('click', () => { setMusic(!audio.music); this.audioButtons(); });
    $('h-code').addEventListener('click', () => { navigator.clipboard?.writeText(this.G.code); this.toast('Invite code copied!', 'info', '📋'); });
    this.audioButtons();
    // naming
    $('n-input').addEventListener('input', (e) => this.net.act('nameDraft', { name: e.target.value }));
    $('n-vote').addEventListener('click', () => this.net.act('nameVote'));
    // chat
    const ci = $('chat-input');
    ci.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const t = ci.value.trim(); if (t) this.net.send({ t: 'chat', text: t }); ci.value = ''; ci.blur(); e.preventDefault(); }
      if (e.key === 'Escape') { ci.blur(); }
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
    const label = { naming: 'NAMING', prep: 'CLOSED', open: 'OPEN', closing: 'CLOSING', report: 'NIGHT', bankrupt: 'BANKRUPT' }[phase] || phase;
    if (ph.textContent !== label) { ph.textContent = label; ph.className = 'phase-chip ' + phase; }
    const cEl = $('h-cash');
    const ct = fmtMoney(cash);
    if (cEl.textContent !== ct) { cEl.textContent = ct; cEl.classList.toggle('neg', cash < 0); }
    if (this.lastCash !== null && Math.abs(cash - this.lastCash) >= 0.01) {
      const d = cash - this.lastCash; const el = $('h-cashdelta');
      el.textContent = (d > 0 ? '+' : '') + fmtMoney(d); el.className = 'delta ' + (d > 0 ? 'up' : 'down'); el.style.opacity = 1; this.cashDeltaT = 1.6;
    }
    this.lastCash = cash;
    setText('h-stars', stars(M.rep));
    $('h-stars').title = `Reputation ${(M.rep / 20).toFixed(1)} / 5`;
    setText('h-level', `Lv ${M.level}`);
    const cur = LEVEL_XP[M.level - 1], next = LEVEL_XP[M.level] ?? cur;
    $('h-xp').style.width = (M.level >= MAX_LEVEL ? 100 : Math.min(100, (M.xp - cur) / (next - cur) * 100)) + '%';
    $('h-xp').parentElement.title = `${M.xp} XP${M.level < MAX_LEVEL ? ` · ${next - M.xp} to level ${M.level + 1}` : ''}`;
    document.querySelectorAll('.tb-speed button').forEach(b => { const v = +b.dataset.speed; b.classList.toggle('sel', v === 0 ? M.paused : (!M.paused && M.speed === v)); });
    $('h-open').classList.toggle('hidden', phase !== 'prep');
    // overlays
    $('naming').classList.toggle('hidden', phase !== 'naming');
    if (phase === 'naming') this.renderNaming();
    if (phase !== 'report' && !$('report').classList.contains('hidden')) $('report').classList.add('hidden');
    if (phase === 'report' && M.report && $('report').classList.contains('hidden')) this.showReport(M.report);
    $('bankrupt').classList.toggle('hidden', phase !== 'bankrupt');
    if (phase === 'bankrupt') this.renderBankrupt();
  }
  tickHud(dt) {
    if (this.cashDeltaT > 0) { this.cashDeltaT -= dt; if (this.cashDeltaT <= 0) $('h-cashdelta').style.opacity = 0; }
  }

  renderNaming() {
    const M = this.G.meta; const inp = $('n-input');
    if (document.activeElement !== inp && inp.value !== M.nameDraft) inp.value = M.nameDraft || '';
    const players = this.G.players || [];
    $('n-votes').innerHTML = players.map(p => `<span class="${M.nameVotes.includes(p.id) ? 'yes' : ''}" style="border:2px solid ${esc(p.color)}">${M.nameVotes.includes(p.id) ? '✅' : '⏳'} ${esc(p.name)}</span>`).join('');
    $('n-vote').textContent = M.nameVotes.includes(this.G.me) ? '↩️ Take back my vote' : '👍 I like this name!';
  }

  renderBankrupt() {
    const M = this.G.meta;
    $('bk-body').innerHTML = `<h2>💸 Bankrupt!</h2><p>Three days in the red… the bank has taken the keys to <b>${esc(M.name)}</b>.</p>
      <div class="report-hero"><div><small>Days survived</small><div class="big-num">${M.day}</div></div><div><small>Customers served</small><div class="big-num">${M.stats.customers}</div></div><div><small>Total revenue</small><div class="big-num">${fmtMoney(M.stats.revenue)}</div></div></div>
      <button class="btn big primary" id="bk-restart">🌱 Start over with the same name</button>`;
    $('bk-restart').onclick = () => this.net.act('restart');
  }

  // ------------------------------------------------------------------------------------------ tasks
  renderTasks() {
    const G = this.G, M = G.meta, W = G.world; if (!M || !W) return;
    const g = GOALS[M.goalIndex];
    setText('g-text', g ? g.text : '🏆 All goals complete — you are true Tycoons!');
    setText('g-reward', g && g.reward ? `Reward: ${fmtMoney(g.reward)}` : '');
    const ch = M.challenge;
    if (ch) {
      const txt = { serve: `Check out ${ch.target} customers today`, revenue: `Earn ${fmtMoney(ch.target)} in sales today`,
        noangry: `Serve ${ch.target}+ customers with no angry walk-outs`, sat: `Average satisfaction ${ch.target}%+ today (15+ customers)`,
        cat: `Sell ${ch.target} ${CATEGORIES[ch.cat]?.name || ''} items today` }[ch.type];
      setText('c-text', txt);
      const prog = ch.type === 'revenue' ? `${fmtMoney(ch.progress)} / ${fmtMoney(ch.target)}` : ch.type === 'sat' ? `${ch.progress}% now` : ch.type === 'noangry' ? `${ch.progress}/${ch.target} served · ${M.ledger.angry} angry` : `${ch.progress}/${ch.target}`;
      setText('c-reward', ch.done ? `✅ Complete! +${fmtMoney(ch.reward)}` : ch.failed ? '❌ Failed — new challenge tomorrow' : `${prog} · Reward ${fmtMoney(ch.reward)}`);
      $('c-bar').style.width = Math.min(100, (ch.type === 'sat' ? ch.progress / ch.target : ch.progress / ch.target) * 100) + '%';
      $('c-card').className = 'goal-card daily' + (ch.done ? ' done' : ch.failed ? ' failed' : '');
    }
    const myRole = (G.players || []).find(p => p.id === G.me)?.role;
    const tasks = [];
    const add = (text, role, urgent = false, ok = false) => tasks.push({ text, role, urgent, ok });
    const phase = G.snap?.phase || M.phase;
    const hasCheckout = W.furniture.some(f => f.type === 'checkout' || f.type === 'selfcheckout');
    const stocked = W.furniture.some(f => f.slots && f.slots.some(s => s.qty > 0));
    if (phase === 'prep') {
      if (!W.furniture.some(f => f.slots)) add('🛠️ Build shelves or fridges (B)', 'builder', true);
      if (!hasCheckout) add('🛒 Place a checkout counter (B → Service)', 'builder', true);
      if (!stocked && !M.orders.length && !W.boxes.length) add('🚚 Order products (O)', 'manager', true);
      if (hasCheckout && stocked) add('🔓 Ready? Click "Open Store" to start the day!', 'manager', false);
    }
    if (phase === 'report') add('🌙 Day over — read the report and start the next day', 'manager');
    const outside = W.boxes.filter(b => b.z >= W.d).length;
    const inside = W.boxes.length - outside;
    if (outside) add(`📦 ${outside} box${outside > 1 ? 'es' : ''} waiting at the loading area — carry them in (E)`, 'stocker', outside > 6);
    if (inside) add(`📦 ${inside} box${inside > 1 ? 'es' : ''} on the shop floor — stock or rack them`, 'stocker');
    for (const o of M.orders) add(`🚚 ${SUPPLIER_MAP[o.supplier].name} delivery in ${Math.ceil(o.remaining / (M.speed || 1))}s`, 'manager', false, true);
    // checkout/counter queues
    const K = G.snap?.K || [], N = G.snap?.N || [];
    for (const k of K) {
      const f = W.furniture.find(f => f.id === k[0]);
      if (f && f.type === 'checkout' && k[5] > 0 && !k[6]) add(`🛒 ${k[5]} customer${k[5] > 1 ? 's' : ''} waiting at an unstaffed checkout!`, 'cashier', true);
    }
    for (const n of N) {
      const f = W.furniture.find(f => f.id === n[0]);
      if (f && n[5] > 0 && !n[6]) add(`${f.type === 'butcher' ? '🔪' : '🧀'} ${n[5]} waiting at the ${FURNITURE[f.type].name}!`, 'counter', true);
    }
    for (const f of W.furniture) if (f.broken) add(`🔥 ${FURNITURE[f.type].name} is broken (${f.temp}°C) — repair it!`, 'builder', true);
    const expired = W.furniture.filter(f => f.slots && f.slots.some(s => s.expired && s.qty > 0)).length;
    if (expired) add(`🤢 Clear expired products from ${expired} fixture${expired > 1 ? 's' : ''}`, 'stocker', true);
    if (W.dirt.length) add(`🧹 Clean ${W.dirt.length} mess${W.dirt.length > 1 ? 'es' : ''} (E)`, 'stocker', W.dirt.length > 5);
    // restock
    const low = [];
    for (const f of W.furniture) if (f.slots) for (const s of f.slots) {
      if (!s.pid || s.expired) continue;
      const cap = FURNITURE[f.type].cap;
      if (s.qty === 0) low.push({ pid: s.pid, empty: true }); else if (s.qty / cap < 0.25) low.push({ pid: s.pid, empty: false });
    }
    const uniq = [...new Map(low.map(l => [l.pid, l])).values()].slice(0, 4);
    for (const l of uniq) add(`${l.empty ? '🪫 Out of' : '📉 Low on'} ${PRODUCT_MAP[l.pid].icon} ${PRODUCT_MAP[l.pid].name}`, 'stocker', l.empty);
    const demand = Object.entries(M.demand || {}).filter(([pid]) => !W.furniture.some(f => f.slots && f.slots.some(s => s.pid === pid && s.qty > 0))).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (demand.length) add(`🗣️ Customers asked for: ${demand.map(([pid, n]) => `${PRODUCT_MAP[pid].icon}${PRODUCT_MAP[pid].name} (${n})`).join(', ')}`, 'manager');
    if (M.pendingSale) add('🏷️ Decide on the flash sale offer!', 'manager', true);
    if (M.cash < 0) add(`⚠️ You're in debt! ${3 - M.negativeDays} day(s) until bankruptcy`, 'manager', true);
    if (phase === 'open' && !W.furniture.some(f => f.type === 'bin')) add('🗑️ Tip: trash bins reduce litter', 'builder');
    const urgentFirst = tasks.sort((a, b) => (b.urgent - a.urgent) || ((b.role === myRole) - (a.role === myRole)));
    $('t-list').innerHTML = urgentFirst.slice(0, 9).map(t => `<li class="${t.urgent ? 'urgent' : ''} ${t.role === myRole ? 'mine' : ''} ${t.ok ? 'ok' : ''}">${esc(t.text)}</li>`).join('') || '<li class="ok">✨ All good! Keep shopping humming.</li>';
    setText('t-count', tasks.length ? `(${tasks.length})` : '');
    const evs = (M.events || []).filter(e => EVENT_TYPES[e.type] && e.type !== 'sale' && (e.until == null || (G.snap?.time ?? 0) < e.until));
    $('ev-active').innerHTML = evs.map(e => `<div class="ev">${EVENT_TYPES[e.type].icon} ${EVENT_TYPES[e.type].name}</div>`).join('') + (M.saleActive ? '<div class="ev">🏷️ Flash sale: 15% off</div>' : '');
    // dock badges
    const badge = (panel, n) => { const b = document.querySelector(`#dock button[data-panel="${panel}"]`); let el = b.querySelector('.badge'); if (n) { if (!el) { el = document.createElement('span'); el.className = 'badge'; b.appendChild(el); } el.textContent = n; } else if (el) el.remove(); };
    badge('orders', M.orders.length);
    badge('staff', 0);
    // player list
    $('playerlist').innerHTML = (G.players || []).map(p => `<div class="pp"><i style="background:${esc(p.color)}"></i>${esc(PLAYER_ROLES[p.role]?.icon || '')} ${esc(p.name)}${p.id === G.me ? ' (you)' : ''}</div>`).join('');
  }

  // ------------------------------------------------------------------------------------------ toasts
  toast(text, kind = 'info', icon = '') {
    const el = document.createElement('div'); el.className = 'toast ' + kind;
    el.innerHTML = `${icon ? `<span>${esc(icon)}</span>` : ''}<span>${esc(text)}</span>`;
    const box = $('toasts'); box.prepend(el);
    while (box.children.length > 6) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4800); setTimeout(() => el.remove(), 5300);
  }
  error(text) {
    const el = document.createElement('div'); el.className = 'e'; el.textContent = text;
    const box = $('toast-err'); box.prepend(el); while (box.children.length > 2) box.lastChild.remove();
    setTimeout(() => el.remove(), 2200); play('error');
  }
  chat(from, color, text) {
    const el = document.createElement('div'); el.innerHTML = `<b style="color:${esc(color)}">${esc(from)}:</b> ${esc(text)}`;
    const log = $('chat-log'); log.appendChild(el); while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => el.classList.add('fade'), 12000);
  }
  showEvent(ev) {
    const el = $('eventcard'); el.classList.remove('hidden');
    el.innerHTML = `<div class="ei">${esc(ev.icon)}</div><div><h3>${esc(ev.name)}</h3><p>${esc(ev.text)}</p>${ev.sale ? '<div class="btns"><button class="btn good small" id="ev-yes">🏷️ Run the sale!</button><button class="btn small" id="ev-no">No thanks</button></div>' : ''}</div>`;
    clearTimeout(this.evT);
    if (ev.sale) { $('ev-yes').onclick = () => { this.net.act('sale', { accept: true }); el.classList.add('hidden'); }; $('ev-no').onclick = () => { this.net.act('sale', { accept: false }); el.classList.add('hidden'); }; this.evT = setTimeout(() => el.classList.add('hidden'), 20000); }
    else this.evT = setTimeout(() => el.classList.add('hidden'), 7000);
  }
  showLevelUp(level, unlocks) {
    const el = $('levelup'); el.classList.remove('hidden');
    el.innerHTML = `<div class="lu"><div style="font-size:40px">🎉</div><h1>LEVEL ${level}!</h1>${unlocks.length ? `<b>New unlocks:</b><ul>${unlocks.map(u => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}</div>`;
    clearTimeout(this.luT); this.luT = setTimeout(() => el.classList.add('hidden'), 4500);
  }
  showReport(r) {
    const el = $('report'); el.classList.remove('hidden');
    const row = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    const top = r.top.map(([pid, n]) => `${PRODUCT_MAP[pid]?.icon} ${esc(PRODUCT_MAP[pid]?.name)} ×${n}`).join('<br>') || '<i>No sales</i>';
    const dem = r.demand.map(([pid, n]) => `${PRODUCT_MAP[pid]?.icon} ${esc(PRODUCT_MAP[pid]?.name)} (${n})`).join('<br>') || '<i>Nothing — great job!</i>';
    $('r-body').innerHTML = `<h2>🌙 Day ${r.day} Report</h2>
      <div class="report-hero">
        <div><small>Profit</small><div class="big-num" style="color:${r.profit >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(r.profit)}</div></div>
        <div><small>Customers served</small><div class="big-num">${r.served}</div></div>
        <div><small>Satisfaction</small><div class="big-num">${r.avgSat}%</div></div>
        <div><small>Reputation</small><div class="big-num stars" style="font-size:22px">${stars(r.rep)}</div></div>
      </div>
      <div class="report-grid">
        <div><div class="section-title">💰 Income</div>${row('Sales', fmtMoney(r.revenue), 'pos')}${row('Tips', fmtMoney(r.tips), 'pos')}${row('Bonuses & rewards', fmtMoney(r.bonus), 'pos')}${r.vending ? row('Vending machines', fmtMoney(r.vending), 'pos') : ''}
          <div class="section-title">💸 Expenses</div>${row('Stock orders', fmtMoney(r.cogs), 'neg')}${row('Salaries', fmtMoney(r.salaries), 'neg')}${row('Rent', fmtMoney(r.rent), 'neg')}${row('Electricity', fmtMoney(r.power), 'neg')}${row('Maintenance', fmtMoney(r.maint), 'neg')}${row('Equipment & other', fmtMoney(r.other), 'neg')}
          ${row('<b>Cash now</b>', fmtMoney(r.cash), r.cash >= 0 ? 'pos' : 'neg')}</div>
        <div>${r.challenge ? `<div class="section-title">⭐ Daily challenge</div><div class="kv"><span>${r.challenge.done ? '✅ Completed' : '❌ Missed'}</span><b class="${r.challenge.done ? 'pos' : 'neg'}">${r.challenge.done ? '+' + fmtMoney(r.challenge.reward) : '—'}</b></div>` : ''}<div class="section-title">👥 Customers</div>${row('Visitors', r.customers)}${row('Checked out', r.served)}${row('Left empty-handed', r.lost)}${row('Left angry 😡', r.angry, r.angry ? 'neg' : '')}${row('Products wasted', r.waste, r.waste ? 'neg' : '')}
          <div class="section-title">🏆 Best sellers</div><div class="note" style="font-size:13px">${top}</div>
          <div class="section-title">🗣️ Customers wanted</div><div class="note" style="font-size:13px">${dem}</div>
          ${r.quits.length ? `<div class="section-title">🚪 Quit</div><div class="note">${r.quits.map(esc).join(', ')}</div>` : ''}</div>
      </div>
      <div style="text-align:center;margin-top:16px"><button class="btn big primary" id="r-next">☀️ Start Day ${r.day + 1}</button><p class="note">Anyone can start the next day. New staff candidates are waiting!</p></div>`;
    $('r-next').onclick = () => this.net.act('continue');
  }

  // ------------------------------------------------------------------------------------------ panels
  openPanel(name) {
    if (this.panel === name) { this.closePanel(); return; }
    this.panel = name; $('panel').classList.remove('hidden');
    document.querySelectorAll('#dock button').forEach(b => b.classList.toggle('sel', b.dataset.panel === name));
    this.renderPanel(true); play('click');
  }
  closePanel() {
    this.panel = null; $('panel').classList.add('hidden');
    document.querySelectorAll('#dock button').forEach(b => b.classList.remove('sel'));
  }
  markDirty() { this.panelDirty = true; }
  maybeRender() {
    if (!this.panel || !this.panelDirty) return;
    const now = performance.now();
    if (now - this.lastRender < 400) return;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#p-body') && document.activeElement.tagName === 'INPUT') return;
    this.renderPanel();
  }
  renderPanel(scrollTop = false) {
    const body = $('p-body'); const sc = body.scrollTop;
    this.panelDirty = false; this.lastRender = performance.now();
    const fn = { orders: this.pOrders, inventory: this.pInventory, prices: this.pPrices, staff: this.pStaff, finance: this.pFinance, upgrades: this.pUpgrades, stats: this.pStats }[this.panel];
    if (!fn || !this.G.meta || !this.G.world) return;
    const [title, html] = fn.call(this);
    if (html === this.lastHtml && !scrollTop) return;
    this.lastHtml = html;
    $('p-title').innerHTML = title; body.innerHTML = html;
    if (!scrollTop) body.scrollTop = sc; else body.scrollTop = 0;
    if (this.panel === 'finance') this.drawChart();
  }

  stockCounts() {
    const W = this.G.world, c = {};
    const add = (pid, k, n) => { (c[pid] ||= { shelf: 0, box: 0, rack: 0, exp: 0 })[k] += n; };
    for (const f of W.furniture) {
      if (f.slots) for (const s of f.slots) if (s.pid && s.qty) add(s.pid, s.expired ? 'exp' : 'shelf', s.qty);
      if (f.boxes) for (const b of f.boxes) add(b.pid, 'rack', b.qty);
    }
    for (const b of W.boxes) add(b.pid, 'box', b.qty);
    return c;
  }

  pOrders() {
    const M = this.G.meta, lvl = M.level;
    const sups = SUPPLIERS;
    let sid = this.tab.orders || 'pantry';
    let h = '<div class="tabs">';
    for (const s of sups) h += `<button data-tab="orders" data-v="${s.id}" class="${s.id === sid ? 'sel' : ''} ${lvl < s.level ? 'locked' : ''}">${s.icon} ${esc(s.name)}${lvl < s.level ? ` 🔒${s.level}` : ''}</button>`;
    h += '</div>';
    const sup = SUPPLIER_MAP[sid];
    const cart = (this.cart[sid] ||= {});
    const counts = this.stockCounts();
    const shortage = (M.events || []).find(e => e.type === 'shortage');
    h += `<p class="note">${esc(sup.desc)} · Delivery fee <b>${fmtMoney(sup.fee)}</b> · Arrives in ~<b>${Math.round(sup.time * ((M.events || []).some(e => e.type === 'delay') ? 2 : 1))}s</b> · Min. order <b>${sup.minOrder} box${sup.minOrder > 1 ? 'es' : ''}</b>${sup.discounts.length ? ' · Bulk discounts: ' + sup.discounts.map(([n, p]) => `${n}+ boxes −${p}%`).join(', ') : ''}${sup.markup !== 1 ? ` · Prices ×${sup.markup}` : ''}</p>`;
    if (lvl < sup.level) h += `<p class="chip warn">🔒 Unlocks at store level ${sup.level}</p>`;
    h += `<table class="t"><tr><th></th><th>Product</th><th>Box</th><th>Box cost</th><th>Sells for</th><th>Margin</th><th>In store</th><th>Shelf life</th><th>Boxes</th></tr>`;
    const prods = PRODUCTS.filter(p => sup.cats.includes(p.cat));
    let boxes = 0, sub = 0;
    for (const p of prods) {
      const locked = lvl < p.level; const short = shortage && shortage.pid === p.id;
      const boxCost = p.box * p.cost * sup.markup;
      const q = cart[p.id] || 0; boxes += q; sub += q * boxCost;
      const c = counts[p.id] || { shelf: 0, box: 0, rack: 0, exp: 0 };
      const price = this.G.world.prices[p.id] ?? p.price;
      const margin = Math.round((price - p.cost * sup.markup) / price * 100);
      const dem = M.demand?.[p.id];
      h += `<tr class="${locked ? 'locked' : ''}"><td class="pico">${p.icon}</td><td><b>${esc(p.name)}</b> <span class="chip" style="background:${CATEGORIES[p.cat].color}22">${CATEGORIES[p.cat].icon}</span>${dem ? ` <span class="chip warn" title="Customers asked for this today">🗣️${dem}</span>` : ''}${short ? ' <span class="chip bad">OUT</span>' : ''}${locked ? ` <span class="chip">🔒 Lv${p.level}</span>` : ''}</td>
        <td>${p.box}×</td><td>${fmtMoney(boxCost)}</td><td>${fmtMoney(price)}</td><td><span class="chip ${margin > 40 ? 'good' : margin > 20 ? '' : 'bad'}">${margin}%</span></td>
        <td title="On shelves / boxes / rack">${c.shelf}${c.box || c.rack ? ` <span class="note">+${c.box + c.rack} boxed</span>` : ''}</td><td>${p.life}d</td>
        <td>${locked || short ? '' : `<span class="stepper"><button data-act="qty" data-pid="${p.id}" data-d="-1">−</button><b>${q}</b><button data-act="qty" data-pid="${p.id}" data-d="1">+</button><button data-act="qty" data-pid="${p.id}" data-d="5" title="+5">⁺⁵</button></span>`}</td></tr>`;
    }
    h += '</table>';
    const disc = discountFor(sup, boxes);
    const total = boxes ? sub * (1 - disc / 100) + sup.fee : 0;
    const okMin = boxes >= sup.minOrder;
    h += `<div class="order-foot"><div class="sum">${boxes} box${boxes !== 1 ? 'es' : ''} · Subtotal ${fmtMoney(sub)}${disc ? ` · <span class="chip good">−${disc}% bulk</span>` : ''} · Delivery ${fmtMoney(boxes ? sup.fee : 0)}<br>Total: <b>${fmtMoney(total)}</b> ${!okMin && boxes ? `<span class="chip warn">Min ${sup.minOrder} boxes</span>` : ''} ${total > M.cash ? '<span class="chip bad">Not enough cash</span>' : ''}</div>
      <div><button class="btn small" data-act="clearcart">Clear</button> <button class="btn primary" data-act="order" ${!boxes || !okMin || total > M.cash || lvl < sup.level ? 'disabled' : ''}>🚚 Place order</button></div></div>`;
    if (M.orders.length) {
      h += `<div class="section-title">🚚 On the way</div>`;
      for (const o of M.orders) {
        const pct = Math.round((1 - o.remaining / o.eta) * 100);
        h += `<div class="kv"><span>${SUPPLIER_MAP[o.supplier].icon} ${esc(SUPPLIER_MAP[o.supplier].name)} — ${o.items.map(i => `${i.boxes}× ${PRODUCT_MAP[i.pid].icon}`).join(' ')} <span class="note">by ${esc(o.by)}</span></span><b style="width:160px"><div class="bar"><div style="width:${pct}%;background:#22c55e"></div></div></b></div>`;
      }
    }
    return ['🚚 Order Stock', h];
  }

  pInventory() {
    const W = this.G.world, M = this.G.meta;
    const counts = this.stockCounts();
    let h = `<div class="section-title">📦 Products in the store</div><table class="t"><tr><th></th><th>Product</th><th>On shelves</th><th>In boxes</th><th>In racks</th><th>Expired</th><th>Sold today</th><th></th></tr>`;
    const list = PRODUCTS.filter(p => counts[p.id] || (M.ledger.sold || {})[p.id]);
    if (!list.length) h += `<tr><td colspan="8" class="note">Nothing in stock yet. Order products from suppliers (O)!</td></tr>`;
    for (const p of list) {
      const c = counts[p.id] || { shelf: 0, box: 0, rack: 0, exp: 0 };
      h += `<tr><td class="pico">${p.icon}</td><td><b>${esc(p.name)}</b></td><td>${c.shelf ? c.shelf : '<span class="chip bad">0</span>'}</td><td>${c.box}</td><td>${c.rack}</td><td>${c.exp ? `<span class="chip bad">${c.exp}</span>` : '-'}</td><td>${M.ledger.sold[p.id] || 0}</td><td><button class="btn small" data-act="reorder" data-pid="${p.id}">Reorder</button></td></tr>`;
    }
    h += `</table><div class="section-title">🧊 Fixtures</div><table class="t"><tr><th></th><th>Fixture</th><th>Contents</th><th>Fill</th><th>Status</th></tr>`;
    for (const f of W.furniture.filter(f => f.slots || f.boxes)) {
      const def = FURNITURE[f.type];
      let fill = 0, cont = '';
      if (f.slots) { fill = f.slots.reduce((a, s) => a + s.qty, 0) / (def.slots * def.cap); cont = f.slots.map(s => s.pid ? `${PRODUCT_MAP[s.pid].icon}${s.qty}${s.expired ? '🤢' : ''}` : '▫️').join(' '); }
      else { const cap = def.boxes + (f.upg ? 4 : 0); fill = f.boxes.length / cap; cont = f.boxes.map(b => PRODUCT_MAP[b.pid].icon).join(''); }
      const st = f.broken ? `<span class="chip bad">BROKEN ${f.temp}°C</span>${f.techEta != null ? ' <span class="chip">tech coming</span>' : ` <button class="btn small" data-act="tech" data-id="${f.id}">📞 Technician $180</button>`}` : f.temp !== undefined ? `<span class="chip blue">${f.temp}°C</span>` : '';
      h += `<tr><td class="pico">${def.icon}</td><td><b>${esc(def.name)}</b>${f.upg ? ' ⭐' : ''}</td><td>${cont}</td><td style="width:120px"><div class="bar"><div style="width:${Math.round(fill * 100)}%;background:${fill < 0.25 ? '#ef4444' : fill < 0.5 ? '#f59e0b' : '#22c55e'}"></div></div></td><td>${st}</td></tr>`;
    }
    h += '</table><p class="note">Tip: products expire! Shelf life is shown in the order menu. Clear expired items with E.</p>';
    return ['📦 Stock & Inventory', h];
  }

  pPrices() {
    const W = this.G.world, M = this.G.meta;
    let cat = this.tab.prices || 'grocery';
    let h = '<div class="tabs">';
    for (const [k, c] of Object.entries(CATEGORIES)) h += `<button data-tab="prices" data-v="${k}" class="${k === cat ? 'sel' : ''}">${c.icon} ${c.name}</button>`;
    h += `</div><div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap"><span class="note" style="align-self:center">All products:</span><button class="btn small" data-act="priceall" data-v="0.9">−10%</button><button class="btn small" data-act="priceall" data-v="1">Suggested</button><button class="btn small" data-act="priceall" data-v="1.1">+10%</button><button class="btn small" data-act="priceall" data-v="1.2">+20%</button></div>`;
    h += `<table class="t"><tr><th></th><th>Product</th><th>Cost</th><th>Suggested</th><th>Your price</th><th>Profit/unit</th><th>Customers think</th></tr>`;
    for (const p of PRODUCTS.filter(p => p.cat === cat)) {
      const locked = M.level < p.level;
      const price = W.prices[p.id] ?? p.price;
      const ratio = price / p.price;
      const react = ratio <= 0.85 ? ['🤑 Bargain!', 'good'] : ratio <= 1.02 ? ['🙂 Fair', 'good'] : ratio <= 1.15 ? ['🤔 A bit pricey', 'warn'] : ratio <= 1.35 ? ['😒 Expensive', 'bad'] : ['😡 Rip-off!', 'bad'];
      h += `<tr class="${locked ? 'locked' : ''}"><td class="pico">${p.icon}</td><td><b>${esc(p.name)}</b>${locked ? ` <span class="chip">🔒 Lv${p.level}</span>` : ''}</td><td>${fmtMoney(p.cost)}</td><td>${fmtMoney(p.price)}</td>
        <td><span class="stepper"><button data-act="price" data-pid="${p.id}" data-d="-0.1">−</button><input data-price="${p.id}" value="${price.toFixed(2)}" /><button data-act="price" data-pid="${p.id}" data-d="0.1">+</button></span></td>
        <td><b style="color:${price - p.cost > 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(price - p.cost)}</b></td><td><span class="chip ${react[1]}">${react[0]}</span></td></tr>`;
    }
    h += '</table><p class="note">Higher prices = more profit per sale, but customers may refuse to buy and get grumpy. Cheap prices make them happy.</p>';
    return ['🏷️ Pricing', h];
  }

  pStaff() {
    const M = this.G.meta;
    const payroll = M.staff.reduce((a, s) => a + Math.round(s.salary * SHIFTS[s.shift].pay), 0);
    const max = 4 + M.expansion * 3;
    let h = `<div class="section-title">👥 Your team (${M.staff.length}/${max}) · Payroll ${fmtMoney(payroll)}/day</div>`;
    if (!M.staff.length) h += '<p class="note">No employees yet. Hire a cashier so customers can check out while you do other jobs!</p>';
    h += '<div class="cards">';
    for (const s of M.staff) {
      const r = ROLES[s.role];
      const hc = s.happiness > 60 ? '#22c55e' : s.happiness > 30 ? '#f59e0b' : '#ef4444';
      h += `<div class="card"><div class="row"><span class="ci">${r.icon}</span><span class="chip ${s.absent ? 'bad' : s.present ? 'good' : ''}">${s.absent ? '🤒 Sick' : s.present ? '● Working' : 'Off duty'}</span></div>
        <h4>${esc(s.name)}</h4><p>${r.name} · <span class="stars">${skillStars(s.skill)}</span><br>Speed ${s.speed.toFixed(2)} · ${fmtMoney(s.salary)}/day (full)<br>Today: ${Math.round(s.served)} jobs</p>
        <div title="Happiness ${s.happiness}%">😊 <div class="bar" style="display:inline-block;width:70%;vertical-align:middle"><div style="width:${s.happiness}%;background:${hc}"></div></div></div>
        <select data-shift="${s.id}">${Object.entries(SHIFTS).map(([k, v]) => `<option value="${k}" ${s.shift === k ? 'selected' : ''}>${v.name} ${v.start}:00–${v.end}:00 (${Math.round(v.pay * 100)}% pay)</option>`).join('')}</select>
        <div class="row"><button class="btn small good" data-act="raise" data-id="${s.id}">💸 Raise +10%</button><button class="btn small bad" data-act="fire" data-id="${s.id}">Fire</button></div></div>`;
    }
    h += `</div><div class="section-title">📝 Job applicants (new ones each day)</div><div class="cards">`;
    if (!M.candidates.length) h += '<p class="note">No applicants right now. Check back tomorrow!</p>';
    for (const c of M.candidates) {
      const r = ROLES[c.role]; const locked = M.level < r.level;
      h += `<div class="card ${locked ? 'locked' : ''}"><div class="row"><span class="ci">${r.icon}</span><span class="price">${fmtMoney(c.salary)}<span class="note">/day</span></span></div>
        <h4>${esc(c.name)}</h4><p>${r.name} — ${esc(r.desc)}<br><span class="stars">${skillStars(c.skill)}</span> · Speed ${c.speed.toFixed(2)}</p>
        <button class="btn small primary" data-act="hire" data-id="${c.id}" ${locked || M.staff.length >= max ? 'disabled' : ''}>${locked ? `🔒 Level ${r.level}` : M.staff.length >= max ? 'Team full — expand' : '🤝 Hire'}</button></div>`;
    }
    h += '</div><p class="note">Happy employees work faster. Full-day shifts tire them out; raises and a break room help. Unhappy staff may quit!</p>';
    return ['👥 Staff', h];
  }

  pFinance() {
    const M = this.G.meta, L = M.ledger, W = this.G.world;
    let power = 12, maint = 0;
    for (const f of W.furniture) { const d = FURNITURE[f.type]; power += (d.power || 0) * (f.upg && d.kind === 'storage' ? 0.5 : 1); maint += d.maint || 0; }
    if (M.upgrades.led) power *= 0.7;
    const salaries = M.staff.filter(s => !s.absent).reduce((a, s) => a + Math.round(s.salary * SHIFTS[s.shift].pay), 0);
    const rent = EXPANSIONS[M.expansion].rent;
    const row = (k, v, cls = '') => `<div class="kv"><span>${k}</span><b class="${cls}">${v}</b></div>`;
    const inc = L.revenue + L.tips + L.bonus, spent = L.cogs + L.other + L.salaries + L.rent + L.power + L.maint;
    let h = `<div class="grid2"><div><div class="section-title">💰 Cash</div><div class="big-num" style="color:${M.cash >= 0 ? '#16a34a' : '#dc2626'}">${fmtMoney(M.cash)}</div>
      ${M.negativeDays ? `<p class="chip bad">In debt ${M.negativeDays} day(s) — 3 in a row means bankruptcy!</p>` : ''}
      <div class="section-title">📅 Today so far</div>${row('Sales revenue', fmtMoney(L.revenue), 'pos')}${row('Tips', fmtMoney(L.tips), 'pos')}${row('Bonuses', fmtMoney(L.bonus), 'pos')}
      ${row('Stock purchases', fmtMoney(L.cogs), 'neg')}${row('Equipment & other', fmtMoney(L.other), 'neg')}${row('<b>Net so far</b>', fmtMoney(inc - spent), inc - spent >= 0 ? 'pos' : 'neg')}
      <div class="section-title">🌙 Due at closing</div>${row('Salaries', fmtMoney(salaries), 'neg')}${row('Rent', fmtMoney(rent), 'neg')}${row('Electricity', fmtMoney(Math.round(power)), 'neg')}${row('Maintenance', fmtMoney(maint), 'neg')}
      ${row('<b>Total fixed costs</b>', fmtMoney(salaries + rent + Math.round(power) + maint), 'neg')}</div>
      <div><div class="section-title">📈 Last days</div><canvas class="chart" id="fin-chart"></canvas><div class="note">🟩 revenue · 🟥 expenses · ● profit</div>
      <div class="section-title">🏆 Best sellers (all time)</div>`;
    const best = Object.entries(M.stats.sold).sort((a, b) => b[1] - a[1]).slice(0, 6);
    h += best.map(([pid, n]) => { const p = PRODUCT_MAP[pid]; const pr = W.prices[pid] ?? p.price; return row(`${p.icon} ${esc(p.name)}`, `${n} sold · ${fmtMoney((pr - p.cost) * n)} profit`); }).join('') || '<p class="note">No sales yet.</p>';
    h += `<div class="section-title">📊 Today's stats</div>${row('Visitors', L.customers)}${row('Checked out', L.served)}${row('Left angry', L.angry, L.angry ? 'neg' : '')}${row('Avg satisfaction', L.satN ? Math.round(L.satSum / L.satN) + '%' : '-')}</div></div>`;
    return ['📊 Finances', h];
  }
  drawChart() {
    const cv = $('fin-chart'); if (!cv) return;
    const H = this.G.meta.history.slice(-14);
    const dpr = devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, w, h);
    if (!H.length) { g.fillStyle = '#94a3b8'; g.font = '700 13px Nunito'; g.fillText('Finish a day to see history', 10, h / 2); return; }
    const max = Math.max(100, ...H.map(d => Math.max(d.revenue, d.expenses)));
    const bw = w / H.length;
    const y = v => h - 18 - (v / max) * (h - 30);
    g.strokeStyle = '#e2e8f0'; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke();
    H.forEach((d, i) => {
      const x = i * bw;
      g.fillStyle = '#4ade80'; g.fillRect(x + bw * 0.12, y(d.revenue), bw * 0.36, y(0) - y(d.revenue));
      g.fillStyle = '#f87171'; g.fillRect(x + bw * 0.52, y(d.expenses), bw * 0.36, y(0) - y(d.expenses));
      g.fillStyle = '#64748b'; g.font = '700 10px Nunito'; g.textAlign = 'center'; g.fillText('D' + d.day, x + bw / 2, h - 4);
    });
    g.strokeStyle = '#2563eb'; g.lineWidth = 2; g.beginPath();
    H.forEach((d, i) => { const x = i * bw + bw / 2, yy = y(Math.max(0, d.profit)); i ? g.lineTo(x, yy) : g.moveTo(x, yy); }); g.stroke();
    H.forEach((d, i) => { g.fillStyle = d.profit >= 0 ? '#2563eb' : '#dc2626'; g.beginPath(); g.arc(i * bw + bw / 2, y(Math.max(0, d.profit)), 3.5, 0, 7); g.fill(); });
  }

  pUpgrades() {
    const M = this.G.meta;
    let h = '<div class="cards">';
    for (const u of TEAM_UPGRADES) {
      const owned = M.upgrades[u.id], locked = M.level < u.level, needs = u.requires && !M.upgrades[u.requires];
      h += `<div class="card ${owned ? 'owned' : ''} ${locked ? 'locked' : ''}"><span class="ci">${u.icon}</span><h4>${esc(u.name)}</h4><p>${esc(u.desc)}</p>
        <div class="row"><span class="price">${owned ? '✅ Owned' : fmtMoney(u.cost)}</span>${owned ? '' : `<button class="btn small primary" data-act="upgrade" data-id="${u.id}" ${locked || needs || M.cash < u.cost ? 'disabled' : ''}>${locked ? `🔒 Lv${u.level}` : needs ? 'Needs ' + TEAM_UPGRADES.find(x => x.id === u.requires).name : 'Buy'}</button>`}</div></div>`;
    }
    h += '</div><p class="note">Fixture upgrades (scanners, eco fridges, pro tools) are in Build mode — click a fixture.</p>';
    return ['⬆️ Team Upgrades', h];
  }

  pStats() {
    const M = this.G.meta;
    const cur = LEVEL_XP[M.level - 1], next = LEVEL_XP[M.level];
    const row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
    let h = `<div class="grid2"><div><div class="section-title">⭐ Store</div>${row('Level', `${M.level}${next ? ` (${M.xp - cur}/${next - cur} XP)` : ' (MAX)'}`)}<div class="bar" style="margin:4px 0 8px"><div style="width:${next ? (M.xp - cur) / (next - cur) * 100 : 100}%;background:linear-gradient(90deg,#a855f7,#ec4899)"></div></div>
      ${row('Reputation', `<span class="stars">${stars(M.rep)}</span> ${(M.rep / 20).toFixed(1)}`)}${row('Store appeal ✨', M.appeal)}${row('Days open', M.day)}${row('Customers served', M.stats.customers)}${row('Total revenue', fmtMoney(M.stats.revenue))}
      ${row('Your team checkouts', M.stats.playerCheckouts)}${row('Butcher customers', M.stats.butcher)}${row('Deli customers', M.stats.deli)}${row('VIPs delighted', M.stats.vip)}
      <div class="section-title">🎯 Goals</div><ol class="goals">${GOALS.map((g, i) => `<li class="${i < M.goalIndex ? 'done' : i === M.goalIndex ? 'cur' : ''}">${esc(g.text)}${g.reward ? ` <span class="note">(${fmtMoney(g.reward)})</span>` : ''}</li>`).slice(Math.max(0, M.goalIndex - 3), M.goalIndex + 5).join('')}</ol></div>
      <div><div class="section-title">🏆 Achievements (${Object.keys(M.achievements).length}/${ACHIEVEMENTS.length})</div><div class="ach">`;
    for (const a of ACHIEVEMENTS) { const got = M.achievements[a.id]; h += `<div class="${got ? 'yes' : 'no'}" title="${esc(a.desc)}"><i>${a.icon}</i><b>${esc(a.name)}</b>${esc(a.desc)}${got ? `<br><span class="note">Day ${got}</span>` : ''}</div>`; }
    h += `</div><div class="section-title">📰 Recent events</div>${(M.eventLog || []).slice(-6).reverse().map(e => `<div class="kv"><span>${EVENT_TYPES[e.type]?.icon} Day ${e.day}: ${esc(EVENT_TYPES[e.type]?.name)}</span></div>`).join('') || '<p class="note">Nothing exciting yet…</p>'}</div></div>`;
    return ['🏆 Progress & Achievements', h];
  }

  panelClick(e) {
    const b = e.target.closest('[data-tab],[data-act]'); if (!b) return;
    if (b.dataset.tab) { this.tab[b.dataset.tab] = b.dataset.v; this.renderPanel(true); play('click'); return; }
    const a = b.dataset.act, net = this.net;
    switch (a) {
      case 'qty': {
        const sid = this.tab.orders || 'pantry'; const cart = (this.cart[sid] ||= {});
        cart[b.dataset.pid] = Math.max(0, (cart[b.dataset.pid] || 0) + +b.dataset.d); play('click'); this.renderPanel(); break;
      }
      case 'clearcart': this.cart[this.tab.orders || 'pantry'] = {}; this.renderPanel(); break;
      case 'order': {
        const sid = this.tab.orders || 'pantry'; const cart = this.cart[sid] || {};
        const items = Object.entries(cart).filter(([, n]) => n > 0).map(([pid, boxes]) => ({ pid, boxes }));
        net.act('order', { supplier: sid, items }); this.cart[sid] = {}; setTimeout(() => this.renderPanel(), 200); break;
      }
      case 'reorder': {
        const p = PRODUCT_MAP[b.dataset.pid];
        const sup = SUPPLIERS.find(s => s.cats.includes(p.cat) && s.id !== 'express' && s.id !== 'mega' && this.G.meta.level >= s.level) || SUPPLIERS.find(s => s.cats.includes(p.cat));
        this.tab.orders = sup.id; const cart = (this.cart[sup.id] ||= {}); cart[p.id] = (cart[p.id] || 0) + Math.max(1, sup.minOrder - Object.values(cart).reduce((a, v) => a + v, 0));
        this.panel = null; this.openPanel('orders'); break;
      }
      case 'price': {
        const pid = b.dataset.pid; const cur = this.G.world.prices[pid] ?? PRODUCT_MAP[pid].price;
        const v = Math.round((cur + +b.dataset.d) * 100) / 100; this.G.world.prices[pid] = v; net.act('setPrice', { pid, price: v }); this.renderPanel(); break;
      }
      case 'priceall': net.act('priceAll', { mult: +b.dataset.v }); break;
      case 'hire': net.act('hire', { id: +b.dataset.id }); break;
      case 'fire': if (confirm('Let this employee go?')) net.act('fire', { id: +b.dataset.id }); break;
      case 'raise': net.act('raise', { id: +b.dataset.id }); break;
      case 'upgrade': net.act('buyUpgrade', { id: b.dataset.id }); break;
      case 'tech': net.act('callTech', { id: +b.dataset.id }); break;
    }
  }
  panelChange(e) {
    const t = e.target;
    if (t.dataset.price) { const v = parseFloat(t.value); if (!isNaN(v)) { this.G.world.prices[t.dataset.price] = v; this.net.act('setPrice', { pid: t.dataset.price, price: v }); } t.blur(); }
    if (t.dataset.shift) this.net.act('shift', { id: +t.dataset.shift, shift: t.value });
  }

  // station bar for the local player
  stationBar(inter) {
    const el = $('station-bar');
    if (!inter || !inter.station) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const s = inter.station;
    if (s.kind === 'checkout') {
      $('sb-title').textContent = s.idle ? `💵 Register open — ${s.queue || 0} in line` : s.pay ? '💳 All scanned! Press E to take payment' : `🛒 Scanning… ${s.scanned}/${s.total}`;
      $('sb-items').innerHTML = s.idle ? '⌛' : s.pids.map((pid, i) => `<span class="${i < s.scanned ? 'done' : ''}">${PRODUCT_MAP[pid].icon}</span>`).join('');
      $('sb-fill').style.width = s.idle ? '0%' : (s.scanned / Math.max(1, s.total) * 100) + '%';
      $('sb-hint').textContent = s.idle ? 'Customers will line up here. Walk away to leave the register.' : 'Tap or hold E to scan';
    } else {
      const p = s.pid ? PRODUCT_MAP[s.pid] : null;
      $('sb-title').textContent = s.idle ? '🧑‍🍳 Counter open — waiting for customers' : `Order: ${s.qty}× ${p.name} (${p.unit})`;
      $('sb-items').textContent = s.idle ? '⌛' : `${p.icon} × ${s.qty}`;
      $('sb-fill').style.width = s.idle ? '0%' : (s.progress / s.presses * 100) + '%';
      $('sb-hint').textContent = s.idle ? 'Walk away to leave the counter.' : 'Hold E to prepare the order';
    }
  }
}

function setText(id, t) { const el = $(id); if (el && el.textContent !== String(t)) el.textContent = t; }
export { esc, stars };
