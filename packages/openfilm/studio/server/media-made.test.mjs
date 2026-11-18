import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { carryMade, madeAnywhere, madeFile, madeView, noteMade, readMade, wordsByFingerprint } from './media-made.mjs';
import { scanProject } from './media-index.mjs';
import { createProject } from './projects.mjs';
import { isOutputName } from './providers/common.mjs';

const KEYS = ['OPENFILM_HOME', 'OPENFILM_SHARED_HOME', 'OPENFILM_LIBRARY'];
let before;
beforeEach(() => {
  before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'of-media-made-')));
  process.env.OPENFILM_HOME = join(base, 'home');
  delete process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_LIBRARY = join(base, 'Projects');
});
afterEach(() => {
  for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

/** A media file of its own bytes: `seed` tells files apart. */
function media(root, rel, seed, size = 100_000) {
  const bytes = Buffer.alloc(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 7 + seed * 13 + (i >> 9)) & 255;
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), bytes);
  return rel;
}
const BY = { via: 'fal', by: 'fal.ai', model: 'flux-2' };
/** A picture made as `openfilm get image` makes one. */
const picture = (root, out, seed, args, at) => noteMade(root, { verb: 'image', args: { out, ratio: '16:9', ...args }, paths: ['ref', 'mask', 'markup'], ...BY,
  files: [media(root, `assets/image/${out}.png`, seed)], now: at });

test('a file made says the words it was asked with, who made it and from what, under whatever name it has now', async () => {
  const { path: root } = await createProject('Made');
  media(root, 'assets/ref/face.png', 1);
  assert.equal(await picture(root, 'hero', 2, { prompt: 'a fox in snow', ref: ['assets/ref/face.png'], yes: true, force: true }, 1000), 1);
  const record = readMade(root)[await fingerprint(join(root, 'assets/image/hero.png'))];
  assert.deepEqual(record.args, { ratio: '16:9', prompt: 'a fox in snow' });
  assert.deepEqual(record.refs, [{ as: 'ref', path: 'assets/ref/face.png', fp: await fingerprint(join(root, 'assets/ref/face.png')) }]);

  let view = await madeView(root);
  assert.deepEqual(Object.keys(view), ['assets/image/hero.png']);
  assert.deepEqual({ ...view['assets/image/hero.png'], again: undefined }, {
    verb: 'image', found: false, words: 'a fox in snow', by: 'fal.ai', model: 'flux-2', at: 1000, args: { ratio: '16:9' },
    refs: [{ as: 'ref', path: 'assets/ref/face.png', name: 'face.png' }], versions: [], again: undefined,
  });

  /* both renamed: it is still known, and what it was made from is where it is now */
  renameSync(join(root, 'assets/image/hero.png'), join(root, 'assets/image/the fox.png'));
  renameSync(join(root, 'assets/ref/face.png'), join(root, 'assets/ref/portrait.png'));
  view = await madeView(root);
  assert.deepEqual(Object.keys(view), ['assets/image/the fox.png']);
  assert.deepEqual(view['assets/image/the fox.png'].refs, [{ as: 'ref', path: 'assets/ref/portrait.png', name: 'portrait.png' }]);
  assert.deepEqual(view['assets/image/the fox.png'].again, { verb: 'image', via: 'fal', model: 'flux-2',
    args: { out: 'the fox-2', ratio: '16:9', prompt: 'a fox in snow', ref: 'assets/ref/portrait.png' } });
});

test('what it was made from gone, it still says how it was made, and is not offered again', async () => {
  const { path: root } = await createProject('Gone');
  media(root, 'assets/ref/face.png', 1);
  await picture(root, 'hero', 2, { prompt: 'a fox', ref: ['assets/ref/face.png'] });
  rmSync(join(root, 'assets/ref/face.png'));
  await scanProject(root);
  const made = (await madeView(root))['assets/image/hero.png'];
  assert.deepEqual(made.refs, [{ as: 'ref', path: null, name: 'face.png' }]);
  assert.equal(made.again, undefined);
  assert.equal(made.words, 'a fox');
});

