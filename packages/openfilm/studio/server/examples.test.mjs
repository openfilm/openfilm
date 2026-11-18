import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleSeconds, listExamples, listNews, readExamples, readNews } from './examples.mjs';

test('an index\'s examples: each with the address that fetches its folder, its poster from the repository', () => {
  const examples = readExamples({
    repo: 'https://github.com/openfilm/examples',
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
      category: 'music', segments: [{ title: 'S1-Open', from: 0, to: 12 }], owner: 'openfilm',
    },
    { id: 'abs', title: 'Abs', description: '', duration: 12, poster: 'https://example.com/p.png', video: null, url: 'https://github.com/openfilm/examples/tree/main/abs', category: null, segments: [], owner: 'openfilm' },
  ]);
  /* another repository: named by the index, or the one it is read from */
  assert.equal(readExamples({ repo: 'https://github.com/a/b', branch: 'dev', examples: [{ folder: 'x', title: 'X' }] })[0].url, 'https://github.com/a/b/tree/dev/x');
  assert.equal(readExamples({ examples: [{ folder: 'x', title: 'X' }] }, 'https://raw.githubusercontent.com/c/d/trunk/examples.json')[0].url, 'https://github.com/c/d/tree/trunk/x');
  assert.deepEqual(readExamples(null), []);
  assert.deepEqual(readExamples({ examples: 'no' }), []);
});

test('the Community\'s listings: each in its publisher\'s repository, its posters at the commit listed, its folder from main', () => {
  const commit = 'a'.repeat(40);
  const [one, ...rest] = readExamples({
    examples: [
      { name: 'city-walk', owner: 'ana', repo: 'https://github.com/ana/films', path: 'walks/city', commit, title: 'City walk', poster: 'look.jpg', duration: '0:42', category: 'vlog' },
      { name: 'no-commit', owner: 'ana', repo: 'https://github.com/ana/films', path: 'x', commit: 'main', title: 'No' },
      { name: 'elsewhere', owner: 'ana', repo: 'https://gitlab.com/ana/films', path: 'x', commit, title: 'No' },
      { name: 'escape', owner: 'ana', repo: 'https://github.com/ana/films', path: '../x', commit, title: 'No' },
    ],
  }, 'https://index.test/index.json');
  assert.equal(rest.length, 0, 'not well formed: left out');
  assert.deepEqual(one, {
    id: 'city-walk', title: 'City walk', description: '', duration: 42, category: 'vlog', segments: [], owner: 'ana', video: null,
    poster: `https://raw.githubusercontent.com/ana/films/${commit}/walks/city/look.jpg`,
    url: 'https://github.com/ana/films/tree/main/walks/city',
  });
});

test('a listing without a path: the top of its own repository', () => {
  const commit = 'b'.repeat(40);
  const [one] = readExamples({ examples: [{ name: 'dot-lab', repo: 'https://github.com/ana/dot-lab', commit, title: 'Dot Lab', poster: 'look.jpg' }] }, 'https://index.test/index.json');
  assert.equal(one.url, 'https://github.com/ana/dot-lab/tree/main');
  assert.equal(one.poster, `https://raw.githubusercontent.com/ana/dot-lab/${commit}/look.jpg`);
});

test('news: those of today, newest first, English always there; a link is https or a line of the Community', () => {
  const news = readNews({
    news: [
      { id: 'old', title: { en: 'Old' }, from: '2026-10-01', until: '2026-10-31' },
      { id: 'later', title: { en: 'Later' }, from: '2026-12-01' },
      { id: 'a', title: { en: 'A', 'zh-CN': '甲' }, text: { en: 'Line' }, from: '2026-11-01', link: 'openfilm://community/examples', image: 'news/a.jpg' },
      { id: 'b', title: { en: 'B' }, from: '2026-11-10', until: '2026-11-30', link: 'javascript:alert(1)' },
      { id: 'no-english', title: { 'zh-CN': '无' }, from: '2026-11-01' },
    ],
  }, '2026-11-17');
  assert.deepEqual(news.map((n) => n.id), ['b', 'a']);
  assert.equal(news[0].link, null, 'only https or openfilm://community/<line>');
  assert.deepEqual(news[1], {
    id: 'a', title: { en: 'A', 'zh-CN': '甲' }, text: { en: 'Line' }, from: '2026-11-01', until: null, link: 'openfilm://community/examples',
    image: 'https://raw.githubusercontent.com/openfilm/community/main/news/a.jpg',
  });
  assert.deepEqual(readNews(null), []);
});

test('the index read once gives both the examples and the news', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'of-news-')), 'index.json');
  writeFileSync(file, JSON.stringify({ examples: [{ folder: 'one', title: 'One' }], news: [{ id: 'n', title: { en: 'N' }, from: '2026-01-01' }] }));
  assert.equal((await listExamples({ source: file }))[0].id, 'one');
  assert.deepEqual((await listNews({ source: file, today: '2026-11-17' })).map((n) => n.id), ['n']);
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

test('GitHub\'s index with no examples yet (or unreadable): the examples shown so far stay, its news is read', async () => {
  const { EXAMPLES_INDEX } = await import('./examples.mjs');
  const home = mkdtempSync(join(tmpdir(), 'of-examples-empty-'));
  const fetchImpl = /** @type {typeof fetch} */ (async () => new Response(JSON.stringify({ version: 1, skills: [], news: [{ id: 'hi', title: { en: 'Hi' }, from: '2026-01-01' }] })));
  /* a new source string: the module's cache keyed by it does not hold the earlier test's read */
  const examples = await listExamples({ source: EXAMPLES_INDEX, fetchImpl, home });
  assert.ok(examples.length > 0);
  await new Promise((done) => setTimeout(done, 20));
  assert.ok((await listExamples({ source: EXAMPLES_INDEX, fetchImpl, home })).length > 0, 'still there after GitHub answered');
});
