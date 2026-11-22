import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { filmHtml } from '../../src/film-doc.mjs';
import { filmParts, filmShareable, shareJob, startFilmShare, withdrawSubmission } from './community-share.mjs';
import { readExamples } from './examples.mjs';
import { fetchHostedFilm, hostedAddress, manifestOf, parseHosted } from './fetch-hosted.mjs';
import { personsSay } from './server.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

/** A project: a film of a clip and a picture, two boards, media nothing uses, and what Studio keeps of its own. */
function project(t, { signedIn = true, more = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'of-film-share-'));
  const vars = ['OPENFILM_HOME', 'OPENFILM_API_URL', 'OPENFILM_API_KEY'];
  const before = new Map(vars.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.OPENFILM_HOME = join(dir, 'home');
  process.env.OPENFILM_API_URL = 'https://service.test';
  if (signedIn) process.env.OPENFILM_API_KEY = 'ofk_test_key'; else delete process.env.OPENFILM_API_KEY;
  const root = join(dir, 'Rain Night');
  const files = {
    'film.html': filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [{ id: 'c0', src: 'assets/clip.mp4', at: 0 }, { id: 'c1', src: 'assets/still.png', at: 2, time: [0, 1] }] }] }),
    'assets/clip.mp4': 'a clip, as far as this test goes',
    'assets/still.png': 'a picture',
    'assets/board only.png': 'a picture only a board shows',
    'assets/gen-1.png': 'made on the board, first',
    'assets/gen-2.png': 'made on the board, then',
    'assets/unused.mov': 'footage nothing uses',
    'assets/empty.txt': '',
    '.film/subtitles.json': '{"style":"plain"}',
    '.film/settings.json': '{"fps":25}',
    '.film/canvas.json': JSON.stringify({ nodes: [
      { id: 'n1', x: 0, y: 0, path: 'assets/clip.mp4' },
      { id: 'n2', x: 0, y: 0, path: 'assets/board only.png' },
      { id: 'n3', x: 0, y: 0, make: 'image', prompt: 'rain on glass', versions: ['assets/gen-1.png', 'assets/gen-2.png'], path: 'assets/gen-2.png' },
      { id: 'n4', x: 0, y: 0, text: 'a note', versions: ['an earlier note'] },
    ], edges: [] }),
    '.film/canvases/b2.json': '{"nodes":[],"edges":[]}',
    '.film/history/1.json': '{"never":"shared"}',
    '.film/chat/a.json': '{"never":"shared"}',
    '.film/logs/x.log': 'never shared',
    '.film/cache/y.bin': 'never shared',
    '.film/id': 'abc',
    ...more,
  };
  for (const [path, body] of Object.entries(files)) {
    /* `more` leaves a file out by naming it with nothing in it */
    if (body === undefined) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  return { root, files };
}

/** OpenFilm's service as sharing meets it: answers by `METHOD path`, keeping every call and every uploaded body. */
function service(answers) {
  const calls = [];
  const puts = new Map();
  const get = async (url, init = {}) => {
    const at = String(url);
    if (at.startsWith('https://storage.test/')) { puts.set(at.split('/').pop(), Buffer.from(await new Response(init.body).arrayBuffer())); return new Response(null, { status: 200 }); }
    const what = `${init.method ?? 'GET'} ${at.replace('https://service.test', '')}`;
    calls.push({ what, authorization: init.headers?.authorization ?? null, body: init.body ? JSON.parse(init.body) : undefined });
    const answer = typeof answers[what] === 'function' ? answers[what](calls.at(-1)) : answers[what];
    if (!answer) return Response.json({ error: 'invalid_request', message: 'not here' }, { status: 404 });
    return answer instanceof Response ? answer : Response.json(answer);
  };
  return { calls, puts, get };
}

