// @ts-check
/**
 * A project's canvas (`.film/canvas.json`): the board beside the edit where its material is laid out, notes written,
 * and what leads to what drawn. Studio's own, beside film.html, not in it (SPEC §1: an editor's own state lives in
 * `.film/`): nothing on it is in the film until it is put on the timeline.
 *
 * A node is a note (`text`), a file of the project (`path`, project-relative), a group (`group`, its name, and a
 * `color`) or a node that makes something with the person's services (`make`: image, video, sfx or music; its
 * `prompt`, `via` and `model`, its `opts`, the files it made, `versions`, the one shown `path`, and `made` what it was
 * asked when it last made one), at `x`, `y` on the board, `w` wide (and `h` high, for a note or a group). A node in a
 * group names it (`parent`), and its `x`, `y` are from the group's corner; one an agent put there names it (`by`). A
 * cut (`cut`) is the order what is wired into it goes onto the timeline in. An
 * edge goes from one node to another, `order` its place among those into that node.
 *
 *   GET canvas                    → { nodes, edges, name? }
 *   PUT canvas { nodes, edges }   → { nodes, edges, name? }: the whole board, as kept (the board in Studio writes it)
 *
 * A project can have more boards than one: the first is `.film/canvas.json` (`main`), the others
 * `.film/canvases/<id>.json`, each with its `name` (none: "Canvas 1"…, as Studio numbers them).
 *
 *   GET canvas/<id>, PUT canvas/<id>  → one of the others, as above
 *   GET canvases                      → { boards: [{ id, name?, nodes }] }, the first first, then as made
 *   POST canvases { name?, from? }    → { id, name? }: a new board, empty or a copy of `from`
 *   PATCH canvases/<id> { name }      → { id, name }
 *   DELETE canvases/<id>              → { boards }: into the trash; the first gone, the next one made first
 *
 * An agent changes it a step at a time (`openfilm canvas`, studio/client.mjs), each step checked and all of them kept
 * or none (applyCanvasOps): the board shown in Studio takes them at once (a `canvas` event).
 *
 *   POST /api/canvas { folder, ops?, by? } → { ok: true, canvas, added } or { ok: false, text }
 */
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { FILM_FILE } from '../../src/film-doc.mjs';
import { writeAtomic } from './atomic.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { TOOL_DIR } from './projects.mjs';
import { moveToTrash } from './trash.mjs';
import { noteMade } from './canvas-history.mjs';

export const CANVAS_FILE = `${TOOL_DIR}/canvas.json`;
/** the project's other boards, and the first one's id */
export const BOARDS_DIR = `${TOOL_DIR}/canvases`;
export const MAIN_BOARD = 'main';
const BOARD_ID = /^[a-z0-9]{1,32}$/;
const BOARDS_MAX = 100;
const MAX_NODES = 2000;
const MAX_EDGES = 4000;
const TEXT_MAX = 20000;
/** how far from the origin a node may be, and how big, in board pixels */
const FAR = 1e6;
const SIZE_MIN = 40;
const SIZE_MAX = 8000;

/** a group's colors, as the board draws them */
const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const NAME_MAX = 80;

/** what a node can make, and how much of what it made it keeps */
const MAKE_KINDS = ['image', 'video', 'sfx', 'music', 'tts'];
const VERSIONS_MAX = 50;
const SHORT_MAX = 120;

/**
 * @typedef {{ id: string, x: number, y: number, w?: number, h?: number, parent?: string, by?: { agent: string, session?: string } } & ({ text: string } | { path: string } | { group: string, color: string } | { make: string } | { cut: true })} CanvasNode
 * @typedef {{ id: string, from: string, to: string, order?: number }} CanvasEdge
 * @typedef {{ nodes: CanvasNode[], edges: CanvasEdge[], name?: string }} Canvas
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** @param {unknown} v */
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
/** @param {unknown} v */
const place = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= FAR ? Math.round(v) : null);
/** @param {unknown} v */
const size = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, v))) : undefined);
/** A project-relative path that stays in the project and out of Studio's own folder. @param {unknown} v */
const projectPath = (v) => typeof v === 'string' && v.length > 0 && v.length <= 1024 && !v.startsWith('/') && !v.includes('\\')
  && !v.split('/').some((part) => part === '..' || part === '' || part === TOOL_DIR);

