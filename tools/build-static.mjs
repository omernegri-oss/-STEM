// Builds dist/: a static, single-player web version of the game (the game server runs in the browser).
// Usage: node tools/build-static.mjs [multiplayerUrl]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const THREE_V = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version;
fs.rmSync(OUT, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };
const copyDir = (from, to) => { for (const f of fs.readdirSync(from, { withFileTypes: true })) { const a = path.join(from, f.name), b = path.join(to, f.name); f.isDirectory() ? copyDir(a, b) : copy(a, b); } };
copyDir(path.join(ROOT, 'client'), OUT);
copyDir(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
for (const f of ['room.js', 'game.js', 'customers.js', 'staff.js']) copy(path.join(ROOT, 'server', f), path.join(OUT, 'server', f));
// bundle three.js and the add-ons the game uses, so the site is fully self-contained
copy(path.join(ROOT, 'node_modules/three/build/three.module.min.js'), path.join(OUT, 'vendor/three.module.js'));
for (const d of ['utils', 'environments', 'postprocessing', 'shaders', 'math']) copyDir(path.join(ROOT, 'node_modules/three/examples/jsm', d), path.join(OUT, 'addons', d));
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const mp = process.argv[2] || '';
html = html.replace('<script type="importmap">', `<script>window.ST_STATIC = true;${mp ? ` window.ST_MP_URL = ${JSON.stringify(mp)};` : ''}</script>\n  <script type="importmap">`);
// relative paths so the build works from any folder or host (also as a claude.ai artifact)
html = html.replace(/(href|src)="\/(css|js)\//g, '$1="./$2/').replace('"/vendor/three.module.js"', '"./vendor/three.module.js"').replace('"/addons/"', '"./addons/"');
for (const f of fs.readdirSync(path.join(OUT, 'js'))) {
  const p = path.join(OUT, 'js', f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '\/(shared|server)\//g, "from '../$1/"));
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);
// artifact.html: the same page without the document wrapper (the artifact host adds its own)
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta [^>]*>\s*/g, '');
// the claude.ai viewer blocks <a download>: there, download buttons open the file in a new tab instead
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/(<a class="btn" id="dl-[a-z]+") download>/g, '$1 target="_blank" rel="noopener">');
// the artifact host may only allow fonts from Google Fonts: ask for the same families there as a fallback
const GF = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@500;600;700&family=Playfair+Display:wght@700;900&family=Archivo+Black&family=Pacifico&display=swap" />\n';
fs.writeFileSync(path.join(OUT, 'artifact.html'), GF + head.trim() + '\n<style>html,body{height:100%;margin:0;padding:0;background:#10161d}:root{padding:0}</style>\n' + body.trim() + '\n');
fs.writeFileSync(path.join(OUT, 'vercel.json'), JSON.stringify({ cleanUrls: false, headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=300' }] }] }, null, 2));
const files = []; (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); f.isDirectory() ? walk(p) : files.push(path.relative(OUT, p)); } })(OUT);
console.log(`dist/ built: ${files.length} files, three@${THREE_V} bundled${mp ? ', multiplayer link ' + mp : ''}`);
