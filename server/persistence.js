// JSON-file save games so teams can come back to their supermarket later.
import fs from 'node:fs';
import path from 'node:path';

export class Persistence {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.activeNames = () => [];
  }
  file(code) { return path.join(this.dir, code.replace(/[^A-Z0-9]/g, '') + '.json'); }
  exists(code) { return /^[A-Z0-9]{4,8}$/.test(code) && fs.existsSync(this.file(code)); }
  save(code, state) {
    const data = { code, savedAt: Date.now(), state };
    const tmp = this.file(code) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file(code));
  }
  load(code) {
    try { return JSON.parse(fs.readFileSync(this.file(code), 'utf8')).state; } catch { return null; }
  }
  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const d = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        out.push({ code: d.code, name: d.state.name, day: d.state.day, level: d.state.level, cash: d.state.cash, savedAt: d.savedAt });
      } catch { /* ignore corrupt */ }
    }
    return out.sort((a, b) => b.savedAt - a.savedAt).slice(0, 20);
  }
  isNameTaken(name, code) {
    const n = name.trim().toLowerCase();
    if (this.activeNames().some(r => r.code !== code && r.name && r.name.trim().toLowerCase() === n)) return true;
    return this.list().some(s => s.code !== code && s.name && s.name.trim().toLowerCase() === n);
  }
}