/** The canvas as kept: what is not a node or an edge is left out, and so is an edge to a node that is not there. @param {unknown} raw @returns {Canvas} */
export function parseCanvas(raw) {
  /** @type {Canvas} */
  const out = { nodes: [], edges: [] };
  if (!isRecord(raw)) return out;
  const ids = new Set();
  for (const n of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (out.nodes.length >= MAX_NODES) break;
    if (!isRecord(n) || !isId(n.id) || ids.has(n.id)) continue;
    const x = place(n.x);
    const y = place(n.y);
    if (x == null || y == null) continue;
    const w = size(n.w);
    const h = size(n.h);
    const box = { id: /** @type {string} */ (n.id), x, y, ...(w ? { w } : {}), ...(h ? { h } : {}) };
    const parent = { ...(isId(n.parent) ? { parent: /** @type {string} */ (n.parent) } : {}), ...readBy(n.by) };
    if (MAKE_KINDS.includes(String(n.make))) out.nodes.push({ ...box, ...parent, ...readMake(n), make: String(n.make) });
    else if (n.cut === true) out.nodes.push({ ...box, ...parent, cut: true });
    else if (projectPath(n.path)) out.nodes.push({ ...box, ...parent, path: /** @type {string} */ (n.path) });
    else if (typeof n.text === 'string') out.nodes.push({ ...box, ...parent, text: n.text.slice(0, TEXT_MAX) });
    else if (typeof n.group === 'string') {
      out.nodes.push({ ...box, ...readBy(n.by), group: n.group.trim().slice(0, NAME_MAX), color: GROUP_COLORS.includes(String(n.color)) ? String(n.color) : 'gray' });
    }
    else continue;
    ids.add(n.id);
  }
  /* in a group only when that group is on the board (a group is in none) */
  const groups = new Set(out.nodes.flatMap((n) => ('group' in n ? [n.id] : [])));
  for (const n of out.nodes) if (n.parent && !groups.has(n.parent)) delete n.parent;
  const edges = new Set();
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    if (out.edges.length >= MAX_EDGES) break;
    if (!isRecord(e) || !isId(e.id) || !ids.has(e.from) || !ids.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}>${e.to}`;
    if (edges.has(key)) continue;
    edges.add(key);
    const order = typeof e.order === 'number' && Number.isInteger(e.order) && e.order >= 0 && e.order < MAX_EDGES ? { order: e.order } : {};
    out.edges.push({ id: /** @type {string} */ (e.id), from: /** @type {string} */ (e.from), to: /** @type {string} */ (e.to), ...order });
  }
  if (typeof raw.name === 'string' && raw.name.trim()) out.name = raw.name.trim().slice(0, NAME_MAX);
  return out;
}

/** Who put a node there, when an agent did: `{ by: { agent, session? } }`, else nothing. @param {unknown} by */
function readBy(by) {
  /** @param {unknown} v */
  const short = (v) => (typeof v === 'string' && v.length > 0 && v.length <= SHORT_MAX ? v : undefined);
  if (!isRecord(by) || !short(by.agent)) return {};
  return { by: { agent: /** @type {string} */ (by.agent), ...(short(by.session) ? { session: /** @type {string} */ (by.session) } : {}) } };
}

/** A making node's own fields, as kept (its kind aside). @param {Record<string, unknown>} n */
function readMake(n) {
  /** @param {unknown} v */
  const short = (v) => (typeof v === 'string' && v.length > 0 && v.length <= SHORT_MAX ? v : undefined);
  const o = isRecord(n.opts) ? n.opts : {};
  const opts = {
    ...(short(o.ratio) ? { ratio: o.ratio } : {}),
    ...(typeof o.sec === 'number' && Number.isFinite(o.sec) && o.sec > 0 && o.sec <= 600 ? { sec: o.sec } : {}),
    ...(o.frames === true ? { frames: true } : {}),
    ...(short(o.quality) ? { quality: o.quality } : {}),
    ...(['text', 'omni', 'first', 'firstLast', 'refs'].includes(/** @type {string} */ (o.mode)) ? { mode: o.mode } : {}),
    ...(short(o.size) ? { size: o.size } : {}),
    ...(o.transparent === true ? { transparent: true } : {}),
    ...(o.format === 'gif' || o.format === 'svg' ? { format: o.format } : {}),
    ...(typeof o.gifFrames === 'number' && o.gifFrames >= 2 && o.gifFrames <= 16 ? { gifFrames: Math.round(o.gifFrames) } : {}),
    ...(typeof o.frameMs === 'number' && o.frameMs >= 20 && o.frameMs <= 2000 ? { frameMs: Math.round(o.frameMs) } : {}),
    ...(projectPath(o.mask) ? { mask: o.mask } : {}),
    ...(projectPath(o.markup) ? { markup: o.markup } : {}),
    ...(o.count === 2 || o.count === 4 ? { count: o.count } : {}),
    ...(short(o.voice) ? { voice: o.voice } : {}),
  };
  const versions = (Array.isArray(n.versions) ? n.versions : []).filter(projectPath).slice(-VERSIONS_MAX);
  const fields = {
    prompt: typeof n.prompt === 'string' ? n.prompt.slice(0, TEXT_MAX) : '',
    via: short(n.via), model: short(n.model), preset: short(n.preset),
    opts: Object.keys(opts).length ? opts : undefined,
    versions: versions.length ? versions : undefined,
    path: versions.includes(n.path) ? n.path : versions.at(-1),
    made: short(n.made),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

/** where a board is kept. @param {string} root @param {string} board */
const boardFile = (root, board) => (board === MAIN_BOARD ? join(root, CANVAS_FILE) : join(root, BOARDS_DIR, `${board}.json`));
/** @param {string} root @param {string} board */
const isBoard = async (root, board) => board === MAIN_BOARD || (BOARD_ID.test(board) && Boolean((await stat(boardFile(root, board)).catch(() => null))?.isFile()));

/** @param {string} root @param {string} [board] @returns {Promise<Canvas>} */
export async function readCanvas(root, board = MAIN_BOARD) {
  try {
    return parseCanvas(JSON.parse(await readFile(boardFile(root, board), 'utf8')));
  } catch { return { nodes: [], edges: [] }; }
}

/** The board kept; written without a name, it keeps the one it has. @param {string} root @param {unknown} canvas @param {string} [board] @returns {Promise<Canvas>} */
export async function writeCanvas(root, canvas, board = MAIN_BOARD) {
  if (!isRecord(canvas) || !Array.isArray(canvas.nodes)) throw new HttpError(400, 'canvas: { nodes: [{ id, x, y, text | path }], edges: [{ id, from, to }] }');
  const kept = parseCanvas(canvas);
  if (!('name' in canvas)) {
    const { name } = await readCanvas(root, board);
    if (name) kept.name = name;
  }
  await mkdir(dirname(boardFile(root, board)), { recursive: true });
  await writeAtomic(boardFile(root, board), `${JSON.stringify(kept, null, 1)}\n`);
  /* what it was given to show, noted for its history (canvas-history.mjs) */
  await noteMade(root, /** @type {{ nodes: Array<Record<string, unknown>> }} */ (/** @type {unknown} */ (kept)));
  return kept;
}

/** The project's boards: the first, then the others as they were made (their ids go up). @param {string} root */
export async function listBoards(root) {
  const others = (await readdir(join(root, BOARDS_DIR)).catch(() => /** @type {string[]} */ ([])))
    .flatMap((f) => (f.endsWith('.json') && BOARD_ID.test(f.slice(0, -5)) ? [f.slice(0, -5)] : [])).sort((a, b) => a.length - b.length || (a < b ? -1 : 1));
  return Promise.all([MAIN_BOARD, ...others].map(async (id) => {
    const { name, nodes } = await readCanvas(root, id);
    return { id, ...(name ? { name } : {}), nodes: nodes.length };
  }));
}

/** when the last board was made (ms): the next is made later, even within a millisecond */
let lastMade = 0;

/** the board each project shows in Studio now, which an agent's steps go to */
const shown = new Map();

/**
 * A project's `canvas[/<board>]` and `canvases[/<board>]`. True when it was this route.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 */
export async function canvasRoute(req, res, root, rest) {
  const [head, id, more] = rest.split('/');
  if ((head !== 'canvas' && head !== 'canvases') || more !== undefined) return false;
  if (head === 'canvas') {
    const board = id === undefined ? MAIN_BOARD : decodeURIComponent(id);
    if (!(await isBoard(root, board))) throw new HttpError(404, 'no such canvas');
    if (req.method === 'GET') { shown.set(root, board); json(res, 200, await readCanvas(root, board)); return true; }
    if (req.method === 'PUT') { json(res, 200, await writeCanvas(root, await readJson(req), board)); return true; }
    return false;
  }
  if (id === undefined) {
    if (req.method === 'GET') { json(res, 200, { boards: await listBoards(root) }); return true; }
    if (req.method !== 'POST') return false;
    const body = /** @type {{ name?: unknown, from?: unknown }} */ (await readJson(req));
    if ((await listBoards(root)).length >= BOARDS_MAX) throw new HttpError(409, `a project has at most ${BOARDS_MAX} canvases`);
    const from = typeof body.from === 'string' && (await isBoard(root, body.from)) ? await readCanvas(root, body.from) : { nodes: [], edges: [] };
    /* its id goes up with each made, so the list is in the order they were made */
    lastMade = Math.max(Date.now(), lastMade + 1);
    const made = `${lastMade.toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
    await writeCanvas(root, { nodes: from.nodes, edges: from.edges, ...(name ? { name } : {}) }, made);
    json(res, 200, { id: made, ...(name ? { name } : {}) });
    return true;
  }
  const board = decodeURIComponent(id);
  if (!(await isBoard(root, board))) throw new HttpError(404, 'no such canvas');
  if (req.method === 'PATCH') {
    const body = /** @type {{ name?: unknown }} */ (await readJson(req));
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, NAME_MAX) : '';
    const now = await readCanvas(root, board);
    const { name: _old, ...rest } = now;
    await writeCanvas(root, name ? { ...rest, name } : rest, board);
    json(res, 200, { id: board, ...(name ? { name } : {}) });
    return true;
  }
  if (req.method === 'DELETE') {
    const boards = await listBoards(root);
    if (boards.length < 2) throw new HttpError(409, 'the only canvas stays');
    const file = boardFile(root, board);
    if ((await stat(file).catch(() => null))?.isFile()) await moveToTrash(file);
    /* the first gone: the next one is made the first */
    if (board === MAIN_BOARD) await rename(boardFile(root, /** @type {string} */ (boards[1]?.id)), file);
    if (shown.get(root) === board) shown.delete(root);
    json(res, 200, { boards: await listBoards(root) });
    return true;
  }
  return false;
}

