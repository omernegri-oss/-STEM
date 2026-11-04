// Writes steam/achievements.csv: the achievements to create in Steamworks (Stats & Achievements > Achievements).
// API names must match desktop/steam.mjs (ACH_<ID>).
import fs from 'node:fs';
import { ACHIEVEMENTS } from '../shared/data.js';
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const rows = [['API name', 'Display name', 'Description', 'Icon'].map(q).join(',')];
for (const a of ACHIEVEMENTS) rows.push([`ACH_${a.id.toUpperCase()}`, a.name, a.desc, a.icon].map(q).join(','));
const names = new Set(ACHIEVEMENTS.map(a => a.name)); if (names.size !== ACHIEVEMENTS.length) throw new Error('achievement display names must be unique');
fs.writeFileSync(new URL('../steam/achievements.csv', import.meta.url), rows.join('\n') + '\n');
console.log(`steam/achievements.csv: ${ACHIEVEMENTS.length} achievements`);
