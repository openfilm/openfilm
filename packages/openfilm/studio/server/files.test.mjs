import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FileError, cleanName, extractAudio, freezeFrame, importFile, inProject, inside, listFiles, makeFolder, moveFile, trashFile } from './files.mjs';
import { execFileSync } from 'node:child_process';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';

let root, trash;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'of-files-'));
  trash = mkdtempSync(join(tmpdir(), 'of-trash-'));
  process.env.OPENFILM_TRASH_DIR = trash;
});
const put = (rel, text = 'x') => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text); };

test('paths stay inside the project and out of .film/', () => {
  for (const bad of ['../x', '/etc/passwd', '.film/id', '.FILM/id', '.film./id', '.film /x', 'a/../../b', '']) assert.throws(() => inside(root, bad), FileError, bad);
  assert.equal(inside(root, 'assets/a.png'), join(root, 'assets', 'a.png'));
  assert.equal(inProject(root, '../x'), null, 'a path a film names: null, not thrown');
  assert.equal(inProject(root, 'assets/a.png'), join(root, 'assets', 'a.png'));
});

/* links need Developer Mode on Windows */
const links = { skip: process.platform === 'win32' && 'links need Developer Mode on Windows' };

test('a link in a downloaded project leads nowhere: nothing is imported, moved, made or trashed through it', links, async () => {
  const away = mkdtempSync(join(tmpdir(), 'of-away-'));
  writeFileSync(join(away, 'secret.png'), 'theirs');
  mkdirSync(join(root, 'assets'));
  symlinkSync(away, join(root, 'assets', 'out'));
  symlinkSync(join(away, 'secret.png'), join(root, 'assets', 'pic.png'));
  symlinkSync(join(away, 'nothing-yet.png'), join(root, 'assets', 'dangling.png'));
  put('assets/mine.png');
  for (const bad of ['assets/out', 'assets/out/secret.png', 'assets/out/new/deeper.png', 'assets/pic.png', 'assets/dangling.png']) {
    assert.throws(() => inside(root, bad), FileError, bad);
  }
  await assert.rejects(importFile(root, 'assets/out/x.png', Readable.from([Buffer.from('x')])), FileError);
  await assert.rejects(importFile(root, 'assets/dangling.png', Readable.from([Buffer.from('x')])), FileError);
  await assert.rejects(makeFolder(root, 'assets/out/new'), FileError);
  await assert.rejects(moveFile(root, 'assets/mine.png', 'assets/out/mine.png'), FileError);
  await assert.rejects(moveFile(root, 'assets/out/secret.png', 'assets/stolen.png'), FileError);
  await assert.rejects(trashFile(root, 'assets/out/secret.png'), FileError);
  await assert.rejects(extractAudio(root, 'assets/out/talk.mp4'), FileError);
  assert.deepEqual(readdirSync(away).sort(), ['secret.png'], 'nothing written there');
  assert.ok(existsSync(join(root, 'assets', 'mine.png')));
  /* a link that stays in the project is the project's */
  mkdirSync(join(root, 'assets', 'real'));
  symlinkSync(join(root, 'assets', 'real'), join(root, 'assets', 'alias'));
  assert.equal((await importFile(root, 'assets/alias/x.png', Readable.from([Buffer.from('x')]))).path, 'assets/alias/x.png');
  assert.ok(existsSync(join(root, 'assets', 'real', 'x.png')));
});

test('a link to .film/ is .film/', links, () => {
  mkdirSync(join(root, '.film'));
  writeFileSync(join(root, '.film', 'id'), 'x');
  symlinkSync(join(root, '.film'), join(root, 'cache'));
  assert.throws(() => inside(root, 'cache/id'), FileError);
  assert.throws(() => inside(root, 'cache'), FileError);
});

test('Studio\'s folder by any spelling Windows reads as it: a stream of it, its short name', { skip: process.platform !== 'win32' && 'Windows names' }, () => {
  mkdirSync(join(root, '.film'));
  for (const bad of ['.film::$INDEX_ALLOCATION/id', '.film:$I30:$INDEX_ALLOCATION/id', 'FILM~1/id', 'film~1/id', 'assets/a.png::$DATA']) {
    assert.throws(() => inside(root, bad), FileError, bad);
  }
});

test('media under assets/ at any depth, pages outside it, folders even when empty', async () => {
  put('assets/footage/a.mp4'); put('assets/b.png'); put('assets/sfx/hit.wav'); put('assets/notes.txt');
  mkdirSync(join(root, 'assets', 'empty'));
  put('scenes/title.html'); put('index.html'); put('node_modules/x/page.html'); put('.film/cache/p.html');
  const { files, folders, pages } = await listFiles(root);
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [
    ['assets/b.png', 'image'], ['assets/footage/a.mp4', 'video'], ['assets/notes.txt', 'other'], ['assets/sfx/hit.wav', 'audio'],
  ]);
  assert.deepEqual(folders, ['assets/empty', 'assets/footage', 'assets/sfx']);
  assert.deepEqual(pages.map((p) => p.path), ['index.html', 'scenes/title.html']);
});

