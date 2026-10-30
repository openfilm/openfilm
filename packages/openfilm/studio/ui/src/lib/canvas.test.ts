import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canvasId, canvasKey, copyOf, emptyHistory, readCanvasDoc, redo, remember, undo } from './canvas.ts';

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

test('a group is read with its color, a node with its group', () => {
  assert.deepEqual(readCanvasDoc({ nodes: [
    { id: 'g', x: 0, y: 0, w: 400, h: 300, group: 'Opening', color: 'teal' },
    { id: 'a', x: 10, y: 20, text: 'in it', parent: 'g' },
  ], edges: [] }).nodes, [
    { id: 'g', x: 0, y: 0, w: 400, h: 300, group: 'Opening', color: 'gray' },
    { id: 'a', x: 10, y: 20, parent: 'g', text: 'in it' },
  ]);
});

test('undo goes back to the board before each change, redo forward again; a new change ends the redos', () => {
  const a = { nodes: [], edges: [] };
  const b = { nodes: [{ id: 'n', x: 0, y: 0, text: '' }], edges: [] };
  const c = { nodes: [{ id: 'n', x: 5, y: 0, text: '' }], edges: [] };
  let h = remember(emptyHistory(), a);
  h = remember(h, b);
  assert.equal(remember(h, b).past.length, 2, 'the same board twice is one step');
  const back = undo(h, c)!;
  assert.deepEqual(back.doc, b);
  const back2 = undo(back.history, back.doc)!;
  assert.deepEqual(back2.doc, a);
  assert.equal(undo(back2.history, back2.doc), null);
  const fwd = redo(back2.history, back2.doc)!;
  assert.deepEqual(fwd.doc, b);
  assert.deepEqual(redo(fwd.history, fwd.doc)!.doc, c);
  assert.deepEqual(remember(fwd.history, b).future, []);
});

test('a copy is new nodes with their edges between them, a group with what is in it', () => {
  const doc = {
    nodes: [
      { id: 'g', x: 0, y: 0, w: 400, h: 300, group: 'G', color: 'blue' as const },
      { id: 'a', x: 10, y: 20, text: 'a', parent: 'g' },
      { id: 'b', x: 500, y: 0, path: 'assets/b.mp4' },
      { id: 'c', x: 900, y: 0, text: 'c' },
    ],
    edges: [{ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'b', to: 'c' }],
  };
  const copy = copyOf(doc, new Set(['g', 'b']), { x: 40, y: 40 });
  assert.equal(copy.nodes.length, 3);
  const [g, a, b] = copy.nodes;
  assert.deepEqual({ x: g!.x, y: g!.y, group: g!.group }, { x: 40, y: 40, group: 'G' });
  assert.deepEqual({ x: a!.x, y: a!.y, parent: a!.parent }, { x: 10, y: 20, parent: g!.id }, 'in its copied group, where it was');
  assert.deepEqual({ x: b!.x, path: b!.path }, { x: 540, path: 'assets/b.mp4' });
  assert.ok(copy.nodes.every((n) => !['g', 'a', 'b'].includes(n.id)));
  assert.deepEqual(copy.edges.map((e) => [e.from, e.to]), [[a!.id, b!.id]], 'only the edges between copies');
});
