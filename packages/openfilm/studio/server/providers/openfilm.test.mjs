import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import openfilm, { polling } from './openfilm.mjs';
import { steadily } from './common.mjs';

const KEY = 'ofk_test0123456789';
/** A fake OpenFilm service on 127.0.0.1: `reply` answers each request; `seen` keeps them. */
let server;
let reply = () => [404, {}];
const seen = [];

before(async () => {
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const call = { method: req.method, url: new URL(req.url, 'http://x'), headers: req.headers, body: Buffer.concat(chunks).toString() };
    seen.push(call);
    const [status, body, type = 'application/json'] = await reply(call);
    if (typeof body === 'function') { body(res); return; }
    res.writeHead(status, { 'content-type': type }).end(Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  process.env.OPENFILM_API_URL = `http://127.0.0.1:${server.address().port}`;
  polling.ms = 5;
  polling.busy = 5;
  steadily.first = 5;
  steadily.most = 10;
});
after(() => server.close());

test('file-backed references upload as streams, while a restarted client recovers the same paid request before uploading again', async t => {
  const root=await mkdtemp(join(tmpdir(),'openfilm-recover-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let uploads=0,generations=0;
  const url=process.env.OPENFILM_API_URL;
  reply=call=>{
    if(call.url.pathname==='/v1/media/uploads') {uploads++;return [200,{uploads:[{path:'assets/ref.png',id:'input-id',url:`${url}/upload`,headers:{'content-length':'3'}}]}];}
    if(call.url.pathname==='/upload'){assert.equal(call.body,'ref');return [200,{}];}
    if(call.url.pathname==='/v1/media/ack')return [200,{ok:true}];
    if(call.method==='POST')generations++;
    return [200,{files:[{path:'assets/out.mp3',url:`${url}/file`,bytes:5}],receipt:{dur:1}}];
  };
  const routed=reply;reply=call=>call.url.pathname==='/file'?[200,Buffer.from('audio'),'audio/mpeg']:routed(call);
  const context={...ctx(),root,openInput:async()=>({size:3,version:'same-content',stream:()=>new ReadableStream({start(c){c.enqueue(Buffer.from('ref'));c.close();}})}),read:async()=>assert.fail('the original must not be buffered')};
  const args={prompt:'music with a reference','first-frame':'assets/ref.png',out:'out'};
  const first=await openfilm.run('video',args,context);
  await first.cleanup(); // simulate interruption before the caller saved the result
  const second=await openfilm.run('video',args,context);
  assert.equal(generations,1);assert.equal(uploads,1,'recovery uses the original task instead of re-uploading consumed inputs');
  await mkdir(join(root,'assets'));await second.files[0].commit(join(root,second.files[0].path));await second.complete();await second.cleanup();
  assert.equal(await readFile(join(root,'assets/out.mp3'),'utf8'),'audio');
  assert.deepEqual(await readdir(join(root,'.film/media-runs')),[],'only a confirmed local save clears the request and staging journal');
});

const ctx = (files = {}, model) => ({
  key: KEY, model, root: '/project', signal: new AbortController().signal, say: () => {},
  read: async (p) => { if (!(p in files)) throw new Error(`no ${p}`); return files[p]; },
});

test('what it offers is what the service says now: the kinds it knows, voices with voice-over; kept when it cannot be reached', async (t) => {
  assert.deepEqual(openfilm.verbs, [], 'nothing before the service said');
  seen.length = 0;
  reply = (call) => (call.url.pathname === '/v1/media/models' ? [200, { models: {
    tts: [{ id: 'elevenlabs/eleven_v4', name: 'ElevenLabs Eleven v4' }],
    video: [{ id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast' },
      { id: 'openrouter/alibaba/wan-3.0', name: 'Wan 3.0', spec: { refs: 10, clip: 5, voice: 5, frames: true } }, { id: 7 }],
    translate: [{ id: 'x/y', name: 'not a kind of media it offers' }],
  } }] : [404, {}]);
  await openfilm.refresh();
  assert.equal(seen[0].headers.authorization, undefined, 'no key: what it offers is no secret');
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video']);
  /* what a model makes is what the provider it is run at says */
  assert.deepEqual(openfilm.models.video, [
    { id: 'openrouter/bytedance/seedance-2.0-fast', name: 'Seedance 2.0 Fast',
      spec: { ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'], seconds: [4, 15], refs: 9, frames: true, voice: true, voiceNeedsVisual: true, clip: true, sizes: ['480p', '720p'] } },
    { id: 'openrouter/alibaba/wan-3.0', name: 'Wan 3.0', spec: { refs: 10, clip: 5, voice: 5, frames: true } },
  ]);
  assert.equal(openfilm.models.tts[0].spec, undefined, 'a voice has none');
  await openfilm.refresh();
  assert.equal(seen.length, 1, 'asked again only after a while');
  reply = () => [503, {}];
  await openfilm.refresh({ force: true });
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video'], 'kept while it cannot be reached');
  /* once it has answered, a list grown old is shown at once while it is asked again: no one waits on the service */
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 31_000 });
  let answer = () => {};
  const later = new Promise((done) => { answer = done; });
  reply = async () => { await later; return [200, { models: { tts: [{ id: 'inworld/inworld-tts-2', name: 'Inworld TTS-2' }] } }]; };
  await openfilm.refresh();
  assert.deepEqual(openfilm.verbs, ['tts', 'voice', 'video'], 'the list it had, without waiting');
  answer();
  await openfilm.refresh({ force: true });
  assert.deepEqual(openfilm.verbs, ['tts', 'voice'], 'then what it says now');
  t.mock.timers.reset();
});

test('a run: posted with the key, the files it names, async; asked after until done (a service from before uploads: inside the run)', async () => {
  seen.length = 0;
  let asks = 0;
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    if (call.method === 'POST') return [202, { status: 'running', idempotency_key: call.headers['idempotency-key'] }];
    asks += 1;
    if (asks < 2) return [202, { status: 'running' }];
    return [200, { files: [{ path: 'assets/video/a.mp4', base64: Buffer.from('mp4').toString('base64'), bytes: 3 }], index: [{ src: 'assets/video/a.mp4', kind: 'video', dur: 5 }], receipt: { dur: 5 } }];
  };
  const frame = new Uint8Array([1, 2, 3]);
  const result = await openfilm.run('video', { prompt: 'a cat. on a mat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'openrouter/bytedance/seedance-2.0'));
  assert.equal(seen[0].url.pathname, '/v1/media/uploads');
  seen.shift();
  const posted = seen[0];
  assert.equal(posted.url.pathname, '/v1/media/run');
  assert.equal(posted.headers.authorization, `Bearer ${KEY}`);
  assert.match(posted.headers.prefer, /respond-async/);
  const body = JSON.parse(posted.body);
  assert.equal(body.verb, 'video');
  assert.equal(body.model, 'openrouter/bytedance/seedance-2.0');
  assert.deepEqual(body.inputs, [{ path: 'assets/image/cat.png', base64: Buffer.from(frame).toString('base64') }]);
  assert.equal(seen[1].url.searchParams.get('key'), posted.headers['idempotency-key']);
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.equal(result.index[0].dur, 5);
});

test('a Seedance run sends the clip and pictures named by its reference flags, including spaces in paths', async () => {
  seen.length = 0;
  const video = 'assets/Weixin Videos 01.mp4';
  const picture = 'assets/参考图片/角色 01.png';
  const prompt = 'assets/unused.png';
  const files = {
    [video]: Uint8Array.of(1, 2, 3),
    [picture]: Uint8Array.of(4, 5, 6),
    [prompt]: Uint8Array.of(7, 8, 9),
  };
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    const { args, inputs } = JSON.parse(call.body);
    const sent = new Map(inputs.map(({ path, base64 }) => [path, base64]));
    for (const path of [args.video, ...args['input-reference']]) {
      if (!sent.has(path)) return [422, { message: `${path} was not sent with the run.` }];
    }
    assert.equal(inputs.length, 2, 'only the named reference files, once per path');
    assert.equal(sent.get(video), Buffer.from(files[video]).toString('base64'));
    assert.equal(sent.get(picture), Buffer.from(files[picture]).toString('base64'));
    return [200, { receipt: { dur: 5 } }];
  };
  const result = await openfilm.run('video', { prompt, video, 'input-reference': [picture, picture], out: 'scene' },
    ctx(files, 'openrouter/bytedance/seedance-2.0-mini'));
  assert.equal(result.receipt.dur, 5);
});

test('a Seedance first-and-last-frame run sends both pictures with Chinese names and spaces', async () => {
  seen.length = 0;
  const first = 'assets/春日长椅上的羞涩等待 4.png';
  const last = 'assets/春日长椅上的羞涩等待 5.png';
  const files = { [first]: Uint8Array.of(1, 2, 3), [last]: Uint8Array.of(4, 5, 6) };
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    const { args, inputs } = JSON.parse(call.body);
    const sent = new Map(inputs.map(({ path, base64 }) => [path, base64]));
    for (const flag of ['first-frame', 'last-frame']) {
      if (!sent.has(args[flag])) return [422, { message: `${args[flag]} was not sent with the run.` }];
      assert.equal(sent.get(args[flag]), Buffer.from(files[args[flag]]).toString('base64'));
    }
    assert.equal(inputs.length, 2);
    return [200, { receipt: { dur: 5 } }];
  };
  const result = await openfilm.run('video', {
    prompt: '两人在长椅上相视而笑', 'first-frame': first, 'last-frame': last, out: 'scene',
  }, ctx(files, 'openrouter/bytedance/seedance-2.5'));
  assert.equal(result.receipt.dur, 5);
});

test('transcription sends a recording with spaces in its path', async () => {
  seen.length = 0;
  const src = 'assets/录音/对白 01.wav';
  const bytes = Uint8Array.of(1, 2, 3);
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    const body = JSON.parse(call.body);
    assert.deepEqual(body.inputs, [{ path: src, base64: Buffer.from(bytes).toString('base64') }]);
    assert.equal(body.args.src, src);
    return [200, { receipt: { text: '你好' } }];
  };
  const result = await openfilm.run('asr', { src, out: 'transcript' }, ctx({ [src]: bytes }, 'elevenlabs/scribe_v2'));
  assert.equal(result.receipt.text, '你好');
});

test('all media file flags send exact paths regardless of punctuation, language or platform separators', async () => {
  const names = [
    'spaces and\u00a0nonbreaking spaces', '中文 日本語 한글', 'العَرَبِيَّة नमस्ते', 'Café', 'Cafe\u0301', '👩🏽‍🎨 🎬',
    "# + %20 & = ; ' ` $ () [] {} !", 'what? quote" star* colon: pipe|', 'two..dots',
  ];
  for (const name of names) {
    const picture = `assets/${name}/first.png`;
    const last = `assets/${name}/last.png`;
    const clip = `assets/${name}/clip.mp4`;
    const audio = `assets/${name}/audio.wav`;
    const cases = [
      ['asr', { src: audio }, [audio]],
      ['cutout', { src: picture }, [picture]],
      ['image', { ref: [picture, last, picture], mask: last, markup: picture }, [picture, last]],
      ['video', { 'first-frame': picture, 'last-frame': last }, [picture, last]],
      ['video', { video: [clip], 'input-reference': [picture, last], audio, voice: [audio] }, [picture, last, clip, audio]],
    ];
    for (const [verb, args, paths] of cases) {
      seen.length = 0;
      const files = Object.fromEntries(paths.map((path, i) => [path, Uint8Array.of(i, 0, 255)]));
      reply = (call) => {
        if (call.url.pathname === '/v1/media/uploads') return [404, {}];
        const body = JSON.parse(call.body);
        assert.deepEqual(body.args, args);
        assert.deepEqual(body.inputs, paths.map((path) => ({ path, base64: Buffer.from(files[path]).toString('base64') })));
        return [200, { receipt: {} }];
      };
      await openfilm.run(verb, args, ctx(files));
      assert.equal(seen.filter((c) => c.url.pathname === '/v1/media/run').length, 1, `${verb}: ${name}`);
    }
  }
  const windows = 'assets\\参考 图片\\首帧 #1 + 100%.png';
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') return [404, {}];
    assert.equal(JSON.parse(call.body).inputs[0].path, windows);
    return [200, {}];
  };
  await openfilm.run('video', { 'first-frame': windows }, ctx({ [windows]: Uint8Array.of(1) }));
});

test('voice IDs, prompts and output names that resemble paths are never treated as input files', async () => {
  seen.length = 0;
  reply = (call) => {
    assert.deepEqual(JSON.parse(call.body).inputs, []);
    return [200, {}];
  };
  await openfilm.run('tts', { text: 'assets/对白 01.wav', voice: 'voice.test', out: 'output.test' }, ctx());
  assert.equal(seen.length, 1);
});

test('files go straight to the service\'s storage and come straight from where their maker keeps them', async () => {
  seen.length = 0;
  const base = process.env.OPENFILM_API_URL;
  const frame = Uint8Array.of(1, 2, 3);
  reply = (call) => {
    if (call.url.pathname === '/v1/media/uploads') {
      const { files } = JSON.parse(call.body);
      return [200, { uploads: files.map((f, i) => ({ path: f.path, id: `u${i}/cat.png`, url: `${base}/put/u${i}?X-Amz-Signature=s`, headers: { 'content-type': 'image/png' } })) }];
    }
    if (call.url.pathname.startsWith('/put/')) return [200, {}];
    if (call.url.pathname === '/files/a.mp4') return [200, Buffer.from('mp4'), 'video/mp4'];
    return [200, { files: [{ path: 'assets/video/a.mp4', url: `${base}/files/a.mp4?X-Tos-Signature=s`, type: 'video/mp4' }], index: [], receipt: { dur: 5 } }];
  };
  const result = await openfilm.run('video', { prompt: 'a cat', 'first-frame': 'assets/image/cat.png', out: 'cat.mp4' }, ctx({ 'assets/image/cat.png': frame }, 'volcengine/doubao-seedance-2-0-fast-260128'));
  const [asked, put, run, fetched] = seen;
  assert.deepEqual(JSON.parse(asked.body), { files: [{ path: 'assets/image/cat.png', bytes: 3 }] }, 'only its name and size');
  assert.equal(asked.headers.authorization, `Bearer ${KEY}`);
  assert.equal(put.method, 'PUT');
  assert.equal(put.headers.authorization, undefined, 'a signed address: no key goes with it');
  assert.equal(put.headers['content-type'], 'image/png');
  assert.deepEqual([...Buffer.from(put.body)], [1, 2, 3]);
  const body = JSON.parse(run.body);
  assert.deepEqual(body.inputs, [{ path: 'assets/image/cat.png', upload: 'u0/cat.png' }], 'the run names the upload, not the bytes');
  assert.equal(body.results, 'links');
  assert.equal(fetched.url.pathname, '/files/a.mp4');
  assert.equal(fetched.headers.authorization, undefined);
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
});

test('an unreadable reference is reported locally instead of submitting an incomplete run', async () => {
  seen.length = 0;
  const video = 'assets/Weixin Videos 01.mp4';
  await assert.rejects(openfilm.run('video', { prompt: 'Make a clip', video, out: 'scene' }, ctx()), /no assets\/Weixin Videos 01\.mp4/);
  assert.equal(seen.length, 0);
});

test('a missing last frame stops the whole run before submitting the first frame or charging', async () => {
  seen.length = 0;
  const first = 'assets/首帧 #1.png';
  const last = 'assets/尾帧 #2.png';
  await assert.rejects(openfilm.run('video', { 'first-frame': first, 'last-frame': last }, ctx({ [first]: Uint8Array.of(1) })), /no assets\/尾帧 #2\.png/);
  assert.equal(seen.length, 0);
});

test('voices are listed with the voice-over model; with no model chosen, the service uses its default', async () => {
  seen.length = 0;
  reply = () => [200, { files: [], index: [], receipt: { voices: [] } }];
  await openfilm.run('voice', { language: 'en' }, ctx({}, 'elevenlabs/eleven_v4'));
  await openfilm.run('image', { prompt: 'x' }, ctx({}));
  assert.equal(JSON.parse(seen[0].body).model, 'elevenlabs/eleven_v4');
  assert.equal(JSON.parse(seen[1].body).model, undefined);
});

test('an account out of credits is out of balance, like any provider; a refused key says so', async () => {
  reply = () => [402, { error: 'insufficient_credits', message: 'Not enough credits.' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), (e) => e.code === 'balance');
  reply = () => [401, { message: 'Invalid key' }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v' }, ctx()), /OpenFilm did not accept your key/);
  assert.throws(() => openfilm.checkKey('sk-123'), /ofk_/);
});

test('a release restarting the service mid-run: said again through its gateway\'s 502, posted again with the same key when it forgot the run, waited for while it counts it as running', async () => {
  seen.length = 0;
  const done = [200, { files: [{ path: 'assets/video/b.mp4', base64: Buffer.from('mp4').toString('base64'), bytes: 3 }], index: [], receipt: {} }];
  const script = [
    [202, { status: 'running' }], // POST
    [502, {}], // the gateway, while the service restarts
    [404, { error: 'unknown_run' }], // the new process does not know it
    [409, { error: 'in_progress' }], // posted again: the old one still counts as running
    [202, { status: 'running' }], // posted again: run anew
    done,
  ];
  reply = () => script.shift() ?? done;
  const result = await openfilm.run('video', { prompt: 'a cat', out: 'b.mp4' }, ctx({}, 'volcengine/doubao-seedance-2-0-mini-260615'));
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'mp4');
  assert.deepEqual(seen.map((c) => c.method), ['POST', 'GET', 'GET', 'POST', 'POST', 'GET']);
  /* every post the same run, so it is never charged twice */
  assert.equal(new Set(seen.filter((c) => c.method === 'POST').map((c) => c.headers['idempotency-key'])).size, 1);
});

test('a service that stays away is said so once its patience is spent', async () => {
  const was = polling.patience;
  polling.patience = 30;
  reply = () => [502, {}];
  try { await assert.rejects(openfilm.run('video', { prompt: 'a cat', out: 'c.mp4' }, ctx({}, 'volcengine/doubao-seedance-2-0-mini-260615')), /not answering right now \(502\)/); }
  finally { polling.patience = was; }
});

test('a cut-off 200 music response is fetched again with the original key, never generated again', async () => {
  seen.length = 0; let completedReads = 0;
  const done = { files: [{ path: 'assets/audio/music/song.mp3', base64: Buffer.from('a complete track').toString('base64') }], receipt: { dur: 75 } };
  reply = call => {
    if (call.method === 'POST') return [202, { status: 'running' }];
    if (++completedReads === 1) return [200, res => {
      const body = JSON.stringify(done);
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      res.flushHeaders(); res.write(body.slice(0, 35)); setTimeout(() => res.destroy(), 10);
    }];
    return [200, done];
  };
  const result = await openfilm.run('music', { prompt: 'a song', out: 'song' }, ctx());
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'a complete track');
  const posted = seen.filter(c => c.method === 'POST');
  assert.equal(posted.length, 1, 'only the original paid generation');
  assert.equal(completedReads, 2);
  for (const call of seen.filter(c => c.method === 'GET')) assert.equal(call.url.searchParams.get('key'), posted[0].headers['idempotency-key']);
});

test('a receipt-only replay from an older server is never reported as a successful music generation', async () => {
  seen.length = 0;
  reply = () => [200, { call_id: 'original-music', files_unavailable: true, idempotent_replay: true, files: [], receipt: null, index: [] }];
  await assert.rejects(openfilm.run('music', { prompt: 'piano' }, ctx()), /already completed.*original-music.*do not start a new generation/);
  assert.equal(seen.filter(c => c.method === 'POST').length, 1);
});

test('a cut-off signed download retries only the file, without leaking the account key or generating again', async () => {
  seen.length = 0; let downloads = 0;
  const url = process.env.OPENFILM_API_URL + '/files/paid.mp3?signature=test';
  reply = call => {
    if (call.url.pathname === '/v1/media/run') return [200, { files: [{ path: 'assets/audio/music/paid.mp3', url }], receipt: { dur: 8 } }];
    assert.equal(call.headers.authorization, undefined);
    if (++downloads === 1) return [200, res => {
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': 10 });
      res.flushHeaders(); res.write(Buffer.from('aud')); setTimeout(() => res.destroy(), 10);
    }];
    return [200, Buffer.from('whole file'), 'audio/mpeg'];
  };
  const result = await openfilm.run('music', { prompt: 'piano' }, ctx());
  assert.equal(Buffer.from(result.files[0].bytes).toString(), 'whole file');
  assert.equal(downloads, 2);
  assert.equal(seen.filter(call => call.method === 'POST').length, 1);
});

test('a run the service refused is over: the same settings make a new run; one with no answer from the service keeps its key', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'openfilm-refused-')); t.after(() => rm(root, { recursive: true, force: true }));
  const keys = () => seen.filter((c) => c.method === 'POST' && c.url.pathname === '/v1/media/run').map((c) => c.headers['idempotency-key']);
  const args = { text: 'hi', voice: 'v', out: 'hello' };
  seen.length = 0;
  /* the service's own answer: no balance (refunded, nothing to recover), then a provider busy, said by the service */
  reply = () => [402, { error: 'insufficient_credits', message: 'Not enough credits.' }];
  await assert.rejects(openfilm.run('tts', args, { ...ctx(), root }), (e) => e.code === 'balance');
  reply = () => [422, { error: 'command_failed', message: 'provider busy' }];
  await assert.rejects(openfilm.run('tts', args, { ...ctx(), root }), /provider busy/);
  assert.equal(new Set(keys()).size, 2, 'topped up or retried: a new run, not the old refusal replayed');
  /* a gateway's page, not the service: the outcome is not known, so the same key is asked again next time */
  seen.length = 0;
  reply = () => [400, Buffer.from('<html>bad gateway</html>'), 'text/html'];
  await assert.rejects(openfilm.run('tts', args, { ...ctx(), root }));
  await assert.rejects(openfilm.run('tts', args, { ...ctx(), root }));
  assert.equal(new Set(keys()).size, 1, 'kept to recover');
});

