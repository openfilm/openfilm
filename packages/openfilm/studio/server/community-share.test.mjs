import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { communityProfile, mySubmissions, publicProfile, saveCommunityProfile, shareJob, shareable, slugOf, startShare } from './community-share.mjs';
import { personsSay } from './server.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A library with a short video, a picture, a sound and a few things the Community does not take; an account signed in or not. */
function fixture(t, { signedIn = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'of-share-'));
  const vars = ['OPENFILM_HOME', 'OPENFILM_SAVED', 'OPENFILM_API_URL', 'OPENFILM_API_KEY'];
  const before = new Map(vars.map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of before) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    rmSync(dir, { recursive: true, force: true });
  });
  process.env.OPENFILM_HOME = join(dir, 'home');
  process.env.OPENFILM_SAVED = join(dir, 'Saved');
  process.env.OPENFILM_API_URL = 'https://service.test';
  if (signedIn) process.env.OPENFILM_API_KEY = 'ofk_test_key'; else delete process.env.OPENFILM_API_KEY;
  const lib = process.env.OPENFILM_SAVED;
  mkdirSync(join(lib, 'Rain', 'A clip'), { recursive: true });
  const ffmpeg = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args]);
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=2', '-pix_fmt', 'yuv420p', join(lib, 'Rain', 'Rain Window.mp4'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=300x200', '-frames:v', '1', join(lib, 'Rain', '水洼.png'));
  ffmpeg('-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', join(lib, 'Rain', 'drip.wav'));
  ffmpeg('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=25:duration=62', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', join(lib, 'Rain', 'long.mp4'));
  writeFileSync(join(lib, 'Rain', 'notes.txt'), 'not media');
  writeFileSync(join(lib, 'Rain', 'A clip', 'saved.json'), '{}');
  return { lib };
}

