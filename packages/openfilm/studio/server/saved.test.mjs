import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFolder, moveFile } from './files.mjs';
import { bringClip, libraryRel, listLibrary, saveClip, saveFile, saveGroup, takeSaved } from './saved.mjs';

let saved;
let before;
beforeEach(() => {
  before = process.env.OPENFILM_SAVED;
  saved = join(mkdtempSync(join(tmpdir(), 'of-saved-')), 'Saved');
  process.env.OPENFILM_SAVED = saved;
});
afterEach(() => {
  if (before === undefined) delete process.env.OPENFILM_SAVED; else process.env.OPENFILM_SAVED = before;
});

/** A project with a title page that loads its own CSS, a picture and a page in a frame, beside another clip's page. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'of-saved-project-'));
  mkdirSync(join(root, 'pages'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'pages', 'title.html'), '<!doctype html><link rel="stylesheet" href="title.css"><img src="../assets/logo.png"><h1 id="t">Hi</h1><iframe src="inset.html"></iframe><script>window.film={duration:2,frame(){}}</script>');
  writeFileSync(join(root, 'pages', 'title.css'), ':root { --accent: #ff5746; --size: 96px }\nh1 { color: var(--accent) }');
  writeFileSync(join(root, 'pages', 'inset.html'), '<!doctype html><p>Inset</p>');
  writeFileSync(join(root, 'pages', 'other.html'), '<!doctype html><p>Another clip</p>');
  writeFileSync(join(root, 'assets', 'logo.png'), 'png');
  writeFileSync(join(root, 'assets', 'unused.png'), 'unused');
  writeFileSync(join(root, 'assets', 'v.mp4'), 'mp4');
  writeFileSync(join(root, 'film.html'), `<meta name="viewport" content="width=1920, height=1080">
<section>
  <iframe id="title" src="pages/title.html" at="5" size="1080x1920" style="left: 10px; top: 20px; width: 400px; height: 200px" overrides='[{"at":"#t","text":"Hello","style":{"--accent":"#00ff00"}}]' data-link="T" data-props='[{"name":"Title","type":"text","at":"#t"}]'></iframe>
</section>
<section>
  <video id="v" src="assets/v.mp4#t=0,4" at="3" data-link="L"></video>
  <video id="w" src="assets/v.mp4#t=4,6" at="9" data-link="M"></video>
</section>
<section>
  <audio id="a" src="assets/v.mp4#t=0,4" at="3" data-link="L"></audio>
</section>
`);
  return root;
}

test('a saved clip is a folder of the library named as the person reads it, with every file it loads and none it does not', async () => {
  const root = project();
  const path = await saveClip(root, 'title', { name: 'Lower third', durationMs: 2000, w: 400, h: 200 });
  assert.equal(path, 'saved/Lower third');
  const dir = join(saved, 'Lower third');
  for (const rel of ['pages/title.html', 'pages/title.css', 'pages/inset.html', 'assets/logo.png']) assert.ok(existsSync(join(dir, 'files', rel)), rel);
  for (const rel of ['pages/other.html', 'assets/unused.png', 'film.html']) assert.ok(!existsSync(join(dir, 'files', rel)), rel);
  const kept = JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8'));
  assert.equal(kept.kind, 'clip');
  assert.equal(kept.clip.at, undefined, 'no place in time: it gets one where it is put');
  assert.equal(kept.clip.id, undefined);
  assert.deepEqual(kept.clip.attrs, { 'data-props': '[{"name":"Title","type":"text","at":"#t"}]' }, 'its properties kept (a component); a link to clips of the film it came from not');
  assert.deepEqual(kept.clip.overrides, [{ at: '#t', text: 'Hello', style: { '--accent': '#00ff00' } }]);
  assert.deepEqual(kept.clip.box, { x: 10, y: 20, w: 400, h: 200 });
  assert.equal(await saveClip(root, 'title', { name: 'Lower third' }), 'saved/Lower third 2', 'a name taken gets a number');
  await assert.rejects(saveClip(root, 'nope'), /not in the film/);
});

test('the library lists files of any kind and folders as a project\'s media, a bundle as one entry with what it is', async () => {
  const root = project();
  mkdirSync(saved, { recursive: true });
  await makeFolder(saved, 'Logos');
  writeFileSync(join(saved, 'Logos', 'acme.svg'), '<svg/>');
  writeFileSync(join(saved, 'notes.pdf'), 'pdf');
  writeFileSync(join(saved, '.DS_Store'), 'x');
  await saveClip(root, 'title', { name: 'Lower third', durationMs: 2000, w: 400, h: 200, into: 'saved/Logos' });
  const { files, folders, pages } = await listLibrary();
  assert.deepEqual(folders, ['saved/Logos']);
  assert.deepEqual(pages, []);
  assert.deepEqual(files.map((f) => [f.path, f.kind]), [['saved/Logos/acme.svg', 'image'], ['saved/Logos/Lower third', 'page'], ['saved/notes.pdf', 'other']]);
  /* its page where the library has it, laid out and changed as its clip had it: the viewer plays it as the film did */
  assert.deepEqual(files[1].saved, {
    kind: 'clip', props: 1, durationMs: 2000, w: 400, h: 200, page: 'Logos/Lower third/files/pages/title.html',
    size: { w: 1080, h: 1920 }, overrides: [{ at: '#t', text: 'Hello', style: { '--accent': '#00ff00' } }],
  });
});

