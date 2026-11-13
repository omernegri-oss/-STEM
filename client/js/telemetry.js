// Anonymous usage statistics and error reports, so the developer can see how many people play and what breaks.
// What is sent: a random id made in this browser (no name, no account), web or app, the build, whether you are in a
// store, and JavaScript errors (message and stack trace). Nothing else. Players can turn it off in Settings.
import { BUILD } from './version.js';

// the stats service (stats/ in the repository, hosted on Vercel). Empty = nothing is ever sent.
export const STATS_URL = '';

const off = () => { try { return localStorage.getItem('st_stats') === '0'; } catch { return false; } };
export const telemetryAllowed = () => !off();
export function setTelemetry(on) { try { localStorage.setItem('st_stats', on ? '1' : '0'); } catch {} if (on) beat(); }
// never from automated tests, and never when there is no service
const enabled = () => !!STATS_URL && !window.ST_NO_ONLINE && !navigator.webdriver && !off();

function uid() {
  try {
    let u = localStorage.getItem('st_uid');
    if (!/^[a-z0-9]{12}$/.test(u || '')) { u = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join(''); localStorage.setItem('st_uid', u); }
    return u;
  } catch { return null; }
}
const platform = () => (window.desktopApp ? 'app' : 'web');
const version = () => (window.desktopApp ? `app ${window.desktopApp.info?.version || ''} ${BUILD}`.trim() : BUILD).slice(0, 16);

function send(obj) {
  const u = uid(); if (!u || !enabled()) return;
  // text/plain keeps this a "simple" request: no CORS preflight
  try { fetch(STATS_URL, { method: 'POST', body: JSON.stringify({ ...obj, u, p: platform(), v: version() }), headers: { 'content-type': 'text/plain' }, keepalive: true, mode: 'cors', credentials: 'omit' }).catch(() => {}); } catch {}
}

let state = () => ({ inStore: false, where: 'menu' });
function beat() { const s = state(); if (document.hidden && !s.inStore) return; send({ t: 'hb', s: s.inStore ? 1 : 0 }); }

const reported = new Set();
// an error report: at most 8 different ones per session
export function reportBug(message, stack = '') {
  const m = String(message || '').slice(0, 300); if (!m || reported.has(m) || reported.size >= 8) return;
  if (/ResizeObserver loop|^Script error\.?$/.test(m) || /(chrome|moz|safari)-extension:\/\//.test(stack || '')) return; // browser noise, other people's extensions
  reported.add(m);
  send({ t: 'bug', m, st: String(stack || '').slice(0, 1500), w: state().where });
}

export function initTelemetry(getState) {
  state = getState;
  addEventListener('error', (e) => reportBug(e.message || (e.error && e.error.message), e.error && e.error.stack || `${e.filename || ''}:${e.lineno || ''}`));
  addEventListener('unhandledrejection', (e) => { const r = e.reason; reportBug('Unhandled: ' + (r && r.message || r), r && r.stack); });
  beat();
  setInterval(beat, 45000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) beat(); });
  addEventListener('pagehide', () => { const u = uid(); if (u && enabled() && navigator.sendBeacon) navigator.sendBeacon(STATS_URL, JSON.stringify({ t: 'bye', u })); });
}
