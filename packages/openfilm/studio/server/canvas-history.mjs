// @ts-check
/**
 * What a project's canvases made (`.film/canvas-made.json`): each picture, clip or sound a making node was given,
 * noted as a board is written with it (canvas.mjs writeCanvas), so it is still there when its node is not. Studio's
 * own, as the boards are: what the board's history shows, newest first, this project's or every project's.
 *
 *   GET canvas-made            → { made: [{ path, make, prompt?, via?, model?, at }] }, newest first, files still there
 *   GET canvas-made?all=1      → the same for every project, each with `project` and `projectName`
 *   GET canvas-made/file?project=&path=     → the file itself, one noted there (its picture in the list)
 *   POST canvas-made/bring { project, path } → { path }: one made in another project, copied into this one's assets
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { writeAtomic } from './atomic.mjs';
import { bringIn } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { TOOL_DIR, listProjects, projectById } from './projects.mjs';

export const MADE_FILE = `${TOOL_DIR}/canvas-made.json`;
const MADE_MAX = 5000;
const SHOWN_MAX = 600;
const PROMPT_MAX = 400;
const KINDS = ['image', 'video', 'sfx', 'music', 'tts'];
const TYPES = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' });

/** @typedef {{ path: string, make: string, prompt?: string, via?: string, model?: string, at: number }} Made */

/** a path in the project, out of Studio's own folder @param {string} path */
const inProject = (path) => path.length > 0 && path.length <= 1024 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some((p) => p === '..' || p === '' || p === TOOL_DIR);

/** @param {string} root @returns {Promise<Made[]>} */
export async function readMade(root) {
  const raw = await readFile(join(root, MADE_FILE), 'utf8').then(JSON.parse, () => null);
  const list = Array.isArray(raw?.made) ? raw.made : [];
  return list.filter((/** @type {any} */ m) => m && typeof m.path === 'string' && inProject(m.path) && KINDS.includes(m.make) && typeof m.at === 'number');
}

/**
 * What a board holds that is not noted yet, noted (its node's words and model with it); `byFile`: when its file was
 * written (what boards made before there was a history), else now.
 * @param {string} root @param {{ nodes: Array<Record<string, unknown>> }} canvas @param {{ byFile?: boolean }} [o]
 */
export async function noteMade(root, canvas, { byFile = false } = {}) {
  const given = canvas.nodes.flatMap((n) => (typeof n.make === 'string' && Array.isArray(n.versions) ? n.versions.map((path) => ({ n, path: String(path) })) : []));
  if (!given.length) return;
  const made = await readMade(root);
  const known = new Set(made.map((m) => m.path));
  const now = Date.now();
  const unknown = given.filter(({ path }) => !known.has(path) && inProject(path));
  const when = byFile ? await Promise.all(unknown.map(({ path }) => stat(join(root, path)).then((s) => Math.round(s.mtimeMs), () => 0))) : [];
  const fresh = unknown.map(({ n, path }, i) => /** @type {Made} */ ({
    path, make: /** @type {string} */ (n.make), at: byFile ? when[i] || now : now + i,
    ...(typeof n.prompt === 'string' && n.prompt.trim() ? { prompt: n.prompt.trim().slice(0, PROMPT_MAX) } : {}),
    ...(typeof n.via === 'string' ? { via: n.via } : {}), ...(typeof n.model === 'string' ? { model: n.model } : {}),
  }));
  if (!fresh.length) return;
  if (byFile) fresh.sort((a, b) => a.at - b.at);
  await writeAtomic(join(root, MADE_FILE), `${JSON.stringify({ made: [...made, ...fresh].slice(-MADE_MAX) }, null, 1)}\n`);
}

/** what each of a project's boards holds, as written (`.film/canvas.json`, `.film/canvases/*.json`) @param {string} root */
async function boardNodes(root) {
  const files = [join(root, TOOL_DIR, 'canvas.json'), ...(await readdir(join(root, TOOL_DIR, 'canvases')).catch(() => [])).filter((f) => f.endsWith('.json')).map((f) => join(root, TOOL_DIR, 'canvases', f))];
  const boards = await Promise.all(files.map((f) => readFile(f, 'utf8').then(JSON.parse, () => null)));
  return boards.flatMap((b) => (Array.isArray(b?.nodes) ? b.nodes.filter((/** @type {unknown} */ n) => n && typeof n === 'object') : []));
}

/** what is noted and still in the project, newest first (what its boards made before there was a history noted first) @param {string} root */
async function stillThere(root) {
  await noteMade(root, { nodes: await boardNodes(root) }, { byFile: true }).catch(() => {});
  const made = (await readMade(root)).sort((a, b) => b.at - a.at).slice(0, SHOWN_MAX);
  const there = await Promise.all(made.map((m) => stat(join(root, m.path)).then((s) => s.isFile(), () => false)));
  return made.filter((_, i) => there[i]);
}

/**
 * A project's `canvas-made[/bring]`. True when it was this route.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest @param {URL} url
 */
export async function canvasMadeRoute(req, res, root, rest, url) {
  if (rest === 'canvas-made' && req.method === 'GET') {
    if (url.searchParams.get('all') !== '1') { json(res, 200, { made: await stillThere(root) }); return true; }
    const projects = (await listProjects()).filter((p) => !p.missing);
    const each = await Promise.all(projects.map(async (p) => (await stillThere(p.path)).map((m) => ({ ...m, project: p.id, projectName: p.name }))));
    json(res, 200, { made: each.flat().sort((a, b) => b.at - a.at).slice(0, SHOWN_MAX) });
    return true;
  }
  if (rest === 'canvas-made/file' && req.method === 'GET') {
    const id = url.searchParams.get('project');
    const from = id ? (await projectById(id).catch(() => null))?.path : root;
    const path = url.searchParams.get('path') ?? '';
    if (!from || !(await readMade(from)).some((m) => m.path === path)) throw new HttpError(404, 'not made on a canvas there');
    const bytes = await readFile(join(from, path)).catch(() => null);
    if (!bytes) throw new HttpError(404, 'no longer there');
    res.writeHead(200, { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=3600' });
    res.end(bytes);
    return true;
  }
  if (rest === 'canvas-made/bring' && req.method === 'POST') {
    const body = /** @type {{ project?: unknown, path?: unknown }} */ (await readJson(req));
    const from = typeof body.project === 'string' ? await projectById(body.project) : null;
    if (!from) throw new HttpError(404, 'no such project');
    const made = (await readMade(from.path)).find((m) => m.path === body.path);
    if (!made) throw new HttpError(404, 'that was not made on its canvas');
    const [path] = await bringIn(root, dirname(made.path), [join(from.path, made.path)], 'copy');
    json(res, 200, { path });
    return true;
  }
  return false;
}
