// @ts-check
/**
 * The person's characters: a name, a few words of who they are and their pictures (a portrait, the full body, their
 * expressions, a turnaround, or any other), kept to be put on any project's canvas and used as a reference, so the
 * same person looks the same in every picture and clip made of them. Kept in the shared Studio home
 * (`canvas-characters/<id>/`), as the canvas templates are: `character.json` and `files/`.
 *
 *   GET    /api/canvas-characters                        → { characters: [{ id, name, about?, created, pictures: [{ role, url }] }] }
 *   GET    /api/canvas-characters/:id/files/:file         → the picture
 *   PATCH  /api/canvas-characters/:id { name?, about? }   → { character }
 *   DELETE /api/canvas-characters/:id                     → {}: into the trash
 *   POST   /api/projects/:pid/canvas-characters { name, about?, pictures: [{ role, path }] } → { character }: kept from
 *          that project's files
 *   POST   /api/projects/:pid/canvas-characters/:id      → { name, about?, pictures: [{ role, path }] }: its pictures
 *          copied into the project's assets/characters/<name>/, ready to be laid down
 */
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { sharedHome } from '../../src/locations.mjs';
import { writeAtomic } from './atomic.mjs';
import { inProject } from './files.mjs';
import { HttpError, json, readJson } from './http.mjs';
import { moveToTrash } from './trash.mjs';

const NAME_MAX = 60;
const ABOUT_MAX = 2000;
const PICTURES_MAX = 12;
const CHARACTERS_MAX = 500;
const ID = /^[a-z0-9-]{1,80}$/;
const FILE = /^[a-z0-9-]{1,40}\.(png|jpe?g|webp)$/;
export const ROLES = ['face', 'body', 'expressions', 'turnaround', 'other'];
const TYPES = /** @type {Record<string, string>} */ ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' });

export const charactersDir = () => join(sharedHome(), 'canvas-characters');

/** @param {string} name */
const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'character';
/** @param {unknown} v */
const clean = (v, max = NAME_MAX) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

/** @typedef {{ name: string, about?: string, created: number, pictures: Array<{ role: string, file: string }> }} Kept */

/** @param {string} id @returns {Promise<Kept | null>} */
async function readKept(id) {
  if (!ID.test(id)) return null;
  const raw = await readFile(join(charactersDir(), id, 'character.json'), 'utf8').then(JSON.parse, () => null);
  if (!raw || typeof raw.name !== 'string') return null;
  const pictures = (Array.isArray(raw.pictures) ? raw.pictures : []).filter((/** @type {any} */ p) => p && ROLES.includes(p.role) && FILE.test(String(p.file)));
  return { name: raw.name, ...(typeof raw.about === 'string' && raw.about ? { about: raw.about } : {}), created: Number(raw.created) || 0, pictures };
}

/** @param {string} id @param {Kept} kept */
const shown = (id, kept) => ({
  id, name: kept.name, ...(kept.about ? { about: kept.about } : {}), created: kept.created,
  pictures: kept.pictures.map((p) => ({ role: p.role, url: `/api/canvas-characters/${id}/files/${p.file}` })),
});

export async function listCharacters() {
  const ids = await readdir(charactersDir()).catch(() => []);
  const all = await Promise.all(ids.map(async (id) => { const kept = await readKept(id); return kept ? shown(id, kept) : null; }));
  return all.filter((c) => c !== null).sort((a, b) => b.created - a.created);
}

/**
 * A character kept from the project at `root`: its pictures copied in with it.
 * @param {string} root @param {unknown} body
 */
