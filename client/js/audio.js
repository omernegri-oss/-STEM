// Procedural sound effects & background music using WebAudio – no audio files needed.
let ctx = null, master = null, sfxGain = null, musicGain = null, noiseBuf = null;
export const audio = { sfx: true, music: true, sfxVol: 0.7, musicVol: 0.7, listener: { x: 0, z: 0 } };
const sfxLevel = () => (audio.sfx ? 0.8 * audio.sfxVol : 0), musicLevel = () => (audio.music ? 0.16 * audio.musicVol : 0);
// volumes 0..1 from the settings screen
export function setVolumes(sfxVol, musicVol) {
  audio.sfxVol = sfxVol; audio.musicVol = musicVol;
  if (sfxGain) sfxGain.gain.value = sfxLevel();
  if (musicGain) musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.1);
}
try { audio.sfx = localStorage.getItem('st_sfx') !== '0'; audio.music = localStorage.getItem('st_music') !== '0'; } catch {}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.gain.value = sfxLevel(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.gain.value = musicLevel(); musicGain.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  startMusic();
}
export function setSfx(on) { audio.sfx = on; try { localStorage.setItem('st_sfx', on ? '1' : '0'); } catch {} if (sfxGain) sfxGain.gain.value = sfxLevel(); }
export function setMusic(on) { audio.music = on; try { localStorage.setItem('st_music', on ? '1' : '0'); } catch {} if (musicGain) musicGain.gain.setTargetAtTime(musicLevel(), ctx.currentTime, 0.3); }

function tone(freq, dur, { type = 'sine', vol = 0.3, at = 0, slide = 0, attack = 0.005, out = sfxGain } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, { vol = 0.2, at = 0, freq = 2000, q = 1, type = 'bandpass' } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxGain); s.start(t); s.stop(t + dur + 0.02);
}

const SOUNDS = {
  beep: () => { tone(1760, 0.07, { type: 'square', vol: 0.12 }); },
  kaching: () => { tone(1318, 0.09, { type: 'triangle', vol: 0.25 }); tone(1975, 0.25, { type: 'triangle', vol: 0.22, at: 0.07 }); noise(0.12, { vol: 0.1, freq: 6000, at: 0.05 }); tone(2637, 0.3, { vol: 0.12, at: 0.12 }); },
  pickup: () => { tone(320, 0.09, { type: 'triangle', vol: 0.25, slide: 180 }); },
  drop: () => { tone(160, 0.12, { type: 'sine', vol: 0.35, slide: -80 }); noise(0.06, { vol: 0.12, freq: 400 }); },
  place: () => { tone(110, 0.18, { vol: 0.4, slide: -40 }); noise(0.1, { vol: 0.18, freq: 300 }); tone(660, 0.08, { type: 'triangle', vol: 0.12, at: 0.08 }); },
  remove: () => { tone(400, 0.2, { type: 'triangle', vol: 0.2, slide: -250 }); },
  pop: () => { tone(500 + Math.random() * 300, 0.06, { type: 'sine', vol: 0.18, slide: 400 }); },
  boxempty: () => { noise(0.15, { vol: 0.15, freq: 900, q: 0.6 }); tone(220, 0.1, { type: 'triangle', vol: 0.1, slide: -60 }); },
  trash: () => { noise(0.25, { vol: 0.25, freq: 700, q: 0.5 }); tone(140, 0.2, { vol: 0.2, slide: -70 }); },
  scrub: () => { noise(0.12, { vol: 0.12, freq: 3000, q: 2 }); },
  sparkle: () => { [1568, 2093, 2637].forEach((f, i) => tone(f, 0.18, { vol: 0.09, at: i * 0.05, type: 'triangle' })); },
  wrench: () => { tone(900, 0.05, { type: 'square', vol: 0.08 }); noise(0.06, { vol: 0.12, freq: 4000, q: 4 }); },
  fixed: () => { [523, 659, 784].forEach((f, i) => tone(f, 0.16, { vol: 0.16, at: i * 0.07, type: 'triangle' })); },
  click: () => { tone(1200, 0.03, { type: 'square', vol: 0.06 }); },
  chop: () => { noise(0.07, { vol: 0.3, freq: 1500, q: 1.2 }); tone(180, 0.06, { vol: 0.25, slide: -60 }); },
  slice: () => { noise(0.12, { vol: 0.16, freq: 5000, q: 3 }); },
  serve: () => { tone(784, 0.1, { type: 'triangle', vol: 0.18 }); tone(1046, 0.18, { type: 'triangle', vol: 0.16, at: 0.08 }); },
  order: () => { tone(880, 0.08, { type: 'square', vol: 0.06 }); tone(1175, 0.12, { type: 'square', vol: 0.06, at: 0.09 }); },
  hire: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.15, { vol: 0.14, at: i * 0.06, type: 'triangle' })); },
  upgrade: () => { [523, 784, 1046].forEach((f, i) => tone(f, 0.2, { vol: 0.15, at: i * 0.08, type: 'triangle' })); },
  error: () => { tone(180, 0.18, { type: 'sawtooth', vol: 0.08 }); tone(140, 0.22, { type: 'sawtooth', vol: 0.08, at: 0.1 }); },
  angry: () => { tone(220, 0.25, { type: 'sawtooth', vol: 0.07, slide: -100 }); },
  open: () => { tone(659, 0.35, { vol: 0.2 }); tone(523, 0.5, { vol: 0.2, at: 0.3 }); },
  door: () => { tone(988, 0.25, { vol: 0.08 }); tone(784, 0.35, { vol: 0.08, at: 0.18 }); },
  alarm: () => { for (let i = 0; i < 4; i++) tone(i % 2 ? 880 : 1175, 0.14, { type: 'square', vol: 0.12, at: i * 0.15 }); },
  honk: () => { tone(330, 0.22, { type: 'square', vol: 0.07 }); tone(330, 0.3, { type: 'square', vol: 0.07, at: 0.3 }); tone(415, 0.3, { type: 'square', vol: 0.05, at: 0.3 }); },
  event: () => { [784, 659, 784, 988].forEach((f, i) => tone(f, 0.12, { vol: 0.14, at: i * 0.1, type: 'square' })); },
  goal: () => { [659, 784, 988, 1318].forEach((f, i) => tone(f, 0.2, { vol: 0.15, at: i * 0.07, type: 'triangle' })); },
  fanfare: () => { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, i === 5 ? 0.6 : 0.16, { vol: 0.16, at: i * 0.11, type: 'triangle' })); },
  levelup: () => { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, { vol: 0.15, at: i * 0.08, type: 'triangle' })); noise(0.6, { vol: 0.05, freq: 8000, at: 0.4 }); },
  dayend: () => { [784, 659, 523, 392].forEach((f, i) => tone(f, 0.3, { vol: 0.12, at: i * 0.15 })); },
  ping: () => { tone(1400, 0.15, { vol: 0.15 }); tone(1400, 0.15, { vol: 0.08, at: 0.18 }); },
  coin: () => { tone(1975, 0.06, { type: 'square', vol: 0.06 }); tone(2637, 0.15, { type: 'square', vol: 0.06, at: 0.06 }); },
  punch: () => { tone(120, 0.12, { vol: 0.45, slide: -60 }); noise(0.1, { vol: 0.3, freq: 800, q: 0.7 }); },
  whoosh: () => { noise(0.18, { vol: 0.12, freq: 1800, q: 0.6 }); },
  fridgeOpen: () => { tone(300, 0.12, { type: 'triangle', vol: 0.08, slide: 120 }); noise(0.2, { vol: 0.05, freq: 500 }); },
  fridgeClose: () => { tone(160, 0.1, { vol: 0.2, slide: -40 }); },
  step: () => { noise(0.03, { vol: 0.03, freq: 600 }); },
};

