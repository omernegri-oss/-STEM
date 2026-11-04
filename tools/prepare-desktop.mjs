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