export async function saveCharacter(root, body) {
  const b = /** @type {{ name?: unknown, about?: unknown, pictures?: unknown }} */ (body ?? {});
  const name = clean(b.name);
  if (!name) throw new HttpError(400, 'a character has a name');
  const given = (Array.isArray(b.pictures) ? b.pictures : []).filter((/** @type {any} */ p) => p && typeof p.path === 'string' && TYPES[extname(p.path).toLowerCase()]).slice(0, PICTURES_MAX);
  if (!given.length) throw new HttpError(400, 'a character has a picture: a PNG, JPEG or WebP of the project');
  if ((await listCharacters()).length >= CHARACTERS_MAX) throw new HttpError(409, `there are ${CHARACTERS_MAX} characters: remove some first`);
  const id = `${slug(name)}-${randomBytes(3).toString('hex')}`;
  const dir = join(charactersDir(), id);
  await mkdir(join(dir, 'files'), { recursive: true });
  /** @type {Kept['pictures']} */
  const pictures = [];
  for (const [i, p] of given.entries()) {
    const path = String(p.path);
    const from = inProject(root, path);
    if (!from || !(await stat(from).catch(() => null))?.isFile()) continue;
    const role = ROLES.includes(p.role) ? p.role : 'other';
    const file = `${role}-${i + 1}${extname(path).toLowerCase()}`;
    await copyFile(from, join(dir, 'files', file));
    pictures.push({ role, file });
  }
  if (!pictures.length) throw new HttpError(400, 'none of its pictures is in the project');
  /** @type {Kept} */
  const kept = { name, ...(clean(b.about, ABOUT_MAX) ? { about: clean(b.about, ABOUT_MAX) } : {}), created: Date.now(), pictures };
  await writeAtomic(join(dir, 'character.json'), `${JSON.stringify(kept, null, 1)}\n`);
  return shown(id, kept);
}

/**
 * A character's pictures copied into the project at `root` (`assets/characters/<its name>/`; a name taken there gets
 * a number), ready to be laid down.
 * @param {string} root @param {string} id
 */
export async function useCharacter(root, id) {
  const kept = await readKept(id);
  if (!kept) throw new HttpError(404, 'no such character');
  const into = `assets/characters/${slug(kept.name)}`;
  await mkdir(join(root, into), { recursive: true });
  const taken = new Set((await readdir(join(root, into)).catch(() => [])).map((f) => f.toLowerCase()));
  const pictures = [];
  for (const p of kept.pictures) {
    const ext = extname(p.file);
    let file = `${slug(kept.name)}-${p.role}${ext}`;
    for (let n = 2; taken.has(file.toLowerCase()); n++) file = `${slug(kept.name)}-${p.role}-${n}${ext}`;
    taken.add(file.toLowerCase());
    await copyFile(join(charactersDir(), id, 'files', p.file), join(root, into, file));
    pictures.push({ role: p.role, path: `${into}/${file}` });
  }
  return { name: kept.name, ...(kept.about ? { about: kept.about } : {}), pictures };
}

/** `/api/canvas-characters[/:id[/files/:file]]` @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts */
export async function charactersRoute(req, res, parts) {
  const [id, files, file, more] = parts;
  if (id === undefined && req.method === 'GET') return json(res, 200, { characters: await listCharacters() });
  if (id === undefined || !ID.test(id) || more !== undefined) throw new HttpError(404, 'no such API');
  if (files === 'files' && file !== undefined && req.method === 'GET') {
    if (!FILE.test(file)) throw new HttpError(404, 'no such picture');
    const bytes = await readFile(join(charactersDir(), id, 'files', file)).catch(() => null);
    if (!bytes) throw new HttpError(404, 'no such picture');
    res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'private, max-age=86400' });
    res.end(bytes);
    return undefined;
  }
  if (files !== undefined) throw new HttpError(404, 'no such API');
  const kept = await readKept(id);
  if (!kept) throw new HttpError(404, 'no such character');
  if (req.method === 'PATCH') {
    const body = /** @type {{ name?: unknown, about?: unknown }} */ (await readJson(req));
    const name = body.name === undefined ? kept.name : clean(body.name);
    if (!name) throw new HttpError(400, 'a character has a name');
    const about = body.about === undefined ? kept.about : clean(body.about, ABOUT_MAX);
    const next = { ...kept, name, ...(about ? { about } : {}) };
    if (!about) delete next.about;
    await writeAtomic(join(charactersDir(), id, 'character.json'), `${JSON.stringify(next, null, 1)}\n`);
    return json(res, 200, { character: shown(id, next) });
  }
  if (req.method === 'DELETE') {
    await moveToTrash(join(charactersDir(), id));
    return json(res, 200, {});
  }
  throw new HttpError(404, 'no such API');
}

/**
 * A project's `canvas-characters[/:id]`: one kept from its files, one's pictures brought into it. True when it was this route.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string} root @param {string} rest
 */
export async function projectCharactersRoute(req, res, root, rest) {
  const [head, id, more] = rest.split('/');
  if (head !== 'canvas-characters' || more !== undefined || req.method !== 'POST') return false;
  if (id === undefined) json(res, 200, { character: await saveCharacter(root, await readJson(req)) });
  else json(res, 200, await useCharacter(root, decodeURIComponent(id)));
  return true;
}
