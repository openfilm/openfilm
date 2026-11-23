// The engine suite (test/engine/) on the browser exports are drawn in: what it can do, and that every technique a film
// may use draws the same picture for the same t in it. Without a GPU (CI's runners: SwiftShader, a virtual GPU) it is
// skipped, as its pictures would say nothing of the engine people draw with.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ENGINE_CHROMIUM } from './engine.mjs';
import { launch, SOFTWARE_GL } from './host.mjs';
import { ALPHA_FORMATS, runSuite, TECHNIQUES, vendorMismatches } from '../test/engine/suite.mjs';

/** The GPU this machine's browser draws WebGL with, as its driver names it; null with no browser or no WebGL. */
async function renderer() {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    return await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null;
    });
  } finally { await browser.close(); }
}

const gpu = await renderer().catch(() => null);
const skip = gpu == null ? 'no WebGL in this browser'
  : SOFTWARE_GL.test(gpu) || /paravirtual/i.test(gpu) ? `no GPU here (${gpu}): the engine suite needs one` : false;
const timeout = 300_000;

/* the suite runs once; each test below reads its part. Kept in OPENFILM_TEST_ARTIFACTS when that is set (CI keeps it
   for a failed run), with the pictures drawn */
const artifacts = process.env.OPENFILM_TEST_ARTIFACTS ? join(process.env.OPENFILM_TEST_ARTIFACTS, 'engine') : null;
const run = skip ? null : (async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-engine-'));
  const browser = await launch();
  try {
    const report = await runSuite(browser, { dir, artifacts: artifacts && join(artifacts, 'pictures') });
    if (artifacts) { mkdirSync(artifacts, { recursive: true }); writeFileSync(join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`); }
    return report;
  } finally {
    await browser.close();
    rmSync(dir, { recursive: true, force: true });
  }
})();
run?.catch(() => {});

/* A page opened anew (a render's other browsers) may draw a picture off by one level in a few pixels, after the two
   frames a render throws away (three.js's glass, GSAP's text: measured on Chromium 149 and 156 alike). More is a
   difference. The path tracer's noise is not the same in two pages at all (the library keeps state of its own across
   frames): within one page it is. */
const NEW_PAGE_LEVELS = 1;
const NEW_PAGE_SHARE = 0.001;
const NOISE_PER_PAGE = new Set(['path-tracer']);

test('the vendored libraries are the files vendor.json names, unchanged', () => {
  assert.deepEqual(vendorMismatches(), []);
});

test('the export engine is the Chromium engine.mjs names, with the GPU, WebGPU, both HTML-in-Canvas names, WebCodecs and the host\'s clock', { skip, timeout }, async (t) => {
  const report = /** @type {any} */ (await run);
  const c = report.capabilities;
  t.diagnostic(`${c.chromium} · ${c.webgl2?.renderer} · WebGPU ${c.webgpu?.adapter ?? 'none'}`);
  for (const r of report.techniques) t.diagnostic(`${r.id}: ${r.skipped ?? `open ${r.openMs} ms, first frame ${r.firstFrameMs} ms, frame ${r.frameMs} ms (draw ${r.seekMs} + capture ${r.captureMs})`}`);
  assert.equal(Number(String(c.chromium).split('.')[0]), ENGINE_CHROMIUM, 'the headless shell is the Chromium the preview draws with (engine.mjs ENGINE_CHROMIUM)');
  assert.ok(c.webgl2?.renderer && !SOFTWARE_GL.test(c.webgl2.renderer), `WebGL2 on the GPU, not ${c.webgl2?.renderer}`);
  assert.ok(c.webgl2.colorBufferFloat, 'float render targets');
  if (process.platform === 'darwin') assert.ok(c.webgpu?.adapter, 'a WebGPU adapter (Metal)');
  const hic = c.htmlInCanvas;
  assert.ok(hic.drawElementImage && hic.texElementImage2D, 'HTML-in-Canvas is on (CanvasDrawElement)');
  /* `content="drawable"` is the name from Chromium 150; `layoutsubtree` the one pages written before then use: both
     draw, in 2D and in WebGL. When one stops, pages written with it alone draw nothing: say so before people find out */
  for (const name of ['contentDrawable', 'layoutsubtree']) {
    assert.ok(hic[name]?.drawn2d, `a canvas marked ${name} draws its child in 2D: ${JSON.stringify(hic[name])}`);
    assert.ok(hic[name]?.drawnWebGL, `a canvas marked ${name} draws its child into WebGL: ${JSON.stringify(hic[name])}`);
  }
  assert.equal(c.webcodecs?.VideoDecoder, 'function');
  assert.ok(c.webcodecs.decode.h264, 'H.264 decoded by WebCodecs');
  for (const f of report.clock) {
    assert.equal(f.now, f.t * 1000, 'performance.now() is t inside a frame');
    assert.equal(f.date, Date.UTC(2026, 0, 1) + f.t * 1000, 'Date.now() is the film\'s epoch plus t inside a frame');
  }
});

for (const tech of TECHNIQUES) {
  test(`${tech.title}: the same picture for the same t, in any order and in a page opened anew`, { skip, timeout }, async (t) => {
    const report = /** @type {any} */ (await run);
    const r = report.techniques.find((/** @type {any} */ x) => x.id === tech.id);
    assert.ok(r, 'drawn');
    if (r.skipped) { t.skip(r.skipped); return; }
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.probeFailed, [], 'the page says it worked');
    assert.ok(r.colors > 2, 'the picture is not blank');
    const inPage = r.differing.filter((/** @type {any} */ d) => d.order === 'B');
    assert.deepEqual(inPage, [], 'the same t drawn again in the same page, after other times, is the same picture');
    const total = 1920 * 1080;
    const anew = r.differing.filter((/** @type {any} */ d) => d.order === 'fresh' && !NOISE_PER_PAGE.has(tech.id) && (d.max > NEW_PAGE_LEVELS || d.pixels > total * NEW_PAGE_SHARE));
    assert.deepEqual(anew, [], 'a page opened anew draws the same picture, after the two frames a render throws away');
    if (r.alpha) {
      for (const a of r.alpha.filter((/** @type {any} */ x) => x.made)) assert.ok(a.ok, `${a.format}: the color shows through where the clip is clear, and its square is drawn: ${JSON.stringify(a)}`);
      t.diagnostic(`alpha formats made: ${r.alpha.filter((/** @type {any} */ x) => x.made).map((/** @type {any} */ x) => x.format).join(', ')} of ${ALPHA_FORMATS.length}`);
    }
  });
}