/** OpenFilm's service as this module meets it: answers by `METHOD path`, keeping every call and every uploaded body. */
function service(answers) {
  const calls = [];
  const puts = new Map();
  const get = async (url, init = {}) => {
    const at = String(url);
    if (at.startsWith('https://storage.test/')) {
      puts.set(at, { bytes: Buffer.from(await new Response(init.body).arrayBuffer()), headers: init.headers });
      return new Response(null, { status: 200 });
    }
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

test('a name from a file\'s: its Latin letters and digits as a slug, none when it has none', () => {
  assert.equal(slugOf('Rain Window (take 2)'), 'rain-window-take-2');
  assert.equal(slugOf('Café_Été'), 'cafe-ete');
  assert.equal(slugOf('水洼'), '');
  assert.equal(slugOf('a'.repeat(60)).length, 40);
});

test('a library file as it would be shared, or why the Community would not take it', async (t) => {
  const { lib } = fixture(t);
  const video = await shareable(lib, 'saved/Rain/Rain Window.mp4');
  assert.deepEqual({ ...video, bytes: video.bytes > 0 }, { path: 'saved/Rain/Rain Window.mp4', media: 'video', ext: 'mp4', bytes: true, durationMs: 2000, name: 'rain-window', title: 'Rain Window' });
  const picture = await shareable(lib, 'saved/Rain/水洼.png');
  assert.deepEqual([picture.media, picture.durationMs, picture.name, picture.title, picture.problem], ['image', 0, '', '水洼', undefined]);
  assert.deepEqual([(await shareable(lib, 'saved/Rain/drip.wav')).media, (await shareable(lib, 'saved/Rain/drip.wav')).durationMs], ['audio', 1000]);
  assert.equal((await shareable(lib, 'saved/Rain/long.mp4')).problem, 'too-long');
  assert.equal((await shareable(lib, 'saved/Rain/notes.txt')).problem, 'not-media');
  /* a saved clip is a folder with what it loads: not a plain file */
  assert.equal((await shareable(lib, 'saved/Rain/A clip')).problem, 'not-media');
  assert.equal((await shareable(lib, 'saved/Rain/gone.mp4')).problem, 'not-media');
  await assert.rejects(shareable(lib, 'saved/../outside.mp4'));
});

test('the person\'s page in the Community: none when signed out; a name is taken with the account\'s key; a refusal keeps its code', async (t) => {
  fixture(t, { signedIn: false });
  assert.deepEqual(await communityProfile({ fetch: async () => { throw new Error('not asked when signed out'); } }), { signedIn: false, profile: null });
  await assert.rejects(saveCommunityProfile({ name: 'mika' }), (e) => e.status === 409 && e.extra.code === 'sign-in');
  process.env.OPENFILM_API_KEY = 'ofk_test_key';
  const profile = { id: 2, name: 'mika', displayName: 'Mika', bio: '', avatar: null, since: '2026-11-21T12:00:00.000Z' };
  const cloud = service({
    'GET /v1/community/profile': { profile: null, id: 2, suggested: 'mika-films' },
    'PUT /v1/community/profile': (call) => (call.body.name === 'taken' ? Response.json({ error: 'name_taken', message: 'That name is taken. Pick another.' }, { status: 409 }) : { profile }),
  });
  /* the account's UID comes before any name */
  assert.deepEqual(await communityProfile({ fetch: cloud.get }), { signedIn: true, profile: null, id: 2, suggested: 'mika-films' });
  assert.deepEqual(await saveCommunityProfile({ name: 'mika', displayName: 'Mika', more: 'ignored' }, { fetch: cloud.get }), { signedIn: true, profile });
  assert.deepEqual(cloud.calls.at(-1), { what: 'PUT /v1/community/profile', authorization: 'Bearer ofk_test_key', body: { name: 'mika', displayName: 'Mika' } });
  await assert.rejects(saveCommunityProfile({ name: 'taken' }, { fetch: cloud.get }), (e) => e.status === 409 && e.extra.code === 'name_taken' && /taken/.test(e.message));
  /* a key the service no longer knows reads as signed out, not as a broken service */
  await assert.rejects(communityProfile({ fetch: async () => new Response('{}', { status: 401 }) }), (e) => e.status === 409 && e.extra.code === 'sign-in');
  await assert.rejects(communityProfile({ fetch: async () => { throw new Error('offline'); } }), (e) => e.status === 502 && e.extra.code === 'network');
});

test('anyone\'s page is read with no key and kept a while; a name with no account has none', async (t) => {
  fixture(t);
  const cloud = service({ 'GET /v1/community/profiles/noor': { profile: { name: 'noor', displayName: 'Noor', bio: 'Trains.', avatar: null, since: '2026-11-01T00:00:00.000Z' } } });
  assert.equal((await publicProfile('noor', { fetch: cloud.get, now: 1000 }))?.displayName, 'Noor');
  assert.equal((await publicProfile('noor', { fetch: cloud.get, now: 2000 }))?.displayName, 'Noor');
  assert.equal(await publicProfile('riverisbuilding', { fetch: cloud.get, now: 1000 }), null);
  assert.equal(await publicProfile('Not A Name', { fetch: cloud.get }), null);
  assert.deepEqual(cloud.calls.map((c) => [c.what, c.authorization]), [['GET /v1/community/profiles/noor', null], ['GET /v1/community/profiles/riverisbuilding', null]]);
});

test('sharing: each file is checked and hashed here, a video gets a poster, only what the service lacks is uploaded, then it is handed over', async (t) => {
  const { lib } = fixture(t);
  const clip = readFileSync(join(lib, 'Rain', 'Rain Window.mp4'));
  const submission = (state) => ({ id: 'sub-1', state, title: 'Rainy Day', items: [], createdAt: '2026-11-21T12:00:00.000Z', updatedAt: '2026-11-21T12:00:00.000Z' });
  let asked;
  const cloud = service({
    'POST /v1/community/submissions': (call) => {
      asked = call.body;
      /* the service has the picture already: it asks for the video and its poster only */
      const wanted = [asked.items[0].file, asked.items[0].poster];
      return { submission: submission('uploading'), uploads: wanted.map((f) => ({ sha256: f.sha256, url: `https://storage.test/staging/${f.sha256}`, headers: { 'content-length': String(f.bytes) } })) };
    },
    'POST /v1/community/submissions/sub-1/commit': { submission: { ...submission('reviewing'), review: 'https://github.com/openfilm/community/pull/7' } },
  });
  const { job } = await startShare(lib, {
    language: 'zh-CN', agreed: true,
    items: [
      { path: 'saved/Rain/Rain Window.mp4', name: 'rain-window', title: '雨窗', about: 'Rain on a window at night.', tags: ['rain', '雨', 'Night Street'], source: { kind: 'own' } },
      { path: 'saved/Rain/水洼.png', name: 'puddle', title: '水洼', about: 'A puddle with the sky in it.', source: { kind: 'ai', tool: 'A picture model' } },
    ],
    pack: { name: 'rainy-day', title: 'Rainy Day', about: 'Rain, puddles and wet streets.' },
  }, { fetch: cloud.get });
  const ended = await done(job);
  assert.deepEqual([ended.state, ended.error, ended.submission.state, ended.submission.review], ['done', undefined, 'reviewing', 'https://github.com/openfilm/community/pull/7']);
  assert.equal(ended.sent, ended.total);
  /* what the service was told: the words as written, the files by size and SHA-256, nothing of where they are on disk */
  assert.deepEqual(asked.language, 'zh-CN');
  assert.deepEqual(asked.items.map((it) => [it.name, it.media, it.ext, it.durationMs, it.tags, it.keywords, it.source]), [
    ['rain-window', 'video', 'mp4', 2000, ['rain'], ['雨', 'Night Street'], { kind: 'own' }],
    ['puddle', 'image', 'png', 0, [], undefined, { kind: 'ai', tool: 'A picture model' }],
  ]);
  assert.deepEqual(asked.items[0].file, { bytes: clip.length, sha256: sha(clip) });
  assert.ok(!JSON.stringify(asked).includes(lib) && !JSON.stringify(asked).includes('saved/'));
  /* the pack's cover is its video's poster: one file, sent once */
  assert.deepEqual(asked.pack, { name: 'rainy-day', title: 'Rainy Day', about: 'Rain, puddles and wet streets.', cover: asked.items[0].poster });
  assert.deepEqual([...cloud.puts.keys()].sort(), [`https://storage.test/staging/${asked.items[0].file.sha256}`, `https://storage.test/staging/${asked.items[0].poster.sha256}`].sort());
  const sentClip = cloud.puts.get(`https://storage.test/staging/${sha(clip)}`);
  assert.ok(sentClip.bytes.equals(clip));
  const poster = cloud.puts.get(`https://storage.test/staging/${asked.items[0].poster.sha256}`).bytes;
  assert.deepEqual([poster[0], poster[1], sha(poster), poster.length], [0xff, 0xd8, asked.items[0].poster.sha256, asked.items[0].poster.bytes]);
  /* the account's key goes to the service, never to an upload's address */
  assert.ok(cloud.calls.every((c) => c.authorization === 'Bearer ofk_test_key'));
  assert.ok([...cloud.puts.values()].every((p) => !p.headers.authorization));
});

test('a share is refused before anything is read when it is not well formed or no one is signed in; a file the Community would not take fails it', async (t) => {
  const { lib } = fixture(t);
  const never = { fetch: async () => { throw new Error('the service is not asked'); } };
  const item = { path: 'saved/Rain/Rain Window.mp4', name: 'rain-window', title: 'Rain', about: 'Rain on a window at night.', source: { kind: 'own' } };
  const bad = [
    { language: 'zh-CN', items: [item] },
    { language: 'xx', agreed: true, items: [item] },
    { language: 'en', agreed: true, items: [] },
    { language: 'en', agreed: true, items: [{ ...item, name: 'Rain Window' }] },
    { language: 'en', agreed: true, items: [item, item] },
    { language: 'en', agreed: true, items: [{ ...item, about: 'Rain.' }] },
    { language: 'en', agreed: true, items: [{ ...item, source: { kind: 'ai' } }] },
    { language: 'en', agreed: true, items: [{ ...item, path: '/etc/passwd' }] },
    { language: 'en', agreed: true, items: [item], pack: { name: 'p', title: 'Pack' } },
  ];
  for (const body of bad) await assert.rejects(startShare(lib, body, never), (e) => e.status === 400 && e.extra.code === 'invalid', JSON.stringify(body));
  const long = await startShare(lib, { language: 'en', agreed: true, items: [{ ...item, path: 'saved/Rain/long.mp4' }] }, never);
  assert.deepEqual(await done(long.job).then((j) => [j.state, j.code, j.item]), ['failed', 'too-long', 'saved/Rain/long.mp4']);
  /* the service's own refusal reaches the person with its code */
  const refused = await startShare(lib, { language: 'en', agreed: true, items: [item] }, { fetch: service({ 'POST /v1/community/submissions': Response.json({ error: 'profile_required', message: 'Pick your name in the Community first.' }, { status: 409 }) }).get });
  assert.deepEqual(await done(refused.job).then((j) => [j.state, j.code, j.error]), ['failed', 'profile_required', 'Pick your name in the Community first.']);
  delete process.env.OPENFILM_API_KEY;
  await assert.rejects(startShare(lib, { language: 'en', agreed: true, items: [item] }, never), (e) => e.status === 409 && e.extra.code === 'sign-in');
  assert.equal(shareJob('no-such-job'), null);
});

test('what the person shared is read with their key; signed out, there is none', async (t) => {
  fixture(t);
  const rows = [{ id: 'sub-1', state: 'declined', title: 'Rain', items: [], note: 'Please crop the sign.', createdAt: 'x', updatedAt: 'x' }];
  assert.deepEqual(await mySubmissions({ fetch: service({ 'GET /v1/community/submissions': { submissions: rows } }).get }), { signedIn: true, submissions: rows });
  delete process.env.OPENFILM_API_KEY;
  assert.deepEqual(await mySubmissions({ fetch: async () => { throw new Error('not asked'); } }), { signedIn: false, submissions: [] });
});

test('publishing under the person\'s name is the person\'s to say: an agent reads, and neither takes a name nor shares', () => {
  assert.equal(personsSay(['community', 'profile'], 'PUT'), true);
  assert.equal(personsSay(['community', 'share'], 'POST'), true);
  assert.equal(personsSay(['community', 'share', 'check'], 'POST'), true);
  assert.equal(personsSay(['community', 'profile'], 'GET'), false);
  assert.equal(personsSay(['community', 'submissions'], 'GET'), false);
  assert.equal(personsSay(['community', 'stats'], 'GET'), false);
});
