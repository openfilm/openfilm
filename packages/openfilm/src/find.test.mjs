import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findCommand, findInLibrary, languageOf, takeCommand } from './find.mjs';
import { UsageError } from './shared.mjs';

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

test('nothing that fits is nothing found, and said so', () => {
  assert.deepEqual(findInLibrary('music', 'qwzxv'), []);
  const said = findCommand(['music', 'qwzxv'], {}, 'openfilm');
  assert.match(said.lines.join('\n'), /No music .* make it with `openfilm get music`/);
});

test('find prints each match\'s id to take, what it is like and where to see it', () => {
  const { lines } = findCommand(['transition', 'glitch'], { limit: '3' }, 'openfilm');
  const text = lines.join('\n');
  assert.match(text, /3 transition in OpenFilm's library for “glitch”/);
  assert.match(text, /^ {4}openfilm\/transitions\/glitch$/m);
  assert.match(text, /over a cut/);
  assert.match(text, /see it: .*transitions\/glitch\/preview\.mp4/);
  assert.match(text, /`openfilm take <id>`/);
  const zh = findCommand(['sound', '雨声'], {}, 'openfilm').lines.join('\n');
  assert.match(zh, /雨声 \(Rain\)/);
  assert.throws(() => findCommand(['music'], {}, 'openfilm'), UsageError);
  assert.throws(() => findCommand(['music', 'calm'], { limit: '0' }, 'openfilm'), UsageError);
  assert.throws(() => findCommand(['music', 'calm'], { duration: 'long' }, 'openfilm'), UsageError);
});

test('take copies a thing into the project and says what to write in film.html', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-take-'));
  writeFileSync(join(root, 'film.html'), '<!doctype html><html><body></body></html>');
  mkdirSync(join(root, 'scenes'));
  const before = process.cwd();
  process.chdir(join(root, 'scenes'));
  try {
    const page = await takeCommand(['openfilm/transitions/glitch'], 'openfilm');
    assert.ok(existsSync(join(root, 'saved/openfilm/transitions-glitch')));
    assert.match(page.lines.join('\n'), /its middle on the cut[\s\S]*<iframe src="saved\/openfilm\/transitions-glitch\/glitch\.html"><\/iframe>/);
    const sound = await takeCommand(['sounds/whoosh.m4a'], 'openfilm');
    assert.ok(existsSync(join(root, 'assets/whoosh.m4a')));
    assert.match(sound.lines.join('\n'), /<audio src="assets\/whoosh\.m4a"><\/audio>/);
    const motion = await takeCommand(['openfilm/motions/in-fade'], 'openfilm');
    assert.match(motion.lines.join('\n'), /@keyframes motion-in-fade \{ from \{ opacity: 0 \} \}[\s\S]*animation: motion-in-fade 0\.5s ease-out backwards/);
    const look = await takeCommand(['openfilm/filters/warm-film'], 'openfilm');
    assert.match(look.lines.join('\n'), /in Studio/);
    await assert.rejects(() => takeCommand(['openfilm/nope'], 'openfilm'), UsageError);
    await assert.rejects(() => takeCommand([], 'openfilm'), UsageError);
    process.chdir(tmpdir());
    const outside = await takeCommand(['sounds/whoosh.m4a'], 'openfilm');
    assert.equal(outside.ok, false);
  } finally {
    process.chdir(before);
  }
});
