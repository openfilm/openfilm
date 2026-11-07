import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInRoot, libraryIndex } from '../studio/server/library.mjs';
import { describeAudio, readText, stem, tagsIn, vocabulary } from './library-words.mjs';

const vocab = vocabulary(builtInRoot());
const LANGS = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const KINDS = ['energy', 'mood', 'genre', 'instrument', 'use', 'sound', 'look', 'motion'];

test('every tag is named in each language, once, of a kind', () => {
  const file = JSON.parse(readFileSync(join(builtInRoot(), 'tags.json'), 'utf8'));
  const ids = new Set();
  for (const tag of file.tags) {
    assert.ok(!ids.has(tag.id), `${tag.id} twice`);
    ids.add(tag.id);
    assert.ok(KINDS.includes(tag.kind), `${tag.id}: kind ${tag.kind}`);
    for (const lang of LANGS) assert.ok(tag.name[lang], `${tag.id} has no ${lang} name`);
    assert.ok(Array.isArray(tag.words));
  }
});

test('the library\'s things carry tags of the vocabulary, and the made ones say what they are', () => {
  const { items } = /** @type {{ items: any[] }} */ (libraryIndex());
  /* what `openfilm get` searches in the library */
  const found = new Set(['music', 'sound', 'transition', 'effect', 'filter', 'sticker', 'text', 'template']);
  for (const item of items.filter((i) => found.has(i.cat))) {
    for (const t of item.tags ?? []) if (!/^stickers\/emoji\//.test(item.id)) assert.ok(vocab.byId.has(t), `${item.id}: no tag ${t}`);
    /* the sounds and music are described by scripts/library-describe.mjs, the emoji by their own words */
    if (/^(audio|sounds|stickers\/emoji)\//.test(item.id)) continue;
    assert.ok(typeof item.about === 'string' && item.about.length > 10, `${item.id}: what it is about`);
    assert.ok(item.tags?.length, `${item.id}: its tags`);
  }
  const music = items.filter((i) => i.cat === 'music');
  assert.ok(music.length > 100);
  assert.ok(music.every((i) => i.energy >= 1 && i.energy <= 5 && Array.isArray(i.tags)), 'every piece of music measured');
});

test('a word is compared without its plural, -ing or -ed', () => {
  assert.equal(stem('pads'), stem('pad'));
  assert.equal(stem('rising'), stem('rise'));
  assert.equal(stem('glitches'), stem('glitch'));
  assert.equal(stem('running'), stem('run'));
  assert.equal(stem('news'), 'news');
});

test('a text says tags in any language, its other words left over', () => {
  const en = readText(vocab, 'calm piano for a morning scene');
  assert.deepEqual([...en.tags].sort(), ['calm', 'morning', 'piano']);
  assert.deepEqual(en.words, ['for', 'a', 'scen']);
  assert.ok(tagsIn(vocab, '适合早晨的舒缓钢琴').has('piano'));
  assert.ok(tagsIn(vocab, '适合早晨的舒缓钢琴').has('morning'));
  assert.ok(tagsIn(vocab, 'música alegre para niños').has('kids'), 'accents folded');
  assert.ok(tagsIn(vocab, 'ピアノ').has('piano'));
  assert.ok(tagsIn(vocab, '잔잔한 피아노').has('piano'));
  /* the longest words first: film grain is the look, not two words */
  assert.ok(tagsIn(vocab, 'film grain').has('film'));
  /* a word two tags share says both */
  const pop = tagsIn(vocab, 'pop');
  assert.ok(pop.has('pop') && pop.has('bubble-pop'));
  /* one CJK character says its tag when asked, not in a name */
  assert.ok(readText(vocab, '雪', { asked: true }).tags.has('weather'));
  assert.ok(!tagsIn(vocab, '雪花屏').has('weather'));
});

test('sounds and music are described by their names, their group and how they were measured', () => {
  const name = (en) => ({ en, 'zh-CN': en, ja: en, ko: en, es: en });
  const items = [
    { id: 'audio/music/morning-felt-piano-000001.mp3', cat: 'music', group: 'calm', name: name('Gentle morning piano'), durationMs: 60000 },
    { id: 'audio/music/stadium-lights-000002.mp3', cat: 'music', group: 'electronic', name: name('Stadium lights'), durationMs: 60000 },
    { id: 'audio/music/warm-felt-piano-000003.mp3', cat: 'music', group: 'warm', name: name('Warm felt piano'), durationMs: 60000 },
    { id: 'audio/sfx/rain-loop-000004.mp3', cat: 'sound', group: 'ambience', name: name('Rain on a roof'), durationMs: 12000, bpm: 99, loop: false },
    { id: 'audio/sfx/door-000005.mp3', cat: 'sound', group: 'foley', name: name('Door slam'), durationMs: 900 },
  ];
  const quiet = { db: -28, flux: 0.05, centroid: 400, bpm: 70, pulse: 0.5, steady: 0.4, seam: 0 };
  const loud = { db: -9, flux: 0.35, centroid: 1200, bpm: 128, pulse: 0.8, steady: 0.9, seam: 0 };
  const measured = {
    [items[0].id]: quiet, [items[1].id]: loud, [items[2].id]: { ...quiet, db: -20, flux: 0.12, centroid: 600 },
    [items[3].id]: { ...quiet, bpm: null, steady: 0.9, seam: 0.95 }, [items[4].id]: { ...loud, bpm: null, steady: 0.1, seam: 0.1 },
  };
  const groups = { music: [{ id: 'calm', name: name('Calm') }, { id: 'electronic', name: name('Electronic') }, { id: 'warm', name: name('Warm') }],
    sound: [{ id: 'ambience', name: name('Ambience') }, { id: 'foley', name: name('Foley') }] };
  const [morning, drive, warm, rain, door] = describeAudio(vocab, items, measured, groups);
  assert.ok(morning.energy < drive.energy);
  assert.equal(drive.bpm, 128);
  assert.ok(['piano', 'morning', 'calm', 'background'].every((t) => morning.tags.includes(t)), morning.tags.join());
  assert.ok(drive.tags.includes('electronic'));
  assert.ok(warm.tags.includes('morning'), 'gentle, on a piano: a morning');
  assert.ok(!morning.tags.includes('warm-tone'), 'a sound is not a picture\'s look');
  assert.equal(rain.loop, true);
  assert.equal(rain.bpm, undefined, 'a sound has no tempo');
  assert.ok(rain.tags.includes('rain') && rain.tags.includes('ambience'));
  assert.equal(door.loop, undefined);
  assert.ok(door.energy > rain.energy);
  /* what was not measured: by its names and group */
  const [unmeasured] = describeAudio(vocab, [items[1]], {}, groups);
  assert.equal(unmeasured.energy, 4);
  assert.equal(unmeasured.bpm, undefined);
});