test('a bundle moves and is renamed as a folder; taken into a project, its files go under saved/ there once, its page still finding them', async () => {
  const root = project();
  await saveClip(root, 'title', { name: 'Lower third' });
  await makeFolder(saved, 'Titles');
  await moveFile(saved, 'Lower third', 'Titles/Blue lower third');
  const other = mkdtempSync(join(tmpdir(), 'of-saved-other-'));
  const taken = await takeSaved(other, 'saved/Titles/Blue lower third');
  assert.ok('clip' in taken);
  assert.equal(taken.clip.src, 'saved/Titles/Blue-lower-third/pages/title.html');
  assert.deepEqual(taken.clip.overrides, [{ at: '#t', text: 'Hello', style: { '--accent': '#00ff00' } }]);
  for (const rel of ['pages/title.html', 'pages/title.css', 'assets/logo.png']) assert.ok(existsSync(join(other, 'saved/Titles/Blue-lower-third', rel)), rel);
  /* taken again: what is there is used, a file changed there is not written over */
  writeFileSync(join(other, 'saved/Titles/Blue-lower-third/assets/logo.png'), 'mine');
  await takeSaved(other, 'saved/Titles/Blue lower third');
  assert.equal(readFileSync(join(other, 'saved/Titles/Blue-lower-third/assets/logo.png'), 'utf8'), 'mine');
  await assert.rejects(takeSaved(other, 'saved/Titles'), /a folder/);
  await assert.rejects(takeSaved(other, 'saved/gone.png'), /not in Saved/);
});

test('a file of any kind is saved as itself, and taken as an import into assets/; a page with what it loads', async () => {
  const root = project();
  writeFileSync(join(root, 'assets', 'brief.pdf'), 'pdf');
  assert.equal(await saveFile(root, 'assets/logo.png'), 'saved/logo.png');
  assert.equal(await saveFile(root, 'assets/logo.png'), 'saved/logo.png', 'the same bytes there already are that file');
  assert.equal(await saveFile(root, 'assets/brief.pdf', { into: 'saved' }), 'saved/brief.pdf');
  assert.equal(await saveFile(root, 'pages/title.html'), 'saved/title');
  assert.ok(existsSync(join(saved, 'title', 'files', 'assets', 'logo.png')));
  const other = mkdtempSync(join(tmpdir(), 'of-saved-other-'));
  assert.deepEqual(await takeSaved(other, 'saved/logo.png'), { path: 'assets/logo.png' });
  assert.deepEqual(await takeSaved(other, 'saved/title'), { path: 'saved/title/pages/title.html' });
  await assert.rejects(saveFile(root, '../outside.png'), /a file of the project/);
  await assert.rejects(saveFile(root, 'assets/gone.png'), /not in the project/);
});

