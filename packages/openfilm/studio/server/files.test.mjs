import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { FileError, bringIn, cleanName, collect, extractAudio, freezeFrame, importFile, inProject, inside, listFiles, makeFolder, moveCheck, moveFile, readable, relink, trashFile } from './files.mjs';
import { lstatSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { filmHtml, readFilmFile } from '../../src/film-doc.mjs';

let root, trash;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'of-files-'));
  trash = mkdtempSync(join(tmpdir(), 'of-trash-'));
  process.env.OPENFILM_TRASH_DIR = trash;
  /* the places the person linked are kept in Studio's home: one of each test's own */
  process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'of-home-'));
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

test('concurrent imports by the same name keep every distinct file and reuse identical bytes', async () => {
  const contents = Array.from({ length: 8 }, (_, i) => `picture ${i}`);
  const uploads = [...contents, ...contents];
  const landed = await Promise.all(uploads.map((text) => importFile(root, 'assets/pic.png', Readable.from([Buffer.from(text)]))));
  assert.equal(new Set(landed.map((file) => file.path)).size, contents.length);
  assert.equal(landed.filter((file) => !file.reused).length, contents.length);
  for (const [i, file] of landed.entries()) assert.equal(readFileSync(join(root, file.path), 'utf8'), uploads[i]);
  assert.deepEqual(readdirSync(join(root, 'assets')).sort(), ['pic.png', ...contents.slice(1).map((_, i) => `pic ${i + 2}.png`)].sort());
});

test('concurrent imports through two names for the same directory do not overwrite each other', links, async () => {
  mkdirSync(join(root, 'assets', 'real'), { recursive: true });
  symlinkSync(join(root, 'assets', 'real'), join(root, 'assets', 'alias'));
  const contents = Array.from({ length: 8 }, (_, i) => `picture ${i}`);
  const landed = await Promise.all(contents.map((text, i) => importFile(root, `assets/${i % 2 ? 'alias' : 'real'}/pic.png`, Readable.from([Buffer.from(text)]))));
  for (const [i, file] of landed.entries()) assert.equal(readFileSync(join(root, file.path), 'utf8'), contents[i]);
  assert.equal(readdirSync(join(root, 'assets', 'real')).length, contents.length);
});

test('moving a file or a folder points film.html at the new place; nothing is moved over another', async () => {
  put('assets/a.png'); put('assets/sfx/hit.wav'); put('assets/b.png');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 10, h: 10 }, tracks: [{ clips: [
    { src: 'assets/a.png', id: 'a', time: [0, 2] }, { src: 'assets/sfx/hit.wav', id: 'hit' },
  ] }] }));
  assert.deepEqual(await moveFile(root, 'assets/a.png', 'assets/stills/logo.png'), { path: 'assets/stills/logo.png', clips: 1, pages: 0 });
  assert.equal((await moveFile(root, 'assets/sfx', 'assets/sounds')).clips, 1);
  const srcs = readFilmFile(readFileSync(join(root, 'film.html'), 'utf8')).value.tracks[0].clips.map((c) => c.src);
  assert.deepEqual(srcs, ['assets/stills/logo.png', 'assets/sounds/hit.wav']);
  await assert.rejects(moveFile(root, 'assets/b.png', 'assets/stills/logo.png'), (e) => e.status === 409);
  await assert.rejects(moveFile(root, 'assets/sounds', 'assets/sounds/inner'), FileError);
});

test('a page moved into a folder keeps its links; a page linking to a moved picture follows it', async () => {
  put('assets/logo.png'); put('anim.js');
  writeFileSync(join(root, 'title.html'), '<script src="anim.js"></script><img src="assets/logo.png"><script type="module">fetch(dir + n)</script>');
  writeFileSync(join(root, 'end.html'), '<img src="assets/logo.png">');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 10, h: 10 }, tracks: [{ clips: [{ src: 'title.html', id: 't', time: [0, 2] }] }] }));
  /* asked first: what it cannot see is named, and nothing moves */
  const [said] = await moveCheck(root, 'title.html', 'scenes/title.html');
  assert.equal(said.file, 'title.html');
  assert.ok(said.unseen.some((u) => u.startsWith('fetch(dir')));
  assert.ok(existsSync(join(root, 'title.html')));
  const out = await moveFile(root, 'title.html', 'scenes/title.html');
  assert.deepEqual([out.path, out.clips, out.pages], ['scenes/title.html', 1, 1]);
  assert.match(readFileSync(join(root, 'scenes', 'title.html'), 'utf8'), /src="\.\.\/anim\.js".*src="\.\.\/assets\/logo\.png"/);
  /* the picture moves: the pages that show it follow (the moved one too) */
  await moveFile(root, 'assets/logo.png', 'assets/brand/logo.png');
  assert.match(readFileSync(join(root, 'end.html'), 'utf8'), /src="assets\/brand\/logo\.png"/);
  assert.match(readFileSync(join(root, 'scenes', 'title.html'), 'utf8'), /src="\.\.\/assets\/brand\/logo\.png"/);
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
  /* a long name is not cut in the middle of a character: half a surrogate pair would become U+FFFD on disk */
  const split = `${'a'.repeat(115)}😀${'b'.repeat(80)}.mp4`;
  const cut = cleanName(split);
  assert.ok(cut.length <= 120);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut), 'no half a character');
  assert.equal(cut, `${'a'.repeat(115)}.mp4`);
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