/**
 * A text node's words written by the person's own agent (an app with a chat, `askAgent`): POST `canvas-write`
 * { prompt, inputs: [the words wired in] } → { text }, the words alone. Without an agent ready: 409, code no-agent.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} rest
 * @param {import('./get.mjs').AskAgent | undefined} askAgent
 */
export async function canvasWriteRoute(req, res, rest, askAgent) {
  if (rest !== 'canvas-write' || req.method !== 'POST') return false;
  const body = /** @type {{ prompt?: unknown, inputs?: unknown }} */ (await readJson(req));
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, TEXT_MAX) : '';
  const inputs = (Array.isArray(body.inputs) ? body.inputs : []).filter((i) => typeof i === 'string' && i.trim()).slice(0, 20).map((i) => /** @type {string} */ (i).slice(0, TEXT_MAX));
  if (!prompt && !inputs.length) throw new HttpError(400, 'say what to write');
  if (!askAgent) throw new HttpError(409, 'Writing on the canvas is done by your agent, in the app with a chat.', { code: 'no-agent' });
  const ask = ['Write what the person asks, for a text node on the canvas of their film project (a script, a shot list, a prompt, a description).',
    'Answer with the text itself, in the language they ask in, with no preamble and no closing remark. Markdown headings, bold and lists are fine.',
    ...(inputs.length ? ['', 'What is wired into it:', ...inputs.map((i, n) => `[${n + 1}] ${i}`)] : []),
    '', 'What they ask:', prompt || 'Write it from what is wired in.'].join('\n');
  try {
    json(res, 200, { text: (await askAgent(ask)).trim() });
  } catch (e) {
    if (/** @type {{ code?: unknown }} */ (e)?.code === 'no-agent') throw new HttpError(409, e instanceof Error ? e.message : String(e), { code: 'no-agent' });
    throw e;
  }
  return true;
}

