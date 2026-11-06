import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasId, canvasKey, copyOf, emptyHistory, inputsChanged, inputsKey, inputsOf, isStale, makeName, makeRequest, modesFor, nextOrder, readCanvasDoc, redo, remember, reorder, undo, withVersion,
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
  assert.deepEqual(makeRequest({ ...v, make: 'image' }, inputs, 'still').args,
    { out: 'still', prompt: 'cold blue dawn\n\na slow push in', ratio: '16:9', ref: ['assets/a.png', 'assets/image/b.png'] }, 'a picture is made from the pictures wired in');
  /* within what the model makes */
  const heygen = { ratios: ['16:9', '9:16'], seconds: [5, 30] as [number, number], refs: 0, frames: true };
  assert.deepEqual(makeRequest({ ...v, opts: { sec: 4, ratio: '4:3' } }, inputs, 'push', heygen).args,
    { out: 'push', prompt: 'cold blue dawn\n\na slow push in', duration: '5', 'aspect-ratio': '16:9', 'first-frame': 'assets/a.png' },
    'a model that takes no references starts from the first picture');
  assert.deepEqual(makeRequest({ ...v, opts: { mode: 'firstLast' } }, inputs, 'push', heygen).args['last-frame'], 'assets/image/b.png', 'between two frames when asked');
  assert.equal(makeRequest({ ...v, opts: { mode: 'text' } }, inputs, 'push').unused, 2, 'from the words alone, the pictures are left');
  assert.deepEqual(modesFor(heygen), ['text', 'first', 'firstLast']);
  assert.deepEqual(modesFor({ refs: 9, frames: true, voice: true }), ['text', 'omni', 'first', 'firstLast', 'refs']);
  assert.deepEqual(makeRequest({ ...v, opts: { frames: true } }, inputs, 'push', { refs: 1, frames: false }).args['input-reference'], ['assets/a.png'], 'one that takes no frames, references, as many as it takes');
  assert.equal(makeRequest({ ...v, opts: { sec: 7 } }, inputs, 'push', { only: [5, 10] }).args.duration, '5');
  assert.deepEqual(makeRequest({ ...v, make: 'image', opts: { quality: 'high' } }, inputs, 'still', { refs: 1, qualities: ['low', 'high'] }).args,
    { out: 'still', prompt: 'cold blue dawn\n\na slow push in', ratio: '16:9', quality: 'high', ref: ['assets/a.png'] });
  assert.equal(makeRequest({ ...v, make: 'image' }, inputs, 'still', { refs: 0 }).unused, 2, 'a model that takes no pictures leaves them');
  assert.deepEqual(makeRequest({ ...v, make: 'image', opts: { size: '2k', transparent: true } }, [], 'cut', { sizes: ['1k', '2k'], transparent: true }).args,
    { out: 'cut', prompt: 'a slow push in', ratio: '16:9', size: '2k', transparent: 'true' });
  assert.equal(makeRequest({ ...v, make: 'image', opts: { size: '4k', transparent: true } }, [], 'cut', { sizes: ['1k'] }).args.size, undefined, 'only what the model makes');
  assert.equal(makeRequest({ ...v, opts: { size: '1080p' } }, [], 'push', { sizes: ['720p', '1080p'] }).args.resolution, '1080p');
  /* a GIF of so many frames, an SVG, and a picture redrawn where a mask or a markup says, as the model makes them */
  const gpt = { formats: ['png', 'gif', 'svg'], mask: true, markup: true };
  const still = [{ from: 'p', path: 'assets/a.png', media: 'image' as const }];
  assert.deepEqual(makeRequest({ ...v, make: 'image', opts: { format: 'gif', gifFrames: 6, frameMs: 120 } }, [], 'g', gpt).args, { out: 'g', prompt: 'a slow push in', ratio: '16:9', format: 'gif', frames: '6', 'frame-ms': '120' });
  assert.equal(makeRequest({ ...v, make: 'image', opts: { format: 'gif' } }, [], 'g', { refs: 4 }).args.format, undefined, 'only a model that makes GIFs');
  assert.equal(makeRequest({ ...v, make: 'image', opts: { mask: 'assets/mask.png' } }, still, 'r', gpt).args.mask, 'assets/mask.png');
  assert.equal(makeRequest({ ...v, make: 'image', opts: { mask: 'assets/mask.png' } }, [], 'r', gpt).args.mask, undefined, 'a mask goes with the picture it redraws');
  assert.equal(makeRequest({ ...v, make: 'image', opts: { markup: 'assets/m.png' } }, still, 'r', gpt).args.markup, 'assets/m.png');
  assert.deepEqual(readCanvasDoc({ nodes: [{ id: 'n', x: 0, y: 0, make: 'image', opts: { format: 'gif', gifFrames: 6, mask: 'assets/mask.png' } }], edges: [] }).nodes[0]!.opts, { format: 'gif', gifFrames: 6, mask: 'assets/mask.png' });
  assert.match(makeName({ ...v, prompt: 'A slow push-in, at dawn!' }, 36), /^a-slow-push-in-10$/);
  assert.match(makeName({ ...v, prompt: '黎明' }, 1296), /^video-100$/);
  /* two made in the same moment never share a name (a file each); a preset names it when its words do not */
  assert.notEqual(makeName({ ...v, prompt: '' }, 1296), makeName({ ...v, prompt: '' }, 1296));
  assert.match(makeName({ ...v, prompt: '', preset: 'fullBody' }, 46656), /^full-body-1000$/);
});

test('a node is stale when what it would be asked is not what it made the one shown from', () => {
  const node = { id: 'v', x: 0, y: 0, make: 'image' as const, prompt: 'dawn', path: 'assets/image/a.png', versions: ['assets/image/a.png'] };
  const inputs = [{ from: 'n', text: 'cold' }];
  const made = { ...node, made: inputsKey(node, inputs) };
  assert.equal(isStale(made, inputs), false);
  assert.equal(isStale(made, [{ from: 'n', text: 'warm' }]), true);
  assert.equal(isStale({ ...made, prompt: 'dusk' }, inputs), true);
  /* said on the node only when what is wired in changed: its own words and settings changed, the person knows */
  assert.equal(inputsChanged({ ...made, prompt: 'dusk' }, inputs), false);
  assert.equal(inputsChanged(made, [{ from: 'n', text: 'warm' }]), true);
  assert.equal(inputsChanged({ ...made, made: 'abc' }, [{ from: 'n', text: 'warm' }]), false, 'a key from before, of one part: not said');
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
