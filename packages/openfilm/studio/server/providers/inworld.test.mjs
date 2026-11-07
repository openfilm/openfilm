import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import inworld, { parts } from './inworld.mjs';

const KEY = 'inworld_test_0123456789';
/** A fake Inworld on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body] = await reply(call);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_INWORLD_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (model) => ({ key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {}, read: async () => new Uint8Array() });
/* one second of 128 kbps MP3 */
const SECOND = Buffer.alloc(16000, 1).toString('base64');

test('voice-over: the key as Inworld gives it, word times with punctuation kept on its word, the length from the MP3', async () => {
  reply = () => [200, {
    audioContent: SECOND,
    timestampInfo: { wordAlignment: { words: ['', 'Hello', ', ', 'world', '.'], wordStartTimeSeconds: [0, 0.1, 0.4, 0.5, 0.9], wordEndTimeSeconds: [0, 0.4, 0.5, 0.9, 0.95] } },
  }];
  const result = await inworld.run('tts', { out: 'intro', text: 'Hello, world.', voice: 'Ashley' }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/tts/v1/voice');
  assert.equal(call.headers.authorization, `Basic ${KEY}`);
  assert.deepEqual(JSON.parse(call.body), { text: 'Hello, world.', voiceId: 'Ashley', modelId: 'inworld-tts-2', audioConfig: { audioEncoding: 'MP3', bitRate: 128000 }, timestampType: 'WORD' });
  assert.equal(result.files[0].path, 'assets/audio/vo/intro.mp3');
  const [row] = result.index;
  assert.equal(row.dur, 1);
  assert.deepEqual(row.words, [{ token: 'Hello,', start: 0.1, end: 0.5 }, { token: 'world.', start: 0.5, end: 0.95 }]);
  assert.equal(result.receipt.model, 'inworld-tts-2');
  assert.equal(result.cost.note, 'billed by Inworld to your key');
});

test('voice-over: the chosen model; a line longer than one request is said in parts, its words moved along', async () => {
  const sentence = `${'word '.repeat(150).trim()}.`;
  const said = `${sentence} ${sentence} ${sentence}`;
  reply = (call) => {
    const text = JSON.parse(call.body).text;
    return [200, { audioContent: SECOND, timestampInfo: { wordAlignment: { words: text.split(' '), wordStartTimeSeconds: text.split(' ').map((_, i) => i * 0.001), wordEndTimeSeconds: text.split(' ').map((_, i) => i * 0.001 + 0.001) } } }];
  };
  const from = seen.length;
  const result = await inworld.run('tts', { out: 'long', text: said, voice: 'Dennis' }, ctx('inworld-tts-2-flash'));
  const calls = seen.slice(from);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => JSON.parse(c.body).text.length <= 2000 && JSON.parse(c.body).modelId === 'inworld-tts-2-flash'));
  const [row] = result.index;
  assert.equal(row.dur, 2);
  assert.equal(row.words.length, 450);
  assert.equal(row.words.find((w, i) => i > 0 && w.start >= 1)?.start, 1, 'the second part starts after the first');
});

test('parts: at a sentence\'s end, else at a space, else anywhere', () => {
  assert.deepEqual(parts('One. Two three.', 10), ['One.', 'Two three.']);
  assert.deepEqual(parts('aaaa bbbb cccc', 10), ['aaaa bbbb', 'cccc']);
  assert.deepEqual(parts('abcdefghijkl', 5), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(parts('第一句。第二句。', 5), ['第一句。', '第二句。']);
});

test('voices: the prompt searches names, descriptions and tags; language and gender narrow', async () => {
  reply = () => [200, { voices: [
    { voiceId: 'Ashley', displayName: 'Ashley', languageCode: 'en-US', gender: 'female', description: 'A warm, natural voice', tags: ['calm'] },
    { voiceId: 'Dennis', displayName: 'Dennis', languageCode: 'en-US', gender: 'male', description: 'Middle-aged man', tags: ['energetic'] },
    { voiceId: 'Yichen', displayName: 'Yichen', languageCode: 'zh-CN', gender: 'male', description: 'Calm young man', tags: [] },
  ] }];
  const calm = await inworld.run('voice', { prompt: 'calm' }, ctx());
  assert.equal(seen.at(-1).url.pathname, '/voices/v1/voices');
  assert.deepEqual(calm.receipt.voices.map((v) => v.voiceId), ['Ashley', 'Yichen']);
  assert.deepEqual(calm.receipt.voices[0], { voiceId: 'Ashley', name: 'Ashley', language: 'en-US', gender: 'f', description: 'A warm, natural voice' });
  const men = await inworld.run('voice', { language: 'en', gender: 'male' }, ctx());
  assert.deepEqual(men.receipt.voices.map((v) => v.voiceId), ['Dennis']);
  const none = await inworld.run('voice', { prompt: 'pirate' }, ctx());
  assert.equal(none.receipt.voices.length, 3);
  assert.match(none.receipt.notes[0], /no voice matched "pirate"/);
});

test('an account out of credit says so, as every provider does', async () => {
  reply = () => [402, { code: 9, message: 'Insufficient credits' }];
  await assert.rejects(inworld.run('tts', { out: 'x', text: 'Hi.', voice: 'Ashley' }, ctx()), (e) => e.code === 'balance');
});
