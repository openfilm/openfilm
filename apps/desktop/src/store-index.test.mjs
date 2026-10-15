import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeIndex, readStoreIndex } from './store-index.mjs';

const RAW = {
  version: 1,
  updated: '2026-10-15T00:00:00Z',
  skills: [
    { id: 'lyric-pv', source: { repo: 'https://github.com/openfilm/skills', path: 'lyric-pv', commit: 'abc' }, badge: 'official',
      title: { en: 'Lyric music video', 'zh-CN': '歌词 MV' }, summary: { en: 'Every word on its beat.' }, category: 'format',
      author: { name: 'OpenFilm' }, version: '1.0.0', preview: { poster: 'media/lyric-pv.jpg', video: 'https://cdn.example.com/a.mp4' },
      scripts: 2, needs: [{ kind: 'file', what: 'song', label: { en: 'A song' } }, { kind: 'weird' }], featured: 1 },
    { id: 'Bad Name', source: { repo: 'x' }, title: { en: 'x' } },
    { id: 'no-title', source: { repo: 'x' } },
    { id: 'odd', source: { repo: 'https://github.com/a/b' }, title: 'Odd', badge: 'gold', category: 'music' },
  ],
};

test('an index as the store shows it: its previews made whole, anything not a skill as listed left out', () => {
  const index = normalizeIndex(RAW, 'https://openfilm.dev/skills/index.json');
  assert.deepEqual(index.skills.map((s) => s.id), ['lyric-pv', 'odd']);
  const [lyric, odd] = index.skills;
  assert.equal(lyric.preview.poster, 'https://openfilm.dev/skills/media/lyric-pv.jpg');
  assert.equal(lyric.preview.video, 'https://cdn.example.com/a.mp4');
  assert.deepEqual(lyric.needs, [{ kind: 'file', what: 'song', label: { en: 'A song' } }]);
  assert.deepEqual([odd.title, odd.badge, odd.category], [{ en: 'Odd' }, 'community', 'format'], 'a plain title, an unknown badge or category: read as the plainest');
});

test('the index read from its address and kept; offline, the one kept is shown', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'of-store-'));
  const file = join(mkdtempSync(join(tmpdir(), 'of-store-src-')), 'index.json');
  writeFileSync(file, JSON.stringify(RAW));
  const read = await readStoreIndex({ dataDir, address: file });
  assert.deepEqual([read.ok, read.offline, read.index.skills.length], [true, false, 2]);
  const offline = await readStoreIndex({ dataDir, address: 'https://store.invalid/index.json', fetch: async () => { throw new Error('offline'); } });
  assert.deepEqual([offline.ok, offline.offline, offline.index.skills.length], [true, true, 2]);
  assert.match(offline.index.skills[0].preview.poster, /^file:.*media\/lyric-pv\.jpg$/, 'relative to where it was read from');
  const none = await readStoreIndex({ dataDir: mkdtempSync(join(tmpdir(), 'of-store-none-')), address: 'https://store.invalid/index.json', fetch: async () => ({ ok: false, status: 404 }) });
  assert.deepEqual([none.ok, none.error], [false, 'The store answered 404.']);
});
