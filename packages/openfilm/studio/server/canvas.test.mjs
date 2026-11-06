import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { CANVAS_FILE, CanvasOpError, agentCanvasRoute, applyCanvasOps, canvasRoute, canvasWriteRoute, parseCanvas, readCanvas, writeCanvas } from './canvas.mjs';

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
  assert.equal(by('shot').x, 400 + 622 + 80, 'right of its inputs: a picture is 622 wide (350 high, 16:9) until resized');
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

test('a project has as many canvases as are made: named, copied, renamed, the first one stays first, deleted into the trash', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-boards-'));
  const trash = mkdtempSync(join(tmpdir(), 'of-trash-'));
  const before = process.env.OPENFILM_TRASH_DIR;
  process.env.OPENFILM_TRASH_DIR = trash;
  const call = async (method, rest, body) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method });
    const res = { status: 0, body: '', writeHead(s) { res.status = s; }, end(b) { res.body = b; } };
    const was = await canvasRoute(/** @type {any} */ (req), /** @type {any} */ (res), root, rest);
    return was ? JSON.parse(res.body) : null;
  };
  try {
    writeFileSync(join(root, 'film.html'), '<!doctype html>');
    await writeCanvas(root, { nodes: [{ id: 'n', x: 0, y: 0, text: 'first' }], edges: [] });
    assert.deepEqual(await call('GET', 'canvases'), { boards: [{ id: 'main', nodes: 1 }] });
    const copy = await call('POST', 'canvases', { name: 'Shots', from: 'main' });
    assert.equal(copy.name, 'Shots');
    const empty = await call('POST', 'canvases', {});
    assert.deepEqual((await call('GET', 'canvases')).boards, [{ id: 'main', nodes: 1 }, { id: copy.id, name: 'Shots', nodes: 1 }, { id: empty.id, nodes: 0 }]);
    /* written without a name, a board keeps its name */
    await call('PUT', `canvas/${copy.id}`, { nodes: [], edges: [] });
    assert.deepEqual(await call('GET', `canvas/${copy.id}`), { nodes: [], edges: [], name: 'Shots' });
    assert.deepEqual(await call('PATCH', `canvases/${copy.id}`, { name: 'Storyboard' }), { id: copy.id, name: 'Storyboard' });
    await assert.rejects(call('GET', 'canvas/nope'), (e) => e.status === 404);
    /* an agent's steps go to the board shown */
    let changed = '';
    const ask = Object.assign(Readable.from([Buffer.from(JSON.stringify({ folder: root, ops: [{ op: 'add', kind: 'note', text: 'from the agent' }] }))]), { method: 'POST' });
    const res = { body: '', writeHead() {}, end(b) { res.body = b; } };
    await agentCanvasRoute(/** @type {any} */ (ask), /** @type {any} */ (res), (r) => { changed = r; });
    assert.equal(changed, root);
    assert.deepEqual((await readCanvas(root, copy.id)).nodes.map((n) => n.text), ['from the agent']);
    assert.equal((await readCanvas(root)).nodes.length, 1);
    /* the first deleted: the next is made the first; the last one stays */
    const after = await call('DELETE', 'canvases/main');
    assert.deepEqual(after.boards, [{ id: 'main', name: 'Storyboard', nodes: 1 }, { id: empty.id, nodes: 0 }]);
    assert.equal(readFileSync(join(trash, 'canvas.json'), 'utf8').includes('first'), true);
    await call('DELETE', `canvases/${empty.id}`);
    await assert.rejects(call('DELETE', 'canvases/main'), (e) => e.status === 409);
  } finally {
    if (before === undefined) delete process.env.OPENFILM_TRASH_DIR; else process.env.OPENFILM_TRASH_DIR = before;
    rmSync(root, { recursive: true, force: true });
    rmSync(trash, { recursive: true, force: true });
  }
});

test('a picture node keeps its GIF, its SVG and what of its picture it redraws', () => {
  const [n] = parseCanvas({ nodes: [{ id: 'p', x: 0, y: 0, make: 'image', opts: { format: 'gif', gifFrames: 6, frameMs: 120, mask: 'assets/mask.png', markup: '../out.png' } }], edges: [] }).nodes;
  assert.deepEqual(/** @type {any} */ (n).opts, { format: 'gif', gifFrames: 6, frameMs: 120, mask: 'assets/mask.png' });
  const [odd] = parseCanvas({ nodes: [{ id: 'q', x: 0, y: 0, make: 'image', opts: { format: 'jpg', gifFrames: 40, frameMs: 5 } }], edges: [] }).nodes;
  assert.equal(/** @type {any} */ (odd).opts, undefined, 'what the format does not take is left out');
});

test("an agent's nodes laid on each other are moved apart, and a group grows round what is in it", async () => {
  const exists = async () => true;
  const { canvas } = await applyCanvasOps({ nodes: [], edges: [] }, [
    { op: 'add', kind: 'group', id: 'g', name: 'Shots', x: 0, y: 0, w: 400, h: 300 },
    { op: 'add', kind: 'note', id: 'n', text: 'brief', group: 'g', x: 32, y: 52 },
    { op: 'add', kind: 'image', id: 'a', prompt: 'one', group: 'g', x: 600, y: 52 },
    { op: 'add', kind: 'image', id: 'b', prompt: 'two', group: 'g', x: 700, y: 52 },
  ], { by: { agent: 'claude' }, exists });
  const at = (id) => /** @type {any} */ (canvas.nodes.find((n) => n.id === id));
  assert.ok(at('b').x >= at('a').x + 622, 'the second picture is clear of the first (622 wide)');
  const g = at('g');
  for (const id of ['n', 'a', 'b']) assert.ok(at(id).x + (at(id).w ?? 622) <= g.w && at(id).y + (at(id).h ?? 350) <= g.h, `${id} is inside its group`);
});
