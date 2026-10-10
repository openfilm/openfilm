#!/usr/bin/env node
/**
 * The desktop app's performance benchmark: the same scenarios on the same film, measured the same way, so two
 * versions of the app can be compared. `node bench/run.mjs [--label name] [--runs n]` from apps/desktop.
 *
 * Each run is the scenarios in scenarios.mjs, in fresh launches of the `bench` flavour (src/flavor.mjs) in a throwaway
 * folder. The figures of every run are kept in bench/results/<label>.json, and their medians printed as a table.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { benchRun } from './scenarios.mjs';
import { report } from './report.mjs';
import { buildShell } from './app.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: { label: { type: 'string', default: 'baseline' }, runs: { type: 'string', default: '5' }, keep: { type: 'boolean', default: false } } });
const runs = Math.max(1, Number(values.runs) || 5);

buildShell();
const results = { label: values.label, date: new Date().toISOString(), machine: `${process.platform}-${process.arch}`, runs: [] };
for (let i = 0; i < runs; i += 1) {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-bench-'));
  process.stdout.write(`run ${i + 1}/${runs} … `);
  let failed = false;
  try {
    results.runs.push(await benchRun({ dir, log: (line) => { if (process.env.BENCH_VERBOSE) process.stderr.write(line); } }));
    process.stdout.write('done\n');
  } catch (e) {
    failed = true;
    results.runs.push({ error: String(e?.stack ?? e) });
    process.stdout.write(`failed: ${e?.message ?? e}\n  (its folder is kept: ${dir})\n`);
  } finally {
    if (!values.keep && !failed) rmSync(dir, { recursive: true, force: true });
  }
}
mkdirSync(join(here, 'results'), { recursive: true });
const out = join(here, 'results', `${values.label}.json`);
writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
console.log(report(results));
console.log(`\n→ ${out}`);