const done = async (id) => {
  for (let i = 0; i < 400; i += 1) {
    const job = shareJob(id);
    if (job?.state === 'done' || job?.state === 'failed') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the share never ended');
};
const submission = (state) => ({ id: 'sub-9', state, title: '雨夜', items: [], film: { id: 'films/mika/rain-night', title: '雨夜', version: 1 }, createdAt: 'x', updatedAt: 'x' });
const sharing = (seen = {}) => service({
  'POST /v1/community/films': (call) => {
    seen.asked = call.body;
    const all = [seen.asked.poster, ...seen.asked.files];
    return { submission: submission('uploading'), uploads: [...new Map(all.map((f) => [f.sha256, f])).values()].map((f) => ({ sha256: f.sha256, url: `https://storage.test/${f.sha256}`, headers: { 'content-length': String(f.bytes) } })) };
  },
  'POST /v1/community/submissions/sub-9/commit': { submission: { ...submission('reviewing'), review: 'https://github.com/openfilm/community/pull/9' } },
});
const request = (more = {}) => ({ language: 'zh-CN', agreed: true, name: 'rain-night', title: '雨夜', about: 'Rain on a window, then the street outside.', category: 'music-video', parts: ['edit'], ...more });
const how = (more = {}) => ({ poster: async () => ({ bytes: JPEG }), duration: async () => 42_340, ...more });

test('a project\'s files by the part of a film each is: what it plays, what only its boards show, the rest; never what Studio keeps of its own', async (t) => {
  const { root } = project(t);
  const parts = await filmParts(root);
  assert.deepEqual(parts.edit.map((f) => f.name), ['.film/settings.json', '.film/subtitles.json', 'assets/clip.mp4', 'assets/still.png', 'film.html']);
  /* the clip is on a board too, and is the edit's; a note's earlier words are not files */
  assert.deepEqual(parts.canvas.map((f) => f.name), ['.film/canvas.json', '.film/canvases/b2.json', 'assets/board only.png', 'assets/gen-1.png', 'assets/gen-2.png']);
  assert.deepEqual(parts.media.map((f) => f.name), ['assets/unused.mov']);
  assert.deepEqual(parts.left, [{ path: 'assets/empty.txt', why: 'empty' }]);
  const every = [...parts.edit, ...parts.canvas, ...parts.media].map((f) => f.name);
  assert.ok(!every.some((name) => /history|chat|logs|cache|\.film\/id/.test(name)));
  const shown = await filmShareable(root);
  assert.deepEqual([shown.parts.edit.files, shown.parts.canvas?.files, shown.parts.media?.files, shown.problem], [5, 5, 1, undefined]);
  assert.equal(shown.parts.edit.bytes, parts.edit.reduce((n, f) => n + f.size, 0));
});

test('what stands in the way of sharing a film: none to share, or a key left in a file of it', async (t) => {
  const empty = project(t, { more: { 'film.html': filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [] }] }) } });
  assert.equal((await filmShareable(empty.root)).problem, 'no-film');
  const leaky = project(t, { more: { 'assets/still.png': 'a picture', 'film.html': filmHtml({ stage: { w: 640, h: 360 }, tracks: [{ clips: [{ id: 'c0', src: 'scenes/title.html', at: 0, time: [0, 2] }] }] }), 'scenes/title.html': '<script>const key = "sk-abcdefghijklmnopqrstuvwxyz012345";</script>' } });
  const said = await filmShareable(leaky.root);
  assert.deepEqual([said.problem, said.file], ['secret', 'scenes/title.html']);
  /* and sharing it is refused the same way, whatever the page asked */
  const cloud = sharing();
  const refused = await done((await startFilmShare(leaky.root, request(), { ...how(), fetch: cloud.get })).job);
  assert.deepEqual([refused.state, refused.code, refused.item], ['failed', 'secret', 'scenes/title.html']);
  assert.deepEqual(cloud.calls, []);
});

