// @ts-check
/**
 * A project's canvas (`.film/canvas.json`): the board beside the edit where its material is laid out, notes written,
 * and what leads to what drawn. Studio's own, beside film.html, not in it (SPEC §1: an editor's own state lives in
 * `.film/`): nothing on it is in the film until it is put on the timeline.
 *
 * A node is a note (`text`), a file of the project (`path`, project-relative), a group (`group`, its name, and a
 * `color`) or a node that makes something with the person's services (`make`: image, video, sfx or music; its
 * `prompt`, `via` and `model`, its `opts`, the files it made, `versions`, the one shown `path`, `made` what it was asked
 * for that one, and `by`, the agent that put it there), at `x`, `y` on the board, `w` wide (and `h` high, for a note
 * or a group). A node in a group names it (`parent`), and its `x`, `y` are from the group's corner. An edge goes from
 * one node to another, `order` its place among those into that node.
 *
 *   GET canvas                    → { nodes, edges }
 *   PUT canvas { nodes, edges }   → { nodes, edges }: the whole board, as kept
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeAtomic } from './atomic.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { TOOL_DIR } from './projects.mjs';

export const CANVAS_FILE = `${TOOL_DIR}/canvas.json`;
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
const MAKE_KINDS = ['image', 'video', 'sfx', 'music'];
const VERSIONS_MAX = 50;
const SHORT_MAX = 120;

/**
 * @typedef {{ id: string, x: number, y: number, w?: number, h?: number, parent?: string } & ({ text: string } | { path: string } | { group: string, color: string } | { make: string })} CanvasNode
 * @typedef {{ id: string, from: string, to: string, order?: number }} CanvasEdge
 * @typedef {{ nodes: CanvasNode[], edges: CanvasEdge[] }} Canvas
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
    const parent = isId(n.parent) ? { parent: /** @type {string} */ (n.parent) } : {};
    if (MAKE_KINDS.includes(String(n.make))) out.nodes.push({ ...box, ...parent, ...readMake(n), make: String(n.make) });
    else if (projectPath(n.path)) out.nodes.push({ ...box, ...parent, path: /** @type {string} */ (n.path) });
    else if (typeof n.text === 'string') out.nodes.push({ ...box, ...parent, text: n.text.slice(0, TEXT_MAX) });
    else if (typeof n.group === 'string') {
      out.nodes.push({ ...box, group: n.group.trim().slice(0, NAME_MAX), color: GROUP_COLORS.includes(String(n.color)) ? String(n.color) : 'gray' });
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
  return out;
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
  };
  const versions = (Array.isArray(n.versions) ? n.versions : []).filter(projectPath).slice(-VERSIONS_MAX);
  const by = isRecord(n.by) && short(n.by.agent) ? { agent: n.by.agent, ...(short(n.by.session) ? { session: n.by.session } : {}) } : undefined;
  const fields = {
    prompt: typeof n.prompt === 'string' ? n.prompt.slice(0, TEXT_MAX) : '',
    via: short(n.via), model: short(n.model),
    opts: Object.keys(opts).length ? opts : undefined,
    versions: versions.length ? versions : undefined,
    path: versions.includes(n.path) ? n.path : versions.at(-1),
    made: short(n.made),
    by,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

/** @param {string} root @returns {Promise<Canvas>} */
export async function readCanvas(root) {
  try {
    return parseCanvas(JSON.parse(await readFile(join(root, CANVAS_FILE), 'utf8')));
  } catch { return { nodes: [], edges: [] }; }
}

/** @param {string} root @param {unknown} canvas @returns {Promise<Canvas>} */
export async function writeCanvas(root, canvas) {
  if (!isRecord(canvas) || !Array.isArray(canvas.nodes)) throw new HttpError(400, 'canvas: { nodes: [{ id, x, y, text | path }], edges: [{ id, from, to }] }');
  const kept = parseCanvas(canvas);
  await mkdir(dirname(join(root, CANVAS_FILE)), { recursive: true });
  await writeAtomic(join(root, CANVAS_FILE), `${JSON.stringify(kept, null, 1)}\n`);
  return kept;
}

/**
 * `canvas` of a project. True when it was this route.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 */
export async function canvasRoute(req, res, root, rest) {
  if (rest !== 'canvas') return false;
  if (req.method === 'GET') { json(res, 200, await readCanvas(root)); return true; }
  if (req.method === 'PUT') { json(res, 200, await writeCanvas(root, await readJson(req))); return true; }
  return false;
}