test('media linked from elsewhere (a NAS): read through the link, listed, never written there', links, async () => {
  const nas = mkdtempSync(join(tmpdir(), 'of-nas-'));
  writeFileSync(join(nas, 'take 1.mp4'), 'footage');
  mkdirSync(join(nas, 'b-roll'));
  writeFileSync(join(nas, 'b-roll', 'sky.png'), 'sky');
  mkdirSync(join(root, 'assets'));
  assert.deepEqual(await bringIn(root, 'assets', [join(nas, 'take 1.mp4'), join(nas, 'b-roll')], 'link'), ['assets/take 1.mp4', 'assets/b-roll']);
  assert.ok(lstatSync(join(root, 'assets', 'take 1.mp4')).isSymbolicLink());
  /* the same place linked again is the link there */
  assert.deepEqual(await bringIn(root, 'assets', [join(nas, 'take 1.mp4')], 'link'), ['assets/take 1.mp4']);
  /* read: followed; a film's clip finds it */
  assert.equal(readable(root, 'assets/take 1.mp4'), join(root, 'assets', 'take 1.mp4'));
  assert.ok(inProject(root, 'assets/b-roll/sky.png'));
  /* written: never */
  assert.throws(() => inside(root, 'assets/b-roll/new.png'), FileError);
  await assert.rejects(importFile(root, 'assets/b-roll/x.png', Readable.from([Buffer.from('x')])), FileError);
  await assert.rejects(moveFile(root, 'assets/take 1.mp4', 'assets/b-roll/take 1.mp4'), FileError);
  /* listed: the linked folder and what is in it, each link with where it leads */
  const listed = await listFiles(root);
  assert.deepEqual(listed.files.map((f) => f.path), ['assets/b-roll/sky.png', 'assets/take 1.mp4']);
  assert.ok(listed.folders.includes('assets/b-roll'));
  assert.deepEqual(Object.keys(listed.links).sort(), ['assets/b-roll', 'assets/take 1.mp4']);
  assert.equal(listed.links['assets/take 1.mp4'].missing, undefined);
  /* moved in the project: the link moves; deleted: only the link goes, the footage stays where it is kept */
  mkdirSync(join(root, 'assets', 'cuts'));
  assert.equal((await moveFile(root, 'assets/take 1.mp4', 'assets/cuts/take 1.mp4')).path, 'assets/cuts/take 1.mp4');
  await trashFile(root, 'assets/cuts/take 1.mp4');
  assert.ok(!existsSync(join(root, 'assets', 'cuts', 'take 1.mp4')));
  assert.equal(readFileSync(join(nas, 'take 1.mp4'), 'utf8'), 'footage');
  assert.deepEqual(readdirSync(trash), [], 'nothing of the NAS in the trash');
  rmSync(nas, { recursive: true, force: true });
});

test('a link that leads nowhere (the NAS is off) is listed as missing, relinked, and collected into the project', links, async () => {
  const nas = mkdtempSync(join(tmpdir(), 'of-nas-'));
  writeFileSync(join(nas, 'a.png'), 'one');
  mkdirSync(join(root, 'assets'));
  await bringIn(root, 'assets', [join(nas, 'a.png')], 'link');
  rmSync(join(nas, 'a.png'));
  const off = await listFiles(root);
  assert.deepEqual(off.files.map((f) => f.path), ['assets/a.png']);
  assert.equal(off.links['assets/a.png'].missing, true);
  assert.equal(inProject(root, 'assets/a.png'), null);
  /* pointed at where it is now, then copied in: the project's own file, the original untouched */
  const moved = mkdtempSync(join(tmpdir(), 'of-nas2-'));
  writeFileSync(join(moved, 'a.png'), 'two');
  await relink(root, 'assets/a.png', join(moved, 'a.png'));
  assert.equal(readFileSync(join(root, 'assets', 'a.png'), 'utf8'), 'two');
  await collect(root, 'assets/a.png');
  assert.ok(!lstatSync(join(root, 'assets', 'a.png')).isSymbolicLink());
  assert.equal(readFileSync(join(root, 'assets', 'a.png'), 'utf8'), 'two');
  assert.equal(readFileSync(join(moved, 'a.png'), 'utf8'), 'two');
  assert.deepEqual((await listFiles(root)).links, {});
});

