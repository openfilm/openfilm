import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIBRARY_VERBS, findInLibrary, languageOf, libraryGet, libraryVerbs } from './library-search.mjs';

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
  assert.match(said.lines.join('\n'), /^Nothing in OpenFilm's library for “qwzxv”: make one with `openfilm get music`\.$/);
  assert.match((await libraryGet('transition', { prompt: 'qwzxv' })).lines[0], /write it yourself/);
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
  assert.match(text, /see it: .*transitions\/glitch\/preview\.mp4/);
  assert.match(text, /`openfilm get transition --take <id>`/);
  assert.equal((await libraryGet('transition', { prompt: 'glitch', n: '2' })).lines.filter((l) => /^ {4}openfilm\//.test(l)).length, 2, '--n is --limit');
  const music = (await libraryGet('music-search', { prompt: 'calm piano', sec: '50' })).lines.join('\n');
  assert.match(music, /Only when none of these fits, make one with `openfilm get music`\./);
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
