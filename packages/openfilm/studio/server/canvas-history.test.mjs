import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { writeCanvas } from './canvas.mjs';
import { canvasMadeRoute, readMade } from './canvas-history.mjs';

test('two writes in the same millisecond still read newest first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-made-'));
  mock.method(Date, 'now', () => 1_000);
  try {
    mkdirSync(join(root, 'assets/image'), { recursive: true });
    writeFileSync(join(root, 'assets/image/a.png'), 'a');
    writeFileSync(join(root, 'assets/image/b.png'), 'b');
    const node = { id: 'm', x: 0, y: 0, make: 'image', versions: ['assets/image/a.png'] };
    await writeCanvas(root, { nodes: [node], edges: [] });
    await writeCanvas(root, { nodes: [{ ...node, versions: ['assets/image/a.png', 'assets/image/b.png'] }], edges: [] });
    const res = { body: '', writeHead() {}, end(b) { res.body = b; } };
    const req = Object.assign(Readable.from([]), { method: 'GET' });
    await canvasMadeRoute(/** @type {any} */ (req), /** @type {any} */ (res), root, 'canvas-made', new URL('http://x/canvas-made'));
    assert.deepEqual(JSON.parse(res.body).made.map((m) => m.path), ['assets/image/b.png', 'assets/image/a.png']);
  } finally {
    mock.restoreAll();
    rmSync(root, { recursive: true, force: true });
  }
});

test("what a board's making nodes were given is noted, and stays noted when the node is gone", async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-made-'));
  try {
    mkdirSync(join(root, 'assets/image'), { recursive: true });
    writeFileSync(join(root, 'assets/image/a.png'), 'a');
    writeFileSync(join(root, 'assets/image/b.png'), 'b');
    const node = { id: 'm', x: 0, y: 0, make: 'image', prompt: 'a fox at dawn', via: 'openfilm', model: 'gpt-image', versions: ['assets/image/a.png'] };
    await writeCanvas(root, { nodes: [node], edges: [] });
    await writeCanvas(root, { nodes: [{ ...node, versions: ['assets/image/a.png', 'assets/image/b.png', 'assets/image/gone.png'] }], edges: [] });
    await writeCanvas(root, { nodes: [], edges: [] });
    const made = await readMade(root);
    assert.deepEqual(made.map((m) => [m.path, m.make, m.prompt, m.model]), [
      ['assets/image/a.png', 'image', 'a fox at dawn', 'gpt-image'],
      ['assets/image/b.png', 'image', 'a fox at dawn', 'gpt-image'],
      ['assets/image/gone.png', 'image', 'a fox at dawn', 'gpt-image'],
    ]);
    /* shown newest first, only what is still in the project */
    const res = { body: '', writeHead() {}, end(b) { res.body = b; } };
    const req = Object.assign(Readable.from([]), { method: 'GET' });
    assert.equal(await canvasMadeRoute(/** @type {any} */ (req), /** @type {any} */ (res), root, 'canvas-made', new URL('http://x/canvas-made')), true);
    assert.deepEqual(JSON.parse(res.body).made.map((m) => m.path), ['assets/image/b.png', 'assets/image/a.png']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a version made with `openfilm get` is noted with the service, model and words that made it, not the node\'s', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-made-'));
  try {
    mkdirSync(join(root, 'assets/image'), { recursive: true });
    mkdirSync(join(root, '.film'), { recursive: true });
    writeFileSync(join(root, 'assets/image/c.png'), 'c');
    writeFileSync(join(root, '.film/media-made.json'), JSON.stringify({ version: 1, made: {
      'f1-0123456789abcdef0123456789abcdef': { path: 'assets/image/c.png', verb: 'image', at: 1, via: 'openfilm', by: 'OpenFilm', model: 'gpt-image-new', args: { prompt: 'as a cartoon' }, refs: [], ask: 'a' },
    } }));
    await writeCanvas(root, { nodes: [{ id: 'm', x: 0, y: 0, make: 'image', prompt: '', via: 'openfilm', model: 'gpt-image-old', versions: ['assets/image/c.png'] }], edges: [] });
    const [made] = await readMade(root);
    assert.deepEqual([made.via, made.model, made.prompt], ['openfilm', 'gpt-image-new', 'as a cartoon']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
