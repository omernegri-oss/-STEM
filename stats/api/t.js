// Supermarket stats: one Vercel function.
//   POST /api/t           the game sends a heartbeat every 45 s ({t:'hb'}) and error reports ({t:'bug'})
//   GET  /api/t?key=...   the private dashboard reads the numbers (key = ADMIN_KEY)
// Who is online right now lives in memory (heartbeats rebuild it within a minute after a restart).
// Everything else is one small JSON document in Vercel Blob: users (first day, last day, platform), a count of
// players per day, and the bug list. No names, no IP addresses: a player is a random id made by their browser.
import { put, head } from '@vercel/blob';
import { createHash } from 'node:crypto';

const TZ = 'Asia/Jerusalem';
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const daysAgo = (n) => dayKey(new Date(Date.now() - n * 86400000));
const ID = /^[a-z0-9]{8,24}$/;
const clip = (s, n) => String(s ?? '').slice(0, n);
const PATH = () => `${createHash('sha256').update(String(process.env.ADMIN_KEY || 'dev')).digest('hex').slice(0, 20)}/data.json`;

const M = (globalThis.__stats ||= { live: new Map(), doc: null, loadedAt: 0, flushedAt: 0, dirty: false, lock: Promise.resolve(), bugWrites: 0, bugHour: 0, lastHb: 0 });
const empty = () => ({ v: 1, users: {}, daily: {}, bugs: {} });