/* ── an agent's steps ─────────────────────────────────────────────────────── */

const MAKE_W = 320;
const KIND_SIZE = /** @type {Record<string, { w: number, h: number }>} */ ({
  note: { w: 240, h: 140 }, file: { w: 280, h: 160 }, group: { w: 480, h: 320 }, make: { w: MAKE_W, h: 320 },
});
/** the room left between what an agent adds and what is there */
const GAP = 80;
/** the room over a card its title takes */
const CARD_HEAD = 28;
/** a card's height on the board (studio/ui lib/canvas CARD_H) */
const CARD_H = 350;
const GROUP_PAD = 32;
/** the room at a group's top, under its name */
const GROUP_HEAD = 20;

/** An agent's step that cannot be taken: which, and why. */
export class CanvasOpError extends Error {}

/** what kind of node, as its size is guessed: @param {CanvasNode} n */
const kindOf = (n) => ('group' in n ? 'group' : 'make' in n || 'cut' in n ? 'make' : 'path' in n ? 'file' : 'note');
/** a node's box on the board (in a group: the group's corner added) @param {CanvasNode} n @param {Map<string, CanvasNode>} byId */
function boxOf(n, byId) {
  /* as the board draws a card until it is resized: 350 high, as wide as its shape (a sound 320, a note or a cut 350
     square); its name row above it */
  const kind = kindOf(n);
  const m = /** @type {{ make?: string, opts?: { ratio?: string } }} */ (n);
  const shaped = (/** @type {string | undefined} */ ratio) => { const [a, b] = String(ratio ?? '16:9').split(':').map(Number); return a && b ? Math.round(CARD_H * a / b) : 622; };
  const w = n.w ?? (kind === 'make' ? (m.make === 'sfx' || m.make === 'music' || m.make === 'tts' ? 320 : shaped(m.opts?.ratio)) : kind === 'file' ? 622 : kind === 'group' ? KIND_SIZE.group.w : CARD_H);
  const h = n.h ?? (kind === 'group' ? KIND_SIZE.group.h : CARD_H);
  const parent = n.parent ? byId.get(n.parent) : undefined;
  return { x: n.x + (parent?.x ?? 0), y: n.y + (parent?.y ?? 0), w, h };
}