test('making media again keeps names in every script and fits the new numbered name before it is offered', async () => {
  const { path: root } = await createProject('Names');
  const names = ["春日 #1 + 100% & Bob's 🎬", 'नमस्ते', 'العَرَبِيَّة', 'Cafe\u0301', '图'.repeat(80), `${'a'.repeat(115)}🎬`];
  for (const [i, name] of names.entries()) await picture(root, name, i + 1, { prompt: name });
  media(root, 'assets/image/Café-2.png', 99);
  const view = await madeView(root);
  for (const name of names) {
    const made = Object.entries(view).find(([path]) => path.normalize('NFC') === `assets/image/${name}.png`.normalize('NFC'))?.[1];
    const out = made.again.args.out;
    assert.ok(isOutputName(out), out);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out), 'no half of an emoji');
    if (name === 'Cafe\u0301') assert.equal(out.normalize('NFC'), 'Café-3', 'skip names occupied in another Unicode normalization');
    else if (name.length < 100 && Buffer.byteLength(name) < 200) assert.equal(out.normalize('NFC'), `${name}-2`.normalize('NFC'));
  }
});

test('files asked for the same way are versions of one thing, the oldest first; so is a picture redrawn from one', async () => {
  const { path: root } = await createProject('Versions');
  await picture(root, 'hero', 1, { prompt: 'a fox  in snow' }, 1000);
  await picture(root, 'hero-2', 2, { prompt: 'a fox in snow ' }, 2000);
  await picture(root, 'other', 3, { prompt: 'a wolf in snow' }, 3000);
  await picture(root, 'hero-fixed', 4, { prompt: 'make the tail longer', ref: ['assets/image/hero-2.png'], mask: 'assets/image/hero.png' }, 4000);
  /* made with one as a reference, not redrawn from it: a thing of its own */
  await picture(root, 'poster', 5, { prompt: 'a poster of this fox', ref: ['assets/image/hero.png'] }, 5000);
  const view = await madeView(root);
  const versions = ['assets/image/hero.png', 'assets/image/hero-2.png', 'assets/image/hero-fixed.png'];
  for (const path of versions) assert.deepEqual(view[path].versions, versions, path);
  assert.deepEqual(view['assets/image/other.png'].versions, []);
  assert.deepEqual(view['assets/image/poster.png'].versions, []);
  /* a copy the person made of one is no version: it shows beside them, and says how it was made too */
  copyFileSync(join(root, 'assets/image/hero.png'), join(root, 'assets/image/hero copy.png'));
  await scanProject(root);
  const copied = await madeView(root);
  assert.deepEqual(copied['assets/image/hero copy.png'].versions, []);
  assert.equal(copied['assets/image/hero copy.png'].words, 'a fox  in snow');
  assert.deepEqual(copied['assets/image/hero.png'].versions, versions);
  /* a new take's name is free, whatever is there */
  assert.equal(view['assets/image/hero.png'].again.args.out, 'hero-3');
  assert.equal(view['assets/image/hero-2.png'].again.args.out, 'hero-3');
});

test('a clip is asked again as a new one, with every file it was made from; something found on the web says whose it is', async () => {
  const { path: root } = await createProject('Clip');
  media(root, 'assets/image/a.png', 1);
  media(root, 'assets/image/b.png', 2);
  await noteMade(root, { verb: 'video', args: { out: 'shot', prompt: 'a slow push', duration: 5, 'input-reference': ['assets/image/a.png', 'assets/image/b.png'] },
    paths: ['first-frame', 'input-reference'], via: 'fal', by: 'fal.ai', model: 'seedance-2.0', files: [media(root, 'assets/video/shot.mp4', 3)] });
  const clip = (await madeView(root))['assets/video/shot.mp4'];
  assert.deepEqual(clip.again.args, { out: 'shot-2', force: true, prompt: 'a slow push', duration: '5', 'input-reference': ['assets/image/a.png', 'assets/image/b.png'] });

  await noteMade(root, { verb: 'video-search', args: { out: 'sea', prompt: 'waves', n: 1 }, paths: [], via: 'pexels', by: 'Pexels',
    files: [media(root, 'assets/video/sea.mp4', 4)], index: [{ src: 'assets/video/sea.mp4', from: { mode: 'search', credit: 'Ada L.', sourceUrl: 'https://example.com/v/1' } }] });
  const found = (await madeView(root))['assets/video/sea.mp4'];
  assert.deepEqual({ found: found.found, credit: found.credit, page: found.page, again: found.again }, { found: true, credit: 'Ada L.', page: 'https://example.com/v/1', again: undefined });
});

