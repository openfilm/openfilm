// @ts-check
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { addSteps } from './add.mjs';

const project = () => {
  const root = mkdtempSync(join(tmpdir(), 'canvas-add-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'a.png'), 'a');
  writeFileSync(join(root, 'assets', 'b.mp4'), 'b');
  return root;
};

test('files go in a row below what is on the board, in the order named', async () => {
  const root = project();
  const canvas = { nodes: [{ id: 'n1', x: 100, y: 50, text: 'hello' }], edges: [] };
  const steps = await addSteps(canvas, root, ['assets/a.png', 'assets/b.mp4']);
  assert.deepEqual(steps.map((s) => s.path), ['assets/a.png', 'assets/b.mp4']);
  assert.equal(steps[0].x, 100);
  assert.ok(steps[0].y > 50);
  assert.equal(steps[1].y, steps[0].y);
  assert.equal(steps[1].x, steps[0].x + 622 + 24);
});

test('an empty board starts at the origin; paths are read from the folder it was run in', async () => {
  const root = project();
  const steps = await addSteps({ nodes: [], edges: [] }, root, ['a.png'], { cwd: join(root, 'assets') });
  assert.deepEqual(steps, [{ op: 'add', kind: 'file', path: 'assets/a.png', x: 0, y: 0 }]);
});

test('a file out of the project, one that is not there, or none named is refused', async () => {
  const root = project();
  const empty = { nodes: [], edges: [] };
  await assert.rejects(addSteps(empty, root, []), /Name the files/);
  await assert.rejects(addSteps(empty, root, ['assets/none.png']), /no such file/);
  await assert.rejects(addSteps(empty, root, ['../x.png']), /not in this project/);
});
