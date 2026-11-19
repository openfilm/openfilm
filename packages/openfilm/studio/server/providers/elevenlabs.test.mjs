import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import elevenlabs, { withSilence } from './elevenlabs.mjs';

const KEY = 'xi-test-key-0123456789';
/** A fake ElevenLabs on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks) };
    seen.push(call);
    const [status, body, headers = {}] = await reply(call);
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'content-type': 'audio/mpeg' }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_ELEVENLABS_URL = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const ctx = (files = {}) => ({ key: KEY, root: '/project', signal: new AbortController().signal, say: () => {}, read: async (p) => files[p] });
const form = (call) => new Request('http://x', { method: 'POST', headers: { 'content-type': call.headers['content-type'] }, body: call.body }).formData();

test('binary music is handed to the streaming relay rather than embedded in the result', async () => {
  reply = () => [200, Buffer.alloc(32000)];
  let kept = 0;
  const result = await elevenlabs.run('music',{out:'bed',prompt:'calm pad',sec:30},{...ctx(),handOff:true,
    keep:async(path,response)=>{
      let bytes=0; for await(const chunk of response.body)bytes+=chunk.length;
      kept++; return {path,url:'https://relay.example/temporary.mp3',type:'audio/mpeg',bytes};
    }});
  assert.equal(kept,1); assert.equal(result.files[0].url,'https://relay.example/temporary.mp3');
  assert.equal(result.files[0].bytes,32000); assert.equal(result.index[0].dur,2);
});

test('voice-over: timed per character, landed as words, the length from the MP3\'s size', async () => {
  const said = 'Hello world.';
  const chars = [...said];
  reply = () => [200, {
    /* one second of 128 kbps MP3 */
    audio_base64: Buffer.alloc(16000, 1).toString('base64'),
    alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.08), character_end_times_seconds: chars.map((_, i) => i * 0.08 + 0.07) },
  }];
  const result = await elevenlabs.run('tts', { out: 'intro', text: said, voice: 'voice 1' }, ctx());
  const call = seen.at(-1);
  assert.equal(call.url.pathname, '/v1/text-to-speech/voice%201/with-timestamps');
  assert.equal(call.url.searchParams.get('output_format'), 'mp3_44100_128');
  assert.equal(call.headers['xi-api-key'], KEY);
  assert.deepEqual(JSON.parse(call.body), { text: said, model_id: 'eleven_v4' });
  assert.equal(result.files[0].path, 'assets/audio/vo/intro.mp3');
  assert.equal(result.files[0].bytes.length, 16000);
  const [row] = result.index;
  assert.equal(row.src, 'assets/audio/vo/intro.mp3');
  assert.equal(row.dur, 1);
  assert.equal(row.text, said);
  assert.deepEqual(row.words.map((w) => w.token), ['Hello', 'world.']);
  assert.equal(row.words[1].start, 0.48);
  assert.equal(result.cost.note, 'billed by ElevenLabs to your key');
});

test('voices: the prompt searches, then language and gender narrow; nothing found by the prompt shows others', async () => {
  const voices = [
    { voice_id: 'a', name: 'Ada', labels: { gender: 'female', accent: 'british' }, verified_languages: [{ language: 'en' }] },
    { voice_id: 'b', name: 'Bo', labels: { gender: 'male' }, verified_languages: [{ language: 'zh' }] },
    { voice_id: 'c', name: 'Cy', labels: { gender: 'female' }, description: 'Warm narrator' },
  ];
  reply = (call) => [200, { voices: call.url.searchParams.get('search') === 'nobody' ? [] : voices }];
  const found = await elevenlabs.run('voice', { language: 'en', gender: 'f', prompt: 'calm', limit: 5 }, ctx());
  assert.equal(seen.at(-1).url.searchParams.get('search'), 'calm');
  assert.deepEqual(found.receipt.voices, [
    { voiceId: 'a', name: 'Ada', language: 'en', gender: 'f', description: 'british' },
    { voiceId: 'c', name: 'Cy', language: null, gender: 'f', description: 'Warm narrator' },
  ]);
  const others = await elevenlabs.run('voice', { prompt: 'nobody', limit: 1 }, ctx());
  assert.equal(others.receipt.voices.length, 1);
  assert.match(others.receipt.notes[0], /no voice matched "nobody"/);
});

test('sound effects and music: the length asked, within what the service takes', async () => {
  reply = () => [200, Buffer.alloc(32000)];
  const sfx = await elevenlabs.run('sfx', { out: 'ding', prompt: 'a glass chime', sec: 40 }, ctx());
  assert.equal(seen.at(-1).url.pathname, '/v1/sound-generation');
  assert.deepEqual(JSON.parse(seen.at(-1).body), { text: 'a glass chime', model_id: 'eleven_text_to_sound_v3', duration_seconds: 30 });
  assert.equal(sfx.files[0].path, 'assets/audio/sfx/ding.mp3');
  assert.equal(sfx.index[0].dur, 2);
  const music = await elevenlabs.run('music', { out: 'bed', prompt: 'calm pad', sec: 30 }, ctx());
  assert.equal(seen.at(-1).url.pathname, '/v1/music');
  assert.deepEqual(JSON.parse(seen.at(-1).body), { prompt: 'calm pad', model_id: 'music_v2_5', music_length_ms: 30000 });
  assert.equal(music.files[0].path, 'assets/audio/music/bed.mp3');
  assert.deepEqual(music.index[0].from, { mode: 'generate', prompt: 'calm pad', sec: 30, provider: 'elevenlabs', model: 'music_v2_5' });
});

