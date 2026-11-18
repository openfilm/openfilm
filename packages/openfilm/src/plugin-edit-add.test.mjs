import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { addToFilm, addedLines, STILL_SECONDS } from '../plugins/edit/add.mjs';

/** A project folder with the files named (empty: only their names matter) and a film.html with `body`. */
const project = (files, body = '') => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'of-edit-add-')));
  for (const file of files) { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), ''); }
  writeFileSync(join(root, 'film.html'), `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=1920, height=1080">\n</head>\n<body>\n${body}</body>\n</html>\n`);
  return root;
};
const LENGTHS = { 'a.mp4': 2.5, 'b.mp4': 1.2, 'v.m4a': 3, 'long.mp4': 10 };
/** A file's length without ffprobe: by its name; null for one it cannot read. */
const facts = async (file) => { const d = LENGTHS[basename(file)]; return d ? { duration: d } : null; };
const clipsOf = (root) => [...readFileSync(join(root, 'film.html'), 'utf8').matchAll(/<(section|\/section|video|img|audio|iframe)\b([^>]*)>/g)].map((m) => `${m[1]}${m[2]}`);

test('edit add: files go at the end of the track of their kind, one after the other, on new tracks in an empty film', async () => {
  const root = project(['assets/a.mp4', 'assets/b.mp4', 'assets/p.png', 'assets/v.m4a']);
  const added = await addToFilm(root, ['assets/a.mp4', 'assets/p.png', 'assets/v.m4a', 'assets/b.mp4'], { facts });
  assert.deepEqual(added.map((c) => [c.link, c.at, c.length, c.track]), [['film.html#a', 0, 2.5, 1], ['film.html#p', 2.5, STILL_SECONDS, 1], ['film.html#v', 0, 3, 2], ['film.html#b', 6.5, 1.2, 1]]);
  assert.deepEqual(clipsOf(root), [
    'section', 'video id="a" src="assets/a.mp4"', 'img id="p" src="assets/p.png#t=0,4" at="2.5"', 'video id="b" src="assets/b.mp4" at="6.5"', '/section',
    'section', 'audio id="v" src="assets/v.m4a"', '/section',
  ]);
  assert.deepEqual(addedLines(added)[1], 'film.html#p  assets/p.png, 4 s from 2.5 s on track 1');
  /* again: after what is there, a second clip of a file named apart; a path is read from where it was typed */
  const more = await addToFilm(root, ['b.mp4', 'v.m4a'], { facts, cwd: join(root, 'assets') });
  assert.deepEqual(more.map((c) => [c.id, c.at, c.track]), [['b-2', 7.7, 1], ['v-2', 3, 2]]);
  rmSync(root, { recursive: true, force: true });
});

test('edit add: after clips that are trimmed, sped up or moved; pictures on the last picture track', async () => {
  const root = project(['a.mp4', 'long.mp4', 'v.m4a'], [
    '<section>\n  <video id="top" src="long.mp4#t=0,1" at="20"></video>\n</section>\n',
    '<section>\n  <video id="one" src="long.mp4#t=2,6" at="1"></video>\n  <video id="two" src="long.mp4" at="5" speed="2"></video>\n</section>\n',
    '<section>\n  <audio id="bed" src="v.m4a" at="4"></audio>\n</section>\n',
  ].join(''));
  const added = await addToFilm(root, ['a.mp4', 'v.m4a'], { facts });
  /* the main track (the last of pictures) ends at 5 + 10 / 2; the sound's at 4 + 3 */
  assert.deepEqual(added.map((c) => [c.id, c.at, c.track]), [['a', 10, 2], ['v', 7, 3]]);
  rmSync(root, { recursive: true, force: true });
});

test('edit add: a track whose end cannot be told gets a new track beside it; a locked one takes nothing', async () => {
  const root = project(['a.mp4', 'b.mp4', 'title.html'], '<section>\n  <video id="x" src="b.mp4"></video>\n  <iframe id="title" src="title.html" at="3"></iframe>\n</section>\n');
  const added = await addToFilm(root, ['a.mp4', 'a.mp4'], { facts });
  assert.deepEqual(added.map((c) => [c.id, c.at, c.track]), [['a', 0, 1], ['a-2', 2.5, 1]]);
  assert.equal(clipsOf(root).filter((c) => c === 'section').length, 2);
  const locked = project(['a.mp4', 'b.mp4'], '<section locked>\n  <video id="x" src="b.mp4"></video>\n</section>\n');
  await assert.rejects(addToFilm(locked, ['a.mp4'], { facts }), /^Error: Track 1 is locked/);
  rmSync(root, { recursive: true, force: true });
  rmSync(locked, { recursive: true, force: true });
});

test('edit add: what cannot be a clip is said, and nothing is written', async () => {
  const root = project(['a.mp4', 'notes.md', 'title.html', 'odd.mp4']);
  const before = readFileSync(join(root, 'film.html'), 'utf8');
  await assert.rejects(addToFilm(root, [], { facts }), /Name the files to add/);
  await assert.rejects(addToFilm(root, ['a.mp4', 'gone.mp4'], { facts }), /gone\.mp4: there is no such file/);
  await assert.rejects(addToFilm(root, ['a.mp4', '../elsewhere.mp4'], { facts }), /is not in this project/);
  await assert.rejects(addToFilm(root, ['notes.md'], { facts }), /is not a video, a picture or a sound/);
  await assert.rejects(addToFilm(root, ['title.html'], { facts }), /is a web page/);
  await assert.rejects(addToFilm(root, ['odd.mp4'], { facts }), /its length could not be read/);
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), before);
  /* a film.html that does not read is never written over */
  writeFileSync(join(root, 'film.html'), '<p>not a film');
  await assert.rejects(addToFilm(root, ['a.mp4'], { facts }));
  assert.equal(readFileSync(join(root, 'film.html'), 'utf8'), '<p>not a film');
  rmSync(root, { recursive: true, force: true });
});
