import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';
import { compoundOuter } from './parts.mjs';
import { coverFolder, coverFrame, coverLook, coverLooks, coverPicture, discardCover, drawCovers, listCovers, mainCover, madeCoverPictures, makeCover, restaged, restoreCover, setMainCover } from './covers.mjs';

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
  const { groups, items, categories } = await coverLooks();
  assert.ok(groups.length >= 2 && items.length >= 8 && categories.length >= 6);
  for (const look of items) {
    assert.ok(look.name.en && look.name['zh-CN'] && look.name.ja && look.name.ko && look.name.es, `${look.id}: five languages`);
    assert.ok(groups.some((/** @type {{ id: string }} */ g) => g.id === look.group), `${look.id}: a group`);
    assert.ok(look.props.some((/** @type {{ type: string }} */ p) => p.type === 'text'), `${look.id}: words to change`);
    assert.ok(look.categories.length && look.categories.every((/** @type {string} */ c) => categories.some((/** @type {{ id: string }} */ k) => k.id === c)), `${look.id}: its categories`);
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
  assert.match(String(look.attrs?.['data-props']), /"Title"/);
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

test('a cover copied to another shape: a thing of the library, placed by its width alone, keeps its shape and its middle', () => {
  const film = { stage: { w: 1920, h: 1080 }, tracks: [{ clips: [{ id: 'heart', src: 'saved/openfilm/stickers-heart/heart.html', time: [0, 1], size: { w: 324, h: 324 }, box: { x: 1436, y: 83, w: 324 } }] }] };
  const { tracks } = restaged(/** @type {any} */ (film), { w: 1080, h: 1440 });
  /* its short side is the stage's: 1080 → 1080 keeps 324; its middle (1598, 245) of 1920 × 1080 is (899, 327) of 1080 × 1440 */
  assert.deepEqual(tracks[0].clips[0].box, { x: 737, y: 165, w: 324 });
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

test('a cover copied to another shape takes the library\'s words and stickers put in it along (its saved/ folder)', async () => {
  const root = project();
  const first = await makeCover(root, { name: 'landscape', stage: { w: 320, h: 180 }, color: '#123456' });
  const sticker = join(root, first, 'saved', 'openfilm', 'stickers-heart');
  mkdirSync(sticker, { recursive: true });
  writeFileSync(join(sticker, 'heart.html'), '<p>♥</p>');
  const copy = await makeCover(root, { name: 'portrait', stage: { w: 270, h: 360 }, from: first });
  assert.equal(readFileSync(join(root, copy, 'saved', 'openfilm', 'stickers-heart', 'heart.html'), 'utf8'), '<p>♥</p>');
});

test('a cover of a picture of the project, or of a color: filling it, nothing that loads or runs let in', async () => {
  const root = project();
  writeFileSync(join(root, 'assets', 'mine.png'), 'png');
  const folder = await makeCover(root, { name: 'mine', stage: { w: 1080, h: 1440 }, picture: 'assets/mine.png', look: 'poster' });
  const { doc } = readFilmFile(readFileSync(join(root, folder, 'film.html'), 'utf8'));
  const picture = doc?.tracks[1].clips[0];
  assert.equal(picture?.src, '../../assets/mine.png');
  assert.match(String(picture?.style), /object-fit: cover/);
  const color = await coverPicture(root, folder, { color: 'linear-gradient(135deg, #111 0%, #ff5a1f 100%)' });
  assert.match(color.src, /^color-[0-9a-f]{10}\.html$/);
  assert.match(readFileSync(join(root, folder, color.src), 'utf8'), /background: linear-gradient\(135deg, #111 0%, #ff5a1f 100%\)/);
  await assert.rejects(coverPicture(root, folder, { color: 'url(http://x)' }));
  await assert.rejects(coverPicture(root, folder, { color: '#fff; } body { background: red' }));
  await assert.rejects(coverPicture(root, folder, { picture: '../outside.png' }));
  await assert.rejects(coverPicture(root, folder, { picture: 'assets/none.png' }));
});

test('the cover the film is shown by: the first made, until another is named', async () => {
  const root = project();
  assert.equal(await mainCover(root, await listCovers(root)), null);
  const a = await makeCover(root, { name: 'a', stage: { w: 200, h: 200 }, color: '#000000' });
  const b = await makeCover(root, { name: 'b', stage: { w: 200, h: 200 }, color: '#ffffff' });
  assert.equal(await mainCover(root, await listCovers(root)), a);
  assert.equal(await setMainCover(root, b), b);
  assert.equal(await mainCover(root, await listCovers(root)), b);
  await assert.rejects(setMainCover(root, 'covers/none'));
});

test('a design cancelled: the cover put back as it was, one made in it taken to the recycle bin', async () => {
  const root = project();
  const folder = await makeCover(root, { name: 'a', stage: { w: 200, h: 200 }, color: '#000000' });
  const file = join(root, folder, 'film.html');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, before.replace('<section>', '<section data-x="1">'));
  await restoreCover(root, folder, before);
  assert.equal(readFileSync(file, 'utf8'), before);
  await assert.rejects(restoreCover(root, folder, '<not a film'));
  process.env.OPENFILM_TRASH_DIR = join(root, '.trash');
  try { await discardCover(root, folder); } finally { delete process.env.OPENFILM_TRASH_DIR; }
  assert.equal(existsSync(join(root, folder)), false);
  assert.deepEqual(await listCovers(root), []);
});

test('the pictures made for covers, the newest first', async () => {
  const root = project();
  mkdirSync(join(root, 'assets', 'image'), { recursive: true });
  writeFileSync(join(root, 'assets', 'image', 'cover-a-picture.png'), 'a');
  writeFileSync(join(root, 'assets', 'image', 'other.png'), 'b');
  writeFileSync(join(root, 'assets', 'image', 'cover-a-subject.png'), 'c');
  writeFileSync(join(root, 'assets', 'image', 'cover-a-subject-mi2x.png'), 'd');
  assert.deepEqual(await madeCoverPictures(root), ['assets/image/cover-a-picture.png']);
});

test('a cover as a video\'s first frame: that frame only, the rest and its sound as they were', ffmpeg, async () => {
  const root = project();
  const folder = await makeCover(root, { name: 'wide', stage: { w: 320, h: 180 }, color: '#00ff00' });
  const video = join(root, 'out.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  const { coverAsFirstFrame } = await import('./covers.mjs');
  await coverAsFirstFrame(root, folder, video, { w: 320, h: 180 }, 'h264');
  /* the mean color of frame n, as r,g,b */
  const colorOf = (/** @type {number} */ n) => execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-vf', `select=eq(n\\,${n}),scale=1:1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    .toJSON().data;
  const [r0, g0] = colorOf(0);
  const [r5, g5] = colorOf(5);
  assert.ok(g0 > 200 && r0 < 60, `the first frame is the cover (${r0},${g0})`);
  assert.ok(r5 > 200 && g5 < 60, `the others are the film's (${r5},${g5})`);
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,nb_frames', '-of', 'csv=p=0', video], { encoding: 'utf8' }).trim();
  assert.match(streams, /video,25/);
  assert.match(streams, /audio/);
  assert.equal(existsSync(`${video}.cover.part.mp4`), false);
});
