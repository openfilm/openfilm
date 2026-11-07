import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { compoundOuter, readPartFilm, writePartFilm } from './parts.mjs';
import { inside } from './files.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'of-parts-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'a.mp4'), '');
  writeFileSync(join(root, 'film.html'), filmHtml({ stage: { w: 640, h: 360 }, tracks: [], keyframes: { gone: '0% { opacity: 0 }' } })
    .replace('<style>', '<style>\n  @font-face { font-family: X; src: url(assets/x.woff2) }'));
  return root;
}

test('a compound clip\'s film: written in a folder of its own with the film\'s looks, read back as it says', async () => {
  const root = project();
  const film = { stage: { w: 640, h: 360 }, tracks: [{ clips: [{ id: 'a', src: '../../assets/a.mp4', time: [0, 2] }] }], keyframes: {} };
  const folder = await writePartFilm(root, 'compound', film);
  assert.equal(folder, 'parts/compound');
  assert.equal(await writePartFilm(root, 'compound', film), 'parts/compound-2', 'a name taken: the next');
  const text = readFileSync(join(root, folder, 'film.html'), 'utf8');
  assert.match(text, /url\(\.\.\/\.\.\/assets\/x\.woff2\)/, 'its fonts named from its folder');
  assert.doesNotMatch(text, /@keyframes gone/, 'the film\'s other keyframes left behind');
  assert.deepEqual((await readPartFilm(root, folder)).tracks[0].clips[0].src, '../../assets/a.mp4');
  await assert.rejects(readPartFilm(root, '../elsewhere'));
});

test('a compound clip\'s folder reaches the files of the project it is in, never past it nor into its tools', async () => {
  const root = project();
  const folder = await writePartFilm(root, 'compound', { tracks: [] });
  const own = join(root, folder);
  assert.equal(compoundOuter(own), compoundOuter(root));
  assert.equal(inside(own, '../../assets/a.mp4'), join(root, 'assets', 'a.mp4'));
  assert.throws(() => inside(own, '../../../x'));
  assert.throws(() => inside(own, '.film/state.json'));
  assert.throws(() => inside(own, '../../.film/state.json'));
  assert.throws(() => inside(root, '../x'), 'a project of its own is as it was');
});
