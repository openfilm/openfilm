import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callService, shownService, targetOf, withService } from './custom-services.mjs';

/* a service of the person's own, on this computer: it says what it was sent */
let base = '';
const seen = [];
const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.url === '/v1/speak') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.from('RIFF....WAVEfmt ')); return; }
    if (req.url === '/v1/broken') { res.writeHead(401, { 'content-type': 'application/json' }); res.end(`{"error":"bad key ${req.headers.authorization}"}`); return; }
    if (req.url === '/v1/plain') { res.writeHead(200); res.end('{"words":[]}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url, words: [{ word: 'hi', start: 0.1, end: 0.4 }] }));
  });
});
before(() => new Promise((done) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; done(); })));
after(() => server.close());

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'of-call-'));
  writeFileSync(join(root, 'film.html'), '<!doctype html>');
  mkdirSync(join(root, 'assets/voice'), { recursive: true });
  writeFileSync(join(root, 'assets/voice/1.wav'), 'RIFF-voice');
  return root;
};
const signal = new AbortController().signal;

test('a service is added with a name the command line calls it by; its key is never shown', () => {
  const [s] = withService([], null, { name: 'My Whisper', url: `${base}/v1/`, key: 'sk-local-1234', note: 'Transcribes, OpenAI style' });
  assert.equal(s.id, 'my-whisper');
  assert.equal(s.url, `${base}/v1`);
  assert.equal(s.auth, 'Authorization: Bearer {key}');
  assert.deepEqual(shownService(s), { id: 'my-whisper', name: 'My Whisper', url: `${base}/v1`, auth: 'Authorization: Bearer {key}', note: 'Transcribes, OpenAI style', last4: '1234' });
  /* changed without a key: the key stays; with '' it goes */
  assert.equal(withService([s], 'my-whisper', { name: 'My Whisper', url: base })[0].key, 'sk-local-1234');
  assert.equal(withService([s], 'my-whisper', { name: 'My Whisper', url: base, key: '' })[0].key, undefined);
  /* a second one by another name gets its own id; the same name is refused */
  assert.equal(withService([s], null, { name: 'my whisper!', url: base }).length, 2);
  assert.throws(() => withService([s], null, { name: 'MY WHISPER', url: base }), /already/);
  for (const url of ['ftp://x', 'localhost:8000', 'http://user:pw@host', 'http://host/?a=1']) assert.throws(() => withService([], null, { name: 'x', url }), url);
  assert.throws(() => withService([], null, { name: 'x', url: base, auth: 'Authorization: Bearer' }), /\{key\}/);
});

test('a request stays under the service\'s address', () => {
  assert.equal(targetOf('http://h:1/v1', '/audio/x?y=1').href, 'http://h:1/v1/audio/x?y=1');
  for (const path of ['//evil.com/x', 'http://evil.com/', '/../admin', '/a/../../b', 'audio', '/a\\b']) assert.throws(() => targetOf('http://h:1/v1', path), path);
});

