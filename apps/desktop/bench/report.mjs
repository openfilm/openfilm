#!/usr/bin/env node
/**
 * The figures that decide, as a table: each the median of the runs. With two result files, side by side:
 * `node bench/report.mjs results/baseline.json results/one-page.json`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
};
const get = (run, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), run);

/** [label, path in a run, unit, which way is better] */
export const ROWS = [
  ['Display refresh (compare only at the same)', 'play.film.displayHz', 'Hz', 'same'],
  ['Cold start to ready', 'start.readyMs', 'ms', 'lower'],
  ['Memory, idle · whole app', 'idle.memory.totalMB', 'MB', 'lower'],
  ['Memory, idle · pages', 'idle.memory.byKind.pages', 'MB', 'lower'],
  ['Play · film frames dropped', 'play.film.droppedPct', '%', 'lower'],
  ['Play · film frame p95', 'play.film.frameMs.p95', 'ms', 'lower'],
  ['Play · footage frames dropped', 'play.film.video.dropped', 'frames', 'lower'],
  ['Play · Studio long tasks', 'play.studio.longTasks.totalMs', 'ms', 'lower'],
  ['Stream+play · film frames dropped', 'stream.film.droppedPct', '%', 'lower'],
  ['Stream+play · film frame p95', 'stream.film.frameMs.p95', 'ms', 'lower'],
  ['Stream+play · footage frames dropped', 'stream.film.video.dropped', 'frames', 'lower'],
  ['Stream+play · chat frames dropped', 'stream.chat.droppedPct', '%', 'lower'],
  ['Stream+play · chat long tasks', 'stream.chat.longTasks.totalMs', 'ms', 'lower'],
  ['Stream+play · Studio long tasks', 'stream.studio.longTasks.totalMs', 'ms', 'lower'],
  ['Memory, streaming · whole app', 'stream.memory.totalMB', 'MB', 'lower'],
  ['Memory, streaming · pages', 'stream.memory.byKind.pages', 'MB', 'lower'],
  ['Scrub · film frames shown', 'scrub.scrub.framesShown', 'of 241', 'higher'],
  ['Scrub · Studio frames dropped', 'scrub.studio.droppedPct', '%', 'lower'],
  ['Divider · resize lag p50', 'divider.resize.lagMs.p50', 'ms', 'lower'],
  ['Divider · resize lag p95', 'divider.resize.lagMs.p95', 'ms', 'lower'],
  ['Divider · Studio frames dropped', 'divider.studio.droppedPct', '%', 'lower'],
  ['Divider · chat frames dropped', 'divider.chat.droppedPct', '%', 'lower'],
];

const ok = (results) => results.runs.filter((r) => !r.error);
const value = (results, path) => median(ok(results).map((r) => get(r, path)));
const fmt = (x) => (x == null ? '—' : String(x));

export function report(a, b = null) {
  const lines = [];
  const head = b ? `| | ${a.label} | ${b.label} | |` : `| | ${a.label} (${ok(a).length}/${a.runs.length} runs) |`;
  lines.push(head, b ? '|---|---:|---:|---|' : '|---|---:|');
  for (const [label, path, unit, better] of ROWS) {
    const x = value(a, path);
    if (!b) { lines.push(`| ${label} | ${fmt(x)} ${unit} |`); continue; }
    const y = value(b, path);
    const verdict = x == null || y == null ? '' : better === 'same' ? (x === y ? '' : 'not comparable') : x === y ? '=' : (better === 'lower' ? y < x : y > x) ? 'better' : 'worse';
    lines.push(`| ${label} | ${fmt(x)} ${unit} | ${fmt(y)} ${unit} | ${verdict} |`);
  }
  const failed = a.runs.filter((r) => r.error).concat(b ? b.runs.filter((r) => r.error) : []);
  if (failed.length) lines.push('', `${failed.length} run(s) failed: ${failed.map((r) => r.error.split('\n')[0]).join('; ')}`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
  if (!a) { console.error('usage: node bench/report.mjs <results.json> [<other results.json>]'); process.exit(1); }
  console.log(report(a, b ?? null));
}
