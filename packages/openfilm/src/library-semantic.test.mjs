import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* the Services settings of the tests' own (Library search on, as it is by default) */
process.env.OPENFILM_HOME = mkdtempSync(join(tmpdir(), 'semantic-home-'));

/* OpenFilm's service: the things it finds for a search, as `found` says, each request kept */
/** @type {{ text: string, cat: string, limit: number }[]} */
const asked = [];
let answer = (/** @type {{ cat: string }} */ _q) => ({ status: 200, body: { found: [['sounds/a', 0.9], ['sounds/c', 0.7]] } });
const service = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.method !== 'POST' || req.url !== '/v1/library/search') { res.writeHead(404); res.end(); return; }
    const q = JSON.parse(body);
    asked.push(q);
    const { status, body: out } = answer(q);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
before(async () => {
  await new Promise((done) => service.listen(0, '127.0.0.1', () => done(undefined)));
  process.env.OPENFILM_API_URL = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (service.address()).port}`;
});
after(() => service.close());

const { nearest, passageOf } = await import('./library-semantic.mjs');
const { packVocabulary, readPacked, readVocabulary, tokenize } = await import('./sentence-model.mjs');

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

test('a search goes to the service as its words and the category alone, once; what it finds comes back as it ranked it', async () => {
  asked.length = 0;
  assert.deepEqual(await nearest('a bright bell', 'sound', 20), [['sounds/a', 0.9], ['sounds/c', 0.7]]);
  assert.deepEqual(asked, [{ text: 'a bright bell', cat: 'sound', limit: 20 }]);
  await nearest('a bright bell', 'sound', 20);
  assert.equal(asked.length, 1, 'asked again: what it said');
  await nearest('a bright bell', 'music', 20);
  assert.equal(asked.length, 2, 'another category is another search');
});

test('Library search turned off in Settings → Services: nothing is asked, words alone', async () => {
  writeFileSync(join(/** @type {string} */ (process.env.OPENFILM_HOME), 'providers.json'), JSON.stringify({ libraryOff: true }), { mode: 0o600 });
  asked.length = 0;
  assert.equal(await nearest('a quiet bell', 'sound'), null);
  assert.equal(asked.length, 0);
  writeFileSync(join(/** @type {string} */ (process.env.OPENFILM_HOME), 'providers.json'), JSON.stringify({ libraryOff: false }), { mode: 0o600 });
  assert.ok(await nearest('a quiet bell', 'sound'));
  assert.equal(asked.length, 1, 'on again: asked');
});

test('a service that is down, says no, or answers something else: the keyword search alone', async () => {
  answer = () => ({ status: 503, body: {} });
  assert.equal(await nearest('a dull thud', 'sound'), null);
  answer = () => ({ status: 200, body: { found: [['sounds/a', 'near']] } });
  assert.equal(await nearest('a soft thud', 'sound'), null);
  process.env.OPENFILM_API_URL = 'http://127.0.0.1:9';
  assert.equal(await nearest('a far thud', 'sound'), null, 'unreachable');
});
