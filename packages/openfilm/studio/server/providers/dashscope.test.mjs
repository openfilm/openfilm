import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import dashscope, { speechWindows } from './dashscope.mjs';

test('DashScope caps each upload at five minutes and overlaps the cut', () => {
  assert.deepEqual(speechWindows(300), [{ start: 0, end: 300, from: 0, to: 300 }]);
  assert.deepEqual(speechWindows(312), [
    { start: 0, end: 285, from: 0, to: 287 },
    { start: 285, end: 312, from: 283, to: 312 },
  ]);
  assert.ok(speechWindows(1200).every(({ from, to }) => to - from < 300));
});

test('DashScope offsets word timings and keeps overlap words in only one core', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'openfilm-dashscope-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const src = 'sample.mp3';
  execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
    '-t', '312', '-c:a', 'libmp3lame', '-b:a', '32k', join(dir, src)]);

  const word = (text, begin_time, end_time, punctuation = '') => ({ text, begin_time, end_time, punctuation, fixed: true });
  const result = (words, sentence_end = true) => ({ output: { text: words.map(w => w.text).join(' '),
    sentence: { sentence_id: 1, sentence_end, words } } });
  const chunks = [
    [result([word('Interim', 20, 100)], false), result([word('Before', 284620, 284950), word('After', 285210, 285580, '.')])],
    [result([word('Before', 1620, 1950), word('After', 2210, 2580, '.'), word('End', 27320, 27600, '.')])],
  ];
  const received = [];
  const server = createServer(async (req, res) => {
    const buffers = [];
    for await (const bytes of req) buffers.push(bytes);
    received.push({ path: req.url, headers: req.headers, payload: JSON.parse(Buffer.concat(buffers).toString()) });
    res.setHeader('content-type', 'text/event-stream');
    res.end(chunks.shift().map(event => `event:result\r\ndata:${JSON.stringify(event)}\r\n\r\n`).join(''));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const fetchLocal = globalThis.fetch;
  const send = t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url.hostname, 'example.cn-beijing.maas.aliyuncs.com');
    assert.equal(init.redirect, 'error');
    return fetchLocal(`http://127.0.0.1:${server.address().port}${url.pathname}`, init);
  });

  const { receipt, index } = await dashscope.run('asr', { src }, {
    root: dir, key: 'example.cn-beijing.maas.aliyuncs.com:test-token', model: 'qwen-audio-3.0-asr-flash',
    read: async path => new Uint8Array(await readFile(join(dir, path))), signal: AbortSignal.timeout(20_000), say() {},
  });
  assert.equal(send.mock.callCount(), 2);
  for (const request of received) {
    assert.equal(request.path, '/api/v1/services/aigc/multimodal-generation/generation');
    assert.equal(request.headers.authorization, 'Bearer test-token');
    assert.equal(request.payload.model, 'qwen-audio-3.0-asr-flash');
    assert.match(request.payload.input.messages[0].content[0].input_audio.data, /^data:audio\/mpeg;base64,/);
  }
  assert.equal(receipt.text, 'Before After. End.');
  assert.deepEqual(index[0].words.map(w => [w.token, Math.round(w.start * 1000), Math.round(w.end * 1000)]),
    [['Before', 284620, 284950], ['After.', 285210, 285580], ['End.', 310320, 310600]]);
});

test('DashScope rejects a lookalike host before loading speech or sending the key', async () => {
  const read = () => { throw new Error('should not read or send audio'); };
  await assert.rejects(dashscope.run('asr', { src: 'sample.mp3' }, {
    key: 'example.cn-beijing.maas.aliyuncs.com.invalid:test-token', read,
  }), /DashScope HTTPS API host/);
});


test('DashScope offers the tested timestamp models with the synchronous 3.1 model first', () => {
  assert.deepEqual(dashscope.models.asr.map(model => model.id), [
    'qwen-audio-3.1-asr-flash', 'qwen-audio-3.0-asr-flash',
    'qwen-audio-3.1-asr-flash-filetrans', 'qwen-audio-3.0-asr-flash-filetrans', 'qwen3-asr-flash-filetrans',
  ]);
});