/**
 * The board after an agent's steps, each checked: all are taken or none (a CanvasOpError says which step and why).
 * A step is one of
 *   { op: 'add', kind: note|file|image|video|sfx|music|group, id?, text?, path?, prompt?, via?, model?, opts?, name?,
 *     color?, x?, y?, w?, h?, group?, inputs?: [id…], around?: [id…] }
 *       a new node (`id` names it for later steps; else one is made). Where it goes, unless `x`, `y` say (on the
 *       board, also in a group): right of its `inputs`, which are wired into it in that order, else below the rest.
 *       `group`: the group it goes in; a group made `around` nodes holds them.
 *   { op: 'set', id, …the fields above that the node has }   { op: 'remove', id }   (a group's nodes go with it)
 *   { op: 'wire', from, to, order? }   { op: 'unwire', from, to }
 *   { op: 'version', id, path }   a file of the project as the newest version of a node that makes something
 * `by`: the agent taking them, kept on what it adds. `exists(path)`: whether a file is in the project.
 * @param {Canvas} canvas @param {unknown} ops @param {{ by?: unknown, exists: (path: string) => Promise<boolean> }} how
 * @returns {Promise<{ canvas: Canvas, added: string[] }>}
 */
export async function applyCanvasOps(canvas, ops, { by, exists }) {
  if (!Array.isArray(ops)) throw new CanvasOpError('ops is a list of steps, e.g. [{"op":"add","kind":"note","text":"…"}]');
  const nodes = canvas.nodes.map((n) => ({ ...n }));
  let edges = canvas.edges.map((e) => ({ ...e }));
  const byId = () => new Map(nodes.map((n) => [n.id, n]));
  const added = /** @type {string[]} */ ([]);
  const who = readBy(by);
  let fresh = 0;
  const newId = (/** @type {string} */ prefix) => {
    for (;;) { const id = `${prefix}${Date.now().toString(36)}${(fresh++).toString(36)}`; if (!nodes.some((n) => n.id === id)) return id; }
  };
  for (const [i, raw] of ops.entries()) {
    const step = `step ${i + 1}`;
    if (!isRecord(raw)) throw new CanvasOpError(`${step}: a step is an object with an op`);
    const op = /** @type {Record<string, any>} */ (raw);
    /** @param {unknown} id */
    const node = (id) => {
      const n = nodes.find((m) => m.id === id);
      if (!n) throw new CanvasOpError(`${step}: there is no node ${JSON.stringify(id)} on the board`);
      return n;
    };
    /** @param {unknown} path @param {string} what */
    const file = async (path, what) => {
      if (!projectPath(path)) throw new CanvasOpError(`${step}: ${what} is a path in the project, e.g. assets/image/dawn.png`);
      if (!(await exists(/** @type {string} */ (path)))) throw new CanvasOpError(`${step}: ${path} is not in the project`);
      return /** @type {string} */ (path);
    };
    const wire = (/** @type {string} */ from, /** @type {string} */ to, /** @type {unknown} */ order) => {
      if (from === to) throw new CanvasOpError(`${step}: a node is not wired into itself`);
      if (edges.some((e) => e.from === from && e.to === to)) return;
      const next = edges.filter((e) => e.to === to).reduce((max, e) => Math.max(max, (e.order ?? -1) + 1), 0);
      const place = typeof order === 'number' && Number.isInteger(order) && order >= 0 ? order : next;
      edges.push({ id: newId('e'), from, to, order: place });
    };
    if (op.op === 'add') {
      const kind = String(op.kind);
      const id = op.id === undefined ? newId('n') : op.id;
      if (!isId(id)) throw new CanvasOpError(`${step}: id is a short name, up to 64 characters`);
      if (nodes.some((n) => n.id === id)) throw new CanvasOpError(`${step}: there is a node ${id} on the board already`);
      /** @type {Record<string, unknown>} */
      let fields;
      if (kind === 'note') fields = { text: typeof op.text === 'string' ? op.text : '' };
      else if (kind === 'file') fields = { path: await file(op.path, 'path') };
      else if (kind === 'group') fields = { group: typeof op.name === 'string' ? op.name : 'Group', color: op.color };
      else if (kind === 'cut') fields = { cut: true };
      else if (MAKE_KINDS.includes(kind)) {
        const path = op.path === undefined ? undefined : await file(op.path, 'path');
        fields = { make: kind, prompt: op.prompt, via: op.via, model: op.model, preset: op.preset, opts: op.opts, ...(path ? { versions: [path], path } : {}) };
      } else throw new CanvasOpError(`${step}: kind is one of note, file, image, video, sfx, music, tts, cut, group`);
      const inputs = Array.isArray(op.inputs) ? op.inputs.map((input) => node(input).id) : [];
      const around = kind === 'group' && Array.isArray(op.around) ? op.around.map((a) => node(a)) : [];
      const group = op.group === undefined ? undefined : node(op.group);
      if (group && !('group' in group)) throw new CanvasOpError(`${step}: ${group.id} is not a group`);
      const ids = byId();
      const size = KIND_SIZE[MAKE_KINDS.includes(kind) || kind === 'cut' ? 'make' : kind];
      let x = Number.isFinite(op.x) ? op.x : null;
      let y = Number.isFinite(op.y) ? op.y : null;
      let w = Number.isFinite(op.w) ? op.w : undefined;
      let h = Number.isFinite(op.h) ? op.h : undefined;
      if (around.length) {
        /* round what it holds, as a group made on the board is */
        const boxes = around.map((n) => boxOf(n, ids));
        const x0 = Math.min(...boxes.map((b) => b.x)); const y0 = Math.min(...boxes.map((b) => b.y));
        x ??= x0 - GROUP_PAD; y ??= y0 - GROUP_PAD - 20;
        w ??= Math.max(...boxes.map((b) => b.x + b.w)) - x0 + 2 * GROUP_PAD;
        h ??= Math.max(...boxes.map((b) => b.y + b.h)) - y0 + 2 * GROUP_PAD + 20;
      } else if (x === null || y === null) {
        const from = inputs.map((input) => boxOf(/** @type {CanvasNode} */ (ids.get(input)), ids));
        const all = nodes.filter((n) => !n.parent).map((n) => boxOf(n, ids));
        if (from.length) { x ??= Math.max(...from.map((b) => b.x + b.w)) + GAP; y ??= from[0].y; }
        else if (all.length) { x ??= Math.min(...all.map((b) => b.x)); y ??= Math.max(...all.map((b) => b.y + b.h)) + GAP; }
        else { x ??= 0; y ??= 0; }
      }
      /** @type {Record<string, unknown>} */
      const made = { id, x, y, ...(w ? { w } : kind === 'group' ? { w: size.w } : {}), ...(h ? { h } : kind === 'group' ? { h: size.h } : {}), ...fields, ...who };
      if (group) { made.parent = group.id; made.x = /** @type {number} */ (made.x) - group.x; made.y = /** @type {number} */ (made.y) - group.y; }
      const [kept] = parseCanvas({ nodes: [...(group ? [group] : []), made], edges: [] }).nodes.slice(group ? 1 : 0);
      if (!kept) throw new CanvasOpError(`${step}: this node could not be kept`);
      nodes.push(/** @type {CanvasNode} */ (kept));
      for (const n of around) {
        if ('group' in n) throw new CanvasOpError(`${step}: a group is not put in another group`);
        const at = boxOf(n, ids);
        n.parent = id; n.x = at.x - /** @type {number} */ (kept.x); n.y = at.y - /** @type {number} */ (kept.y);
      }
      for (const input of inputs) wire(input, id, undefined);
      added.push(id);
    } else if (op.op === 'set') {
      const n = node(op.id);
      const { op: _op, id: _id, kind: _kind, ...change } = op;
      if ('path' in n && !('make' in n) && change.path !== undefined) change.path = await file(change.path, 'path');
      if ('make' in n && change.path !== undefined) {
        if (!(/** @type {{ versions?: string[] }} */ (n).versions ?? []).includes(change.path)) throw new CanvasOpError(`${step}: path names one of its versions; a new one is added with op version`);
      }
      if ('group' in n && change.name !== undefined) { change.group = change.name; delete change.name; }
      /* where it goes is said on the board, as for a new node: in a group, from the group's corner */
      const parent = n.parent ? byId().get(n.parent) : undefined;
      if (parent && Number.isFinite(change.x)) change.x -= parent.x;
      if (parent && Number.isFinite(change.y)) change.y -= parent.y;
      const allowed = new Set(['x', 'y', 'w', 'h', ...('text' in n ? ['text'] : []), ...('make' in n ? ['prompt', 'via', 'model', 'preset', 'opts', 'path'] : []),
        ...('group' in n ? ['group', 'color'] : []), ...('path' in n && !('make' in n) ? ['path'] : [])]);
      const odd = Object.keys(change).filter((k) => !allowed.has(k));
      if (odd.length) throw new CanvasOpError(`${step}: a ${kindOf(n)} node has no ${odd.join(', ')}; it has ${[...allowed].join(', ')}`);
      const [kept] = parseCanvas({ nodes: [{ ...n, ...change }], edges: [] }).nodes;
      if (!kept) throw new CanvasOpError(`${step}: ${n.id} could not be kept so`);
      nodes[nodes.indexOf(n)] = { ...kept, ...(n.parent ? { parent: n.parent } : {}) };
    } else if (op.op === 'remove') {
      const n = node(op.id);
      const gone = new Set([n.id, ...nodes.filter((m) => m.parent === n.id).map((m) => m.id)]);
      for (let k = nodes.length - 1; k >= 0; k--) if (gone.has(nodes[k].id)) nodes.splice(k, 1);
      edges = edges.filter((e) => !gone.has(e.from) && !gone.has(e.to));
    } else if (op.op === 'wire') {
      wire(node(op.from).id, node(op.to).id, op.order);
    } else if (op.op === 'unwire') {
      const before = edges.length;
      edges = edges.filter((e) => !(e.from === op.from && e.to === op.to));
      if (edges.length === before) throw new CanvasOpError(`${step}: there is no wire from ${op.from} to ${op.to}`);
    } else if (op.op === 'version') {
      const n = node(op.id);
      if (!('make' in n)) throw new CanvasOpError(`${step}: ${n.id} does not make anything; a file goes on the board with op add, kind file`);
      const path = await file(op.path, 'path');
      const m = /** @type {CanvasNode & { versions?: string[], path?: string, made?: string }} */ (n);
      m.versions = [...(m.versions ?? []).filter((v) => v !== path), path];
      m.path = path;
      delete m.made;
    } else throw new CanvasOpError(`${step}: op is one of add, set, remove, wire, unwire, version`);
  }
  settle(nodes, added);
  const kept = parseCanvas({ nodes, edges });
  if (kept.nodes.length < nodes.length) throw new CanvasOpError(`the board would have more than ${MAX_NODES} nodes`);
  return { canvas: kept, added };
}

