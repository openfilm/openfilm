import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInRoot, libraryIndex } from '../studio/server/library.mjs';
import { LIBRARY_VERBS, findInLibrary, languageOf, libraryGet, libraryVerbs, searchFile, searchLibrary } from './library-search.mjs';
import { embedder, manifest } from './library-semantic.mjs';

/* OpenFilm's service searching the library by meaning, as `POST /v1/library/search` does (the model and the things'
   vectors): here, when this checkout's library has the model (published with the library, not in git); else no
   service, and words alone */
/* the Services settings of the tests' own (Library search on, as it is by default) */
process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'library-search-home-'));
const model = manifest();
const semantic = Boolean(model?.files.every((f) => existsSync(join(builtInRoot(), f.path))));
const vectors = JSON.parse(readFileSync(join(builtInRoot(), 'vectors.json'), 'utf8'));
const values = new Int8Array(readFileSync(join(builtInRoot(), 'vectors.i8')).buffer.slice(0));
const service = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const { text, cat, limit } = JSON.parse(body);
    const q = await (await embedder())(`query: ${text}`);
    const found = [];
    vectors.ids.forEach((/** @type {string} */ id, /** @type {number} */ i) => {
      if (vectors.cats[i] !== cat) return;
      let dot = 0;
      for (let k = 0; k < vectors.dims; k++) dot += values[i * vectors.dims + k] * q[k];
      found.push([id, dot * vectors.scales[i]]);
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ found: found.sort((x, y) => y[1] - x[1]).slice(0, limit) }));
  });
});
if (semantic) {
  /* loaded before the first search, as the service loads it when it starts */
  await embedder();
  await new Promise((done) => service.listen(0, '127.0.0.1', () => done(undefined)));
  process.env.OPENFILM_API_URL = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (service.address()).port}`;
  after(() => service.close());
} else process.env.OPENFILM_API_URL = 'http://127.0.0.1:9';

test('library/search.json is of the library as it is (after changing the library, run scripts/library-search-index.mjs)', () => {
  assert.equal(readFileSync(join(builtInRoot(), 'search.json'), 'utf8'), searchFile(/** @type {any} */ (libraryIndex())));
});

test('calm piano for a morning scene: calm piano music for a morning', () => {
  const found = findInLibrary('music', 'calm piano for a morning scene', { limit: 5 });
  assert.equal(found.length, 5);
  for (const { item, tags } of found) {
    assert.equal(item.cat, 'music');
    assert.ok(tags.includes('piano') && tags.includes('morning'), `${item.id}: ${tags}`);
    assert.ok(/** @type {number} */ (item.energy) <= 2, `${item.id}: energy ${item.energy}`);
  }
});

test('a transition asked for by its name comes first, then the others like it', () => {
  const found = findInLibrary('transition', 'glitch');
  assert.equal(found[0].item.id, 'transitions/glitch');
  assert.ok(found.length >= 4 && found.every((f) => f.item.cat === 'transition' && f.tags.includes('glitch')));
});

test('asked in another language, found by its tags and names there', () => {
  assert.equal(findInLibrary('sound', '雨声')[0].item.id, 'sounds/rain.m4a');
  assert.ok(findInLibrary('sound', '打字音效').every((f) => f.tags.includes('typing')));
  assert.ok(findInLibrary('music', 'música alegre para niños', { limit: 3 }).every((f) => f.tags.includes('kids')));
  assert.ok(findInLibrary('filter', '暖色 复古').slice(0, 3).every((f) => f.tags.includes('warm-tone') || f.tags.includes('retro')));
  assert.equal(languageOf('雨声'), 'zh-CN');
  assert.equal(languageOf('ピアノ'), 'ja');
  assert.equal(languageOf('피아노'), 'ko');
  assert.equal(languageOf('piano'), 'en');
});

test('how lively, how fast and how long: energy, tempo and length count', () => {
  const soft = findInLibrary('music', 'soft ambient', { limit: 5 });
  const hard = findInLibrary('music', 'energetic electronic', { limit: 5 });
  const mean = (list) => list.reduce((s, f) => s + f.item.energy, 0) / list.length;
  assert.ok(mean(soft) < mean(hard), `${mean(soft)} < ${mean(hard)}`);
  const fast = findInLibrary('music', 'epic 120 bpm', { limit: 3 });
  assert.ok(fast.every((f) => Math.abs(/** @type {number} */ (f.item.bpm) - 120) <= 8), fast.map((f) => f.item.bpm).join());
  const long = findInLibrary('music', 'calm piano', { duration: 50, limit: 5 });
  assert.ok(long.every((f) => /** @type {number} */ (f.item.durationMs) >= 50000 || f.item.loop), 'music at least as long as asked, or a loop');
  const all = findInLibrary(null, 'glitch', { limit: 12 });
  assert.ok(all.some((f) => f.item.cat === 'sound') && all.some((f) => f.item.cat === 'transition'), 'every kind without one');
});

test('nothing that fits is nothing found, and said so', async () => {
  assert.deepEqual(findInLibrary('music', 'qwzxv'), []);
  const said = await libraryGet('music-search', { prompt: 'qwzxv' });
  assert.equal(said.code, 0);
  /* a vector is near something whatever is asked: then the nearest are given as such */
  if (semantic) assert.match(said.lines[0], /^No words of “qwzxv” are in OpenFilm's library; the 8 nearest in meaning, which may not fit:$/);
  else {
    assert.match(said.lines[0], /^Nothing in OpenFilm's library for “qwzxv”: make one with `openfilm get music`\.$/);
    assert.match((await libraryGet('transition', { prompt: 'qwzxv' })).lines[0], /write it yourself/);
  }
});

test('with OpenFilm\'s service, what is meant is found with no word in common, and what is named stays first', { skip: !semantic && 'the model is not in this library' }, async () => {
  const goodbye = (await searchLibrary('music', 'sad goodbye at a train station', { limit: 5 })).found;
  assert.ok(goodbye.filter(({ item }) => /farewell|grief|goodbye|lament|elegiac/i.test(`${item.name.en} ${item.about ?? ''}`)).length >= 3, goodbye.map((f) => f.item.name.en).join());
  assert.ok(!goodbye.some(({ item }) => /training|gym/i.test(item.name.en)), 'no word taken for what it is not');
  const guzheng = (await searchLibrary('music', '古风 古筝', { limit: 5 })).found;
  assert.ok(guzheng.every(({ tags }) => tags.includes('chinese')), guzheng.map((f) => f.item.name.en).join());
  const vague = await searchLibrary('music', '下班路上的感觉', { limit: 3 });
  assert.equal(vague.worded, false);
  assert.equal(vague.found.length, 3);
  assert.equal((await searchLibrary('transition', 'glitch')).found[0].item.id, 'transitions/glitch');
  assert.equal((await searchLibrary('sound', '雨声')).found[0].item.id, 'sounds/rain.m4a');
  const long = (await searchLibrary('music', 'calm piano', { duration: 50, limit: 5 })).found;
  assert.ok(long.every(({ item }) => /** @type {number} */ (item.durationMs) >= 50000 || item.loop), 'music at least as long as asked, or a loop');
});

test('the library is part of `openfilm get`: a search verb beside each one that makes, a verb for each kind only it has', () => {
  assert.deepEqual(Object.keys(LIBRARY_VERBS), ['music-search', 'sfx-search', 'transition', 'effect', 'filter', 'sticker', 'text', 'template']);
  for (const v of libraryVerbs()) {
    assert.match(v.help, /^Free and offline/);
    assert.ok(v.options.prompt && v.options.take && v.options.limit);
  }
  assert.equal(LIBRARY_VERBS['music-search'].makes, 'music');
  assert.equal(LIBRARY_VERBS['sfx-search'].makes, 'sfx');
  assert.deepEqual(libraryVerbs('sticker').map((v) => v.verb), ['sticker']);
  assert.deepEqual(libraryVerbs('image'), []);
});

test('a search prints each match\'s id to take, what it is like and where to see it', async () => {
  const { code, lines } = await libraryGet('transition', { prompt: 'glitch', limit: '3' });
  const text = lines.join('\n');
  assert.equal(code, 0);
  assert.match(text, /^3 in OpenFilm's library for “glitch”, the best first/);
  assert.match(text, /^ {4}openfilm\/transitions\/glitch$/m);
  assert.match(text, /over a cut/);
  assert.match(text, /see it: .*transitions[\\/]glitch[\\/]preview\.mp4/);
  assert.match(text, /`openfilm get transition --take <id>`/);
  assert.equal((await libraryGet('transition', { prompt: 'glitch', n: '2' })).lines.filter((l) => /^ {4}openfilm\//.test(l)).length, 2, '--n is --limit');
  const music = (await libraryGet('music-search', { prompt: 'calm piano', sec: '50' })).lines.join('\n');
  assert.match(music, /^ {4}has: calm, piano$/m, 'what of the prompt each has');
  assert.match(music, /None fits well enough, or the film needs its own\? Make one with `openfilm get music`, made to the prompt \(it costs\)\./);
  /* by meaning, the cave comes first though no dragon roars in it; by words alone, a roar would */
  if (semantic) {
    const roar = (await libraryGet('sfx-search', { prompt: 'dragon roar in a cave', limit: '1' })).lines.join('\n');
    assert.match(roar, /^ {4}has: cave · lacks: dragon, roar$/m, 'and what it lacks');
  }
  const zh = (await libraryGet('sfx-search', { prompt: '雨声' })).lines.join('\n');
  assert.match(zh, /雨声 \(Rain\)/);
  for (const [flags, said] of [[{}, /what to look for, please: `openfilm get music-search --prompt "/], [{ prompt: 'calm', limit: '0' }, /--limit is a whole number/],
    [{ prompt: 'calm', sec: 'long' }, /--sec is seconds/], [{ prompt: 'calm', via: 'x' }, /there is no --via/], [{ prompt: true }, /--prompt takes a value/]]) {
    const wrong = await libraryGet('music-search', /** @type {any} */ (flags));
    assert.equal(wrong.code, 2);
    assert.match(wrong.lines[0], said);
  }
});

