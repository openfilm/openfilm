import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyBoardInto, listTemplates, saveTemplate, templateBoard, useTemplate } from './canvas-templates.mjs';

test('a template keeps a part of the board from 0, 0, without what it made or who put it there', () => {
  const kept = templateBoard({
    nodes: [
      { id: 'g', x: 100, y: 50, w: 600, h: 400, group: 'Beat', color: 'blue', by: { agent: 'codex' } },
      { id: 'n', x: 20, y: 30, text: 'dawn', parent: 'g' },
      { id: 'm', x: 300, y: 30, make: 'image', prompt: 'a lighthouse', versions: ['assets/a.png'], path: 'assets/a.png', made: 'k', parent: 'g' },
    ],
    edges: [{ id: 'e', from: 'n', to: 'm', order: 0 }],
  });
  assert.deepEqual(kept.nodes, [
    { id: 'g', x: 0, y: 0, w: 600, h: 400, group: 'Beat', color: 'blue' },
    { id: 'n', x: 20, y: 30, parent: 'g', text: 'dawn' },
    { id: 'm', x: 300, y: 30, parent: 'g', prompt: 'a lighthouse', make: 'image' },
  ]);
  assert.deepEqual(kept.edges, [{ id: 'e', from: 'n', to: 'm', order: 0 }]);
});

test('a template is kept with its files, and laid down in another project with copies of them', async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-canvas-templates-'));
  const before = process.env.OPENFILM_SHARED_HOME;
  process.env.OPENFILM_SHARED_HOME = join(scratch, 'home');
  t.after(() => { if (before === undefined) delete process.env.OPENFILM_SHARED_HOME; else process.env.OPENFILM_SHARED_HOME = before; rmSync(scratch, { recursive: true, force: true }); });
  const one = join(scratch, 'one');
  const two = join(scratch, 'two');
  mkdirSync(join(one, 'assets'), { recursive: true });
  mkdirSync(join(two, 'assets', 'templates', 'storyboard'), { recursive: true });
  writeFileSync(join(one, 'assets', 'ref.png'), 'picture');
  writeFileSync(join(two, 'assets', 'templates', 'storyboard', 'ref.png'), 'someone else');
  const saved = await saveTemplate(one, ' Storyboard ', {
    nodes: [{ id: 'f', x: 0, y: 0, path: 'assets/ref.png' }, { id: 'gone', x: 0, y: 0, path: 'assets/none.png' }, { id: 'm', x: 400, y: 0, make: 'video', prompt: 'push in' }],
    edges: [{ id: 'e1', from: 'f', to: 'm' }, { id: 'e2', from: 'gone', to: 'm' }],
  });
  assert.equal(saved.name, 'Storyboard');
  assert.equal(saved.nodes, 2, 'a file not there is left out');
  assert.deepEqual((await listTemplates()).map((x) => x.id), [saved.id]);
  const laid = await useTemplate(two, saved.id);
  assert.deepEqual(laid.nodes[0], { id: 'f', x: 0, y: 0, path: 'assets/templates/storyboard/ref-2.png' }, 'beside the file already there, not over it');
  assert.equal(readFileSync(join(two, 'assets', 'templates', 'storyboard', 'ref-2.png'), 'utf8'), 'picture');
  assert.equal(readFileSync(join(two, 'assets', 'templates', 'storyboard', 'ref.png'), 'utf8'), 'someone else');
  assert.deepEqual(laid.edges, [{ id: 'e1', from: 'f', to: 'm' }]);
  await assert.rejects(useTemplate(two, '../escape'), /no such template/);
  await assert.rejects(saveTemplate(one, '  ', { nodes: [{ id: 'a', x: 0, y: 0, text: '' }], edges: [] }), /has a name/);
});

test("an example's board laid down here: what it made comes too, a file it lacks does not", async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'of-board-into-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const from = join(scratch, 'example');
  const root = join(scratch, 'mine');
  mkdirSync(join(from, 'assets', 'image'), { recursive: true });
  mkdirSync(root);
  writeFileSync(join(from, 'assets', 'image', 'a.png'), 'a');
  writeFileSync(join(from, 'assets', 'image', 'b.png'), 'b');
  writeFileSync(join(from, 'intro.html'), '<p>a page needs its own files</p>');
  const laid = await copyBoardInto(root, from, {
    nodes: [
      { id: 'm', x: 0, y: 0, make: 'image', prompt: 'dawn', versions: ['assets/image/a.png', 'assets/image/gone.png', 'assets/image/b.png'], path: 'assets/image/a.png', made: 'k' },
      { id: 'f', x: 0, y: 0, path: 'assets/image/gone.png' },
      { id: 'page', x: 0, y: 0, path: 'intro.html' },
      { id: 'n', x: 0, y: 0, text: 'beat' },
    ],
    edges: [{ id: 'e1', from: 'n', to: 'm' }, { id: 'e2', from: 'f', to: 'm' }],
  }, 'assets/examples/dawn');
  assert.deepEqual(laid.nodes.map((n) => n.id), ['m', 'n']);
  assert.deepEqual(/** @type {any} */ (laid.nodes[0]).versions, ['assets/examples/dawn/a.png', 'assets/examples/dawn/b.png']);
  assert.equal(/** @type {any} */ (laid.nodes[0]).path, 'assets/examples/dawn/a.png', 'the one it showed, shown');
  assert.equal(readFileSync(join(root, 'assets', 'examples', 'dawn', 'b.png'), 'utf8'), 'b');
  assert.deepEqual(laid.edges, [{ id: 'e1', from: 'n', to: 'm' }]);
});