test('clips saved together keep their tracks and times from the first, and the links among them only', async () => {
  const root = project();
  const path = await saveGroup(root, ['title', 'v', 'a', 'w'], { name: 'Opener' });
  assert.equal(path, 'saved/Opener');
  const other = mkdtempSync(join(tmpdir(), 'of-saved-other-'));
  const taken = await takeSaved(other, path);
  assert.ok('clips' in taken);
  assert.deepEqual(taken.clips.map(({ track, at, clip }) => [track, at, clip.src, clip.attrs?.['data-link'] ?? null]), [
    [0, 2, 'saved/Opener/pages/title.html', null],
    [1, 0, 'saved/Opener/assets/v.mp4', 'L'],
    [1, 6, 'saved/Opener/assets/v.mp4', null],
    [2, 0, 'saved/Opener/assets/v.mp4', 'L'],
  ]);
  const listed = (await listLibrary()).files.find((f) => f.path === path);
  assert.deepEqual([listed?.kind, listed?.saved?.kind, listed?.saved?.count], ['page', 'group', 4]);
  await assert.rejects(saveGroup(root, ['title', 'gone']), /not all in the film/);
});

test('a place in the library is named from saved/', () => {
  assert.equal(libraryRel('saved'), '');
  assert.equal(libraryRel('saved/a/b.png'), 'a/b.png');
  assert.throws(() => libraryRel('assets/a.png'), /a place in Saved/);
  assert.throws(() => libraryRel(7), /a place in Saved/);
});

test('a clip brought from another project: its page and what it loads copied in under its project\'s name, once', async () => {
  const from = project();
  const root = mkdtempSync(join(tmpdir(), 'of-saved-into-'));
  const clip = { src: 'pages/title.html', overrides: [{ at: '#t', t: [24, 24] }] };
  const { clip: brought } = await bringClip(root, from, clip, 'Launch: v2');
  assert.deepEqual(brought, { ...clip, src: 'pasted/Launch-v2/pages/title.html' });
  for (const f of ['pages/title.html', 'pages/title.css', 'pages/inset.html', 'assets/logo.png']) assert.ok(existsSync(join(root, 'pasted/Launch-v2', f)), f);
  for (const f of ['pages/other.html', 'assets/unused.png', 'film.html']) assert.ok(!existsSync(join(root, 'pasted/Launch-v2', f)), `${f} is not the clip's`);
  /* changed here since: brought again, it is used as it is */
  writeFileSync(join(root, 'pasted/Launch-v2/pages/title.css'), 'h1 { color: red }');
  await bringClip(root, from, clip, 'Launch: v2');
  assert.equal(readFileSync(join(root, 'pasted/Launch-v2/pages/title.css'), 'utf8'), 'h1 { color: red }');
  await assert.rejects(bringClip(root, from, { src: 'pages/gone.html' }, 'Launch'), /not in its project/);
});

test('the clips of two pages brought from one project: the files of each, under one place for that project', async () => {
  const from = project();
  writeFileSync(join(from, 'pages', 'other.html'), '<!doctype html><img src="../assets/v.mp4"><p>Another clip</p>');
  const root = mkdtempSync(join(tmpdir(), 'of-saved-two-'));
  const one = await bringClip(root, from, { src: 'pages/title.html' }, 'Launch');
  const two = await bringClip(root, from, { src: 'pages/other.html' }, 'Launch');
  assert.deepEqual([one.clip.src, two.clip.src], ['pasted/Launch/pages/title.html', 'pasted/Launch/pages/other.html']);
  for (const f of ['assets/logo.png', 'assets/v.mp4', 'pages/other.html']) assert.ok(existsSync(join(root, 'pasted/Launch', f)), f);
});