test('sharing a film: only the parts chosen go, each file by its path, size and SHA-256, with the poster; then it is handed over', async (t) => {
  const { root, files } = project(t);
  const seen = {};
  const cloud = sharing(seen);
  const ended = await done((await startFilmShare(root, request(), { ...how(), fetch: cloud.get })).job);
  assert.deepEqual([ended.state, ended.error, ended.submission.state, ended.submission.review], ['done', undefined, 'reviewing', 'https://github.com/openfilm/community/pull/9']);
  assert.deepEqual(seen.asked.files.map((f) => f.path), ['.film/settings.json', '.film/subtitles.json', 'assets/clip.mp4', 'assets/still.png', 'film.html']);
  assert.deepEqual(seen.asked.files.find((f) => f.path === 'assets/clip.mp4'), { path: 'assets/clip.mp4', bytes: files['assets/clip.mp4'].length, sha256: sha(files['assets/clip.mp4']) });
  assert.deepEqual({ ...seen.asked, files: undefined }, {
    language: 'zh-CN', name: 'rain-night', title: '雨夜', about: 'Rain on a window, then the street outside.', category: 'music-video', parts: ['edit'], agreed: true,
    durationMs: 42_340, poster: { bytes: JPEG.length, sha256: sha(JPEG) }, files: undefined,
  });
  /* nothing of where it is on this computer, and nothing Studio keeps of its own beside the film */
  assert.ok(!JSON.stringify(seen.asked).includes(root));
  assert.equal(cloud.puts.size, 6);
  assert.ok(cloud.puts.get(sha(files['assets/clip.mp4'])).equals(Buffer.from(files['assets/clip.mp4'])));
  assert.ok(cloud.puts.get(sha(JPEG)).equals(JPEG));
  assert.ok(cloud.calls.every((c) => c.authorization === 'Bearer ofk_test_key'));
});

test('with its canvas and the rest of its media, a film says so and holds them; a part with nothing in it is not said', async (t) => {
  const { root } = project(t);
  const seen = {};
  await done((await startFilmShare(root, request({ parts: ['media', 'canvas', 'edit'] }), { ...how(), fetch: sharing(seen).get })).job);
  assert.deepEqual(seen.asked.parts, ['edit', 'canvas', 'media']);
  assert.deepEqual(seen.asked.files.map((f) => f.path).filter((p) => !['.film/settings.json', '.film/subtitles.json', 'assets/clip.mp4', 'assets/still.png', 'film.html'].includes(p)),
    ['.film/canvas.json', '.film/canvases/b2.json', 'assets/board only.png', 'assets/gen-1.png', 'assets/gen-2.png', 'assets/unused.mov']);
  const bare = project(t, { more: { '.film/canvas.json': undefined, '.film/canvases/b2.json': undefined } });
  const plain = {};
  await done((await startFilmShare(bare.root, request({ parts: ['edit', 'canvas'] }), { ...how(), fetch: sharing(plain).get })).job);
  assert.deepEqual(plain.asked.parts, ['edit']);
});

test('a film is not shared without a sign-in, a well formed request, a poster and a length; the service\'s refusal keeps its code', async (t) => {
  const { root } = project(t);
  const never = { ...how(), fetch: async () => { throw new Error('the service is not asked'); } };
  for (const body of [request({ agreed: false }), request({ name: 'Rain Night' }), request({ about: 'Rain.' }), request({ parts: ['canvas'] }), request({ parts: ['edit', 'chat'] }), request({ language: 'xx' }), request({ title: '' })]) {
    await assert.rejects(startFilmShare(root, body, never), (e) => e.status === 400 && e.extra.code === 'invalid', JSON.stringify(body));
  }
  const cloud = sharing();
  assert.deepEqual(await done((await startFilmShare(root, request(), { ...how({ poster: async () => null }), fetch: cloud.get })).job).then((j) => [j.state, j.code]), ['failed', 'poster']);
  assert.deepEqual(await done((await startFilmShare(root, request(), { ...how({ duration: async () => null }), fetch: cloud.get })).job).then((j) => [j.state, j.code]), ['failed', 'no-film']);
  assert.deepEqual(cloud.calls, []);
  const refusing = service({ 'POST /v1/community/films': Response.json({ error: 'in_progress', message: 'films/mika/rain-night is in review already.' }, { status: 409 }) });
  assert.deepEqual(await done((await startFilmShare(root, request(), { ...how(), fetch: refusing.get })).job).then((j) => [j.state, j.code]), ['failed', 'in_progress']);
  delete process.env.OPENFILM_API_KEY;
  await assert.rejects(startFilmShare(root, request(), never), (e) => e.status === 409 && e.extra.code === 'sign-in');
});

