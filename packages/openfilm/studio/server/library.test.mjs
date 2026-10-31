import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtInRoot, libraryFavorites, libraryFile, libraryIndex, libraryVoices, setLibraryFavorites, voiceKey } from './library.mjs';
import { takeSaved } from './saved.mjs';

const index = /** @type {{ groups: Record<string, { id: string }[]>, items: any[] }} */ (libraryIndex());
const LANGS = ['en', 'zh-CN', 'ja', 'ko', 'es'];

test('every thing of the library is there, named in each language, in a group of its category', () => {
  assert.ok(index.items.length > 50);
  const ids = new Set();
  for (const item of index.items) {
    assert.ok(!ids.has(item.id), `${item.id} twice`);
    ids.add(item.id);
    for (const lang of LANGS) assert.ok(item.name?.[lang], `${item.id} has no ${lang} name`);
    assert.ok(index.groups[item.cat]?.some((g) => g.id === item.group), `${item.id}: no group ${item.group} in ${item.cat}`);
    /* the things published apart from git (the emoji, the sounds and music) are checked where they are there */
    const apart = /^(stickers\/emoji|audio)\//.test(item.id);
    if (item.kind === 'page' && apart) assert.ok(item.poster && item.still, `${item.id}: its own picture`);
    if (item.kind === 'page' && !apart) {
      const about = JSON.parse(readFileSync(join(builtInRoot(), item.id, 'saved.json'), 'utf8'));
      assert.equal(about.kind, 'clip');
      assert.ok(existsSync(join(builtInRoot(), item.id, 'files', about.clip.src)), `${item.id}: its page`);
      assert.ok(item.place === 'cut' || Array.isArray(about.clip.time), `${item.id}: a page without an end needs its stretch`);
      for (const f of ['poster.jpg', 'preview.mp4']) assert.ok(libraryFile(`${item.id}/${f}`), `${item.id}: ${f}`);
      if (about.clip.attrs?.['data-props']) assert.ok(Array.isArray(JSON.parse(about.clip.attrs['data-props'])));
    }
    /* its own sounds are in git; audio.json's are published with the library */
    if (item.kind === 'sound' && item.id.startsWith('sounds/')) assert.ok(libraryFile(item.id), `${item.id}: the sound`);
    if (item.kind === 'sound') assert.match(item.id, /^(sounds|audio\/(sfx|music))\/[\w.-]+\.(m4a|mp3)$/);
    if (item.kind === 'look') assert.match(item.filter, /^[a-z-]+\(.+\)$/);
    if (item.kind === 'fade') assert.ok(['dissolve', 'dip-black', 'dip-white'].includes(item.fade));
  }
});

test('only files inside the library are given out', () => {
  assert.ok(libraryFile('index.json'));
  assert.equal(libraryFile('../package.json'), null);
  assert.equal(libraryFile('effects'), null);
  assert.equal(libraryFile(''), null);
  assert.equal(libraryFile(null), null);
});

test('a page of the library is taken into a project as a copy under saved/openfilm/, a sound into assets/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-library-project-'));
  const taken = await takeSaved(root, 'openfilm/effects/snow');
  assert.ok('clip' in taken);
  assert.equal(taken.clip.src, 'saved/openfilm/effects-snow/snow.html');
  assert.deepEqual(/** @type {any} */ (taken.clip).time, [0, 4]);
  assert.ok(existsSync(join(root, 'saved/openfilm/effects-snow/snow.html')));
  assert.ok(JSON.parse(String(/** @type {any} */ (taken.clip).attrs['data-props'])).some((p) => p.var === '--color'));
  const sound = await takeSaved(root, 'openfilm/sounds/whoosh.m4a');
  assert.deepEqual(sound, { path: 'assets/whoosh.m4a' });
  await assert.rejects(() => takeSaved(root, 'openfilm/../package.json'));
});

test('the starred things are kept in the shared prefs, those of the library only, each once', () => {
  const before = process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_SHARED_HOME = mkdtempSync(join(tmpdir(), 'of-library-home-'));
  try {
    assert.deepEqual(libraryFavorites(), []);
    assert.deepEqual(setLibraryFavorites(['effects/snow', 'nope/none', 'effects/snow', 7, 'filters/bw']), ['effects/snow', 'filters/bw']);
    assert.deepEqual(libraryFavorites(), ['effects/snow', 'filters/bw']);
    assert.deepEqual(setLibraryFavorites('all'), []);
  } finally {
    if (before === undefined) delete process.env.OPENFILM_SHARED_HOME; else process.env.OPENFILM_SHARED_HOME = before;
  }
});

test('the voices are the voice-over services\' own, each once, said as `openfilm get tts` takes them; a star can be on one', async () => {
  const { providers, voices } = /** @type {{ providers: any[], voices: any[] }} */ (libraryVoices());
  assert.deepEqual(providers.map((p) => p.id), ['elevenlabs', 'inworld', 'cartesia']);
  assert.ok(providers.every((p) => p.models.length && p.models.every((/** @type {any} */ m) => m.id && m.name)));
  const seen = new Set();
  for (const v of voices) {
    const key = voiceKey(v);
    assert.ok(!seen.has(key), `${key} twice`);
    seen.add(key);
    assert.ok(providers.some((p) => p.id === v.provider), `${key}: no such service`);
    assert.ok(v.id && v.name, `${key}: an id and a name`);
    assert.ok([null, 'm', 'f', 'n'].includes(v.gender) && [null, 'young', 'middle', 'old'].includes(v.age), `${key}: gender, age`);
    assert.ok(Array.isArray(v.tags));
    assert.equal(typeof v.featured, 'boolean', `${key}: featured or not`);
    assert.ok(v.uses === null || v.uses >= 0, `${key}: uses`);
    if (v.sample) assert.match(v.sample, new RegExp(`^voices/${v.provider}/[\\w.-]+\\.m4a$`));
  }
  for (const p of providers) assert.ok(voices.some((v) => v.provider === p.id), `${p.id} has voices`);
  /* ElevenLabs: its own voices and its library's featured ones, picked, first */
  const eleven = voices.filter((v) => v.provider === 'elevenlabs');
  assert.ok(eleven.length > 300 && eleven.filter((v) => v.featured).length >= 50);
  assert.ok(eleven.findIndex((v) => !v.featured) > eleven.findLastIndex((v) => v.featured));
  const home = mkdtempSync(join(tmpdir(), 'of-voices-'));
  const was = process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_SHARED_HOME = home;
  try {
    assert.deepEqual(setLibraryFavorites([voiceKey(voices[0]), 'voice:nobody/none']), [voiceKey(voices[0])]);
    assert.deepEqual(libraryFavorites(), [voiceKey(voices[0])]);
  } finally {
    if (was === undefined) delete process.env.OPENFILM_SHARED_HOME; else process.env.OPENFILM_SHARED_HOME = was;
  }
});
