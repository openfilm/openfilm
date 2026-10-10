import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exampleSeconds, listExamples, readExamples } from './examples.mjs';

test('an index\'s examples: each with the address that fetches its folder, its poster from the repository', () => {
  const examples = readExamples({
    examples: [
      { folder: 'one-prompt', title: 'One Prompt', description: 'Every frame is code.', poster: 'one-prompt/look.png', duration: '1:29' },
      { folder: '../escape', title: 'No' },
      { folder: 'untitled' },
      { folder: 'abs', title: 'Abs', poster: 'https://example.com/p.png', duration: 12 },
    ],
  });
  assert.deepEqual(examples, [
    {
      id: 'one-prompt', title: 'One Prompt', description: 'Every frame is code.', duration: 89,
      poster: 'https://raw.githubusercontent.com/openfilm/examples/main/one-prompt/look.png',
      url: 'https://github.com/openfilm/examples/tree/main/one-prompt',
    },
    { id: 'abs', title: 'Abs', description: '', duration: 12, poster: 'https://example.com/p.png', url: 'https://github.com/openfilm/examples/tree/main/abs' },
  ]);
  /* another repository: named by the index, or the one it is read from */
  assert.equal(readExamples({ repo: 'https://github.com/a/b', branch: 'dev', examples: [{ folder: 'x', title: 'X' }] })[0].url, 'https://github.com/a/b/tree/dev/x');
  assert.equal(readExamples({ examples: [{ folder: 'x', title: 'X' }] }, 'https://raw.githubusercontent.com/c/d/trunk/examples.json')[0].url, 'https://github.com/c/d/tree/trunk/x');
  assert.deepEqual(readExamples(null), []);
  assert.deepEqual(readExamples({ examples: 'no' }), []);
});

test('a duration is seconds or m:ss', () => {
  assert.equal(exampleSeconds('1:29'), 89);
  assert.equal(exampleSeconds('1:02:03'), 3723);
  assert.equal(exampleSeconds(42), 42);
  assert.equal(exampleSeconds('soon'), null);
  assert.equal(exampleSeconds(-1), null);
});

test('the index from a file on this computer, or from an address; one that cannot be read is no examples', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'of-examples-')), 'examples.json');
  writeFileSync(file, JSON.stringify({ examples: [{ folder: 'one-prompt', title: 'One Prompt' }] }));
  assert.equal((await listExamples({ source: file }))[0].id, 'one-prompt');
  assert.deepEqual(await listExamples({ source: `${file}.missing` }), []);
  const offline = /** @type {typeof fetch} */ (async () => { throw new Error('offline'); });
  assert.deepEqual(await listExamples({ source: 'https://example.test/a.json', fetchImpl: offline }), []);
  const notFound = /** @type {typeof fetch} */ (async () => new Response('', { status: 404 }));
  assert.deepEqual(await listExamples({ source: 'https://example.test/b.json', fetchImpl: notFound }), []);
});
