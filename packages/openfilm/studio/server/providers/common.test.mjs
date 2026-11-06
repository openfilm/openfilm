import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, imageSize, landing, mp4Facts, outOfBalance, translatedLines, translationAsk, wav, wavSeconds, wordsFromCharacters } from './common.mjs';

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
  /* streamed WAV writers use either size to mean unknown */
  for (const size of [0, 0xffffffff]) {
    Buffer.from(file.buffer).writeUInt32LE(size, 40);
    assert.equal(wavSeconds(file), 1);
  }
  assert.equal(wavSeconds(new Uint8Array(10)), null);
});

test('WAV duration excludes trailing metadata and is capped by the available samples', () => {
  const audio = Buffer.from(wav(new Uint8Array(48000), 24000));
  const metadata = Buffer.alloc(4808);
  metadata.write('LIST', 0);
  metadata.writeUInt32LE(4800, 4);
  metadata.write('INFO', 8);
  metadata.write('ICMT', 12);
  metadata.writeUInt32LE(4788, 16);
  const file = Buffer.concat([audio, metadata]);
  file.writeUInt32LE(file.length - 8, 4);
  assert.equal(wavSeconds(file), 1);
  assert.equal(wavSeconds(audio.subarray(0, 44 + 24000)), 0.5);
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

test('an MP4\'s length and picture size from its boxes: 32- and 64-bit headers, the moov after the media', () => {
  const box = (/** @type {string} */ type, /** @type {Buffer[]} */ ...parts) => {
    const body = Buffer.concat(parts);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, body]);
  };
  const mvhd0 = Buffer.alloc(100);
  mvhd0.writeUInt32BE(600, 12);
  mvhd0.writeUInt32BE(2700, 16);
  const sound = Buffer.alloc(84);
  const picture = Buffer.alloc(84);
  picture.writeUInt32BE(1280 * 65536, 76);
  picture.writeUInt32BE(720 * 65536, 80);
  /* a large media box (64-bit size) before the movie header, the sound track before the picture's */
  const mdat = Buffer.alloc(24);
  mdat.writeUInt32BE(1);
  mdat.write('mdat', 4, 'ascii');
  mdat.writeBigUInt64BE(24n, 8);
  const file = Buffer.concat([box('ftyp', Buffer.from('isom')), mdat, box('moov', box('trak', box('tkhd', sound)), box('mvhd', mvhd0), box('trak', box('tkhd', picture)))]);
  assert.deepEqual(mp4Facts(new Uint8Array(file)), { seconds: 4.5, w: 1280, h: 720 });
  const mvhd1 = Buffer.alloc(112);
  mvhd1[0] = 1;
  mvhd1.writeUInt32BE(1000, 20);
  mvhd1.writeBigUInt64BE(15000n, 24);
  const tkhd1 = Buffer.alloc(96);
  tkhd1[0] = 1;
  tkhd1.writeUInt32BE(720 * 65536, 88);
  tkhd1.writeUInt32BE(1280 * 65536, 92);
  assert.deepEqual(mp4Facts(new Uint8Array(box('moov', box('mvhd', mvhd1), box('trak', box('tkhd', tkhd1))))), { seconds: 15, w: 720, h: 1280 });
  assert.equal(mp4Facts(new Uint8Array(Buffer.from('mp4 bytes'))), null);
  assert.equal(mp4Facts(new Uint8Array(box('ftyp', Buffer.from('isom')))), null);
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

test('a key that reached the spending limit set on it is told apart from a wrong key and from no balance', async () => {
  const body = JSON.stringify({ error: { message: 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/settings/keys $200.03 of $200.00 used; does not reset.', code: 403 } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(body, { status: 403 });
  try {
    await assert.rejects(call('OpenRouter', 'https://x.test', {}, { key: 'k', signal: new AbortController().signal }),
      (/** @type {any} */ e) => e.code === 'balance' && e.limit === true && /spending limit set on it/.test(e.message) && !/did not accept your key/.test(e.message));
  } finally {
    globalThis.fetch = realFetch;
  }
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
  /* ElevenLabs' free plan: music, or a voice from its library, is a 402 whatever the credits left */
  const freePlan = { detail: { status: 'paid_plan_required', message: 'Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.' } };
  assert.ok(!outOfBalance(402, JSON.stringify(freePlan)));
  /* and its documented plan errors, both 403s */
  const subscription = { detail: { type: 'authorization_error', code: 'subscription_required', message: 'A paid subscription is required to access this feature.' } };
  const feature = { detail: { type: 'authorization_error', code: 'feature_not_available', message: 'This feature is not available on your current plan.' } };
  assert.ok(!outOfBalance(403, JSON.stringify(subscription)));
  assert.ok(!outOfBalance(403, JSON.stringify(feature)));

  const ctx = { key: 'sk-test', signal: new AbortController().signal };
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const answers = { '/quota': [429, { error: { type: 'insufficient_quota' } }], '/plan': [402, freePlan], '/subscription': [403, subscription], '/feature': [403, feature] };
    const [status, body] = answers[/** @type {keyof typeof answers} */ (req.url)] ?? [401, { error: { message: 'bad key sk-test' } }];
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const at = `http://127.0.0.1:${server.address().port}`;
  try {
    await assert.rejects(call('OpenAI', `${at}/quota`, {}, ctx), (e) => e.code === 'balance' && e.message === "OpenAI doesn't have enough balance for this.");
    await assert.rejects(call('OpenAI', `${at}/key`, {}, ctx), (e) => e.code === undefined && /did not accept your key/.test(e.message));
    await assert.rejects(call('ElevenLabs', `${at}/plan`, {}, ctx), (e) => e.code === undefined
      && e.message === 'ElevenLabs needs a paid plan for this (402): Free users cannot use library voices via the API. Please upgrade your subscription to use this voice.');
    await assert.rejects(call('ElevenLabs', `${at}/subscription`, {}, ctx), (e) => e.code === undefined
      && e.message === 'ElevenLabs needs a paid plan for this (403): A paid subscription is required to access this feature.');
    await assert.rejects(call('ElevenLabs', `${at}/feature`, {}, ctx), (e) => e.code === undefined
      && e.message === 'ElevenLabs needs a paid plan for this (403): This feature is not available on your current plan.');
  } finally {
    server.close();
  }
});
