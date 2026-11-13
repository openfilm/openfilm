import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExports, ExportError } from './exports.mjs';
import { filmHtml } from '../../src/film-doc.mjs';
import { encoders } from '../../src/encoders.mjs';

const ended = async (queue, id) => {
  for (let i = 0; i < 3000; i++) {
    const job = queue.list('target').find((j) => j.id === id);
    if (['done', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error('export did not end');
};

test('the export API rejects malformed or unsupported delivery targets before queuing', () => {
  const queue = createExports();
  const project = { id: 'target', name: 'Target', path: tmpdir() };
  for (const ask of [
    { target: null }, { target: { kind: 'size', value: 0 } }, { target: { kind: 'size', value: '10' } },
    { target: { kind: 'bitrate', value: 121 } }, { codec: 'png', target: { kind: 'size', value: 10 } },
    { codec: 'hevc_alpha', target: { kind: 'bitrate', value: 3 } },
    { codec: 'prores422hq', target: { kind: 'size', value: 10 } },
  ]) assert.throws(() => queue.start(project, { kind: 'video', ...ask }), ExportError);
  assert.equal(queue.list('target').length, 0);
});

test('delivery exports use software average rate and budget actual selected duration and sound', { timeout: 240_000 }, async (t) => {
  const have = await encoders();
  if (!have.has('libx264')) return t.skip('no libx264');
  const root = mkdtempSync(join(tmpdir(), 'of-target-'));
  const previous = process.env.OPENFILM_HOME;
  process.env.OPENFILM_HOME = join(root, 'home');
  try {
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'noise.html'), `<!doctype html><body style="margin:0"><canvas width="320" height="180"></canvas><script>
const ctx=document.querySelector('canvas').getContext('2d');
window.film={width:320,height:180,duration:24,frame(t){let n=Math.floor(t*15)+1;const img=ctx.createImageData(320,180);for(let i=0;i<img.data.length;i+=4){n=(Math.imul(n,1664525)+1013904223)|0;img.data[i]=n>>>24;img.data[i+1]=n>>>16;img.data[i+2]=n>>>8;img.data[i+3]=255;}ctx.putImageData(img,0,0)}};</script>`);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', join(root, 'assets', 'tone.wav')]);
    writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [{ id: 'noise', src: 'noise.html' }] }, { clips: [{ id: 'tone', src: 'assets/tone.wav' }] },
    ] }));
    const queue = createExports();
    const project = { id: 'target', name: 'Target', path: root };
    const run = async (ask) => {
      const job = await ended(queue, queue.start(project, { kind: 'video', fps: 15, ...ask }, { folder: root }).id);
      assert.equal(job.status, 'done', job.error);
      const meta = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', job.out], { encoding: 'utf8' }));
      return { job, meta, video: meta.streams.find((s) => s.codec_type === 'video') };
    };
    const rate = await run({ codec: 'h264', audio: false, target: { kind: 'bitrate', value: 0.3 } });
    assert.equal(rate.job.encoder, 'libx264');
    assert.ok(Math.abs(Number(rate.video.bit_rate) / 300000 - 1) < .25, rate.video.bit_rate);
    t.diagnostic(`H.264 target 300000 bps: measured ${rate.video.bit_rate} bps over 24 seconds`);
    assert.equal(Number(rate.video.nb_frames), 360);
    assert.equal(rate.meta.streams.length, 1);
    // A size applies to the joined, clamped output (12 seconds), not the 24-second source or requested 87 seconds.
    const size = await run({ codec: 'h264', target: { kind: 'size', value: 1.01 }, ranges: [[20, 99], [0, 8]] });
    assert.equal(Number(size.video.nb_frames), 180);
    assert.ok(size.meta.streams.some((s) => s.codec_type === 'audio'));
    assert.ok(Math.abs(statSync(size.job.out).size / (1.01 * 1024 * 1024) - 1) < .3, String(statSync(size.job.out).size));
    t.diagnostic(`Size target ${Math.round(1.01 * 1024 * 1024)} bytes: measured ${statSync(size.job.out).size} bytes over 12 seconds with sound`);
    const batch = queue.startAll(project, { folder: root, jobs: [0.2, 0.6].map((value) => ({
      kind: 'video', codec: 'h264', fps: 15, range: [0, 4], audio: false, target: { kind: 'bitrate', value },
    })) });
    const different = await Promise.all(batch.map((job) => ended(queue, job.id)));
    assert.ok(different.every((job) => job.status === 'done'), different.map((job) => job.error).join(' '));
    assert.ok(statSync(different[1].out).size > statSync(different[0].out).size * 1.5, 'different targets in one batch are encoded separately, never copied as twins');
    // Sound later in the source does not consume the selected output's size budget.
    writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [
      { clips: [{ id: 'noise', src: 'noise.html' }] }, { clips: [{ id: 'tone', src: 'assets/tone.wav', at: 20, time: [0, 4] }] },
    ] }));
    for (const selected of [{ range: [0, 10] }, { ranges: [[0, 4], [4, 10]] }]) {
      const silent = await run({ codec: 'h264', target: { kind: 'size', value: .1 }, ...selected });
      assert.equal(silent.meta.streams.length, 1, 'no audio stream outside the selection');
      assert.equal(Number(silent.video.nb_frames), 150);
    }
    const impossible = await ended(queue, queue.start(project, { kind: 'video', target: { kind: 'size', value: .001 } }, { folder: root }).id);
    assert.equal(impossible.status, 'failed');
    assert.match(impossible.error, /target/);
    for (const [codec, encoder] of [['hevc', 'libx265'], ['vp9', 'libvpx-vp9']]) {
      if (!have.has(encoder)) continue;
      const result = await run({ codec, audio: false, range: [0, 2], target: { kind: 'bitrate', value: .3 } });
      assert.equal(result.job.encoder, encoder);
      assert.ok(Number(result.meta.format.duration) >= 2);
    }
  } finally {
    if (previous === undefined) delete process.env.OPENFILM_HOME; else process.env.OPENFILM_HOME = previous;
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});