test('an import is streamed under a free name, and a failed one leaves nothing', async () => {
  put('assets/clip.mp4', 'old');
  const { path: landed } = await importFile(root, 'assets/clip.mp4', Readable.from([Buffer.from('new '), Buffer.from('bytes')]));
  assert.equal(landed, 'assets/clip 2.mp4');
  assert.equal(readFileSync(join(root, landed), 'utf8'), 'new bytes');
  const failing = new Readable({ read() { this.destroy(new Error('cancelled')); } });
  await assert.rejects(importFile(root, 'assets/broken.mp4', failing), /cancelled/);
  assert.deepEqual((await listFiles(root)).files.map((f) => f.path), ['assets/clip 2.mp4', 'assets/clip.mp4']);
});

test('files imported at once (a message with two) each land, none in the other\'s way', async () => {
  const bytes = (text) => Readable.from([Buffer.from(text)]);
  const landed = await Promise.all(['a.mp4', 'b.mp3', 'c.png'].map((name) => importFile(root, `assets/upload/${name}`, bytes(name))));
  assert.deepEqual(landed.map((l) => l.path), ['assets/upload/a.mp4', 'assets/upload/b.mp3', 'assets/upload/c.png']);
  assert.deepEqual(readdirSync(join(root, 'assets/upload')).filter((n) => n.endsWith('.importing')), [], 'nothing half-written left');
});

test('the same file imported again is the one there; other bytes by that name get the next free name', async () => {
  const bytes = (text) => Readable.from([Buffer.from(text)]);
  assert.deepEqual(await importFile(root, 'assets/pic.png', bytes('picture')), { path: 'assets/pic.png', reused: false });
  assert.deepEqual(await importFile(root, 'assets/pic.png', bytes('picture')), { path: 'assets/pic.png', reused: true });
  assert.deepEqual(await importFile(root, 'assets/pic.png', bytes('another')), { path: 'assets/pic 2.png', reused: false });
  assert.deepEqual(await importFile(root, 'assets/pic.png', bytes('another')), { path: 'assets/pic 2.png', reused: true }, 'the copy made before, found again');
  assert.deepEqual(await importFile(root, 'assets/pic.png', bytes('pictur!')), { path: 'assets/pic 3.png', reused: false }, 'the same size is not the same file');
  /* another spelling is another name: on a disk that ignores case, `pic.png` and the copies take the names it would */
  const ignoresCase = existsSync(join(root, 'assets', 'PIC.PNG'));
  assert.deepEqual(await importFile(root, 'assets/Pic.png', bytes('picture')), { path: ignoresCase ? 'assets/Pic 4.png' : 'assets/Pic.png', reused: false });
  assert.deepEqual((await listFiles(root)).files.map((f) => f.path).filter((p) => /pic/i.test(p)).length, 4);
  assert.deepEqual(readdirSync(join(root, 'assets')).filter((n) => n.endsWith('.importing')), [], 'nothing half-written left');
});

test('moving a file or a folder points film.html at the new place; nothing is moved over another', async () => {
  put('assets/a.png'); put('assets/sfx/hit.wav'); put('assets/b.png');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 10, h: 10 }, tracks: [{ clips: [
    { src: 'assets/a.png', id: 'a', time: [0, 2] }, { src: 'assets/sfx/hit.wav', id: 'hit' },
  ] }] }));
  assert.deepEqual(await moveFile(root, 'assets/a.png', 'assets/stills/logo.png'), { path: 'assets/stills/logo.png', clips: 1 });
  assert.equal((await moveFile(root, 'assets/sfx', 'assets/sounds')).clips, 1);
  const srcs = readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value.tracks[0].clips.map((c) => c.src);
  assert.deepEqual(srcs, ['assets/stills/logo.png', 'assets/sounds/hit.wav']);
  await assert.rejects(moveFile(root, 'assets/b.png', 'assets/stills/logo.png'), (e) => e.status === 409);
  await assert.rejects(moveFile(root, 'assets/sounds', 'assets/sounds/inner'), FileError);
});

