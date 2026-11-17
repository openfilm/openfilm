import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';
import { compoundOuter } from './parts.mjs';
import { coverFolder, coverFrame, coverLook, coverLooks, drawCovers, listCovers, makeCover, restaged } from './covers.mjs';

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const ffmpeg = { skip: hasFfmpeg ? false : 'no ffmpeg' };

/** A film of a red picture, 320 × 180, for two seconds. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'of-covers-'));
  mkdirSync(join(root, 'assets'));
  if (hasFfmpeg) execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1', join(root, 'assets', 'red.png')]);
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 320, h: 180 }, tracks: [{ clips: [{ id: 'red', src: 'assets/red.png', time: [0, 2] }] }] }));
  return root;
}

const stageOf = (/** @type {string} */ file) => readFilmFile(readFileSync(file, 'utf8')).doc?.stage;
const probe = (/** @type {string} */ file) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim();

test('the looks a cover can take: each a page of the library with its words and colors to change', async () => {
  const { groups, items } = await coverLooks();
  assert.ok(groups.length >= 2 && items.length >= 8);
  for (const look of items) {
    assert.ok(look.name.en && look.name['zh-CN'] && look.name.ja && look.name.ko && look.name.es, `${look.id}: five languages`);
    assert.ok(groups.some((/** @type {{ id: string }} */ g) => g.id === look.group), `${look.id}: a group`);
    assert.ok(look.props.some((/** @type {{ type: string }} */ p) => p.type === 'text'), `${look.id}: words to change`);
  }
});

test('a cover from a moment of the film: the frame fills its stage, a look over it, opened as the project\'s', ffmpeg, async () => {
  const root = project();
  const folder = await makeCover(root, { name: 'portrait', stage: { w: 270, h: 360 }, at: 1, look: 'bold-left' });
  assert.equal(folder, 'covers/portrait');
  const abs = join(root, folder);
  assert.deepEqual(stageOf(join(abs, 'film.html')), { w: 270, h: 360 });
  const { doc } = readFilmFile(readFileSync(join(abs, 'film.html'), 'utf8'));
  const [look, frame] = doc?.tracks.map((t) => t.clips[0]) ?? [];
  assert.equal(look.src, 'look-bold-left.html', 'the look on top, a copy of its own');
  assert.ok(existsSync(join(abs, 'look-bold-left.html')));
  assert.match(String(look.attrs?.['data-props']), /Headline/);
  assert.equal(frame.src, 'frame-1000.jpg');
  /* 320 × 180 grown to cover 270 × 360: 640 × 360, centered */
  assert.deepEqual(frame.box, { x: -185, y: 0, w: 640, h: 360 });
  assert.equal(probe(join(abs, 'frame-1000.jpg')), '640,360');
  assert.equal(compoundOuter(abs), compoundOuter(root), 'its files are the project\'s');
  assert.deepEqual((await listCovers(root)).map((c) => [c.folder, c.stage.w, c.stage.h]), [['covers/portrait', 270, 360]]);
});

test('another moment and another look for a cover already made, beside its files', ffmpeg, async () => {
  const root = project();
  const folder = await makeCover(root, { name: 'wide', stage: { w: 320, h: 180 } });
  const frame = await coverFrame(root, folder, 0.5);
  assert.equal(frame.src, 'frame-500.jpg');
  assert.deepEqual(frame.box, { x: 0, y: 0, w: 320, h: 180 });
  const look = await coverLook(root, folder, 'poster');
  assert.equal(look.src, 'look-poster.html');
  await assert.rejects(coverLook(root, folder, 'nothing'));
  assert.throws(() => coverFolder(root, '../elsewhere'));
  assert.throws(() => coverFolder(root, 'covers/a/b'));
  await assert.rejects(makeCover(root, { stage: { w: 10, h: 10 } }), /64 to 4096/);
});

test('a cover copied to another shape: what filled it fills the new one, the rest keeps its place', () => {
  const film = {
    stage: { w: 1920, h: 1080 },
    tracks: [
      { clips: [{ id: 'sticker', src: 's.png', time: /** @type {[number, number]} */ ([0, 1]), box: { x: 860, y: 440, w: 200, h: 200 } }] },
      { clips: [{ id: 'frame', src: 'f.jpg', time: /** @type {[number, number]} */ ([0, 1]), box: { x: 0, y: 0, w: 1920, h: 1080 } }] },
    ],
  };
  const tall = restaged(film, { w: 1080, h: 1440 });
  assert.deepEqual(tall.stage, { w: 1080, h: 1440 });
  assert.deepEqual(tall.tracks[1].clips[0].box, { x: -740, y: 0, w: 2560, h: 1440 });
  assert.deepEqual(tall.tracks[0].clips[0].box, { x: 440, y: 620, w: 200, h: 200 }, 'centered as it was, the same size');
});

test('covers drawn as pictures at their own size, never over a file already there', ffmpeg, async () => {
  const root = project();
  const folder = await makeCover(root, { name: 'square', stage: { w: 200, h: 200 }, at: 0.5, look: 'labels' });
  const out = join(root, 'out');
  const [first] = await drawCovers(root, [folder], out, 'jpg');
  assert.ok(first.endsWith('cover square.jpg'));
  assert.equal(probe(first), '200,200');
  const [again] = await drawCovers(root, [folder], out, 'png');
  assert.ok(again.endsWith('cover square.png'));
  const [third] = await drawCovers(root, [folder], out, 'jpg');
  assert.notEqual(third, first);
});

test('a cover copied to a bigger shape draws its moment of the film again, sharp at the new size', ffmpeg, async () => {
  const root = project();
  const first = await makeCover(root, { name: 'portrait', stage: { w: 270, h: 360 }, at: 1 });
  const copy = await makeCover(root, { name: 'vertical', stage: { w: 270, h: 480 }, from: first });
  assert.equal(copy, 'covers/vertical');
  const { doc } = readFilmFile(readFileSync(join(root, copy, 'film.html'), 'utf8'));
  const frame = doc?.tracks[0].clips[0];
  assert.equal(frame?.src, 'frame-1000.jpg');
  /* 320 × 180 grown to cover 270 × 480: 853 × 480 */
  assert.equal(probe(join(root, copy, 'frame-1000.jpg')), '853,480');
  assert.deepEqual(frame?.box, { x: -291, y: 0, w: 853, h: 480 });
});