test('taking a submission back asks the service with the account\'s key; sharing a project and taking back are the person\'s to say', async (t) => {
  project(t);
  const cloud = service({ 'POST /v1/community/submissions/sub-9/withdraw': { submission: submission('withdrawn') } });
  assert.equal((await withdrawSubmission('sub-9', { fetch: cloud.get })).submission.state, 'withdrawn');
  assert.deepEqual(cloud.calls.map((c) => [c.what, c.authorization]), [['POST /v1/community/submissions/sub-9/withdraw', 'Bearer ofk_test_key']]);
  await assert.rejects(withdrawSubmission('../x', { fetch: cloud.get }), (e) => e.status === 400);
  assert.equal(personsSay(['projects', 'p1', 'community', 'share'], 'POST'), true);
  assert.equal(personsSay(['community', 'submissions', 'sub-9', 'withdraw'], 'POST'), true);
  assert.equal(personsSay(['projects', 'p1', 'community'], 'GET'), false);
});

/* ── a film someone else shared, fetched from OpenFilm's service ─────────── */

const FILM = { 'film.html': Buffer.from('<film></film>'), 'assets/雨 窗.mp4': Buffer.from('a clip'), '.film/canvas.json': Buffer.from('{"nodes":[]}') };
const listed = (files = FILM) => Object.entries(files).map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes), url: `https://storage.test/${encodeURIComponent(path)}` }));
/** the service and its storage: the film's list, then each file's bytes */
const hosting = (answer, bytes = FILM) => async (url) => {
  const at = String(url);
  if (at === 'https://service.test/v1/community/films/mika/rain-night') return answer instanceof Response ? answer : Response.json({ film: answer });
  const path = decodeURIComponent(at.replace('https://storage.test/', ''));
  return bytes[path] ? new Response(bytes[path]) : new Response(null, { status: 404 });
};
const library = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'of-film-fetch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = process.env.OPENFILM_API_URL;
  process.env.OPENFILM_API_URL = 'https://service.test';
  t.after(() => { if (before === undefined) delete process.env.OPENFILM_API_URL; else process.env.OPENFILM_API_URL = before; });
  return dir;
};

test('a listed film\'s address is OpenFilm\'s service\'s own, with the digest its files must have', (t) => {
  library(t);
  const digest = 'a'.repeat(64);
  assert.equal(hostedAddress('mika', 'rain-night', digest), `https://service.test/v1/community/films/mika/rain-night#${digest}`);
  assert.deepEqual(parseHosted(hostedAddress('mika', 'rain-night', digest)), { owner: 'mika', name: 'rain-night', manifest: digest });
  assert.deepEqual(parseHosted('https://service.test/v1/community/films/mika/rain-night'), { owner: 'mika', name: 'rain-night', manifest: null });
  for (const not of ['https://elsewhere.test/v1/community/films/mika/rain-night', 'https://service.test/v1/community/films/mika', 'https://service.test/v1/community/films/Mika/rain-night',
    'https://service.test/v1/community/films/mika/rain-night/poster', 'https://github.com/openfilm/examples', 42]) assert.equal(parseHosted(not), null, String(not));
});

test('a listed film is fetched into a folder named after it, every file checked against what the Community lists', async (t) => {
  const lib = library(t);
  const files = listed();
  const seen = [];
  const folder = await fetchHostedFilm({ owner: 'mika', name: 'rain-night', manifest: manifestOf(files) }, { library: lib, fetch: hosting({ title: '雨夜', files }), onProgress: (p) => seen.push(p.phase) });
  assert.equal(folder, join(lib, '雨夜'));
  for (const [path, bytes] of Object.entries(FILM)) assert.ok(readFileSync(join(folder, ...path.split('/'))).equals(bytes), path);
  assert.deepEqual([seen[0], seen.at(-1)], ['lookup', 'download']);
  /* a second one lands beside the first, never over it */
  assert.equal(await fetchHostedFilm({ owner: 'mika', name: 'rain-night', manifest: null }, { library: lib, fetch: hosting({ title: '雨夜', files }) }), join(lib, '雨夜 2'));
});

