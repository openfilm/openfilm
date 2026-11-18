import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAsks, getRoute, runGet } from '../get.mjs';
import { openProject } from '../projects.mjs';

const KEY = 'test-zhipu-key';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const GENERATE = '/api/paas/v4/images/generations';
const PROMPT = '水彩风格的山间小屋';
const requests = [];
let server, origin, root, response, image;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'openfilm-zhipu-'));
  process.env.OPENFILM_HOME = join(root, 'home');
  process.env.OPENFILM_SHARED_HOME = join(root, 'shared');
  process.env.ZHIPU_API_KEY = KEY;
  await openProject(root);
  const asks = createAsks({ roots: () => [], emit: () => {} });
  server = createServer(async (req, res) => {
    if (req.url === '/api/get') return getRoute(req, res, [], asks);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === GENERATE) {
      const [status, body] = response;
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    } else if (req.url === '/result') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(image);
    } else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = process.env.OPENFILM_ZHIPU_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

const make = (out, args = {}) => runGet(root, 'image', { out, prompt: PROMPT, ...args }, { via: 'zhipu' });
const makeInStudio = async (out, args = {}) => (await fetch(`${origin}/api/get`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ folder: root, verb: 'image', via: 'zhipu', args: { out, prompt: PROMPT, ...args } }),
})).json();

test('GLM-Image uses the BigModel request and saves the downloaded image in the project', async () => {
  response = [200, { data: [{ url: `${origin}/result` }] }];
  image = PNG;
  const receipt = JSON.parse(await make('cabin', { ratio: '9:16', quality: 'high' }));
  const [post, get] = requests.slice(-2);
  assert.equal(post.method, 'POST');
  assert.equal(post.path, GENERATE);
  assert.equal(post.headers.authorization, `Bearer ${KEY}`);
  assert.equal(post.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(post.body), { model: 'glm-image', prompt: PROMPT, size: '960x1728', quality: 'hd' });
  assert.equal(get.method, 'GET');
  assert.equal(get.path, '/result');
  assert.equal(get.headers.authorization, undefined);
  assert.equal(receipt.provider, 'zhipu');
  assert.equal(receipt.model, 'glm-image');
  assert.deepEqual(receipt.images, [{ src: 'assets/image/cabin.png', width: 1, height: 1, alpha: true }]);
  assert.deepEqual(await readFile(join(root, receipt.images[0].src)), PNG);
});

test('unsupported image input is refused before spending a request', async () => {
  const seen = requests.length;
  await assert.rejects(make('panorama', { ratio: '21:9' }), /--ratio is one of .* with GLM-Image/);
  await assert.rejects(make('animation', { format: 'gif' }), /GLM-Image makes still pictures/);
  const long = await makeInStudio('long', { prompt: '图'.repeat(1001) });
  assert.equal(long.ok, false);
  assert.equal(long.reason, 'prompt-too-long');
  assert.match(long.text, /up to 1000 characters/);
  assert.equal(requests.length, seen);
});

test('an empty image response or a non-image download leaves no asset', async () => {
  response = [200, { data: [] }];
  const empty = await makeInStudio('empty');
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'invalid-picture');
  assert.match(empty.text, /Zhipu AI answered without a valid picture URL/);
  await assert.rejects(readFile(join(root, 'assets/image/empty.png')), { code: 'ENOENT' });
  response = [200, { data: [{ url: `${origin}/result` }] }];
  image = Buffer.from('<html>download expired</html>');
  const broken = await makeInStudio('broken');
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, 'invalid-picture');
  assert.match(broken.text, /did not return a PNG, JPEG, or WebP picture/);
  await assert.rejects(readFile(join(root, 'assets/image/broken.png')), { code: 'ENOENT' });
});

test('authentication, balance, and rate limits use the usual Studio messages', async () => {
  response = [401, { error: { code: '1000', message: `Invalid key ${KEY}` } }];
  await assert.rejects(make('unauthorized'), /Zhipu AI did not accept your key/);
  response = [429, { error: { code: '1113', message: '账户已欠费' } }];
  await assert.rejects(make('balance'), { reason: 'balance', message: /Zhipu AI doesn't have enough balance/ });
  response = [429, { error: { code: '1302', message: 'Rate limited' } }];
  await assert.rejects(make('rate'), /Zhipu AI answered 429: Rate limited/);
});
