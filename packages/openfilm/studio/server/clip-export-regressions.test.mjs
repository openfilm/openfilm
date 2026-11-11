import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { createExports, framing } from './exports.mjs';
import { JIANYING_DRAFT_PATH } from './jianying.mjs';

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
  const folder = dirname(await exported(root, { kind: 'nle', format: 'jianying', fps: 30, subtitles: false, footage: 'render' }));
  const info = JSON.parse(readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  const top = info.tracks.filter((t) => t.type === 'video').at(-1);
  const [processed, slow, disabled, animated] = top.segments;
  assert.deepEqual(processed.source_timerange, { start: 2_000_000, duration: 2_000_000 });
  assert.equal(processed.target_timerange.duration, 1_000_000);
  assert.equal(processed.speed, 2);
  const material = info.materials.videos.find((m) => m.id === processed.material_id);
  assert.equal(material.duration, 6_000_000);
  const footage = material.path.replace(JIANYING_DRAFT_PATH, folder);
  const before = pixel(footage, 1), fade = pixel(footage, 2.1), middle = pixel(footage, 2.8), after = pixel(footage, 4.2);
  assert.ok(before[3] > 250 && middle[3] > 250 && after[3] > 250, `both source handles remain: ${before}; ${middle}; ${after}`);
  assert.ok(fade[3] > 20 && fade[3] < 120, `the original cut's fade remains at its source in point: ${fade}`);
  assert.equal(slow.speed, 0.5);
  assert.equal(slow.volume, 0.4);
  assert.equal(disabled.visible, false);
  assert.equal(disabled.volume, 0);
  assert.equal(disabled.last_nonzero_volume, 0.3);
  const moving = info.materials.videos.find((m) => m.id === animated.material_id);
  const movingAlpha = pixel(moving.path.replace(JIANYING_DRAFT_PATH, folder), 2.8)[3];
  assert.ok(movingAlpha > 125 && movingAlpha < 145, `CSS motion stays on film time after native speed is restored: ${movingAlpha}`);
  const original = info.materials.videos.find((m) => m.path.endsWith('source.mp4'));
  assert.deepEqual(readFileSync(original.path.replace(JIANYING_DRAFT_PATH, folder)), readFileSync(join(root, 'source.mp4')));
  const voice = info.materials.audios.find((m) => m.path.endsWith('voice.wav'));
  assert.deepEqual(readFileSync(voice.path.replace(JIANYING_DRAFT_PATH, folder)), readFileSync(join(root, 'voice.wav')));
  assert.equal(voice.duration, 6_000_000);
});

