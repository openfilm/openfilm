import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasId, canvasKey, copyOf, emptyHistory, inputsKey, inputsOf, isStale, makeName, makeRequest, nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
} from './canvas.ts';

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

test('a making node is read with what it made; the one shown is one of them, the last when it names none', () => {
  const [n] = readCanvasDoc({ nodes: [{ id: 'm', x: 0, y: 0, make: 'video', prompt: 'dawn', opts: { sec: 6, frames: true, odd: 1 },
    versions: ['assets/video/a.mp4', 'assets/video/b.mp4', 3], path: 'assets/video/elsewhere.mp4', made: 'k', by: { agent: 'codex', session: 's1' } }], edges: [] }).nodes;
  assert.deepEqual(n, { id: 'm', x: 0, y: 0, make: 'video', prompt: 'dawn', opts: { sec: 6, frames: true },
    versions: ['assets/video/a.mp4', 'assets/video/b.mp4'], path: 'assets/video/b.mp4', made: 'k', by: { agent: 'codex', session: 's1' } });
  assert.deepEqual(readCanvasDoc({ nodes: [{ id: 'm', x: 0, y: 0, make: 'hologram' }], edges: [] }).nodes, []);
});

test('what is wired into a node comes in its edges\' order; words and pictures, what a node made too', () => {
  const doc = {
    nodes: [
      { id: 'n1', x: 0, y: 0, text: 'cold blue dawn' },
      { id: 'n2', x: 0, y: 0, text: '  ' },
      { id: 'f1', x: 0, y: 0, path: 'assets/a.png' },
      { id: 'f2', x: 0, y: 0, path: 'assets/x.zip' },
      { id: 'm1', x: 0, y: 0, make: 'image' as const, versions: ['assets/image/b.png'], path: 'assets/image/b.png' },
      { id: 'v', x: 0, y: 0, make: 'video' as const, prompt: 'a slow push in' },
    ],
    edges: [
      { id: 'e1', from: 'f1', to: 'v', order: 1 }, { id: 'e2', from: 'n1', to: 'v', order: 0 }, { id: 'e3', from: 'm1', to: 'v' },
      { id: 'e4', from: 'n2', to: 'v' }, { id: 'e5', from: 'f2', to: 'v' }, { id: 'e6', from: 'v', to: 'n1' },
    ],
  };
  const mediaOf = (p: string) => (p.endsWith('.png') ? 'image' as const : null);
  const inputs = inputsOf(doc, 'v', mediaOf);
  assert.deepEqual(inputs, [{ from: 'n1', text: 'cold blue dawn' }, { from: 'f1', path: 'assets/a.png', media: 'image' }, { from: 'm1', path: 'assets/image/b.png', media: 'image' }]);
  const v = doc.nodes[5] as typeof doc.nodes[5] & { make: 'video' };
  assert.deepEqual(makeRequest(v, inputs, 'push'), {
    verb: 'video', unused: 0,
    args: { out: 'push', prompt: 'cold blue dawn\n\na slow push in', duration: '5', 'input-reference': ['assets/a.png', 'assets/image/b.png'] },
  });
  assert.deepEqual(makeRequest({ ...v, opts: { frames: true, sec: 99, ratio: '9:16' } }, inputs, 'push').args,
    { out: 'push', prompt: 'cold blue dawn\n\na slow push in', duration: '30', 'aspect-ratio': '9:16', 'first-frame': 'assets/a.png', 'last-frame': 'assets/image/b.png' });
  assert.equal(makeRequest({ ...v, make: 'image' }, inputs, 'still').unused, 2, 'a picture is made from words only');
  assert.match(makeName({ ...v, prompt: 'A slow push-in, at dawn!' }, 36), /^a-slow-push-in-10$/);
  assert.match(makeName({ ...v, prompt: '黎明' }, 36), /^video-10$/);
});

test('a node is stale when what it would be asked is not what it made the one shown from', () => {
  const node = { id: 'v', x: 0, y: 0, make: 'image' as const, prompt: 'dawn', path: 'assets/image/a.png', versions: ['assets/image/a.png'] };
  const inputs = [{ from: 'n', text: 'cold' }];
  const made = { ...node, made: inputsKey(node, inputs) };
  assert.equal(isStale(made, inputs), false);
  assert.equal(isStale(made, [{ from: 'n', text: 'warm' }]), true);
  assert.equal(isStale({ ...made, prompt: 'dusk' }, inputs), true);
  assert.equal(isStale({ ...node }, []), false, 'nothing known it was made from');
});

test('a new edge goes after the others into its node; one can be put first', () => {
  const doc = { nodes: [], edges: [{ id: 'a', from: 'x', to: 'v', order: 0 }, { id: 'b', from: 'y', to: 'v', order: 1 }, { id: 'c', from: 'z', to: 'w' }] };
  assert.equal(nextOrder(doc, 'v'), 2);
  assert.equal(nextOrder(doc, 'w'), 0);
  assert.deepEqual(reorder(doc, 'v', 'b').map((e) => [e.id, e.order]), [['a', 1], ['b', 0], ['c', undefined]]);
});

test('what a node made is its newest version, shown', () => {
  assert.deepEqual(withVersion({ versions: ['a', 'b'], path: 'a', made: 'k1' }, { path: 'c', made: 'k2' }), { versions: ['a', 'b', 'c'], path: 'c', made: 'k2' });
  assert.deepEqual(withVersion({}, { path: 'a', made: 'k' }), { versions: ['a'], path: 'a', made: 'k' });
});
