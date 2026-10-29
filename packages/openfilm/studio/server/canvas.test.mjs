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