test('a legacy 503 that reports a refunded media task stops polling after the first failed GET', async () => {
  seen.length = 0;
  reply = (req) => req.method === 'POST' ? [202, { status: 'running' }]
    : [503, { error: 'command_failed', message: 'provider busy', refunded: 4 }];
  await assert.rejects(openfilm.run('tts', { text: 'hi', voice: 'v', out: 'hello' }, ctx()), /provider busy/);
  const requests = seen.filter((r) => r.url.pathname === '/v1/media/run');
  assert.deepEqual(requests.map((r) => r.method), ['POST', 'GET']);
  assert.equal(requests[1].url.searchParams.get('key'), requests[0].headers['idempotency-key']);
});

test('supplier reconciliation stops polling and preserves the original request for recovery', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'openfilm-reconciliation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  seen.length = 0;
  reply = (req) => [202, { status: req.method === 'GET' ? 'reconciliation' : 'running' }];
  const args = { text: 'hi', voice: 'v', out: 'hello' };
  const context = { ...ctx(), root };
  await assert.rejects(openfilm.run('tts', args, context), /could not confirm the supplier's result/);
  await assert.rejects(openfilm.run('tts', args, context), /could not confirm the supplier's result/);
  const requests = seen.filter((r) => r.url.pathname === '/v1/media/run');
  assert.deepEqual(requests.map((r) => r.method), ['POST', 'GET', 'GET']);
  for (const req of requests.slice(1)) assert.equal(req.url.searchParams.get('key'), requests[0].headers['idempotency-key']);
});
