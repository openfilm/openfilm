#!/usr/bin/env node
/**
 * The engine suite (test/engine/), written down: run it in the browser this checkout exports with and keep what it
 * found, or compare what two runs found (two engines: before and after an upgrade of Playwright or Electron).
 *
 *   node scripts/engine-report.mjs [--out <folder>] [--only <id,id>]
 *       report.json, report.md and the pictures drawn (order A, and any that differed), in <folder>
 *   node scripts/engine-report.mjs --compare <before folder> <after folder> [--out <folder>]
 *       compare.md: capabilities that changed, each technique's pictures compared between the two engines, timings
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { launch } from '../src/host.mjs';
import { ORDER_A, pictureTools, runSuite } from '../test/engine/suite.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: 'string' }, only: { type: 'string' }, compare: { type: 'boolean', default: false } },
});

/** A value of the report, short, for a table. */
const shown = (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));

/** Every leaf of an object, by its dotted path. */
function leaves(obj, at = '', out = new Map()) {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) leaves(v, at ? `${at}.${k}` : k, out);
  } else out.set(at, obj);
  return out;
}

function markdown(report) {
  const c = report.capabilities ?? {};
  const lines = [`# Engine report: ${report.engine.browser} (${report.engine.platform} ${report.engine.arch})`, '',
    `WebGL2: ${c.webgl2?.renderer ?? 'none'}  `, `WebGPU: ${c.webgpu?.adapter ?? 'none'}  `,
    `HTML-in-Canvas: layoutsubtree ${shown(c.htmlInCanvas?.layoutsubtree)}; content="drawable" ${shown(c.htmlInCanvas?.contentDrawable)}`, '',
    '| technique | same t, same picture | open ms | first frame ms | frame ms (draw + capture) | note |', '|---|---|---|---|---|---|'];
  for (const t of report.techniques) {
    const same = t.skipped ? 'skipped' : t.error ? 'error' : t.differing?.length ? `${t.differing.length} differ` : 'yes';
    const note = t.skipped ?? t.error?.split('\n')[0] ?? [t.probeFailed?.length ? `page said: ${t.probeFailed[0]}` : '', t.colors <= 2 ? 'blank picture' : '',
      t.alpha ? t.alpha.map((a) => `${a.format} ${a.made ? (a.ok ? 'ok' : `off (square ${a.squareOff}, clear ${a.clearOff})`) : 'not made'}`).join(', ') : '',
      t.probe?.videoDrawn !== undefined ? `video drawn: ${t.probe.videoDrawn}` : '', t.probe?.paintWaits ? `paint waits: ${t.probe.paintWaits}` : ''].filter(Boolean).join('; ');
    lines.push(`| ${t.id} | ${same} | ${t.openMs ?? ''} | ${t.firstFrameMs ?? ''} | ${t.frameMs ?? ''} | ${note.replace(/\|/g, '/')} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function compare(beforeDir, afterDir, outDir) {
  const before = JSON.parse(readFileSync(join(beforeDir, 'report.json'), 'utf8'));
  const after = JSON.parse(readFileSync(join(afterDir, 'report.json'), 'utf8'));
  const lines = [`# ${before.engine.browser} → ${after.engine.browser}`, '', '## Capabilities that changed', '', '| capability | before | after |', '|---|---|---|'];
  const a = leaves(before.capabilities), b = leaves(after.capabilities);
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (key === 'userAgent') continue;
    if (JSON.stringify(a.get(key)) !== JSON.stringify(b.get(key))) lines.push(`| ${key} | ${shown(a.get(key)).replace(/\|/g, '/')} | ${shown(b.get(key)).replace(/\|/g, '/')} |`);
  }
  lines.push('', '## Techniques', '', '| technique | same t (before → after) | open ms | frame ms | pictures between engines (t: pixels differing, largest difference) |', '|---|---|---|---|---|');
  const browser = await launch();
  const tools = await pictureTools(browser);
  try {
    for (const t of after.techniques) {
      const o = before.techniques.find((x) => x.id === t.id) ?? {};
      const same = (r) => (!r.id ? 'absent' : r.skipped ? 'skipped' : r.error ? 'error' : r.differing?.length ? `${r.differing.length} differ` : 'yes');
      const between = [];
      for (const at of ORDER_A) {
        const p = join(beforeDir, 'pictures', `${t.id}-${at}.png`), q = join(afterDir, 'pictures', `${t.id}-${at}.png`);
        if (!existsSync(p) || !existsSync(q)) continue;
        const d = await tools.diff(readFileSync(p), readFileSync(q));
        const share = d.total > 0 ? d.pixels / d.total : 0;
        between.push(`${at}: ${d.pixels < 0 ? 'other size' : share >= 0.001 ? `${(100 * share).toFixed(1)}%` : `${d.pixels} px`}, ${d.max}`);
      }
      lines.push(`| ${t.id} | ${same(o)} → ${same(t)} | ${o.openMs ?? ''} → ${t.openMs ?? ''} | ${o.frameMs ?? ''} → ${t.frameMs ?? ''} | ${between.join('; ')} |`);
    }
  } finally {
    await tools.close();
    await browser.close();
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'compare.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}

if (opts.compare) {
  const [beforeDir, afterDir] = positionals.map((p) => resolve(p));
  if (!beforeDir || !afterDir) throw new Error('--compare <before folder> <after folder>');
  await compare(beforeDir, afterDir, resolve(opts.out ?? afterDir));
} else {
  const out = resolve(opts.out ?? 'engine-report');
  const dir = mkdtempSync(join(tmpdir(), 'of-engine-'));
  const browser = await launch();
  try {
    const report = await runSuite(browser, { dir, artifacts: join(out, 'pictures'), only: opts.only?.split(',') ?? null, log: (line) => console.log(line) });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(out, 'report.md'), markdown(report));
    console.log(`\n${markdown(report)}\nwritten to ${out}`);
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