async function readRemote() {
  try {
    const h = await head(PATH());
    const r = await fetch(`${h.url}?t=${Date.now()}`, { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* not created yet */ }
  return null;
}
// union of two documents (another instance may have written since we last read)
function merge(a, b) {
  if (!b) return a;
  for (const [u, [first, last, p, n]] of Object.entries(b.users || {})) {
    const x = a.users[u];
    if (!x) a.users[u] = [first, last, p, n]; else { if (first < x[0]) x[0] = first; if (last > x[1]) x[1] = last; x[3] = Math.max(x[3] || 1, n || 1); }
  }
  for (const [d, n] of Object.entries(b.daily || {})) a.daily[d] = Math.max(a.daily[d] || 0, n);
  for (const [h, g] of Object.entries(b.bugs || {})) {
    const x = a.bugs[h];
    if (!x) a.bugs[h] = g; else { if (g.first < x.first) x.first = g.first; if (g.last > x.last) x.last = g.last; x.n = Math.max(x.n, g.n); x.days = [...new Set([...(x.days || []), ...(g.days || [])])].sort().slice(-60); x.fixed = x.fixed || g.fixed; }
  }
  return a;
}
async function load(force = false) {
  if (M.doc && !force && Date.now() - M.loadedAt < 5 * 60000) return M.doc;
  const remote = await readRemote();
  M.doc = merge(M.doc || empty(), remote); M.loadedAt = Date.now();
  return M.doc;
}
// write at most every two minutes: storage operations are limited, heartbeats are frequent
function flushSoon(now = false) {
  if (!M.dirty) return M.lock;
  if (!now && Date.now() - M.flushedAt < 120000) return M.lock;
  M.flushedAt = Date.now(); M.dirty = false;
  M.lock = M.lock.then(async () => {
    try {
      merge(M.doc, await readRemote());
      // keep the document small: the daily history covers 400 days, the bug list the newest 200
      const days = Object.keys(M.doc.daily).sort(); for (const d of days.slice(0, -400)) delete M.doc.daily[d];
      const bugs = Object.entries(M.doc.bugs).sort((a, b) => (a[1].last < b[1].last ? 1 : -1)); for (const [h] of bugs.slice(200)) delete M.doc.bugs[h];
      await put(PATH(), JSON.stringify(M.doc), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60 });
    } catch (e) { M.dirty = true; console.error('flush failed', e && e.message); }
  });
  return M.lock;
}

async function ingest(req, res) {
  let m = req.body;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
  if (!m || !ID.test(String(m.u || ''))) return res.status(400).json({ ok: false });
  const u = m.u, p = m.p === 'app' ? 'a' : 'w', today = dayKey(), now = Date.now();
  const doc = await load();
  if (m.t === 'hb') {
    M.live.set(u, { t: now, p, s: m.s ? 1 : 0, v: clip(m.v, 16) }); M.lastHb = now;
    const x = doc.users[u];
    if (!x) { doc.users[u] = [today, today, p, 1]; doc.daily[today] = (doc.daily[today] || 0) + 1; M.dirty = true; }
    else if (x[1] !== today) { x[1] = today; x[2] = p; x[3] = (x[3] || 1) + 1; doc.daily[today] = (doc.daily[today] || 0) + 1; M.dirty = true; }
  } else if (m.t === 'bye') {
    M.live.delete(u);
  } else if (m.t === 'bug') {
    const msg = clip(m.m, 300), st = clip(m.st, 1500);
    if (!msg) return res.status(400).json({ ok: false });
    const hour = Math.floor(now / 3600000); if (hour !== M.bugHour) { M.bugHour = hour; M.bugWrites = 0; }
    if (M.bugWrites++ > 200) return res.status(429).json({ ok: false });
    const h = createHash('sha1').update(msg + '|' + st.split('\n').slice(0, 2).join('|')).digest('hex').slice(0, 12);
    const g = (doc.bugs[h] ||= { m: msg, st, first: today, last: today, n: 0, days: [], v: '', p: '', w: '', ua: '' });
    g.n++; g.last = today; if (!g.days.includes(today)) g.days.push(today);
    g.v = clip(m.v, 16); g.p = p === 'a' ? 'app' : 'web'; g.w = clip(m.w, 24); g.ua = clip(req.headers['user-agent'], 160); g.at = now; g.fixed = false;
    M.dirty = true;
  } else return res.status(400).json({ ok: false });
  await flushSoon();
  res.status(200).json({ ok: true });
}

async function stats(req, res) {
  const key = String(req.query.key || req.headers['x-key'] || '');
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) return res.status(401).json({ ok: false, error: 'wrong key' });
  const doc = await load(req.query.fresh === '1');
  if (req.query.fixed) { // mark a bug as handled (it shows again if it happens again)
    const g = doc.bugs[String(req.query.fixed)]; if (g) { g.fixed = true; M.dirty = true; await flushSoon(true); }
  }
  const now = Date.now(), today = dayKey(), d7 = daysAgo(6), d30 = daysAgo(29);
  for (const [u, v] of M.live) if (now - v.t > 100000) M.live.delete(u);
  const live = [...M.live.values()];
  let nToday = 0, n7 = 0, n30 = 0, all = 0, web = 0, app = 0, newToday = 0;
  for (const [first, last, p] of Object.values(doc.users)) {
    all++; if (p === 'a') app++; else web++;
    if (last === today) nToday++; if (last >= d7) n7++; if (last >= d30) n30++; if (first === today) newToday++;
  }
  const daily = []; for (let i = 29; i >= 0; i--) { const d = daysAgo(i); daily.push({ day: d, n: doc.daily[d] || 0 }); }
  const bugs = Object.entries(doc.bugs).map(([h, g]) => ({ h, ...g })).sort((a, b) => (a.at || 0) < (b.at || 0) ? 1 : -1);
  await flushSoon();
  res.status(200).json({ ok: true, now, today,
    online: { total: live.length, web: live.filter(v => v.p === 'w').length, app: live.filter(v => v.p === 'a').length, inStore: live.filter(v => v.s).length },
    today: nToday, newToday, week: n7, month: n30, all, platforms: { web, app }, daily, bugs,
    lastHeartbeat: M.lastHb || null, saved: !M.dirty });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-key');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'POST') return await ingest(req, res);
    if (req.method === 'GET') return await stats(req, res);
    res.status(405).end();
  } catch (e) { console.error(e); res.status(500).json({ ok: false }); }
}