/**
 * After an agent's steps: what it added kept clear of what is there (moved right of what it would lie on, as a row
 * goes on), and every group round what is in it (grown, never shrunk; what is in it stays where it is on the board).
 * @param {CanvasNode[]} nodes @param {string[]} added
 */
function settle(nodes, added) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  /* a card's title is drawn over it: it takes its room too */
  const overlap = (/** @type {{ x: number, y: number, w: number, h: number }} */ a, /** @type {typeof a} */ b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y - CARD_HEAD < b.y + b.h && b.y - CARD_HEAD < a.y + a.h;
  /* in the order they were added: each clear of what was there and of what was added before it */
  const later = new Set(added);
  for (const id of added) {
    const n = byId.get(id);
    later.delete(id);
    if (!n || 'group' in n) continue;
    for (let tries = 0; tries < 200; tries++) {
      const me = boxOf(n, byId);
      const hit = nodes.find((o) => o !== n && !later.has(o.id) && !('group' in o) && overlap(me, boxOf(o, byId)));
      if (!hit) break;
      const there = boxOf(hit, byId);
      n.x += there.x + there.w + GAP / 2 - me.x;
    }
  }
  for (const g of nodes) {
    if (!('group' in g)) continue;
    const kids = nodes.filter((n) => n.parent === g.id);
    if (!kids.length) continue;
    const sizes = kids.map((k) => boxOf(k, byId));
    const left = Math.min(0, ...kids.map((k) => k.x - GROUP_PAD));
    const top = Math.min(0, ...kids.map((k) => k.y - GROUP_PAD - GROUP_HEAD));
    if (left < 0 || top < 0) {
      g.x += left; g.y += top;
      for (const k of kids) { k.x -= left; k.y -= top; }
    }
    g.w = Math.max(g.w ?? KIND_SIZE.group.w, ...kids.map((k, i) => k.x + sizes[i].w + GROUP_PAD));
    g.h = Math.max(g.h ?? KIND_SIZE.group.h, ...kids.map((k, i) => k.y + sizes[i].h + GROUP_PAD));
  }
}

