/* A page and a still graded by --of-lut, drawn by the browser as an export draws them: the picture is what the grade's
   stages work out (page-grade.mjs), its input and output not read at all. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open } from '../shared.mjs';
import { withAdjust, withWheels } from './adjust.mjs';
import { pageStages, stagesFunction } from './page-grade.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const COLOR = [0x30, 0x60, 0xa0];
const LAYER = withWheels(withAdjust(null, { temperature: 40, contrast: 20, saturation: 30, exposure: 0.3 }, 'shot-p'), { shadows: { r: 0.92, g: 1, b: 1.1, m: 1 } });
const CHAIN = 'url(looks/in-rec709.ctf) url(looks/shot-p.ctf) url(looks/out-rec709.ctf)';

/** The pixel at (x, y) of a PNG, by ffmpeg. @param {Buffer} png @param {number} x @param {number} y */
function pixel(png, x, y) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png });
  return [...raw.subarray(0, 3)];
}

test('a page and a still graded by LUT files are drawn through them, the same as the stages work out', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'of-page-grade-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  await mkdir(join(root, 'looks'));
  await writeFile(join(root, 'looks', 'shot-p.ctf'), LAYER);
  const hex = `#${COLOR.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  await writeFile(join(root, 'flat.html'), `<!doctype html><style>html,body{margin:0;background:${hex}}</style><script>window.film = { duration: 2, frame() {} };</script>`);
  // Generate in RGB so a YUV round trip cannot shift the still away from the page's COLOR.
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${hex.replace('#', '0x')}:size=160x180,format=rgb24`, '-frames:v', '1', join(root, 'flat.png')]);
  /* the page left, the still right; the input and output files are not in the folder: a page or a still needs neither */
  await writeFile(join(root, 'film.html'), `<!doctype html><html><head><meta name="viewport" content="width=320, height=180"></head><body>
<section><iframe id="p" src="flat.html#t=0,2" style="--of-lut: ${CHAIN}; width: 160px; height: 180px; left: 0; top: 0"></iframe></section>
<section><img id="s" src="flat.png#t=0,2" style="--of-lut: ${CHAIN}; width: 160px; height: 180px; left: 160px; top: 0"></section>
</body></html>`);
  const s = await open(join(root, 'film.html'), { root });
  t.after(() => s.close());
  await s.film.seek(0.5);
  const png = await s.film.capture({ format: 'png' });
  const got = pageStages([{ name: 'looks/shot-p.ctf', text: LAYER }]);
  assert.ok(got?.stages.length);
  const want = [0, 0, 0];
  stagesFunction(got.stages, { quantize: true })(...COLOR.map((c) => c / 255), want);
  const expected = want.map((v) => Math.round(v * 255));
  const scale = (await s.film.page.evaluate(() => window.devicePixelRatio)) || 1;
  for (const [name, x] of [['page', 80], ['still', 240]]) {
    const seen = pixel(png, Math.round(x * scale), Math.round(90 * scale));
    assert.notDeepEqual(seen, COLOR, `${name}: graded`);
    for (let c = 0; c < 3; c++) assert.ok(Math.abs(seen[c] - expected[c]) <= 3, `${name}: ${seen} drawn, ${expected} worked out`);
  }
});
