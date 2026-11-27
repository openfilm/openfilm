import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import dashscope from './dashscope.mjs';

const task = '12345678-1234-4000-8000-123456789abc';
const workspace = 'example.cn-beijing.maas.aliyuncs.com';
const upload = 'dashscope-file-test.oss-cn-beijing.aliyuncs.com';
const result = 'dashscope-result-test.oss-cn-beijing.aliyuncs.com';

test('Filetrans keeps the API key on DashScope, uploads privately, and reads the signed result over HTTPS', async (t) => {
  const seen = [];
  const server = createServer(async (req, res) => {
    const data = [];
    for await (const bytes of req) data.push(bytes);
    seen.push({ path: req.url, headers: req.headers, data: Buffer.concat(data).toString() });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/api/v1/uploads?')) {
      res.end(JSON.stringify({ data: {
        upload_host: 'https://' + upload, upload_dir: 'dashscope-instant/example',
        oss_access_key_id: 'fixture-id', signature: 'fixture-signature', policy: 'fixture-policy',
        x_oss_object_acl: 'private', max_file_size_mb: 10,
      } }));
    } else if (req.url === '/oss-upload') {
      res.end('{}');
    } else if (req.url === '/api/v1/services/audio/asr/transcription') {
      res.end(JSON.stringify({ output: { task_id: task } }));
    } else if (req.url === '/api/v1/tasks/' + task) {
      res.end(JSON.stringify({ output: { task_status: 'SUCCEEDED',
        result: { transcription_url: 'http://' + result + '/output.json?Signature=fixture' } } }));
    } else {
      res.end(JSON.stringify({ properties: { original_duration_in_milliseconds: 4000 }, transcripts: [{text: 'Timed speech.',
        sentences: [{ words: [{ text: 'Timed', begin_time: 100, end_time: 700 },
          { text: 'speech', punctuation: '.', begin_time: 700, end_time: 1500 }] }] }] }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const fetchLocal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (url, init) => {
    assert.equal(url.protocol, 'https:');
    assert.equal(init.redirect, 'error');
    if (url.hostname !== workspace) {
      assert.ok([upload, result].includes(url.hostname));
      assert.equal(init.headers, undefined);
    }
    const path = url.hostname === upload ? '/oss-upload' : url.pathname + url.search;
    return fetchLocal(`http://127.0.0.1:${server.address().port}${path}`, init);
  });

  const checkpoints = [];
  const ctx = {
    key: workspace + ':test-token', model: 'qwen3-asr-flash-filetrans', root: '',
    read: async () => new Uint8Array([1, 2, 3]), signal: AbortSignal.timeout(10000), say() {},
    checkpoint: async job => checkpoints.push(job),
  };
  const { receipt, index } = await dashscope.run('asr', { src: 'sample.mp3' }, ctx);
  assert.deepEqual(index[0].words, [{ token: 'Timed', start: 0.1, end: 0.7 }, { token: 'speech.', start: 0.7, end: 1.5 }]);
  assert.equal(receipt.dur, 4);
  assert.equal(seen[0].headers.authorization, 'Bearer test-token');
  assert.equal(seen[1].headers.authorization, undefined);
  assert.match(seen[1].data, /name="x-oss-object-acl"\r\n\r\nprivate/);
  assert.equal(seen[2].headers['x-dashscope-ossresourceresolve'], 'enable');
  const submitted = JSON.parse(seen[2].data);
  assert.match(submitted.input.file_url, /^oss:\/\/dashscope-instant\/example\/openfilm-/);
  assert.equal(submitted.parameters.enable_words, true);
  assert.equal(seen.at(-1).headers.authorization, undefined);

  const before = seen.length;
  await dashscope.run('asr', { src: 'sample.mp3' }, { ...ctx, resume: checkpoints[0], read: async () => { throw Error('unexpected upload on resume'); } });
  assert.deepEqual(seen.slice(before).map(req => req.path), ['/api/v1/tasks/' + task, '/output.json?Signature=fixture']);
});
