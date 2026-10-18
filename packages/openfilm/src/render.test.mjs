import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encoders, hardwareEncoder } from './encoders.mjs';
import { defaultWorkers, render } from './render.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a render with no format of its own encodes on the graphics chip when it can: H.264 for an MP4, ProRes for a MOV', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-chip-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><div id="box" style="width:320px;height:180px"></div><script>'
      + 'window.film = { duration: 1, width: 320, height: 180, frame(t) { document.getElementById("box").style.background = `hsl(${t * 360}, 80%, 50%)`; } };</script>');
    const have = await encoders();
    const quiet = { workers: 1, silent: true, onProgress() {} };
    const mp4 = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'chip.mp4') });
    assert.equal(mp4.encoder, (await hardwareEncoder('h264', have)) ?? 'libx264');
    assert.match(mp4.lines[1], new RegExp(` · ${mp4.encoder} · `), 'the summary says which encoder');
    const soft = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'soft.mp4'), hardware: false });
    assert.equal(soft.encoder, 'libx264', 'hardware: false keeps the processor\'s');
    const mov = await render([dir, '0-0.5'], { ...quiet, out: join(dir, 'chip.mov'), alpha: true });
    assert.equal(mov.encoder, (await hardwareEncoder('prores', have)) ?? 'prores_ks');
    assert.equal(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile', '-of', 'csv=p=0', mov.out]).toString().trim(), 'prores,4444');
    const frames = (file) => parseInt(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file]).toString(), 10);
    assert.deepEqual([mp4.out, soft.out, mov.out].map(frames), [15, 15, 15]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an encoder that fails to start fails the render with ffmpeg\'s error, instead of waiting forever', { skip: !hasFfmpeg && 'no ffmpeg', timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-render-fails-'));
  try {
    /* noise: frames too big for the pipe to take while no one reads it */
    writeFileSync(join(dir, 'index.html'), '<!doctype html><body style="margin:0"><canvas width="1280" height="720"></canvas><script>'
      + 'const c = document.querySelector("canvas").getContext("2d"), img = c.createImageData(1280, 720);'
      + 'window.film = { duration: 1, width: 1280, height: 720, frame(t) { let s = 1 + Math.round(t * 30);'
      + 'for (let i = 0; i < img.data.length; i++) { s = (s * 1103515245 + 12345) % 2147483648; img.data[i] = i % 4 === 3 ? 255 : s & 255; }'
      + 'c.putImageData(img, 0, 0); } };</script>');
    await assert.rejects(render([dir], { out: join(dir, 'out.mp4'), workers: 1, format: { video: ['-c:v', 'no_such_encoder'] } }), /^Error: ffmpeg: .*no_such_encoder/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a browser for every two threads, with 3 GB of memory each, at least one and at most eight', () => {
  const GB = 2 ** 30;
  assert.equal(defaultWorkers(10, 16 * GB), 5);
  assert.equal(defaultWorkers(8, 8 * GB), 2, 'memory first');
  assert.equal(defaultWorkers(32, 128 * GB), 8);
  assert.equal(defaultWorkers(2, 4 * GB), 1);
});
