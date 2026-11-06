import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CANVAS_FILE, CanvasOpError, applyCanvasOps, canvasWriteRoute, parseCanvas, readCanvas, writeCanvas } from './canvas.mjs';

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

test("an agent's steps: added where they go, wired in order, kept as its", async () => {
  const exists = async (/** @type {string} */ path) => ['assets/a.png', 'assets/image/b.png'].includes(path);
  const { canvas, added } = await applyCanvasOps({ nodes: [{ id: 'n0', x: 0, y: 0, w: 240, h: 140, text: 'there' }], edges: [] }, [
    { op: 'add', kind: 'note', id: 'mood', text: 'cold blue dawn' },
    { op: 'add', kind: 'file', id: 'ref', path: 'assets/a.png', x: 400, y: 220 },
    { op: 'add', kind: 'video', id: 'shot', prompt: 'a slow push in', inputs: ['ref', 'mood'], opts: { sec: 6 } },
    { op: 'version', id: 'shot', path: 'assets/image/b.png' },
    { op: 'add', kind: 'group', id: 'g', name: 'Opening', color: 'blue', around: ['mood', 'ref'] },
    { op: 'set', id: 'mood', text: 'warm dusk' },
  ], { by: { agent: 'codex', session: 's1' }, exists });
  assert.deepEqual(added, ['mood', 'ref', 'shot', 'g']);
  const by = (/** @type {string} */ id) => /** @type {any} */ (canvas.nodes.find((n) => n.id === id));
  assert.deepEqual({ x: by('mood').x + by('g').x, y: by('mood').y + by('g').y }, { x: 0, y: 220 }, 'below what was there, where it stays in its group');
  assert.equal(by('mood').text, 'warm dusk');
  assert.equal(by('mood').parent, 'g');
  assert.deepEqual(by('mood').by, { agent: 'codex', session: 's1' });
  assert.equal(by('n0').by, undefined, 'what was there is as it was');
  assert.equal(by('shot').x, 400 + 280 + 80, 'right of its inputs');
  assert.deepEqual(by('shot').versions, ['assets/image/b.png']);
  assert.deepEqual(canvas.edges.map((e) => [e.from, e.to, e.order]), [['ref', 'shot', 0], ['mood', 'shot', 1]]);
});

test("an agent's steps are all taken or none, and a wrong one says which and why", async () => {
  const exists = async () => false;
  const board = { nodes: [{ id: 'a', x: 0, y: 0, text: '' }], edges: [] };
  const wrong = async (/** @type {unknown[]} */ ops, /** @type {RegExp} */ said) =>
    assert.rejects(applyCanvasOps(board, ops, { exists }), (e) => e instanceof CanvasOpError && said.test(e.message));
  await wrong([{ op: 'add', kind: 'note', id: 'b' }, { op: 'wire', from: 'b', to: 'zzz' }], /step 2: there is no node "zzz"/);
  await wrong([{ op: 'add', kind: 'file', path: 'assets/none.png' }], /step 1: assets\/none.png is not in the project/);
  await wrong([{ op: 'add', kind: 'hologram' }], /kind is one of/);
  await wrong([{ op: 'set', id: 'a', prompt: 'x' }], /a note node has no prompt/);
  await wrong([{ op: 'version', id: 'a', path: 'assets/x.png' }], /does not make anything/);
  await wrong([{ op: 'add', kind: 'note', id: 'a' }], /there is a node a on the board already/);
  assert.deepEqual(board, { nodes: [{ id: 'a', x: 0, y: 0, text: '' }], edges: [] }, 'nothing was changed');
});

test('a cut keeps only that it is one, with its place', () => {
  assert.deepEqual(parseCanvas({ nodes: [{ id: 'c', x: 1, y: 2, w: 320, cut: true, text: 'ignored' }], edges: [] }).nodes, [{ id: 'c', x: 1, y: 2, w: 320, cut: true }]);
});

test("a text node's words are written by the person's agent, from what they ask and what is wired in", async () => {
  const post = (body) => Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), { method: 'POST' });
  const answer = () => { const res = { status: 0, body: '', writeHead(s) { res.status = s; }, end(b) { res.body = b; } }; return res; };
  let asked = '';
  const res = answer();
  assert.equal(await canvasWriteRoute(/** @type {any} */ (post({ prompt: 'a three-shot script', inputs: ['a fox at dawn', 3] })), /** @type {any} */ (res), 'canvas-write',
    async (text) => { asked = text; return '  1. The fox wakes.\n'; }), true);
  assert.deepEqual([res.status, JSON.parse(res.body)], [200, { text: '1. The fox wakes.' }]);
  assert.match(asked, /\[1\] a fox at dawn/);
  assert.match(asked, /a three-shot script$/);
  assert.doesNotMatch(asked, /\[2\]/);
  /* no agent here (a browser's Studio): refused, saying so */
  await assert.rejects(canvasWriteRoute(/** @type {any} */ (post({ prompt: 'x' })), /** @type {any} */ (answer()), 'canvas-write', undefined),
    (e) => e.status === 409 && e.extra?.code === 'no-agent');
  await assert.rejects(canvasWriteRoute(/** @type {any} */ (post({})), /** @type {any} */ (answer()), 'canvas-write', async () => ''), (e) => e.status === 400);
  assert.equal(await canvasWriteRoute(/** @type {any} */ ({ method: 'GET' }), /** @type {any} */ (answer()), 'canvas-write', undefined), false);
});
