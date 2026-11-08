import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encoders } from '../../src/encoders.mjs';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports } from './exports.mjs';

/* A synthetic dark gradient with one-level dither, changing every frame. The same fixture is drawn in Chromium
   and measured here; no recording or private project is needed. */
function pixels(frame, w, h) {
  const bytes = new Uint8ClampedArray(w * h * 4);
  let state = frame + 1;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const f = Math.max(0, 1 - Math.hypot((x - w * 0.6) / w, (y - h * 0.4) / h) * 1.4) ** 2;
    for (let c = 0; c < 3; c++) bytes[(y * w + x) * 4 + c] = Math.round([11, 27, 58][c] * (1 - f) + [91, 79, 224][c] * f + random() - random());
    bytes[(y * w + x) * 4 + 3] = 255;
  }
  return bytes;
}

test('HEVC master keeps changing fine grain instead of flattening it into one still picture', { timeout: 120_000 }, async (t) => {
  if (!(await encoders()).has('libx265')) return t.skip('no libx265');
  const scratch = mkdtempSync(join(tmpdir(), 'of-master-grain-'));
  const root = join(scratch, 'project');
  mkdirSync(root);
  const saved = { exports: process.env.OPENFILM_EXPORTS, home: process.env.OPENFILM_HOME };
  process.env.OPENFILM_EXPORTS = join(scratch, 'exports');
  process.env.OPENFILM_HOME = join(scratch, 'home');
  const w = 640, h = 360, fps = 30;
  try {
    writeFileSync(join(root, 'grain.html'), `<!doctype html><body style="margin:0"><canvas width="${w}" height="${h}"></canvas><script>
const pixels=${pixels}; const g=document.querySelector('canvas').getContext('2d');
window.film={duration:0.4,width:${w},height:${h},frame(t){g.putImageData(new ImageData(pixels(Math.floor(t*${fps}+0.0001),${w},${h}),${w},${h}),0,0)}};</script>`);
    writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w, h }, tracks: [{ clips: [{ id: 'grain', src: 'grain.html' }] }] }));
    const exports = createExports();
    const job = exports.start({ id: 'grain', name: 'Grain', path: root }, { kind: 'video', codec: 'hevc', quality: 'master', fps, hardware: false, audio: false });
    let done;
    for (let i = 0; i < 1800; i++) {
      done = exports.list('grain').find((j) => j.id === job.id);
      if (['done', 'failed', 'cancelled'].includes(done.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(done.status, 'done', done.error);
    const stream = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'csv=p=0', done.out], { encoding: 'utf8' }).trim();
    assert.equal(stream, 'hevc,yuv420p10le');
    /* Default swscale decoding of 8-bit YUV can itself add a roughly two-level RGB bias. Use the same explicit,
       accurately rounded BT.709 conversion for both bit depths when measuring exported colors. */
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', done.out, '-frames:v', '2', '-vf',
      'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb48le', '-f', 'rawvideo', '-'], { maxBuffer: w * h * 12 + 1024 });
    assert.equal(raw.length, w * h * 12);
    const source = [pixels(0, w, h), pixels(1, w, h)];
    const weights = [0.2126, 0.7152, 0.0722];
    let xy = 0, xx = 0, yy = 0;
    const delta = [0, 0, 0];
    for (let p = 0; p < w * h; p++) {
      let a = 0, b = 0;
      for (let c = 0; c < 3; c++) {
        const v0 = raw.readUInt16LE((p * 3 + c) * 2) / 257;
        const v1 = raw.readUInt16LE(((w * h + p) * 3 + c) * 2) / 257;
        a += (source[1][p * 4 + c] - source[0][p * 4 + c]) * weights[c];
        b += (v1 - v0) * weights[c];
        delta[c] += v0 - source[0][p * 4 + c];
      }
      xy += a * b; xx += a * a; yy += b * b;
    }
    const correlation = xy / Math.sqrt(xx * yy);
    t.diagnostic(`grain correlation ${correlation}; mean RGB delta ${delta.map((v) => v / (w * h))}`);
    assert.ok(correlation > 0.1, `the changing grain follows the source, not one frozen texture: ${correlation}`);
    for (const value of delta) assert.ok(Math.abs(value / (w * h)) < 1, `no constant color shift: ${delta.map((v) => v / (w * h))}`);
  } finally {
    for (const [key, value] of [['OPENFILM_EXPORTS', saved.exports], ['OPENFILM_HOME', saved.home]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
