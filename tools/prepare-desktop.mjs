// Copies the three.js files the game loads into vendor/three/ before a desktop build.
// (electron-builder leaves out node_modules/*/examples, which is where the three.js add-ons live.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'node_modules/three'), OUT = path.join(ROOT, 'vendor/three');
fs.rmSync(OUT, { recursive: true, force: true });
const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a, { withFileTypes: true })) { const x = path.join(a, f.name), y = path.join(b, f.name); f.isDirectory() ? copyDir(x, y) : fs.copyFileSync(x, y); } };
fs.mkdirSync(path.join(OUT, 'build'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'build/three.module.js'), path.join(OUT, 'build/three.module.js'));
for (const d of ['utils', 'environments', 'postprocessing', 'shaders', 'math']) copyDir(path.join(SRC, 'examples/jsm', d), path.join(OUT, 'addons', d));
console.log('vendor/three ready');
// release builds (CI) stamp the build id so bug reports say which version they came from
if (process.env.CI) {
  const stamp = `${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${(process.env.GITHUB_SHA || 'ci').slice(0, 7)}`;
  fs.writeFileSync(path.join(ROOT, 'client/js/version.js'), `export const BUILD = ${JSON.stringify(stamp)};\n`);
  console.log('build', stamp);
}
