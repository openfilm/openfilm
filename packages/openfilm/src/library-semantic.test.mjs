import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* the library's host: a folder served as openfilm.dev/library serves the published parts */
const host = mkdtempSync(join(tmpdir(), 'semantic-host-'));
const put = (rel, body) => { mkdirSync(join(host, rel, '..'), { recursive: true }); writeFileSync(join(host, rel), body); };
const server = createServer((req, res) => {
  try { res.end(readFileSync(join(host, decodeURIComponent(req.url ?? '').replace(/^\/library\//, '')))); } catch { res.writeHead(404); res.end(); }
});
const sha = (body) => createHash('sha256').update(body).digest('hex');
/** A package's library holding models.json for `files` (path → body) as published. */
function packageWith(files, model = 'tiny') {
  const root = mkdtempSync(join(tmpdir(), 'semantic-package-'));
  writeFileSync(join(root, 'models.json'), JSON.stringify({ version: 1, model, dims: 4, onnx: Object.keys(files)[0], tokenizer: Object.keys(files)[0], runtime: Object.keys(files)[0],
    files: Object.entries(files).map(([path, body]) => ({ path, bytes: body.length, sha256: sha(body) })) }));
  return root;
}

before(async () => {
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  process.env.OPENFILM_LIBRARY_URL = `http://127.0.0.1:${address.port}/library`;
});
after(() => server.close());

const { fetchModel, packVocabulary, passageOf, readPacked, readVocabulary, semanticReady, semanticState, tokenize } = await import('./library-semantic.mjs');

test('a text is cut into the vocabulary\'s pieces whose scores add up highest, between <s> and </s>', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'semantic-vocab-')), 'tokenizer.json');
  const vocab = [['<s>', 0], ['<pad>', 0], ['</s>', 0], ['<unk>', 0], ['▁', -3], ['▁cal', -6], ['m', -4], ['▁calm', -5], ['▁pi', -6], ['ano', -6], ['▁piano', -7], ['p', -9], ['i', -9], ['a', -9], ['n', -9], ['o', -9], ['▁p', -8], ['c', -9], ['l', -9], ['钢琴', -6], ['▁钢', -7]];
  writeFileSync(file, JSON.stringify({ model: { vocab } }));
  const v = readVocabulary(file);
  const id = (piece) => vocab.findIndex(([p]) => p === piece);
  assert.deepEqual(tokenize(v, 'calm piano'), [0, id('▁calm'), id('▁piano'), 2], 'whole words beat their parts');
  assert.deepEqual(tokenize(v, '  calm\tpiano  '), [0, id('▁calm'), id('▁piano'), 2], 'spaces as one');
  assert.deepEqual(tokenize(v, 'ｃａｌｍ'), [0, id('▁calm'), 2], 'NFKC: full-width letters are letters');
  assert.deepEqual(tokenize(v, 'calmx'), [0, id('▁calm'), 3, 2], 'a character no piece has is <unk>');
  assert.deepEqual(tokenize(v, '钢琴'), [0, id('▁'), id('钢琴'), 2]);
  assert.equal(tokenize(v, 'calm '.repeat(600)).length, 512, 'at most 512');
  /* packed, it finds every piece the JSON does, and nothing else */
  const packed = readPacked(packVocabulary(file));
  for (const [piece] of [...vocab, ['ca'], ['▁calmer'], ['钢'], ['']]) assert.equal(packed.id(piece), v.id(piece), piece);
  assert.deepEqual([packed.longest, packed.unknown, [...packed.scores]], [v.longest, Math.fround(v.unknown), [...v.scores]]);
  for (const text of ['calm piano', 'calmx 钢琴', 'ｃａｌｍ']) assert.deepEqual(tokenize(packed, text), tokenize(v, text));
});

test('what a thing is, in the words of its vector: names, about, group, tags in English and Chinese, energy, tempo', () => {
  const vocab = { byId: new Map([['calm', { name: { en: 'Calm', 'zh-CN': '平静' } }], ['piano', { name: { en: 'Piano', 'zh-CN': '钢琴' } }]]) };
  const passage = passageOf({ cat: 'music', group: 'calm', name: { en: 'Quiet morning piano', 'zh-CN': '清晨安静钢琴' }, tags: ['calm', 'piano', 'gone'], energy: 1, bpm: 72 },
    vocab, { name: { en: 'Calm' } });
  assert.equal(passage, 'passage: music: Quiet morning piano (清晨安静钢琴). Calm. Calm, Piano. 平静，钢琴. very calm, 72 bpm');
});

test('the model is fetched once, every file checked against models.json, and ready only when all are', async () => {
  const files = { 'models/tiny/model.onnx': 'model bytes', 'models/tiny/tokenizer.json': '{"model":{"vocab":[]}}' };
  for (const [path, body] of Object.entries(files)) put(path, body);
  process.env.OPENFILM_BUILT_IN_LIBRARY = packageWith(files);
  process.env.OPENFILM_LIBRARY_CACHE = mkdtempSync(join(tmpdir(), 'semantic-cache-'));
  assert.equal(semanticReady(), false);
  let started = 0;
  assert.equal(semanticState({ start: () => { started++; } }), 'fetching', 'the first search starts the fetch');
  assert.equal(started, 1);
  assert.equal(await fetchModel(), true);
  assert.equal(semanticReady(), true);
  assert.equal(semanticState({ start: () => { started++; } }), 'ready');
  assert.equal(started, 1, 'nothing more to fetch');
});

test('a file that does not check is thrown away; the model is off, said nothing of, and tried again an hour later', async () => {
  put('models/bad/model.onnx', 'not the model');
  process.env.OPENFILM_BUILT_IN_LIBRARY = packageWith({ 'models/bad/model.onnx': 'the model' }, 'bad');
  process.env.OPENFILM_LIBRARY_CACHE = mkdtempSync(join(tmpdir(), 'semantic-cache-'));
  assert.equal(await fetchModel(), false);
  assert.equal(existsSync(join(process.env.OPENFILM_LIBRARY_CACHE, 'models/bad/model.onnx')), false);
  assert.equal(semanticReady(), false);
  let started = 0;
  assert.equal(semanticState({ start: () => { started++; } }), 'off');
  assert.equal(started, 0);
  /* an hour on */
  const state = join(process.env.OPENFILM_LIBRARY_CACHE, 'models/bad.json');
  writeFileSync(state, JSON.stringify({ failed: Date.now() - 61 * 60_000 }));
  assert.equal(semanticState({ start: () => { started++; } }), 'fetching');
  assert.equal(started, 1);
  /* a fetch running now is not begun again */
  writeFileSync(state, JSON.stringify({ pid: process.pid, at: Date.now() }));
  assert.equal(semanticState({ start: () => { started++; } }), 'fetching');
  assert.equal(started, 1);
  /* offline: no host at all */
  process.env.OPENFILM_LIBRARY_URL = 'http://127.0.0.1:9/library';
  assert.equal(await fetchModel(), false);
});

test('no models.json: no semantic search, and nothing fetched', () => {
  process.env.OPENFILM_BUILT_IN_LIBRARY = mkdtempSync(join(tmpdir(), 'semantic-package-'));
  let started = 0;
  assert.equal(semanticState({ start: () => { started++; } }), 'off');
  assert.equal(started, 0);
});
