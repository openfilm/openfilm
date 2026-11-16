#!/usr/bin/env node
// A real Studio draft export, with sampled logical disk use. Run against a project COPY.
import { readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const [projectArg, outputArg, moduleArg, resultArg, workersArg] = process.argv.slice(2);
if (!projectArg || !outputArg) throw new Error('bench-draft-export.mjs PROJECT_COPY OUTPUT_FOLDER [EXPORTS_MODULE] [RESULT_JSON] [WORKERS|auto]');
const workers = workersArg == null || workersArg === 'auto' ? undefined : Number(workersArg);
if (workers != null && (!Number.isInteger(workers) || workers < 1 || workers > 8)) throw new Error('WORKERS: auto or 1–8');
const root = resolve(projectArg), output = resolve(outputArg);
const resultFile = resolve(resultArg ?? join(output, 'benchmark.json'));
process.env.OPENFILM_HOME = join(dirname(output), 'benchmark-home');
const { createExports } = await import(moduleArg ? pathToFileURL(resolve(moduleArg)).href : '../studio/server/exports.mjs');
await mkdir(output, { recursive: true });
async function bytes(path) {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return s.size;
    return (await Promise.all((await readdir(path)).map((n) => bytes(join(path, n))))).reduce((a, b) => a + b, 0);
  } catch (e) { if (e.code === 'ENOENT') return 0; throw e; }
}
let latest, told = 0;
const exports = createExports({ drafts: () => null, onChange(job) {
  latest = job;
  if (Date.now() - told > 10_000 || ['failed', 'done', 'cancelled'].includes(job.status)) {
    told = Date.now();
    console.log(JSON.stringify({ status: job.status, phase: job.phase, frame: job.framesDone, total: job.framesTotal, rate: job.rate, encoder: job.encoder, error: job.error }));
  }
} });
const started = performance.now();
exports.start({ id: 'benchmark', name: 'T12 benchmark', path: root }, { kind: 'nle', format: 'jianying', fps: 30, ...(workers != null ? { workers } : {}) }, { folder: output });
const samples = [];
while (!latest || !['done', 'failed', 'cancelled'].includes(latest.status)) {
  const [out, cache] = await Promise.all([bytes(output), bytes(join(root, '.film', 'cache'))]);
  samples.push({ seconds: (performance.now() - started) / 1000, outputBytes: out, cacheBytes: cache });
  await delay(1000);
}
const result = { startedAt: new Date(Date.now() - (performance.now() - started)).toISOString(), seconds: (latest.finishedAt - latest.startedAt) / 1000,
  peakLogicalOutputBytes: Math.max(0, ...samples.map((s) => s.outputBytes)), peakLogicalCacheBytes: Math.max(0, ...samples.map((s) => s.cacheBytes)),
  note: 'Disk samples are logical file sizes at one-second intervals, not physical APFS allocation. Use a project copy; original media may be cloned by the filesystem.', job: latest, samples };
await writeFile(resultFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ seconds: result.seconds, bytes: latest.bytes, result: resultFile, status: latest.status }));
if (latest.status !== 'done') process.exitCode = 1;