export function play(name, x, z) {
  if (!ctx || !audio.sfx || !SOUNDS[name]) return;
  if (x !== undefined && z !== undefined && x !== null) {
    const d = Math.hypot(x - audio.listener.x, z - audio.listener.z);
    if (d > 28) return;
    if (d > 10 && Math.random() < (d - 10) / 18) return; // thin out far away noise
  }
  SOUNDS[name]();
}

// ------------------------------------------------------------- music: a cheerful elevator-muzak loop
let musicTimer = null;
function startMusic() {
  const bpm = 98, beat = 60 / bpm;
  // I - vi - IV - V in C major, jazzy 7ths
  const chords = [[261.6, 329.6, 392, 493.9], [220, 261.6, 329.6, 392], [174.6, 220, 261.6, 329.6], [196, 246.9, 293.7, 349.2]];
  const melody = [659, 784, 880, 784, 659, 587, 523, 587, 659, 523, 440, 523, 587, 659, 587, 494];
  let bar = 0, t0 = ctx.currentTime + 0.2;
  const schedule = () => {
    while (t0 < ctx.currentTime + 2) {
      const ch = chords[bar % 4];
      for (const f of ch) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f / 2;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 3.8);
        o.connect(g); g.connect(musicGain); o.start(t0); o.stop(t0 + beat * 4);
      }
      // bass
      const b = ctx.createOscillator(), bg = ctx.createGain();
      b.type = 'sine'; b.frequency.value = ch[0] / 4;
      bg.gain.setValueAtTime(0.0001, t0); bg.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02); bg.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 1.8);
      b.connect(bg); bg.connect(musicGain); b.start(t0); b.stop(t0 + beat * 2);
      const b2 = ctx.createOscillator(), bg2 = ctx.createGain();
      b2.type = 'sine'; b2.frequency.value = ch[2] / 4;
      bg2.gain.setValueAtTime(0.0001, t0 + beat * 2); bg2.gain.exponentialRampToValueAtTime(0.3, t0 + beat * 2 + 0.02); bg2.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 3.8);
      b2.connect(bg2); bg2.connect(musicGain); b2.start(t0 + beat * 2); b2.stop(t0 + beat * 4);
      // plucky melody (4 notes per bar)
      for (let i = 0; i < 4; i++) {
        if ((bar + i) % 5 === 4) continue;
        const f = melody[(bar * 4 + i) % melody.length];
        const o = ctx.createOscillator(), g = ctx.createGain();
        const t = t0 + i * beat;
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.9);
        o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + beat);
      }
      t0 += beat * 4; bar++;
    }
  };
  schedule();
  musicTimer = setInterval(schedule, 500);
}
