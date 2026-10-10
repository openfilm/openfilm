import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, imageSize, landing, outOfBalance, translatedLines, translationAsk, wav, wavSeconds, wordsFromCharacters } from './common.mjs';

test('words from character timings: spaces split, punctuation stays, each Chinese character is a word, times clamped', () => {
  const said = 'Hi, there 你好';
  const chars = [...said];
  const starts = chars.map((_, i) => i * 0.1);
  const ends = chars.map((_, i) => i * 0.1 + 0.08);
  assert.deepEqual(wordsFromCharacters(chars, starts, ends, 1.25).map((w) => [w.token, +w.start.toFixed(2), +w.end.toFixed(2)]), [
    ['Hi,', 0, 0.28], ['there', 0.4, 0.88], ['你', 1, 1.08], ['好', 1.1, 1.18],
  ]);
  /* past the file's end: clamped to it */
  assert.equal(wordsFromCharacters(['a', 'b'], [2, 2.1], [2.1, 2.2], 2.05)[0].end, 2.05);
});

test('a WAV of PCM plays as long as its samples, whatever its header claims', () => {
  const file = wav(new Uint8Array(48000), 24000);
  assert.equal(wavSeconds(file), 1);
  /* a streamed WAV says its data is endless */
  Buffer.from(file.buffer).writeUInt32LE(0xffffffff, 40);
  assert.equal(wavSeconds(file), 1);
  assert.equal(wavSeconds(new Uint8Array(10)), null);
});

test('picture sizes from PNG and JPEG headers', () => {
  const png = Buffer.alloc(33);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(1536, 16);
  png.writeUInt32BE(864, 20);
  assert.deepEqual(imageSize(png), { w: 1536, h: 864 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0xd0, 0x05, 0x00, 3, 0, 0]);
  assert.deepEqual(imageSize(jpeg), { w: 1280, h: 720 });
  assert.equal(imageSize(Buffer.from('nope')), null);
});

test('results land as assets/<dir>/<name>.<ext>; --out is a name, not a path', () => {
  assert.equal(landing('audio/vo', 'intro', 'mp3'), 'assets/audio/vo/intro.mp3');
  for (const out of ['', '..', '../x', 'a/b', 'a\\b']) assert.throws(() => landing('image', out, 'png'));
});

test('translation: one string per line asked, in order; anything else is refused', () => {
  const ask = translationAsk([{ text: 'Hello.' }, 'Goodbye.'], 'es');
  assert.equal(ask.count, 2);
  assert.deepEqual(JSON.parse(ask.user), { language: 'es', lines: ['Hello.', 'Goodbye.'] });
  assert.match(ask.system, /exactly 2 strings/);
  assert.deepEqual(translatedLines('```json\n{"lines": [" Hola. ", "Adiós."]}\n```', 2), ['Hola.', 'Adiós.']);
  assert.throws(() => translatedLines('{"lines": ["Hola."]}', 2), /1 lines for 2/);
  assert.throws(() => translatedLines('Hola', 1), /JSON/);
  assert.throws(() => translationAsk([], 'es'), /lines/);
  assert.throws(() => translationAsk(['x'], ''), /language/);
});

test('no balance, as each service says it, is one error for all; a plain rate limit is not one', async () => {
  /* OpenAI, ElevenLabs, fal, Gemini, Tavily, and any 402 */
  assert.ok(outOfBalance(429, JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota', code: 'insufficient_quota' } })));
  assert.ok(outOfBalance(401, JSON.stringify({ detail: { status: 'quota_exceeded', message: 'This request exceeds your quota.' } })));
  assert.ok(outOfBalance(403, JSON.stringify({ detail: 'User is locked. Reason: Exhausted balance. Top up your balance at fal.ai/dashboard/billing.' })));
  assert.ok(outOfBalance(429, JSON.stringify({ error: { code: 429, message: 'Your prepayment credits are depleted.', status: 'RESOURCE_EXHAUSTED' } })));
  assert.ok(outOfBalance(402, ''));
  /* Tavily's plan and pay-as-you-go limits */
  assert.ok(outOfBalance(432, '') && outOfBalance(433, ''));
  assert.ok(!outOfBalance(429, JSON.stringify({ error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } })));
  assert.ok(!outOfBalance(429, JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } })));
  assert.ok(!outOfBalance(401, JSON.stringify({ error: { message: 'Incorrect API key provided' } })));

  const ctx = { key: 'sk-test', signal: new AbortController().signal };
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const [status, body] = req.url === '/quota' ? [429, { error: { type: 'insufficient_quota' } }] : [401, { error: { message: 'bad key sk-test' } }];
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const at = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(call('OpenAI', `${at}/quota`, {}, ctx), (e) => e.code === 'balance' && e.message === "OpenAI doesn't have enough balance for this.");
    await assert.rejects(call('OpenAI', `${at}/key`, {}, ctx), (e) => e.code === undefined && /did not accept your key/.test(e.message));
  } finally {
    server.close();
  }
});
