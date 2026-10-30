import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CANVAS_FILE, parseCanvas, readCanvas, writeCanvas } from './canvas.mjs';

test('a canvas keeps notes and project files as nodes, and edges between nodes it has', () => {
  assert.deepEqual(parseCanvas({
    nodes: [
      { id: 'a', x: 10.4, y: -20.6, w: 300, text: 'Opening: the city wakes' },
      { id: 'b', x: 400, y: 0, w: 5, path: 'assets/dawn.mp4' },
      { id: 'a', x: 0, y: 0, text: 'same id again' },
      { id: 'c', x: 0, y: 0, path: '../outside.png' },
      { id: 'd', x: 0, y: 0, path: '.film/canvas.json' },
      { id: 'e', x: Infinity, y: 0, text: 'nowhere' },
      { id: 'f', x: 0, y: 0 },
      null,
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b' },
      { id: 'e2', from: 'a', to: 'b' },
      { id: 'e3', from: 'b', to: 'b' },
      { id: 'e4', from: 'a', to: 'c' },
    ],
  }), {
    nodes: [
      { id: 'a', x: 10, y: -21, w: 300, text: 'Opening: the city wakes' },
      { id: 'b', x: 400, y: 0, w: 40, path: 'assets/dawn.mp4' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b' }],
  });
  assert.deepEqual(parseCanvas([]), { nodes: [], edges: [] });
});

test('a group has a name and a color of the board\'s; a node is in a group only when that group is there', () => {
  assert.deepEqual(parseCanvas({
    nodes: [
      { id: 'g', x: 0, y: 0, w: 600, h: 400, group: ' Opening ', color: 'blue' },
      { id: 'h', x: 0, y: 500, group: 'Ending', color: 'mauve', parent: 'g' },
      { id: 'a', x: 20, y: 40, text: 'in it', parent: 'g' },
      { id: 'b', x: 20, y: 40, path: 'assets/a.mp4', parent: 'gone' },
      { id: 'c', x: 20, y: 40, text: 'in a note', parent: 'a' },
    ],
    edges: [],
  }).nodes, [
    { id: 'g', x: 0, y: 0, w: 600, h: 400, group: 'Opening', color: 'blue' },
    { id: 'h', x: 0, y: 500, group: 'Ending', color: 'gray' },
    { id: 'a', x: 20, y: 40, parent: 'g', text: 'in it' },
    { id: 'b', x: 20, y: 40, path: 'assets/a.mp4' },
    { id: 'c', x: 20, y: 40, text: 'in a note' },
  ]);
});

test('a project keeps its canvas in .film/canvas.json, outside film.html', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-canvas-'));
  try {
    assert.deepEqual(await readCanvas(root), { nodes: [], edges: [] }, 'none yet');
    const kept = await writeCanvas(root, { nodes: [{ id: 'n', x: 1, y: 2, text: 'hi' }], edges: [] });
    assert.deepEqual(kept, { nodes: [{ id: 'n', x: 1, y: 2, text: 'hi' }], edges: [] });
    assert.deepEqual(JSON.parse(readFileSync(join(root, CANVAS_FILE), 'utf8')), kept);
    assert.deepEqual(await readCanvas(root), kept);
    await assert.rejects(writeCanvas(root, 'nope'), /canvas: \{ nodes/);
    /* a file written wrong reads as an empty board */
    mkdirSync(join(root, '.film'), { recursive: true });
    writeFileSync(join(root, CANVAS_FILE), '{ not json');
    assert.deepEqual(await readCanvas(root), { nodes: [], edges: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a making node keeps what it made in the project, the one shown among them; an edge its place', () => {
  const kept = parseCanvas({
    nodes: [
      { id: 'm', x: 0, y: 0, make: 'video', prompt: 'dawn', model: 'seedance', opts: { sec: 6, frames: true, x: 1 },
        versions: ['assets/video/a.mp4', '../out.mp4', 'assets/video/b.mp4'], path: 'assets/video/a.mp4', by: { agent: 'codex' } },
      { id: 'n', x: 0, y: 0, text: 'cold' },
      { id: 'q', x: 0, y: 0, make: 'hologram', path: 'assets/a.png' },
    ],
    edges: [{ id: 'e', from: 'n', to: 'm', order: 2 }, { id: 'f', from: 'q', to: 'm', order: -1 }],
  });
  assert.deepEqual(kept.nodes[0], { id: 'm', x: 0, y: 0, make: 'video', prompt: 'dawn', model: 'seedance', opts: { sec: 6, frames: true },
    versions: ['assets/video/a.mp4', 'assets/video/b.mp4'], path: 'assets/video/a.mp4', by: { agent: 'codex' } });
  assert.deepEqual(kept.nodes[2], { id: 'q', x: 0, y: 0, path: 'assets/a.png' }, 'not a kind it can make: a file');
  assert.deepEqual(kept.edges, [{ id: 'e', from: 'n', to: 'm', order: 2 }, { id: 'f', from: 'q', to: 'm' }]);
});
