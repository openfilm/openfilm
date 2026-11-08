import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports, framing } from './exports.mjs';

const haveFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const ffmpeg = { skip: !haveFfmpeg, timeout: 180_000 };
let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), 'of-export-regression-'));
  process.env.OPENFILM_HOME = join(scratch, 'home');
  process.env.OPENFILM_EXPORTS = join(scratch, 'exports');
});
after(() => rmSync(scratch, { recursive: true, force: true }));
async function exported(root, ask) {
  const exports = createExports({ drafts: () => null });
  const job = exports.start({ id: 'p', name: 'Regression', path: root }, ask);
  const deadline = Date.now() + 150_000;
  for (;;) {
    const state = exports.list('p').find((j) => j.id === job.id);
    if (['done', 'failed', 'cancelled'].includes(state.status)) {
      assert.equal(state.status, 'done', state.error);
      return state.out;
    }
    assert.ok(Date.now() < deadline, 'export timed out');
    await new Promise((done) => setTimeout(done, 50));
  }
}
function pixel(file, seconds = 0, vp9 = false) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', ...(vp9 ? ['-c:v', 'libvpx-vp9'] : []), '-i', file,
    '-vf', 'fps=30', '-ss', String(seconds), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const at = (45 * 160 + 80) * 4;
  return [...raw.subarray(at, at + 4)];
}

test('a Jianying draft retains untouched sources, full processed video handles, native speed and disabled clips', ffmpeg, async () => {
  const root = join(scratch, 'editable'); mkdirSync(root);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=160x90:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-shortest', '-pix_fmt', 'yuv420p', join(root, 'source.mp4')]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', join(root, 'voice.wav')]);
  writeFileSync(join(root, 'under.html'), '<!doctype html><body style="margin:0;background:navy"><script>window.film={duration:6,width:160,height:90,frame(){}}</script>');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, keyframes: { reveal: 'from { opacity: 0.2 } to { opacity: 1 }' }, tracks: [
    { clips: [
      { id: 'processed', src: 'source.mp4', time: [2, 4], speed: 2, style: 'filter: brightness(0.7)', overrides: [{ fade: [0.2, 0.2] }] },
      { id: 'slow', src: 'source.mp4', at: 1, time: [1, 3], speed: 0.5, volume: 0.4 },
      { id: 'disabled', src: 'source.mp4', at: 5, time: [0, 1], disabled: true, volume: 0.3 },
      { id: 'animated', src: 'source.mp4', at: 6, time: [2, 4], speed: 2, style: 'animation: reveal 1s linear both' },
    ] },
    { clips: [{ id: 'under', src: 'under.html', time: [0, 7] }] },
    { clips: [{ id: 'voice', src: 'voice.wav', time: [2, 4], speed: 0.5, volume: 0.35, overrides: [{ fade: [0.3, 0.2] }] }] },
  ] }));
  const folder = dirname(await exported(root, { kind: 'nle', format: 'jianying', fps: 30, subtitles: false }));
  const info = JSON.parse(readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  const top = info.tracks.filter((t) => t.type === 'video').at(-1);
  const [processed, slow, disabled, animated] = top.segments;
  assert.deepEqual(processed.source_timerange, { start: 2_000_000, duration: 2_000_000 });
  assert.equal(processed.target_timerange.duration, 1_000_000);
  assert.equal(processed.speed, 2);
  const material = info.materials.videos.find((m) => m.id === processed.material_id);
  assert.equal(material.duration, 6_000_000);
  const before = pixel(material.path, 1), fade = pixel(material.path, 2.1), middle = pixel(material.path, 2.8), after = pixel(material.path, 4.2);
  assert.ok(before[3] > 250 && middle[3] > 250 && after[3] > 250, `both source handles remain: ${before}; ${middle}; ${after}`);
  assert.ok(fade[3] > 20 && fade[3] < 120, `the original cut's fade remains at its source in point: ${fade}`);
  assert.equal(slow.speed, 0.5);
  assert.equal(slow.volume, 0.4);
  assert.equal(disabled.visible, false);
  assert.equal(disabled.volume, 0);
  assert.equal(disabled.last_nonzero_volume, 0.3);
  const moving = info.materials.videos.find((m) => m.id === animated.material_id);
  const movingAlpha = pixel(moving.path, 2.8)[3];
  assert.ok(movingAlpha > 125 && movingAlpha < 145, `CSS motion stays on film time after native speed is restored: ${movingAlpha}`);
  const original = info.materials.videos.find((m) => m.path.endsWith('source.mp4'));
  assert.deepEqual(readFileSync(original.path), readFileSync(join(root, 'source.mp4')));
  const voice = info.materials.audios.find((m) => m.path.endsWith('voice.wav'));
  assert.deepEqual(readFileSync(voice.path), readFileSync(join(root, 'voice.wav')));
  assert.equal(voice.duration, 6_000_000);
});

test('transparent resizing weights bright pixels by their opacity', ffmpeg, () => {
  const pixels = Buffer.alloc(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    pixels.set(x % 2 ? [0, 170, 255, 255] : [255, 255, 255, 1], (y * 16 + x) * 4);
  }
  const { vf } = framing({ w: 16, h: 16 }, 'native', 'contain', { w: 8, h: 8 }, true);
  const scaled = execFileSync('ffmpeg', ['-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '16x16',
    '-i', '-', '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: pixels });
  const [r, g, b, a] = scaled.subarray((4 * 8 + 4) * 4, (4 * 8 + 4) * 4 + 4);
  assert.ok(r < 4 && Math.abs(g - 170) <= 2 && b >= 253 && Math.abs(a - 128) <= 2, `${r},${g},${b},${a}`);
});

test('transparent ProRes and WebM blur keeps nearly transparent white from becoming a luminous blue edge', ffmpeg, async () => {
  const root = join(scratch, 'alpha'); mkdirSync(root);
  writeFileSync(join(root, 'edge.html'), '<!doctype html><body style="margin:0"><div id="fill" style="position:absolute;inset:0"></div><script>window.film={duration:2,width:160,height:90,frame(t){document.getElementById("fill").style.background=t<1?"rgba(255,255,255,0.004)":"rgb(0,170,255)"}}</script>');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [{ id: 'edge', src: 'edge.html' }] }] }));
  for (const codec of ['prores4444', 'vp9']) {
    const out = await exported(root, { kind: 'video', codec, scale: 1, fps: 1, samples: 2, shutter: 0.5, range: [1, 2], audio: false, hardware: false });
    const [r, g, b, a] = pixel(out, 0, codec === 'vp9');
    assert.ok(r < 10 && g > 160 && g < 180 && b > 245 && a > 120 && a < 138, `${codec}: ${r},${g},${b},${a}`);
    /* The same straight-alpha pixel must composite correctly over both dark and light backgrounds. */
    const black = r * a / 255, white = black + 255 - a;
    assert.ok(black < 6 && Math.abs(white - (255 - a)) < 6, `${codec}: black ${black}, white ${white}`);
  }
});
