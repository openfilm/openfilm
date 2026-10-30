// @ts-check
/**
 * The person's canvas templates: a group of a canvas kept to be laid down again on any project's canvas, as a way of
 * working (a beat, its picture, the clip made from it). Kept in the shared Studio home (`canvas-templates/<id>/`), so
 * every OpenFilm on this computer has them: `template.json` (its name and its board, the group's corner at 0, 0) and
 * `files/`, the files its file nodes show. What its making nodes made is not kept: a template keeps what they are asked.
 *
 *   GET    /api/canvas-templates                    → { templates: [{ id, name, nodes, created }] }
 *   DELETE /api/canvas-templates/:id                → {}
 *   POST   /api/projects/:id/canvas-templates      { name, nodes, edges } → { template }: kept from that project
 *   POST   /api/projects/:id/canvas-templates/:tid → { nodes, edges }: its files copied into the project's assets/,
 *                                                     ready to be laid down
 *
 * An example film's canvas is laid down the same way (copyBoardInto), what it made with it.
 */
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { sharedHome } from '../../src/locations.mjs';
import { writeAtomic } from './atomic.mjs';
import { parseCanvas } from './canvas.mjs';
import { HttpError, json, readJson } from './http.mjs';

const NAME_MAX = 80;
const TEMPLATES_MAX = 200;
const ID = /^[a-z0-9-]{1,80}$/;

export const templatesDir = () => join(sharedHome(), 'canvas-templates');

/** @param {string} name */
const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'template';

