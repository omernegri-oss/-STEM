// Desktop app only: on start, ask GitHub whether a newer release exists and offer to download it.
// The web version is always current, so it never checks. Release builds carry their number in version.js (RELEASE).
import { RELEASE } from './version.js';

const LATEST = 'https://api.github.com/repos/omernegri-oss/-STEM/releases/latest';

export async function checkForUpdate() {
  if (!window.desktopApp || !RELEASE) return;
  let rel;
  try {
    const r = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) return;
    rel = await r.json();
  } catch { return; } // offline: try again next start
  const n = +String(rel.tag_name || '').replace(/^build-/, '');
  if (!(n > RELEASE)) return;
  try { if (localStorage.getItem('st_skip_update') === String(n)) return; } catch {}
  const bar = document.getElementById('update-bar'); if (!bar) return;
  // the download for this computer, or the release page if it is not found
  const pf = navigator.userAgent;
  const want = /Windows/.test(pf) ? /windows-setup\.exe$/ : /Mac/.test(pf) ? /mac\.zip$/ : /linux\.tar\.gz$/;
  const asset = (rel.assets || []).find(a => want.test(a.name));
  const link = (asset && asset.browser_download_url) || rel.html_url;
  bar.querySelector('[data-up-text]').textContent = `A new version of the game is out (build ${n}, you have build ${RELEASE}).`;
  bar.querySelector('[data-up-get]').onclick = () => window.open(link, '_blank');
  bar.querySelector('[data-up-later]').onclick = () => { bar.classList.add('hidden'); try { localStorage.setItem('st_skip_update', String(n)); } catch {} };
  bar.classList.remove('hidden');
}