test('a rename never changes what a file is: another ending of the same kind is fine, a name in another case too', async () => {
  put('assets/red.png'); put('assets/tone.mp3'); put('assets/notes.txt'); put('assets/clips.mp3/x.png');
  await assert.rejects(moveFile(root, 'assets/red.png', 'assets/red.mp3'), (e) => e.status === 400 && /red\.png can't be renamed red\.mp3/.test(e.message));
  await assert.rejects(moveFile(root, 'assets/tone.mp3', 'assets/tone.mp4'), FileError);
  await assert.rejects(moveFile(root, 'assets/notes.txt', 'assets/notes.png'), FileError);
  assert.ok(existsSync(join(root, 'assets', 'red.png')), 'nothing moved');
  assert.equal((await moveFile(root, 'assets/red.png', 'assets/red.jpeg')).path, 'assets/red.jpeg');
  assert.equal((await moveFile(root, 'assets/tone.mp3', 'assets/sfx/tone.wav')).path, 'assets/sfx/tone.wav');
  /* a folder has no kind, whatever its name */
  assert.equal((await moveFile(root, 'assets/clips.mp3', 'assets/clips')).path, 'assets/clips');
  assert.equal((await moveFile(root, 'assets/red.jpeg', 'assets/Red.jpeg')).path, 'assets/Red.jpeg');
});

test('delete goes to the trash, not away', async () => {
  put('assets/a.mp4', 'keep me');
  await trashFile(root, 'assets/a.mp4');
  assert.ok(!existsSync(join(root, 'assets', 'a.mp4')));
  assert.equal(readFileSync(join(trash, 'a.mp4'), 'utf8'), 'keep me');
  await makeFolder(root, 'assets/new');
  await assert.rejects(makeFolder(root, 'assets/new'), (e) => e.status === 409);
});

test('one naming rule for imports, renames, moves and new folders: spaces and every script stay', async () => {
  assert.equal(cleanName('镜头 01.mp4'), '镜头 01.mp4');
  assert.equal(cleanName('Logos & Ünïcode'), 'Logos & Ünïcode');
  assert.equal(cleanName('  a: b / c?.png '), 'a b c .png');
  assert.equal(cleanName('..hidden\tname'), 'hidden name');
  assert.equal(cleanName('a"<>|*b'), 'a b');
  assert.equal(cleanName('...'), '');
  assert.equal(cleanName(`${'x'.repeat(200)}.mp4`), `${'x'.repeat(116)}.mp4`);
  put('assets/a.mp4');
  assert.equal((await moveFile(root, 'assets/a.mp4', 'assets/镜头 01.mp4')).path, 'assets/镜头 01.mp4');
  assert.equal(await makeFolder(root, 'assets/Logos & Ünïcode'), 'assets/Logos & Ünïcode');
  assert.equal(await makeFolder(root, 'assets/Re: cut'), 'assets/Re cut');
  assert.equal((await importFile(root, 'assets/Logos & Ünïcode/my: logo.png', Readable.from([Buffer.from('x')]))).path, 'assets/Logos & Ünïcode/my logo.png');
  await assert.rejects(makeFolder(root, 'assets/..'), FileError);
  await assert.rejects(moveFile(root, 'assets/镜头 01.mp4', 'assets/:::'), FileError);
});

test('a video\'s sound is taken out beside it, as it is, its transcript along; a second one gets a free name', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-sound-'));
  mkdirSync(join(root, 'assets'));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(root, 'assets', 'talk.mp4')]);
  writeFileSync(join(root, 'assets', 'talk.vtt'), 'WEBVTT\n\n00:00.000 --> 00:00.900\nhello\n');
  assert.equal(await extractAudio(root, 'assets/talk.mp4'), 'assets/talk.m4a');
  const streams = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', join(root, 'assets', 'talk.m4a')]).toString().trim();
  assert.equal(streams, 'aac,audio', 'the sound alone, not re-encoded');
  assert.equal(await extractAudio(root, 'assets/talk.mp4'), 'assets/talk-2.m4a');
  assert.ok(existsSync(join(root, 'assets', 'talk-2.vtt')), 'its words go with it');
  await assert.rejects(extractAudio(root, 'assets/talk.vtt'), /is not a video here/);
});

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a freeze frame is the video\'s frame at that moment, full size, a PNG beside it; never over another file', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  mkdirSync(join(root, 'assets'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', join(root, 'assets', 'shot.mp4')]);
  const still = await freezeFrame(root, 'assets/shot.mp4', 1240);
  assert.equal(still, 'assets/shot-frame-1_24s.png');
  const png = readFileSync(join(root, still));
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  /* the width and height in the PNG's header */
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 180]);
  assert.equal(await freezeFrame(root, 'assets/shot.mp4', 1240), 'assets/shot-frame-1_24s-2.png');
  await assert.rejects(freezeFrame(root, 'assets/none.mp4', 0), FileError);
  await assert.rejects(freezeFrame(root, '../x.mp4', 0), FileError);
});
