import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleSeconds, listExamples, readExamples } from './examples.mjs';

test('an index\'s examples: each with the address that fetches its folder, its poster from the repository', () => {
  const examples = readExamples({
    examples: [
      { folder: 'one-prompt', title: 'One Prompt', description: 'Every frame is code.', poster: 'one-prompt/look.png', duration: '1:29',
        video: 'one-prompt/preview.mp4', category: 'music', segments: [{ title: 'S1-Open', from: 0, to: '0:12' }, { title: 'bad', from: 5, to: 2 }, { from: 1, to: 2 }] },
      { folder: '../escape', title: 'No' },
      { folder: 'untitled' },
      { folder: 'abs', title: 'Abs', poster: 'https://example.com/p.png', duration: 12 },
    ],
  });
  assert.deepEqual(examples, [
    {
      id: 'one-prompt', title: 'One Prompt', description: 'Every frame is code.', duration: 89,
      poster: 'https://raw.githubusercontent.com/openfilm/examples/main/one-prompt/look.png',
      video: 'https://raw.githubusercontent.com/openfilm/examples/main/one-prompt/preview.mp4',
      url: 'https://github.com/openfilm/examples/tree/main/one-prompt',
      category: 'music', segments: [{ title: 'S1-Open', from: 0, to: 12 }],
    },
    { id: 'abs', title: 'Abs', description: '', duration: 12, poster: 'https://example.com/p.png', video: null, url: 'https://github.com/openfilm/examples/tree/main/abs', category: null, segments: [] },
  ]);
  /* another repository: named by the index, or the one it is read from */
  assert.equal(readExamples({ repo: 'https://github.com/a/b', branch: 'dev', examples: [{ folder: 'x', title: 'X' }] })[0].url, 'https://github.com/a/b/tree/dev/x');
  assert.equal(readExamples({ examples: [{ folder: 'x', title: 'X' }] }, 'https://raw.githubusercontent.com/c/d/trunk/examples.json')[0].url, 'https://github.com/c/d/tree/trunk/x');
  assert.deepEqual(readExamples(null), []);
  assert.deepEqual(readExamples({ examples: 'no' }), []);
});

test('a duration is seconds or m:ss', () => {
  assert.equal(exampleSeconds('1:29'), 89);
  assert.equal(exampleSeconds('1:02:03'), 3723);
  assert.equal(exampleSeconds(42), 42);
  assert.equal(exampleSeconds('soon'), null);
  assert.equal(exampleSeconds(-1), null);
});

test('the index from a file on this computer, or from an address; one that cannot be read is no examples', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'of-examples-')), 'examples.json');
  writeFileSync(file, JSON.stringify({ examples: [{ folder: 'one-prompt', title: 'One Prompt' }] }));
  assert.equal((await listExamples({ source: file }))[0].id, 'one-prompt');
  assert.deepEqual(await listExamples({ source: `${file}.missing` }), []);
  const offline = /** @type {typeof fetch} */ (async () => { throw new Error('offline'); });
  assert.deepEqual(await listExamples({ source: 'https://example.test/a.json', fetchImpl: offline }), []);
  const notFound = /** @type {typeof fetch} */ (async () => new Response('', { status: 404 }));
  assert.deepEqual(await listExamples({ source: 'https://example.test/b.json', fetchImpl: notFound }), []);
});

test('an example\'s folder: beside a local index, or fetched into the cache and kept a day', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { exampleFolder } = await import('./examples.mjs');
  const root = mkdtempSync(join(tmpdir(), 'of-example-'));
  mkdirSync(join(root, 'intro'));
  writeFileSync(join(root, 'intro', 'film.html'), '<!doctype html>');
  writeFileSync(join(root, 'examples.json'), JSON.stringify({ examples: [{ folder: 'intro', title: 'Intro' }] }));
  const fetchFolder = async () => { throw new Error('not fetched'); };
  assert.equal(await exampleFolder('intro', { home: root, source: join(root, 'examples.json'), fetchFolder }), join(root, 'intro'));
  await assert.rejects(exampleFolder('../intro', { home: root, source: join(root, 'examples.json'), fetchFolder }), /no such example/);
  /* from a repository: fetched once, then the copy kept */
  let fetched = 0;
  const index = 'https://index.test/examples.json';
  const fetchImpl = async () => ({ ok: true, json: async () => ({ repo: 'https://github.com/a/b', examples: [{ folder: 'intro', title: 'Intro' }] }) });
  await listExamples({ source: index, fetchImpl });
  const fromRepo = async (url, into) => { fetched++; assert.equal(url, 'https://github.com/a/b/tree/main/intro'); const d = join(into, 'intro'); mkdirSync(d); writeFileSync(join(d, 'film.html'), 'x'); return d; };
  const home = join(root, 'home');
  const dir = await exampleFolder('intro', { home, source: index, fetchFolder: fromRepo });
  assert.equal(dir, join(home, 'cache', 'examples', 'intro'));
  assert.ok(existsSync(join(dir, 'film.html')));
  await exampleFolder('intro', { home, source: index, fetchFolder: fromRepo });
  assert.equal(fetched, 1, 'kept');
  await exampleFolder('intro', { home, source: index, fetchFolder: fromRepo, now: () => Date.now() + 2 * 24 * 3600 * 1000 });
  assert.equal(fetched, 2, 'a day on: fetched again');
});

test('GitHub\'s index shows at once: the copy OpenFilm came with, then the last one read, while GitHub is asked', async () => {
  const { EXAMPLES_INDEX, listExamples } = await import('./examples.mjs');
  const home = mkdtempSync(join(tmpdir(), 'of-examples-home-'));
  let answer;
  const slow = () => new Promise((done) => { answer = done; });
  /* GitHub does not answer yet: the copy that came with OpenFilm, its posters served from it */
  const first = await listExamples({ source: EXAMPLES_INDEX, fetchImpl: slow, home });
  assert.ok(first.length > 0, 'examples at once');
  assert.ok(first.every((e) => e.poster?.startsWith('/api/examples/file/')), 'posters from the copy');
  /* GitHub answers with a newer index: kept, and in Studio's home for the next start */
  const newer = { repo: 'https://github.com/openfilm/examples', branch: 'main', examples: [{ folder: 'fresh-one', title: 'Fresh one', poster: 'fresh-one/look.jpg' }] };
  answer({ ok: true, json: async () => newer });
  await new Promise((done) => setTimeout(done, 20));
  const second = await listExamples({ source: EXAMPLES_INDEX, fetchImpl: slow, home });
  assert.deepEqual(second.map((e) => e.id), ['fresh-one']);
  assert.equal(second[0].poster, 'https://raw.githubusercontent.com/openfilm/examples/main/fresh-one/look.jpg', 'a poster the copy does not have comes from GitHub');
  assert.ok(existsSync(join(home, 'cache', 'examples-index.json')));
});