test('a file changed since, a verb that makes no media and a record that cannot be read say nothing', async () => {
  const { path: root } = await createProject('Nothing');
  assert.equal(await noteMade(root, { verb: 'asr', args: { src: 'assets/a.wav' }, paths: ['src'], via: 'x', by: 'X', files: [] }), 0);
  assert.deepEqual(await madeView(root), {});
  await picture(root, 'hero', 1, { prompt: 'a fox' });
  /* of another size, so it is known to have changed whatever the clock says */
  media(root, 'assets/image/hero.png', 9, 110_000);
  await scanProject(root);
  assert.deepEqual(await madeView(root), {});
  writeFileSync(madeFile(root), '{ not json');
  assert.deepEqual(readMade(root), {});
});

test('the same file in another project is known by what the first knows of it', async () => {
  const one = await createProject('One');
  await picture(one.path, 'hero', 1, { prompt: 'a fox in snow' }, 1000);
  const fp = await fingerprint(join(one.path, 'assets/image/hero.png'));
  await createProject('Two');
  assert.deepEqual(await madeAnywhere(fp), { verb: 'image', found: false, words: 'a fox in snow', by: 'fal.ai', model: 'flux-2', at: 1000, args: { ratio: '16:9' } });
  assert.equal(await madeAnywhere('f1-00000000000000000000000000000000'), null);
  assert.deepEqual([...await wordsByFingerprint()], [[fp, 'a fox in snow']]);
});

test('what a canvas made before there was a record says its words and who made it, and is not asked again', async () => {
  const { path: root } = await createProject('Canvas');
  media(root, 'assets/image/a.png', 1);
  media(root, 'assets/image/b.png', 2);
  mkdirSync(join(root, '.film'), { recursive: true });
  writeFileSync(join(root, '.film/canvas-made.json'), JSON.stringify({ made: [
    { path: 'assets/image/a.png', make: 'image', prompt: 'a red door', via: 'fal', model: 'flux-2', at: 1000 },
    { path: 'assets/image/b.png', make: 'image', prompt: 'a red door', via: 'fal', model: 'flux-2', at: 2000 },
    { path: 'assets/image/gone.png', make: 'image', prompt: 'a blue door', at: 3000 },
  ] }));
  const view = await madeView(root);
  assert.deepEqual(Object.keys(view).sort(), ['assets/image/a.png', 'assets/image/b.png']);
  assert.deepEqual(view['assets/image/b.png'], { verb: 'image', found: false, words: 'a red door', by: 'fal.ai', model: 'flux-2', at: 2000, args: {}, refs: [],
    versions: ['assets/image/a.png', 'assets/image/b.png'] });
  /* made again with a record of its own: that is what is said of it */
  await picture(root, 'a', 1, { prompt: 'a red door, open' }, 5000);
  assert.equal((await madeView(root))['assets/image/a.png'].words, 'a red door, open');
  assert.deepEqual([...(await wordsByFingerprint()).values()].sort(), ['a red door', 'a red door, open']);
});

test('a file brought in from another project keeps how it was made, under where it landed', async () => {
  const from = await createProject('From');
  const into = await createProject('Into');
  await picture(from.path, 'hero', 1, { prompt: 'a fox in snow' }, 1000);
  await scanProject(from.path);
  media(into.path, 'assets/the fox.png', 9);
  copyFileSync(join(from.path, 'assets/image/hero.png'), join(into.path, 'assets/the fox.png'));
  assert.equal(await carryMade(into.path, 'assets/the fox.png'), true);
  const made = (await madeView(into.path))['assets/the fox.png'];
  assert.deepEqual({ words: made.words, by: made.by, model: made.model, out: made.again.args.out }, { words: 'a fox in snow', by: 'fal.ai', model: 'flux-2', out: 'the fox-2' });
  /* known here already, or known nowhere: nothing is done */
  assert.equal(await carryMade(into.path, 'assets/the fox.png'), false);
  media(into.path, 'assets/own.png', 5);
  assert.equal(await carryMade(into.path, 'assets/own.png'), false);
  assert.equal(await carryMade(into.path, 'assets/nope.png'), false);
});