for (const name of ['b-roll', '.b-roll']) test(`collecting a linked folder (${name}) keeps its files when the source goes offline`, links, async (t) => {
  const nas = mkdtempSync(join(tmpdir(), 'of-nas-'));
  t.after(() => rmSync(nas, { recursive: true, force: true }));
  const source = join(nas, name);
  mkdirSync(join(source, 'nested'), { recursive: true });
  writeFileSync(join(source, 'sky.png'), 'picture');
  writeFileSync(join(source, 'nested', 'sound.wav'), 'sound');
  writeFileSync(join(source, '.hidden'), 'hidden');
  const [rel] = await bringIn(root, 'assets', [source], 'link');
  assert.ok(lstatSync(join(root, rel)).isSymbolicLink());
  assert.equal(await collect(root, rel), rel);
  assert.ok(lstatSync(join(root, rel)).isDirectory(), 'a local folder, not another link');
  assert.equal(readFileSync(join(source, 'sky.png'), 'utf8'), 'picture', 'the source stays intact');
  assert.equal(readFileSync(join(source, 'nested', 'sound.wav'), 'utf8'), 'sound');
  assert.equal(readFileSync(join(source, '.hidden'), 'utf8'), 'hidden');
  rmSync(nas, { recursive: true, force: true });
  assert.equal(readFileSync(join(root, rel, 'sky.png'), 'utf8'), 'picture');
  assert.equal(readFileSync(join(root, rel, 'nested', 'sound.wav'), 'utf8'), 'sound');
  assert.ok(!existsSync(join(root, rel, '.hidden')), 'hidden children are still excluded');
  assert.deepEqual(readdirSync(join(root, 'assets')), [cleanName(name)], 'no collecting files left');
  assert.deepEqual((await listFiles(root)).links, {});
});

test('a link a project brings from elsewhere is not followed, even to a file that is there; one the person makes is', links, async () => {
  const away = mkdtempSync(join(tmpdir(), 'of-away-'));
  writeFileSync(join(away, 'secret.png'), 'theirs');
  mkdirSync(join(root, 'assets'));
  symlinkSync(join(away, 'secret.png'), join(root, 'assets', 'pic.png'));
  assert.equal(inProject(root, 'assets/pic.png'), null);
  assert.equal((await listFiles(root)).links['assets/pic.png'].missing, true);
  await assert.rejects(collect(root, 'assets/pic.png'), FileError);
  assert.ok(lstatSync(join(root, 'assets', 'pic.png')).isSymbolicLink());
  /* outside assets/ no link is followed, linked or not */
  await bringIn(root, 'assets', [join(away, 'secret.png')], 'link');
  symlinkSync(join(away, 'secret.png'), join(root, 'page.png'));
  assert.equal(inProject(root, 'page.png'), null);
  assert.ok(inProject(root, 'assets/pic.png'), 'the place is linked now');
});

test('files copied in from this computer: a copy each under a free name, the originals left as they are', async () => {
  const disk = mkdtempSync(join(tmpdir(), 'of-disk-'));
  writeFileSync(join(disk, 'a.png'), 'pic');
  mkdirSync(join(disk, 'set'));
  writeFileSync(join(disk, 'set', 'b.wav'), 'snd');
  writeFileSync(join(disk, 'set', '.DS_Store'), '');
  put('assets/a.png', 'other');
  assert.deepEqual(await bringIn(root, 'assets', [join(disk, 'a.png'), join(disk, 'set')], 'copy'), ['assets/a 2.png', 'assets/set']);
  assert.equal(readFileSync(join(root, 'assets', 'a 2.png'), 'utf8'), 'pic');
  assert.deepEqual(readdirSync(join(root, 'assets', 'set')), ['b.wav']);
  assert.ok(!lstatSync(join(root, 'assets', 'set')).isSymbolicLink());
  assert.equal(readFileSync(join(disk, 'a.png'), 'utf8'), 'pic');
  await assert.rejects(bringIn(root, 'scenes', [join(disk, 'a.png')], 'copy'), FileError);
  await assert.rejects(bringIn(root, 'assets', ['a.png'], 'copy'), FileError);
});

test('media is dated when it came into the project: a copy now, a link when it was made', links, async () => {
  const away = mkdtempSync(join(tmpdir(), 'of-away-'));
  for (const name of ['old.mp4', 'linked.mp4']) {
    writeFileSync(join(away, name), name);
    utimesSync(join(away, name), new Date('2020-01-01'), new Date('2020-01-01'));
  }
  put('assets/here.png');
  const before = Date.now() - 2000;
  await bringIn(root, 'assets', [join(away, 'old.mp4')], 'copy');
  await bringIn(root, 'assets', [join(away, 'linked.mp4')], 'link');
  const { files } = await listFiles(root);
  const of = (path) => files.find((f) => f.path === path);
  assert.ok(of('assets/old.mp4').added >= before, 'a copy is dated now, not as the original');
  assert.ok(of('assets/linked.mp4').added >= before, 'a link is dated when it was made');
  /* what a link leads to keeps its own date: its pictures are made again when it changes */
  assert.equal(of('assets/linked.mp4').mtime, new Date('2020-01-01').getTime());
  assert.equal(of('assets/here.png').added, of('assets/here.png').mtime);
});