test('transcription: the speech uploaded as what it is, words kept and spacing dropped', async () => {
  reply = () => [200, { language_code: 'en', text: 'Hi there', words: [
    { text: 'Hi', type: 'word', start: 0.1, end: 0.3 }, { text: ' ', type: 'spacing', start: 0.3, end: 0.35 }, { text: 'there', type: 'word', start: 0.35, end: 0.7 },
  ] }];
  const wavBytes = Buffer.concat([Buffer.from('RIFF\0\0\0\0WAVE'), Buffer.alloc(40)]);
  const result = await elevenlabs.run('asr', { src: 'assets/upload/talk.mp4' }, ctx({ 'assets/upload/talk.mp4': new Uint8Array(wavBytes) }));
  const sent = await form(seen.at(-1));
  assert.equal(sent.get('model_id'), 'scribe_v3');
  assert.equal(sent.get('timestamps_granularity'), 'word');
  assert.equal(sent.get('temperature'), '0');
  assert.equal(sent.get('file').name, 'talk.wav');
  assert.deepEqual(result.index, [{ src: 'assets/upload/talk.mp4', text: 'Hi there', transcribed: true,
    words: [{ token: 'Hi', start: 0.1, end: 0.3 }, { token: 'there', start: 0.35, end: 0.7 }] }]);
  assert.equal(result.files.length, 0);
});

test('speech MP3 as OpenFilm sends it gets a second of silence after it; any other file goes as it is', async () => {
  const header = [0xff, 0xf3, 0x48, 0xc0];
  const speech = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0, ...header, ...new Array(140).fill(0)]);
  const padded = withSilence(speech);
  assert.equal(padded.length, speech.length + 28 * 144);
  assert.deepEqual([...padded.subarray(speech.length, speech.length + 4)], header);
  const other = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0]);
  assert.equal(withSilence(other), other, 'a 44.1 kHz stereo MP3 is left alone');
  reply = () => [200, { text: '', words: [] }];
  await elevenlabs.run('asr', { src: 'talk.mp3' }, ctx({ 'talk.mp3': speech }));
  assert.equal((await form(seen.at(-1))).get('file').size, padded.length);
  assert.equal(elevenlabs.speechFormat, 'mp3');
});

test('a refused key says so without the service\'s words; an echoed key is blanked out', async () => {
  reply = () => [401, { detail: { message: `invalid key ${KEY}` } }];
  await assert.rejects(elevenlabs.run('sfx', { out: 'x', prompt: 'y' }, ctx()), (e) => /did not accept your key/.test(e.message) && !e.message.includes(KEY));
  reply = () => [422, { detail: { message: `bad request for ${KEY}` } }];
  await assert.rejects(elevenlabs.run('sfx', { out: 'x', prompt: 'y' }, ctx()), (e) => e.message === 'ElevenLabs answered 422: bad request for •••');
});

test('voice lookup stays within the supplier term limit and invalid selection has a correction', async () => {
  reply = () => [200, { voices: [{ voice_id: 'abc', name: 'Voice' }] }];
  const prompt = Array.from({ length: 42 }, (_, i) => 'term' + i).join(' ');
  await elevenlabs.run('voice', { prompt }, ctx());
  assert.equal(seen.at(-1).url.searchParams.get('search').split(' ').length, 30);
  const count = seen.length;
  await assert.rejects(elevenlabs.run('tts', { text: 'hi', voice: 'audio/sample.mp3' }, ctx()), /--voice-sample/);
  assert.equal(seen.length, count, 'a file path never goes to the speech endpoint as a voice ID');
  reply = () => [404, { detail: { message: "A voice with voice_id 'missing' was not found." } }];
  await assert.rejects(elevenlabs.run('tts', { out: 'hello', text: 'hi', voice: 'missing' }, ctx()), /Choose an ElevenLabs voice/);
});

test('Scribe retries one explicit overload and does not retry an uncertain submission', async () => {
  const context = ctx({ 'voice.wav': Buffer.from('speech') });
  const args = { src: 'voice.wav' };
  let requests = 0;
  reply = () => ++requests === 1
    ? [429, { detail: { message: 'heavy traffic' } }, { 'retry-after': '0' }]
    : [200, { text: 'hi', words: [] }];
  const out = await elevenlabs.run('asr', args, context);
  assert.equal(out.receipt.text, 'hi');
  assert.equal(requests, 2);

  requests = 0;
  reply = () => { requests++; return [429, { detail: { message: 'heavy traffic' } }, { 'retry-after': '0' }]; };
  await assert.rejects(elevenlabs.run('asr', args, context), /429/);
  assert.equal(requests, 2);

  requests = 0;
  reply = () => { requests++; return [502, {}]; };
  await assert.rejects(elevenlabs.run('asr', args, context), (error) => error.mediaUncertain === true);
  assert.equal(requests, 1);
});
