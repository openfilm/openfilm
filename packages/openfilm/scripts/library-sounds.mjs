#!/usr/bin/env node
/**
 * The library's sound effects (library/sounds/), made by code: each one a few lines of noise, tones and envelopes,
 * written as a WAV and encoded to AAC by ffmpeg. Run again after changing one; the files are committed.
 *
 *   node scripts/library-sounds.mjs [name …]
 *
 * Every sound here is the OpenFilm contributors' own and is CC0, as the rest of library/ (library/LICENSE.md).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'library', 'sounds');
const RATE = 48000;

/* a fixed seed: the same sound every run */
let seed = 0x2545f491;
const noise = () => { seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return (((x ^ (x >>> 14)) >>> 0) / 4294967296) * 2 - 1; };

/** A sound `secs` long, sample by sample: `fn(t, i)` gives the sample at time t. */
const make = (secs, fn) => Float32Array.from({ length: Math.round(secs * RATE) }, (_, i) => fn(i / RATE, i));
/** Rises over `a` seconds, then falls away with time constant `d`. */
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
/** A band-pass filter whose center may move: `f(t)` in Hz, quality q. Returns a function of the next sample. */
function bandpass(q) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f) => {
    const w = (2 * Math.PI * Math.min(f, RATE / 2.2)) / RATE, alpha = Math.sin(w) / (2 * q);
    const b0 = alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
    const y = (b0 * x - b0 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}
/** A one-pole low-pass at `f` Hz. */
function lowpass(f) { let y = 0; const k = 1 - Math.exp((-2 * Math.PI * f) / RATE); return (x) => (y += k * (x - y)); }
/** A sine whose frequency follows `f(t)`, its phase carried on. */
function sweep() { let phase = 0; return (f) => { phase += (2 * Math.PI * f) / RATE; return Math.sin(phase); }; }

const SOUNDS = {
  whoosh: () => { const bp = bandpass(1.2); return make(0.7, (t) => bp(noise(), 300 * 14 ** Math.sin((Math.PI * t) / 0.7)) * Math.sin((Math.PI * t) / 0.7) ** 2 * 3); },
  'whoosh-low': () => { const bp = bandpass(0.8); return make(1.2, (t) => bp(noise(), 90 * 9 ** Math.sin((Math.PI * t) / 1.2)) * Math.sin((Math.PI * t) / 1.2) ** 2 * 4); },
  swish: () => { const bp = bandpass(2.5); return make(0.35, (t) => bp(noise(), 2000 + 6000 * (t / 0.35)) * Math.sin((Math.PI * t) / 0.35) * 2.5); },
  riser: () => { const bp = bandpass(3), s = sweep(); return make(2.2, (t) => { const p = t / 2.2; return (bp(noise(), 200 * 40 ** p) * 1.6 + s(110 * 8 ** p) * 0.18) * p ** 2 * (t > 2.1 ? (2.2 - t) * 10 : 1); }); },
  drop: () => { const s = sweep(); return make(1.4, (t) => s(900 * (60 / 900) ** (t / 1.4)) * env(t, 0.01, 0.6) * 0.7); },
  boom: () => { const s = sweep(), lp = lowpass(900); return make(1.6, (t) => (s(150 * Math.exp(-t * 4) + 38) * 0.9 + lp(noise()) * Math.exp(-t * 18) * 0.8) * env(t, 0.003, 0.5)); },
  hit: () => { const lp = lowpass(3000); return make(0.5, (t) => (lp(noise()) * 1.4 + Math.sin(2 * Math.PI * 90 * t) * 0.6) * env(t, 0.001, 0.08)); },
  kick: () => { const s = sweep(); return make(0.45, (t) => s(160 * Math.exp(-t * 18) + 45) * env(t, 0.002, 0.14)); },
  ding: () => make(1.4, (t) => (Math.sin(2 * Math.PI * 1320 * t) * 0.6 + Math.sin(2 * Math.PI * 2640 * t) * 0.2 + Math.sin(2 * Math.PI * 3960 * t) * 0.07) * env(t, 0.004, 0.45)),
  pop: () => { const s = sweep(); return make(0.15, (t) => s(300 + 900 * Math.exp(-t * 40)) * env(t, 0.002, 0.03)); },
  click: () => { const bp = bandpass(4); return make(0.06, (t) => bp(noise(), 3500) * env(t, 0.0005, 0.006) * 4); },
  typing: () => {
    const bp = bandpass(3), keys = [0.05, 0.19, 0.31, 0.47, 0.58, 0.74, 0.86, 1.02, 1.15, 1.31, 1.42, 1.58];
    return make(1.75, (t) => { const k = keys.reduce((a, b) => (b <= t ? b : a), -1); return k < 0 ? 0 : bp(noise(), 2600) * env(t - k, 0.0008, 0.012) * 5; });
  },
  shutter: () => { const bp = bandpass(2); return make(0.3, (t) => bp(noise(), 1800) * (env(t, 0.001, 0.015) + (t > 0.09 ? env(t - 0.09, 0.001, 0.02) : 0)) * 5); },
  buzz: () => make(0.9, (t) => Math.sign(Math.sin(2 * Math.PI * 160 * t)) * 0.12 * (Math.floor(t / 0.3) % 2 === 0 ? 1 : 0) * Math.min(1, (0.9 - t) * 20)),
  notify: () => make(0.8, (t) => (Math.sin(2 * Math.PI * 880 * t) * env(t, 0.004, 0.18) + (t > 0.14 ? Math.sin(2 * Math.PI * 1318.5 * t) * env(t - 0.14, 0.004, 0.25) : 0)) * 0.5),
  heartbeat: () => { const s = sweep(); return make(1.6, (t) => { const b = t % 0.8; const k = b < 0.25 ? b : b - 0.25; return s(60) * env(k, 0.004, 0.06) * (b < 0.25 ? 1 : 0.7) * 1.1; }); },
  tick: () => { const bp = bandpass(6); return make(2, (t) => { const k = t % 0.5; return bp(noise(), Math.floor(t / 0.5) % 2 ? 2200 : 3000) * env(k, 0.0005, 0.008) * 6; }); },
  zap: () => { const s = sweep(); return make(0.4, (t) => Math.sign(s(1200 * Math.exp(-t * 6) + 80)) * 0.18 * env(t, 0.002, 0.15) * (Math.floor(t * 60) % 3 ? 1 : 0.2)); },
  rain: () => { const lp = lowpass(5000), hp = lowpass(400); return make(8, (t) => { const n = lp(noise()); return (n - hp(n)) * 0.5 * Math.min(1, t * 2, (8 - t) * 2); }); },
  wind: () => { const bp = bandpass(1.5); return make(8, (t) => bp(noise(), 300 + 200 * Math.sin(t * 0.9) + 120 * Math.sin(t * 2.3)) * 1.2 * Math.min(1, t, 8 - t)); },
};

/** The sound, its loudest peak at -1 dBFS, as a 16-bit mono WAV. */
function wav(samples) {
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-9);
  const gain = 0.89 / peak;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v * gain)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const asked = process.argv.slice(2);
const unknown = asked.filter((n) => !(n in SOUNDS));
if (unknown.length) { console.error(`no such sound: ${unknown.join(', ')} (there are ${Object.keys(SOUNDS).join(', ')})`); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const tmp = join(tmpdir(), `openfilm-sounds-${process.pid}.wav`);
for (const [name, fn] of Object.entries(SOUNDS)) {
  if (asked.length && !asked.includes(name)) continue;
  writeFileSync(tmp, wav(fn()));
  const out = join(OUT, `${name}.m4a`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', tmp, '-c:a', 'aac', '-b:a', '128k', out], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(1);
  console.log(`→ library/sounds/${name}.m4a`);
}
rmSync(tmp, { force: true });
