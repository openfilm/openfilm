#!/usr/bin/env node
// @ts-check
/**
 * node compare.mjs <reference video> <your film's video> [--out <png>]
 *
 * How closely a film follows its reference: each of the reference's cuts and moves against the nearest of the film's,
 * in frames, the two motion rhythms' correlation, how many states each has, and a picture of the two side by side at
 * the reference's states (reference left, film right). When the two lengths differ, the reference's times are scaled
 * to the film's.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measure, timeline } from './lib.mjs';

const args = process.argv.slice(2);
const [refFile, ourFile] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
if (!refFile || !ourFile) {
  console.error('node compare.mjs <reference video> <your film\'s video> [--out <png>]');
  process.exit(2);
}
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : ourFile.replace(/\.[^.]+$/, '.compare.png');

const ref = measure(refFile);
const ours = measure(ourFile);
const scale = Math.abs(ours.duration / ref.duration - 1) > 0.03 ? ours.duration / ref.duration : 1;
const at = (t) => t * scale;
const frame = 1 / ref.sampled;
const lines = [
  `reference ${ref.duration.toFixed(2)}s, ${ref.shots.length} shots · film ${ours.duration.toFixed(2)}s, ${ours.shots.length} shots${scale !== 1 ? ` · the reference's times scaled ×${scale.toFixed(3)} to the film's length` : ''}`,
];

/** Each of `want` against the nearest of `have`: off by how many frames, or missing (none within half a second). */
const match = (want, have) => want.map((t) => {
  const near = have.reduce((best, h) => (Math.abs(h - at(t)) < Math.abs(best - at(t)) ? h : best), Infinity);
  const off = near - at(t);
  return { t, off: Math.abs(off) <= 0.5 ? Math.round(off / frame) : null };
});
const report = (title, rows) => {
  if (!rows.length) return;
  const found = rows.filter((r) => r.off != null);
  const mean = found.length ? found.reduce((s, r) => s + Math.abs(r.off), 0) / found.length : 0;
  lines.push('', `${title}: ${found.length} of ${rows.length} matched, ${mean.toFixed(1)} frames off on average`);
  for (const r of rows) if (r.off == null || Math.abs(r.off) > 2) lines.push(`  ${r.t.toFixed(2)}s  ${r.off == null ? 'missing in the film' : `${r.off > 0 ? 'late' : 'early'} by ${Math.abs(r.off)} frames`}`);
};
const cuts = (m) => m.shots.slice(1).map((s) => s.from);
const moves = (m) => m.shots.flatMap((s) => s.moves.map((mv) => mv.from));
report('cuts', match(cuts(ref), cuts(ours)));
report('moves (where each starts)', match(moves(ref), moves(ours)));
const extra = cuts(ours).filter((t) => !cuts(ref).some((r) => Math.abs(at(r) - t) <= 0.5));
if (extra.length) lines.push(`  the film cuts where the reference does not: ${extra.map((t) => `${t.toFixed(2)}s`).join(', ')}`);

/* the rhythm: both motion curves at 10 a second over the same span, smoothed, correlated */
const curve = (m, stretch) => {
  const n = Math.floor(ours.duration * 10);
  return Array.from({ length: n }, (_, i) => {
    const t = i / 10 / stretch;
    const a = Math.floor(t * m.sampled); const b = Math.floor((t + 0.1 / stretch) * m.sampled);
    const span = m.motion.slice(a, Math.max(a + 1, b));
    return span.length ? Math.max(...span) : 0;
  });
};
/* smoothed over ±0.2 s: a move a few frames off still counts as the same move */
const smooth = (v) => v.map((_, i) => { let s = 0; let n = 0; for (let k = -2; k <= 2; k++) if (v[i + k] != null) { s += v[i + k]; n++; } return s / n; });
const x = smooth(curve(ref, scale)); const y = smooth(curve(ours, 1));
const mean = (v) => v.reduce((s, a) => s + a, 0) / (v.length || 1);
const [mx, my] = [mean(x), mean(y)];
let sxy = 0; let sxx = 0; let syy = 0;
for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
lines.push('', `motion rhythm: ${r.toFixed(2)} correlation (1: moves at the same moments; 0: unrelated)`);
if (ref.summary.bpm || ours.summary.bpm) lines.push(`beat: reference ${ref.summary.bpm ?? 'none'}, film ${ours.summary.bpm ?? 'none'}`);

/* the states: as many in the film as in the reference? side by side at each of the reference's, at most 12 rows */
const refStates = timeline(ref).filter((e) => e.kind === 'state');
const ourStates = timeline(ours).filter((e) => e.kind === 'state');
lines.push(`states: reference ${refStates.length}, film ${ourStates.length}`);
const picked = refStates.length > 12 ? Array.from({ length: 12 }, (_, i) => refStates[Math.floor((i * refStates.length) / 12)]) : refStates;
const rows = picked.map((st) => st.at);
const dir = mkdtempSync(join(tmpdir(), 'replicate-'));
try {
  const grab = (file, t, png) => spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1', '-vf', 'scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2', png], { windowsHide: true }).status === 0;
  const pngs = [];
  rows.forEach((t, i) => {
    const a = join(dir, `${i}-a.png`); const b = join(dir, `${i}-b.png`);
    if (grab(refFile, t, a) && grab(ourFile, Math.min(at(t), ours.duration - 0.05), b)) pngs.push([a, b]);
  });
  if (pngs.length) {
    const inputs = pngs.flat().flatMap((p) => ['-i', p]);
    const graph = `${pngs.map((_, i) => `[${2 * i}][${2 * i + 1}]hstack[r${i}]`).join(';')};${pngs.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${pngs.length}[out]`;
    const done = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', pngs.length > 1 ? graph : '[0][1]hstack[out]', '-map', '[out]', out], { windowsHide: true });
    if (done.status === 0) lines.push('', `side by side (reference left, film right), a row per reference state ${picked.slice(0, pngs.length).map((st) => st.n).join(', ')} → ${out}`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
console.log(lines.join('\n'));
