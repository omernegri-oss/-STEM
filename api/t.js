// Supermarket stats: one Vercel function.
//   POST /api/t           the game sends a heartbeat every 45 s ({t:'hb'}) and error reports ({t:'bug'})
//   GET  /api/t           the private dashboard reads the numbers (header x-key = ADMIN_KEY)
// Who is online right now lives in memory (heartbeats rebuild it within a minute after a restart).
// Everything else is one small JSON document in Vercel Blob: users (first day, last day, platform), a count of
// players per day, and the bug list. No names, no IP addresses: a player is a random id made by their browser.
import { put, head } from '@vercel/blob';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const TZ = 'Asia/Jerusalem';
const dayKey = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
const daysAgo = (n) => dayKey(new Date(Date.now() - n * 86400000));
const ID = /^[a-z0-9]{8,24}$/;
const clip = (s, n) => String(s ?? '').slice(0, n);
const sha = (x) => createHash('sha256').update(String(x)).digest('hex');
// the dashboard key: ADMIN_KEY in the project's environment variables. Without it the dashboard stays closed
// (there is no built-in key: a key whose hash sits in public source code can be guessed offline).
const KEY_HASH = process.env.ADMIN_KEY ? sha(process.env.ADMIN_KEY) : '';
const PATH = () => `${(KEY_HASH || sha('no key')).slice(0, 20)}/data.json`;
const keyOk = (key) => !!KEY_HASH && !!key && timingSafeEqual(Buffer.from(sha(key), 'hex'), Buffer.from(KEY_HASH, 'hex'));

// limits, so nobody can fill the storage or the memory with made-up players
const MAX_BODY = 8 * 1024, POSTS_PER_MINUTE = 40, NEW_USERS_PER_HOUR_PER_ADDRESS = 30, NEW_USERS_PER_HOUR = 3000, MAX_USERS = 300000, MAX_LIVE = 20000;

const M = (globalThis.__stats ||= { live: new Map(), doc: null, loadedAt: 0, flushedAt: 0, dirty: false, lock: Promise.resolve(), bugWrites: 0, bugHour: 0, lastHb: 0,
  salt: randomBytes(16).toString('hex'), rate: new Map(), rateMinute: 0, newHour: 0, newUsers: 0, newBy: new Map() });
// tables keyed by text that comes from outside have no prototype: an id such as "constructor" is just an id
const table = (o) => Object.assign(Object.create(null), o);
const empty = () => ({ v: 1, users: table(), daily: table(), bugs: table() });
// who is sending: used only to count requests, kept in memory for a minute as a salted hash, never stored
const sender = (req) => sha(M.salt + String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim()).slice(0, 16);
function tooMany(who, now) {
  const minute = Math.floor(now / 60000);
  if (minute !== M.rateMinute) { M.rateMinute = minute; M.rate.clear(); }
  const n = (M.rate.get(who) || 0) + 1; M.rate.set(who, n);
  return n > POSTS_PER_MINUTE || M.rate.size > 50000;
}
function mayAddUser(who, now) {
  const hour = Math.floor(now / 3600000);
  if (hour !== M.newHour) { M.newHour = hour; M.newUsers = 0; M.newBy.clear(); }
  const n = M.newBy.get(who) || 0;
  if (n >= NEW_USERS_PER_HOUR_PER_ADDRESS || M.newUsers >= NEW_USERS_PER_HOUR) return false;
  M.newBy.set(who, n + 1); M.newUsers++;
  return true;
}

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
  for (const [u, v] of Object.entries(b.users || {})) {
    if (!ID.test(u) || !Array.isArray(v)) continue;
    const [first, last, p, n] = v;
    const x = a.users[u];
    if (!x) a.users[u] = [first, last, p, n]; else { if (first < x[0]) x[0] = first; if (last > x[1]) x[1] = last; x[3] = Math.max(x[3] || 1, n || 1); }
  }
  for (const [d, n] of Object.entries(b.daily || {})) a.daily[d] = Math.max(a.daily[d] || 0, +n || 0);
  for (const [h, g] of Object.entries(b.bugs || {})) {
    if (!g || typeof g !== 'object') continue;
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
      M.flushErr = '';
    } catch (e) { M.dirty = true; M.flushErr = String((e && e.message) || e).slice(0, 200); console.error('flush failed', M.flushErr); }
  });
  return M.lock;
}

async function ingest(req, res) {
  let m = req.body;
  if (+req.headers['content-length'] > MAX_BODY || (typeof m === 'string' && m.length > MAX_BODY)) return res.status(413).json({ ok: false });
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = null; } }
  if (!m || typeof m !== 'object' || typeof m.u !== 'string' || !ID.test(m.u)) return res.status(400).json({ ok: false });
  const u = m.u, p = m.p === 'app' ? 'a' : 'w', today = dayKey(), now = Date.now(), who = sender(req);
  if (tooMany(who, now)) return res.status(429).json({ ok: false });
  const doc = await load();
  if (m.t === 'hb') {
    const x = doc.users[u];
    // a player never seen before: only so many per hour, and never past the size the document can hold
    if (!x && (Object.keys(doc.users).length >= MAX_USERS || !mayAddUser(who, now))) return res.status(429).json({ ok: false });
    if (M.live.size >= MAX_LIVE && !M.live.has(u)) { for (const [k, v] of M.live) if (now - v.t > 100000) M.live.delete(k); }
    if (M.live.size < MAX_LIVE || M.live.has(u)) M.live.set(u, { t: now, p, s: m.s ? 1 : 0, v: clip(m.v, 16) });
    M.lastHb = now;
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
  // the key travels in a header, never in the address (addresses end up in logs and browser history)
  if (!KEY_HASH) return res.status(503).json({ ok: false, error: 'ADMIN_KEY is not set' });
  if (!keyOk(String(req.headers['x-key'] || ''))) return res.status(401).json({ ok: false, error: 'wrong key' });
  const doc = await load(req.query.fresh === '1');
  if (req.query.fixed) { // mark a bug as handled (it shows again if it happens again)
    const g = doc.bugs[String(req.query.fixed)]; if (g && typeof g === 'object') { g.fixed = true; M.dirty = true; await flushSoon(true); }
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
    lastHeartbeat: M.lastHb || null, saved: !M.dirty, storage: !!process.env.BLOB_READ_WRITE_TOKEN, storageError: M.flushErr || '' });
}

export default async function handler(req, res) {
  // the game posts from other sites (GitHub Pages, the desktop app); the dashboard is on this site and needs no CORS,
  // so the key header is deliberately not allowed from other origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method === 'POST') return await ingest(req, res);
    // a public health check (no numbers): is the service up, is storage connected
    if (req.method === 'GET' && req.query.health !== undefined) return res.status(200).json({ ok: true, storage: !!process.env.BLOB_READ_WRITE_TOKEN, storageOk: !M.flushErr });
    if (req.method === 'GET') return await stats(req, res);
    res.status(405).end();
  } catch (e) { console.error(e); res.status(500).json({ ok: false }); }
}
