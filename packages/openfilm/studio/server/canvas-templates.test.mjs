import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTemplates, saveTemplate, templateBoard, useTemplate } from './canvas-templates.mjs';

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