/** A file name not taken in `taken` (as it is, else with -2, -3… before its extension). @param {string} name @param {Set<string>} taken */
function freeName(name, taken) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let n = 1;
  let candidate = name;
  while (taken.has(candidate.toLowerCase())) candidate = `${stem}-${++n}${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * What a template keeps of a board: its nodes and the wires between them, moved so they start at 0, 0, without who
 * put them there or what the making nodes made. @param {unknown} raw
 */
export function templateBoard(raw) {
  const { nodes, edges } = parseCanvas(raw);
  const top = nodes.filter((n) => !n.parent);
  const x0 = top.length ? Math.min(...top.map((n) => n.x)) : 0;
  const y0 = top.length ? Math.min(...top.map((n) => n.y)) : 0;
  return {
    nodes: nodes.map((n) => {
      const { by: _by, versions: _versions, made: _made, ...rest } = /** @type {Record<string, unknown> & { x: number, y: number, parent?: string }} */ (n);
      if ('make' in rest) delete rest.path;
      return n.parent ? rest : { ...rest, x: n.x - x0, y: n.y - y0 };
    }),
    edges,
  };
}

/** The templates kept, newest first. */
export async function listTemplates() {
  const names = await readdir(templatesDir()).catch(() => []);
  const all = await Promise.all(names.filter((id) => ID.test(id)).map(async (id) => {
    try {
      const kept = JSON.parse(await readFile(join(templatesDir(), id, 'template.json'), 'utf8'));
      return { id, name: String(kept.name ?? id), nodes: Array.isArray(kept.nodes) ? kept.nodes.length : 0, created: Number(kept.created) || 0 };
    } catch { return null; }
  }));
  return all.filter((t) => t !== null).sort((a, b) => b.created - a.created);
}

/**
 * Keep a template named `name` of `board`, a part of the canvas of the project at `root`: its files copied in with it.
 * @param {string} root @param {string} name @param {unknown} board
 */
export async function saveTemplate(root, name, board) {
  const title = String(name ?? '').trim().slice(0, NAME_MAX);
  if (!title) throw new HttpError(400, 'a template has a name');
  const kept = templateBoard(board);
  if (!kept.nodes.length) throw new HttpError(400, 'a template has something in it');
  if ((await listTemplates()).length >= TEMPLATES_MAX) throw new HttpError(409, `there are ${TEMPLATES_MAX} templates: remove some first`);
  const id = `${slug(title)}-${randomBytes(3).toString('hex')}`;
  const dir = join(templatesDir(), id);
  await mkdir(join(dir, 'files'), { recursive: true });
  const taken = new Set();
  /** @type {Map<string, string>} */
  const copied = new Map();
  for (const n of kept.nodes) {
    if (!('path' in n) || typeof n.path !== 'string') continue;
    if (!copied.has(n.path)) {
      const from = join(root, n.path);
      if (!(await stat(from).catch(() => null))?.isFile()) { copied.set(n.path, ''); continue; }
      const file = freeName(basename(n.path), taken);
      await copyFile(from, join(dir, 'files', file));
      copied.set(n.path, `files/${file}`);
    }
  }
  /* a file not there any more is left out of it, with its wires */
  const nodes = kept.nodes.filter((n) => !('path' in n) || copied.get(/** @type {string} */ (n.path)))
    .map((n) => ('path' in n ? { ...n, path: copied.get(/** @type {string} */ (n.path)) } : n));
  const ids = new Set(nodes.map((n) => n.id));
  const template = { name: title, created: Date.now(), nodes, edges: kept.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  await writeAtomic(join(dir, 'template.json'), `${JSON.stringify(template, null, 1)}\n`);
  return { id, name: title, nodes: nodes.length, created: template.created };
}

/** what goes from one board to another: a picture, a clip, a sound (a page needs the pages and files it loads) */
const MEDIA = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|aac|flac)$/i;

/**
 * A board from `from` (a template's folder, an example film) ready for the project at `root`: each media file it shows
 * (a file node's, what a making node made) copied into `into` there (a name taken there gets a number), its board
 * naming them there; a file `from` has not, or that is not media, is left out, with its wires.
 * @param {string} root @param {string} from @param {unknown} board @param {string} into
 */
export async function copyBoardInto(root, from, board, into) {
  const { nodes, edges } = parseCanvas(board);
  await mkdir(join(root, into), { recursive: true });
  const taken = new Set((await readdir(join(root, into)).catch(() => [])).map((f) => f.toLowerCase()));
  /** @type {Map<string, string | null>} */
  const placed = new Map();
  const place = async (/** @type {string} */ path) => {
    if (!placed.has(path)) {
      const source = join(from, path);
      if (!MEDIA.test(path) || !(await stat(source).catch(() => null))?.isFile()) placed.set(path, null);
      else {
        const file = freeName(basename(path), taken);
        await copyFile(source, join(root, into, file));
        placed.set(path, `${into}/${file}`);
      }
    }
    return placed.get(path) ?? null;
  };
  const kept = [];
  for (const n of nodes) {
    const node = /** @type {Record<string, any>} */ ({ ...n });
    if ('make' in node) {
      const versions = (await Promise.all((node.versions ?? []).map(place))).filter(Boolean);
      const shown = node.path ? await place(node.path) : null;
      if (versions.length) { node.versions = versions; node.path = shown && versions.includes(shown) ? shown : versions.at(-1); }
      else { delete node.versions; delete node.path; delete node.made; }
    } else if ('path' in node) {
      node.path = await place(node.path);
      if (!node.path) continue;
    }
    kept.push(node);
  }
  return parseCanvas({ nodes: kept, edges });
}

/**
 * A template ready for the project at `root`: its files copied into `assets/templates/<its name>/` (copyBoardInto).
 * @param {string} root @param {string} id
 */
export async function useTemplate(root, id) {
  if (!ID.test(id)) throw new HttpError(404, 'no such template');
  const dir = join(templatesDir(), id);
  const kept = await readFile(join(dir, 'template.json'), 'utf8').then(JSON.parse, () => null);
  if (!kept) throw new HttpError(404, 'no such template');
  return copyBoardInto(root, dir, kept, `assets/templates/${slug(String(kept.name ?? id))}`);
}

/** `/api/canvas-templates[/:id]`: the list, and one removed. @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts */
export async function templatesRoute(req, res, parts) {
  if (!parts.length && req.method === 'GET') return json(res, 200, { templates: await listTemplates() });
  if (parts.length === 1 && req.method === 'DELETE' && ID.test(parts[0])) {
    await rm(join(templatesDir(), parts[0]), { recursive: true, force: true });
    return json(res, 200, {});
  }
  throw new HttpError(404, 'no such API');
}

/**
 * A project's `canvas-templates[/:tid]`: one kept from its canvas, one laid down on it. True when it was this route.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 */
export async function projectTemplatesRoute(req, res, root, rest) {
  const [head, id, more] = rest.split('/');
  if (head !== 'canvas-templates' || more !== undefined || req.method !== 'POST') return false;
  if (id === undefined) {
    const body = /** @type {{ name?: unknown, nodes?: unknown, edges?: unknown }} */ (await readJson(req));
    json(res, 200, { template: await saveTemplate(root, String(body.name ?? ''), { nodes: body.nodes, edges: body.edges }) });
    return true;
  }
  json(res, 200, await useTemplate(root, decodeURIComponent(id)));
  return true;
}
