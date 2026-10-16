import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSaved, newSavedId, renameSaved, saveClip, saveFile, takeSaved } from './saved.mjs';

let saved;
let before;
beforeEach(() => {
  before = process.env.OPENFILM_SAVED;
  saved = mkdtempSync(join(tmpdir(), 'of-saved-'));
  process.env.OPENFILM_SAVED = saved;
});
afterEach(() => {
  if (before === undefined) delete process.env.OPENFILM_SAVED; else process.env.OPENFILM_SAVED = before;
});

/** A project with a title page that loads its own CSS and a picture, a video, and a file nothing uses. */
function project() {
  const root = mkdtempSync(join(tmpdir(), 'of-saved-project-'));
  mkdirSync(join(root, 'pages'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'pages', 'title.html'), '<!doctype html><link rel="stylesheet" href="title.css"><img src="../assets/logo.png"><h1 id="t">Hi</h1><iframe src="inset.html"></iframe><script>window.film={duration:2,frame(){}}</script>');
  writeFileSync(join(root, 'pages', 'title.css'), ':root { --accent: #ff5746; --size: 96px }\nh1 { color: var(--accent) }');
  writeFileSync(join(root, 'assets', 'logo.png'), 'png');
  writeFileSync(join(root, 'assets', 'unused.png'), 'unused');
  /* another clip's page beside it, and a page it loads in a frame */
  writeFileSync(join(root, 'pages', 'other.html'), '<!doctype html><p>Another clip</p>');
  writeFileSync(join(root, 'pages', 'inset.html'), '<!doctype html><p>Inset</p>');
  writeFileSync(join(root, 'film.html'), `<!doctype html><html><head><meta name="viewport" content="width=1920, height=1080"></head><body>
<section>
  <iframe id="title" src="pages/title.html" at="3" style="left: 10px; top: 20px; width: 400px; height: 200px" overrides='[{"at":"#t","text":"Hello","style":{"color":"#00ff00"}}]' data-link="l1"></iframe>
</section>
</body></html>`);
  return root;
}

test('a saved clip keeps how it is in the film, with every file it loads, and none it does not', async () => {
  const root = project();
  const item = await saveClip(root, 'title', { durationMs: 2000, w: 400, h: 200 });
  assert.equal(item.kind, 'clip');
  assert.equal(item.name, 'title');
  assert.equal(item.main, 'pages/title.html');
  assert.equal(item.durationMs, 2000);
  assert.equal(item.template, true, 'its CSS sets custom properties on :root');
  const dir = join(saved, item.id);
  for (const rel of ['pages/title.html', 'pages/title.css', 'assets/logo.png']) assert.ok(existsSync(join(dir, 'files', rel)), rel);
  assert.ok(existsSync(join(dir, 'files', 'pages', 'inset.html')), 'a page it loads');
  assert.ok(!existsSync(join(dir, 'files', 'pages', 'other.html')), 'not another clip\'s page beside it');
  assert.ok(!existsSync(join(dir, 'files', 'assets', 'unused.png')));
  assert.ok(!existsSync(join(dir, 'files', 'film.html')));
  const kept = JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8'));
  assert.equal(kept.clip.at, undefined, 'no place in time: it gets one where it is put');
  assert.equal(kept.clip.id, undefined);
  assert.equal(kept.clip.attrs, undefined, 'a link to clips of the film it came from is not kept');
  assert.deepEqual(kept.clip.overrides, [{ at: '#t', text: 'Hello', style: { color: '#00ff00' } }]);
  assert.deepEqual(kept.clip.box, { x: 10, y: 20, w: 400, h: 200 });
});

test('a clip taken into another project brings its files there once, under saved/, its page still finding them', async () => {
  const item = await saveClip(project(), 'title', { name: 'Lower third' });
  const other = mkdtempSync(join(tmpdir(), 'of-saved-other-'));
  const taken = await takeSaved(other, item.id);
  assert.ok('clip' in taken);
  assert.equal(taken.clip.src, `saved/${item.id}/pages/title.html`);
  assert.deepEqual(taken.clip.overrides, [{ at: '#t', text: 'Hello', style: { color: '#00ff00' } }]);
  for (const rel of ['pages/title.html', 'pages/title.css', 'assets/logo.png']) assert.ok(existsSync(join(other, 'saved', item.id, rel)), rel);
  /* taken again: what is there is used, a file changed there is not written over */
  writeFileSync(join(other, 'saved', item.id, 'assets', 'logo.png'), 'mine');
  await takeSaved(other, item.id);
  assert.equal(readFileSync(join(other, 'saved', item.id, 'assets', 'logo.png'), 'utf8'), 'mine');
});

test('a file is saved and taken as itself', async () => {
  const root = project();
  const item = await saveFile(root, 'assets/logo.png');
  assert.equal(item.kind, 'file');
  assert.equal(item.name, 'logo.png');
  const other = mkdtempSync(join(tmpdir(), 'of-saved-other-'));
  assert.deepEqual(await takeSaved(other, item.id), { path: `saved/${item.id}/assets/logo.png` });
  await assert.rejects(saveFile(root, '../outside.png'), /a file of the project/);
  await assert.rejects(saveFile(root, 'assets/gone.png'), /not in the project/);
});

test('the list is the newest first, and a name can be changed', async () => {
  const root = project();
  const a = await saveFile(root, 'assets/logo.png', { name: 'Logo' });
  await new Promise((r) => setTimeout(r, 5));
  const b = await saveClip(root, 'title', { name: '片头 Title' });
  assert.deepEqual((await listSaved()).map((x) => x.id), [b.id, a.id]);
  assert.match(b.id, /^片头-title-[0-9a-f]{6}$/);
  assert.equal((await renameSaved(a.id, '  New logo ')).name, 'New logo');
  assert.equal((await listSaved()).find((x) => x.id === a.id)?.name, 'New logo');
  await assert.rejects(renameSaved('../x', 'y'), /no such saved item/);
  await assert.rejects(saveClip(root, 'nope'), /not in the film/);
});

test('a saved thing\'s folder name: its words and a few letters of its own', () => {
  assert.match(newSavedId('Lower Third / blue!'), /^lower-third-blue-[0-9a-f]{6}$/);
  assert.match(newSavedId('***'), /^saved-[0-9a-f]{6}$/);
});
