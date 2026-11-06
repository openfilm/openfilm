import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { writeCanvas } from './canvas.mjs';
import { canvasMadeRoute, readMade } from './canvas-history.mjs';

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