/**
 * Studio's `/api/canvas` (the CLI, with the launch key): `{ folder, ops?, by? }` → the board after the steps, kept and
 * shown at once (`changed`), or why not. Without steps: the board as it is.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {(root: string) => void} changed
 */
export async function agentCanvasRoute(req, res, changed) {
  if (req.method !== 'POST') throw new HttpError(404, 'no such API');
  const body = /** @type {{ folder?: unknown, ops?: unknown, by?: unknown }} */ (await readJson(req));
  const root = resolve(String(body.folder ?? ''));
  if (!(await stat(join(root, FILM_FILE)).catch(() => null))?.isFile()) return json(res, 200, { ok: false, code: 2, text: `${root} is not a project; \`openfilm open\` makes one` });
  /* the board the person has in front of them */
  const showing = shown.get(root);
  const board = showing && (await isBoard(root, showing)) ? showing : MAIN_BOARD;
  const canvas = await readCanvas(root, board);
  if (body.ops === undefined) return json(res, 200, { ok: true, canvas, added: [] });
  try {
    const exists = async (/** @type {string} */ path) => Boolean((await stat(join(root, path)).catch(() => null))?.isFile());
    const after = await applyCanvasOps(canvas, body.ops, { by: body.by, exists });
    const kept = await writeCanvas(root, after.canvas, board);
    changed(root);
    return json(res, 200, { ok: true, canvas: kept, added: after.added });
  } catch (e) {
    if (!(e instanceof CanvasOpError)) throw e;
    return json(res, 200, { ok: false, code: 2, text: e.message });
  }
}