test('a film that is not the one listed, or not whole, is not kept: nothing is left behind', async (t) => {
  const lib = library(t);
  const files = listed();
  const film = { owner: 'mika', name: 'rain-night', manifest: manifestOf(files) };
  const failing = async (answer, bytes, why) => {
    await assert.rejects(fetchHostedFilm(film, { library: lib, fetch: hosting(answer, bytes) }), why);
    assert.deepEqual(readdirSync(lib), []);
  };
  /* the service lists other files than the Community reviewed */
  await failing({ title: 'x', files: [...files, { path: 'extra.js', bytes: 3, sha256: sha(Buffer.from('abc')), url: 'https://storage.test/extra.js' }] }, FILM, /not the one the Community lists/);
  /* a file's bytes are not the ones listed: longer, or other */
  await failing({ title: 'x', files }, { ...FILM, 'film.html': Buffer.from('<film>changed and longer</film>') }, /not what the Community lists/);
  await failing({ title: 'x', files }, { ...FILM, 'film.html': Buffer.from('<film>x</film>') }, /not what the Community lists/);
  /* paths that leave the folder, or name what is Studio's own */
  const escaping = (path) => [...files.slice(0, 2), { ...files[2], path }];
  for (const path of ['../outside.txt', '.film/history/1.json', '.git/config', 'a/../../b']) {
    await assert.rejects(fetchHostedFilm({ ...film, manifest: null }, { library: lib, fetch: hosting({ title: 'x', files: escaping(path) }) }), /not a film/, path);
  }
  await failing({ title: 'x', files: files.slice(1) }, FILM, (e) => e.code === 'no-film');
  await failing(new Response(null, { status: 404 }), FILM, (e) => e.code === 'access' && /no longer in the Community/.test(e.message));
  await failing({ title: 'x', files }, {}, (e) => e.code === 'network');
  await assert.rejects(fetchHostedFilm(film, { library: lib, maxBytes: 5, fetch: hosting({ title: 'x', files }) }), (e) => e.code === 'too-big');
  assert.ok(!existsSync(join(lib, '..', 'outside.txt')));
});

test('the examples index: a film shared from OpenFilm is one of the examples, under its account, fetched from OpenFilm\'s service', (t) => {
  library(t);
  const digest = 'b'.repeat(64);
  const github = { name: 'one-prompt', owner: 'openfilm', repo: 'https://github.com/openfilm/examples', path: 'one-prompt', commit: 'a'.repeat(40), title: 'One Prompt', poster: 'look.jpg', duration: '1:31' };
  const shared = { name: 'rain-night', owner: 'mika', via: 'openfilm', version: 2, title: '雨夜', description: 'Rain.', poster: { size: 9, sha256: 'c'.repeat(64) }, duration: 42.3, category: 'music-video', license: 'CC-BY-4.0', hosted: { parts: ['edit'], files: 3, bytes: 99, manifest: digest } };
  const examples = readExamples({ version: 1, examples: [github, shared, { ...shared, owner: 'Mika' }, { ...shared, name: 'no-digest', hosted: {} }, { ...shared, name: 'other', owner: 'noor' }] }, 'https://raw.githubusercontent.com/openfilm/community/main/index.json');
  assert.deepEqual(examples.map((e) => e.id), ['one-prompt', 'mika.rain-night', 'noor.other']);
  assert.deepEqual(examples[1], {
    id: 'mika.rain-night', title: '雨夜', description: 'Rain.', poster: 'https://service.test/v1/community/films/mika/rain-night/poster', video: null, duration: 42.3,
    url: `https://service.test/v1/community/films/mika/rain-night#${digest}`, category: 'music-video', segments: [], owner: 'mika', shared: true,
  });
  /* the address it is fetched at is one a fetch takes as a listed film's */
  assert.deepEqual(parseHosted(examples[1].url), { owner: 'mika', name: 'rain-night', manifest: digest });
  assert.equal(examples[0].shared, undefined);
});