test('--take copies a thing into the project and says what to write in film.html', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-take-'));
  writeFileSync(join(root, 'film.html'), '<!doctype html><html><body></body></html>');
  mkdirSync(join(root, 'scenes'));
  const before = process.cwd();
  process.chdir(join(root, 'scenes'));
  try {
    const page = await libraryGet('transition', { take: 'openfilm/transitions/glitch' });
    assert.equal(page.code, 0);
    assert.ok(existsSync(join(root, 'saved/openfilm/transitions-glitch')));
    assert.match(page.lines.join('\n'), /its middle on the cut[\s\S]*<iframe src="saved\/openfilm\/transitions-glitch\/glitch\.html"><\/iframe>/);
    const sound = await libraryGet('sfx-search', { take: 'sounds/whoosh.m4a' });
    assert.ok(existsSync(join(root, 'assets/whoosh.m4a')));
    assert.match(sound.lines.join('\n'), /<audio src="assets\/whoosh\.m4a"><\/audio>/);
    /* once the film has it, a search says so */
    writeFileSync(join(root, 'film.html'), '<!doctype html><html><body><section><audio src="assets/whoosh.m4a"></audio></section></body></html>');
    const again = (await libraryGet('sfx-search', { prompt: 'whoosh' })).lines.join('\n');
    assert.match(again, /^ {4}openfilm\/sounds\/whoosh\.m4a\n(?: {4}.*\n)*? {4}in this film already$/m);
    const motion = await libraryGet('effect', { take: 'openfilm/motions/in-fade' });
    assert.match(motion.lines.join('\n'), /@keyframes motion-in-fade \{ from \{ opacity: 0 \} \}[\s\S]*animation: motion-in-fade 0\.5s ease-out backwards/);
    const look = await libraryGet('filter', { take: 'openfilm/filters/warm-film' });
    assert.match(look.lines.join('\n'), /in Studio/);
    assert.equal((await libraryGet('transition', { take: 'openfilm/nope' })).code, 2);
    assert.equal((await libraryGet('music-search', { take: 'openfilm/transitions/glitch' })).code, 2, 'a thing of its own kind');
    process.chdir(tmpdir());
    assert.equal((await libraryGet('sfx-search', { take: 'sounds/whoosh.m4a' })).code, 2, 'not in a project');
  } finally {
    process.chdir(before);
  }
});
