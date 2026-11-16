// JSON-file save games so teams can come back to their supermarket later.
import fs from 'node:fs';
import path from 'node:path';

export class Persistence {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.activeNames = () => [];
    this.index = null; // one summary line per save file, read once and kept up to date by save()
  }
  // a store code is the file name: anything that is not a plain code never reaches the disk
  valid(code) { return typeof code === 'string' && /^[A-Z0-9]{4,8}$/.test(code); }
  file(code) { if (!this.valid(code)) throw new Error('bad store code'); return path.join(this.dir, code + '.json'); }
  exists(code) { return this.valid(code) && fs.existsSync(this.file(code)); }
  summary(d) { return { code: d.code, name: d.state.name, day: d.state.day, level: d.state.level, cash: d.state.cash, savedAt: d.savedAt }; }
  save(code, state) {
    const data = { code, savedAt: Date.now(), state };
    const tmp = this.file(code) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file(code));
    if (this.index) this.index.set(code, this.summary(data));
  }
  load(code) {
    try { return JSON.parse(fs.readFileSync(this.file(code), 'utf8')).state; } catch { return null; }
  }
  // every save's summary (the menu asks every few seconds: the files are read once, not on every request)
  all() {
    if (!this.index) {
      this.index = new Map();
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith('.json') || !this.valid(f.slice(0, -5))) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
          if (d.code === f.slice(0, -5)) this.index.set(d.code, this.summary(d));
        } catch { /* ignore corrupt */ }
      }
    }
    return [...this.index.values()];
  }
  list() { return this.all().sort((a, b) => b.savedAt - a.savedAt).slice(0, 20); }
  isNameTaken(name, code) {
    const n = name.trim().toLowerCase();
    const same = (r) => r.code !== code && typeof r.name === 'string' && r.name.trim().toLowerCase() === n;
    return this.activeNames().some(same) || this.all().some(same);
  }
}