test('JSON comes back as it is; the key goes in its header and never in what the agent reads', async () => {
  const root = project();
  const [s] = withService([], null, { name: 'whisper', url: `${base}/v1`, key: 'sk-local-1234' });
  const said = await callService(root, s, { path: '/audio/transcriptions', form: ['model=whisper-1', 'timestamp_granularities[]=word'], file: ['file=assets/voice/1.wav'] }, signal);
  assert.match(said, /^whisper answered 200 \(application\/json\):\n\{"path":"\/v1\/audio\/transcriptions"/);
  const got = seen.at(-1);
  assert.equal(got.method, 'POST');
  assert.equal(got.headers.authorization, 'Bearer sk-local-1234');
  assert.match(got.body.toString(), /name="file"; filename="1.wav"[\s\S]*RIFF-voice/);
  assert.match(got.body.toString(), /name="timestamp_granularities\[\]"\r\n\r\nword/);
  /* a refusal says why, with the key blanked out */
  await assert.rejects(callService(root, s, { path: '/broken' }, signal), (e) => /answered 401/.test(e.message) && !e.message.includes('sk-local-1234') && e.message.includes('••••'));
});

test('a file comes back into assets/<service>/; text without a type is read as text', async () => {
  const root = project();
  const [s] = withService([], null, { name: 'Della', url: base, auth: 'x-api-key: {key}', key: 'della-key' });
  const said = await callService(root, s, { path: '/v1/speak', json: '{"text":"Hello"}', out: 'line-1' }, signal);
  assert.match(said, /saved as assets\/della\/line-1\.wav/);
  assert.equal(readFileSync(join(root, 'assets/della/line-1.wav'), 'utf8'), 'RIFF....WAVEfmt ');
  assert.equal(seen.at(-1).headers['x-api-key'], 'della-key');
  assert.equal(seen.at(-1).headers['content-type'], 'application/json');
  assert.match(await callService(root, s, { path: '/v1/plain' }, signal), /answered 200:\n\{"words":\[\]\}/);
});

test('a voice saved over the last take takes the last take\'s subtitles to the trash', async () => {
  process.env.OPENFILM_TRASH_DIR ??= mkdtempSync(join(tmpdir(), 'of-trash-'));
  const root = project();
  const [s] = withService([], null, { name: 'Della', url: base });
  mkdirSync(join(root, 'assets/della'), { recursive: true });
  writeFileSync(join(root, 'assets/della/line-1.vtt'), 'WEBVTT\n\n00:00.000 --> 00:05.000\nThe last take\n');
  writeFileSync(join(root, 'assets/della/line-1.fr.vtt'), 'WEBVTT\n\n00:00.000 --> 00:05.000\nLa dernière\n');
  writeFileSync(join(root, 'assets/della/line-10.vtt'), 'WEBVTT\n');
  await callService(root, s, { path: '/v1/speak', json: '{}', out: 'line-1' }, signal);
  assert.equal(existsSync(join(root, 'assets/della/line-1.vtt')), false);
  assert.equal(existsSync(join(root, 'assets/della/line-1.fr.vtt')), false);
  assert.equal(existsSync(join(root, 'assets/della/line-10.vtt')), true, 'another file\'s stays');
});

test('only the project\'s files are sent, and one body at a time', async () => {
  const root = project();
  const [s] = withService([], null, { name: 'x', url: base });
  await assert.rejects(callService(root, s, { path: '/', file: ['file=../etc/passwd'] }, signal), (e) => e.status === 400);
  await assert.rejects(callService(root, s, { path: '/', file: ['file=assets/none.wav'] }, signal), /not in the project/);
  await assert.rejects(callService(root, s, { path: '/', json: '{}', form: ['a=b'] }, signal), /one kind of body/);
  await assert.rejects(callService(root, s, { path: '/', method: 'GET', json: '{}' }, signal), /POST/);
  await assert.rejects(callService(root, s, { path: '/', header: ['Host: evil.com'] }, signal), /set by Studio/);
});

test('a service that is not running says so', async () => {
  /* a port that was free a moment ago */
  const port = await new Promise((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); }); });
  const [s] = withService([], null, { name: 'Off', url: `http://127.0.0.1:${port}` });
  await assert.rejects(callService(project(), s, { path: '/' }, signal), new RegExp(`not answering at http://127\\.0\\.0\\.1:${port}: is it running\\?`));
});

test('the key goes where the agent writes {key}, as the service\'s docs say; with none, as the usual header', async () => {
  const root = project();
  const [s] = withService([], null, { name: 'Odd', url: `${base}/v1`, key: 'odd+key&1' });
  await callService(root, s, { path: '/words?token={key}' }, signal);
  assert.equal(seen.at(-1).url, '/v1/words?token=odd%2Bkey%261', 'in the query, encoded');
  assert.equal(seen.at(-1).headers.authorization, undefined, 'and nowhere else');
  await callService(root, s, { path: '/words', header: ['X-Auth-Token: Token {key}'] }, signal);
  assert.equal(seen.at(-1).headers['x-auth-token'], 'Token odd+key&1');
  assert.equal(seen.at(-1).headers.authorization, undefined);
  await callService(root, s, { path: '/words' }, signal);
  assert.equal(seen.at(-1).headers.authorization, 'Bearer odd+key&1');
  const [none] = withService([], null, { name: 'Open', url: base });
  await assert.rejects(callService(root, none, { path: '/words?token={key}' }, signal), (e) => e.status === 400 && /no key/.test(e.message));
});

test('a service changed without saying where its key goes keeps where it went', () => {
  const [s] = withService([], null, { name: 'Della', url: base, auth: 'x-api-key: {key}', key: 'della-key' });
  const [changed] = withService([s], s.id, { name: 'Della', url: base, note: 'Speaks in my voice' });
  assert.equal(changed.auth, 'x-api-key: {key}');
  assert.equal(changed.note, 'Speaks in my voice');
  assert.equal(withService([], null, { name: 'New', url: base })[0].auth, 'Authorization: Bearer {key}');
});