test('Jianying keeps a mask, the complete original and editable caption styles by default', ffmpeg, async () => {
  const root = join(scratch, 'masked-original'); mkdirSync(root);
  const original = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=160x90:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6', '-shortest', '-pix_fmt', 'yuv420p', original]);
  writeFileSync(join(root, 'caption.vtt'), `WEBVTT

STYLE
::cue { --size: 5cqmin; --weight: 700; --color: #ff8000; --stroke: 0.055em; --stroke-color: rgba(0,0,0,0.84); }
::cue(#c2) { --size: 8cqmin; --italic: italic; }

c1
00:00:01.000 --> 00:00:02.000
First

c2
00:00:02.000 --> 00:00:03.000 align:end
Second
`);
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [
    { clips: [], captions: { src: 'caption.vtt' } },
    { clips: [
      { id: 'mask', src: 'source.mp4', at: 1, time: [2, 4], speed: 2,
        style: 'mask-image: radial-gradient(circle 28px at center, black 100%, transparent 100%)' },
      { id: 'plain', src: 'source.mp4', at: 2, time: [4, 6], speed: 2 },
    ] },
  ] }));
  const beforeRename = dirname(await exported(root, { kind: 'nle', format: 'jianying', fps: 30, subtitles: false }));
  const folder = `${beforeRename} renamed`;
  renameSync(beforeRename, folder);
  const info = JSON.parse(readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  const [mask, plain] = info.tracks.find((t) => t.type === 'video').segments;
  const rendered = info.materials.videos.find((m) => m.id === mask.material_id);
  const untouched = info.materials.videos.find((m) => m.id === plain.material_id);
  assert.deepEqual(mask.target_timerange, { start: 1_000_000, duration: 1_000_000 });
  assert.deepEqual(mask.source_timerange, { start: 0, duration: 1_000_000 });
  assert.equal(rendered.duration, 1_000_000, 'only the used masked range is drawn');
  assert.equal(rendered.path, `${JIANYING_DRAFT_PATH}/media/mask.mov`);
  assert.equal(untouched.path, `${JIANYING_DRAFT_PATH}/media/source.mp4`);
  const meta = JSON.parse(readFileSync(join(folder, 'draft_meta_info.json'), 'utf8'));
  assert.ok(meta.draft_materials[0].value.some((m) => m.file_Path === './media/mask.mov'));
  const rgba = execFileSync('ffmpeg', ['-v', 'error', '-i', rendered.path.replace(JIANYING_DRAFT_PATH, folder), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  assert.equal(rgba[3], 0, 'the corner outside the mask is transparent even on the bottom track');
  assert.equal(rgba[(45 * 160 + 80) * 4 + 3], 255, 'the middle of the mask remains visible');
  assert.equal(plain.speed, 2);
  assert.deepEqual(plain.source_timerange, { start: 4_000_000, duration: 2_000_000 });
  assert.deepEqual(readFileSync(untouched.path.replace(JIANYING_DRAFT_PATH, folder)), readFileSync(original));
  assert.equal(untouched.duration, 6_000_000);
  const sound = info.tracks.find((t) => t.type === 'audio').segments[0];
  assert.deepEqual(sound.target_timerange, mask.target_timerange);
  assert.deepEqual(sound.source_timerange, { start: 2_000_000, duration: 2_000_000 });
  assert.equal(sound.speed, 2);
  const [first, second] = info.materials.texts;
  const glyphs = [first, second].map((line) => JSON.parse(line.content).styles[0]);
  assert.deepEqual(glyphs.map((s) => [s.size, s.bold, s.italic]), [[7.2, true, false], [11.52, true, true]]);
  assert.deepEqual(glyphs[0].fill.content.solid.color, [1, 128 / 255, 0]);
  assert.equal(glyphs[0].strokes[0].content.solid.alpha, 0.84);
  assert.equal(second.alignment, 2);
  assert.deepEqual(info.tracks.find((t) => t.type === 'text').segments.map((s) => s.target_timerange.start), [1_000_000, 2_000_000]);
});

test('Jianying exports native controls for opacity, rotation and a hard rectangle mask', ffmpeg, async () => {
  const root = join(scratch, 'native-draft'); mkdirSync(root);
  const original = join(root, 'source.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=160x90:rate=30:duration=3',
    '-pix_fmt', 'yuv420p', original]);
  const rect = 'linear-gradient(90deg, transparent 45%, #000 45%, #000 80%, transparent 80%), linear-gradient(180deg, transparent 32.5%, #000 32.5%, #000 92.5%, transparent 92.5%)';
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 160, h: 90 }, tracks: [{ clips: [
    { id: 'adjust', src: 'source.mp4', time: [0, 1], style: 'opacity: 0.45', box: { x: 0, y: 0, w: 160, h: 90, r: 25 } },
    { id: 'rect', src: 'source.mp4', at: 1, time: [1, 2], style: `mask-image: ${rect}; mask-composite: intersect` },
    { id: 'soft', src: 'source.mp4', at: 2, time: [2, 3], style: `mask-image: ${rect.replace('#000 45%', '#000 47%')}; mask-composite: intersect` },
  ] }] }));
  const folder = dirname(await exported(root, { kind: 'nle', format: 'jianying', fps: 30, subtitles: false, media: 'link' }));
  const info = JSON.parse(readFileSync(join(folder, 'draft_info.json'), 'utf8'));
  const [adjust, rectangle, soft] = info.tracks[0].segments;
  assert.equal(adjust.clip.alpha, 0.45);
  assert.equal(adjust.clip.rotation, 25);
  assert.equal(adjust.material_id, rectangle.material_id);
  const video = info.materials.videos.find((m) => m.id === rectangle.material_id);
  assert.equal(video.path, original);
  assert.equal(video.duration, 3_000_000);
  assert.deepEqual(rectangle.source_timerange, { start: 1_000_000, duration: 1_000_000 });
  const [mask] = info.materials.common_mask;
  assert.ok(rectangle.extra_material_refs.includes(mask.id));
  assert.equal(info.materials.masks[0].id, mask.id);
  assert.deepEqual([mask.config.centerX, mask.config.centerY, mask.config.width, mask.config.height], [0.25, -0.25, 0.35, 0.6]);
  assert.notEqual(soft.material_id, adjust.material_id, 'a soft edge continues to render');
  assert.ok(!soft.extra_material_refs.includes(mask.id));
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
