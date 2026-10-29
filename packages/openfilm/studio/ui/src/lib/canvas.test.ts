import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasId, canvasKey, readCanvasDoc } from './canvas.ts';

test('a board as sent is read node by node: notes and files, and edges between nodes it has', () => {
  assert.deepEqual(readCanvasDoc({
    nodes: [
      { id: 'a', x: 1, y: 2, w: 240, h: 140, text: 'Open on the city' },
      { id: 'b', x: 300, y: 0, path: 'assets/dawn.mp4' },
      { id: 'b', x: 0, y: 0, text: 'twice' },
      { id: 'c', x: 'far', y: 0, text: 'nowhere' },
      { id: 'd', x: 0, y: 0 },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'a', to: 'gone' }, null],
  }), {
    nodes: [{ id: 'a', x: 1, y: 2, w: 240, h: 140, text: 'Open on the city' }, { id: 'b', x: 300, y: 0, path: 'assets/dawn.mp4' }],
    edges: [{ id: 'e1', from: 'a', to: 'b' }],
  });
  assert.deepEqual(readCanvasDoc(null), { nodes: [], edges: [] });
});

test('two boards that say the same have one key; ids are new each time', () => {
  const doc = { nodes: [{ id: 'a', x: 0, y: 0, text: '' }], edges: [] };
  assert.equal(canvasKey(doc), canvasKey(structuredClone(doc)));
  assert.notEqual(canvasKey(doc), canvasKey({ ...doc, nodes: [{ ...doc.nodes[0]!, x: 1 }] }));
  assert.notEqual(canvasId('n'), canvasId('n'));
  assert.match(canvasId('e'), /^e/);
});
