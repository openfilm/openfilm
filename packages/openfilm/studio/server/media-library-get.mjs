// @ts-check
/**
 * `openfilm get my-media`: the person's own media for an agent (media-library.mjs): what they kept in Saved to use in
 * every film, and the footage, pictures and sound in the folders of this computer they added. An agent looks there
 * before OpenFilm's library and before making anything: what the person shot or already paid for is the film's first
 * material. Free, offline, and answered here from the index, with no Studio running.
 *
 * A file is named by its fingerprint, so the name holds while the file is renamed or moved. `--take <id>` brings it
 * into the project the way media the person brings in comes (no room taken twice where the disk allows; one the
 * project has already is that one) and says its path there.
 */
import { basename } from 'node:path';
import { fingerprint } from '../../src/media-fingerprint.mjs';
import { projectRecordFile, readRecord } from './media-index.mjs';
import { fileIn, placeOf, searchLibrary, takeByFingerprint } from './media-library.mjs';
import { wordsByFingerprint } from './media-made.mjs';
import { listProjects } from './projects.mjs';

export const MY_MEDIA = 'my-media';

/** The verb as `openfilm get` lists it, with OpenFilm's own library's. */
export const myMediaVerb = () => ({
  verb: MY_MEDIA,
  help: 'Free and offline: the person\'s own media (Mine), what they keep to use in every film and the footage, pictures and sound they linked into it from this computer. Look here first, before OpenFilm\'s library and before making anything. '
    + 'Words find a file by its name, its folders, or the prompt a generated one was made with; without words, the newest. '
    + 'Each match says its id, what it is, where it is and which projects use it. --take <id> brings it into the project and says its path.',
  options: {
    prompt: { value: 'text' }, kind: { value: 'kind', choices: ['video', 'image', 'audio'] },
    limit: { value: 'n', min: 1, max: 50, default: 12, alias: 'n' }, take: { value: 'id' },
  },
});

const size = (/** @type {number} */ bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/**
 * `openfilm get my-media [--prompt <words>] [--kind video|image|audio] [--limit n]`, or
 * `--take <id>` with the project folder the command was run in. `code` as `openfilm get` has it: 0 done, 1 it did not
 * run, 2 a wrong command.
 * @param {Record<string, string | true | (string | true)[]>} flags @param {string | null} folder the project around the current folder
 * @returns {Promise<{ code: number, lines: string[] }>}
 */
export async function myMediaGet(flags, folder) {
  const wrong = (/** @type {string} */ text) => ({ code: 2, lines: [`openfilm get ${MY_MEDIA}: ${text}`] });
  const spec = myMediaVerb().options;
  const { n, ...given } = flags;
  if (n !== undefined && given.limit === undefined) given.limit = n;
  const unknown = Object.keys(given).find((name) => !(name in spec));
  if (unknown) return wrong(`there is no --${unknown}; it takes ${Object.keys(spec).map((o) => `--${o}`).join(', ')}`);
  for (const name of ['prompt', 'kind', 'limit', 'take']) if (given[name] !== undefined && typeof given[name] !== 'string') return wrong(`--${name} takes a value, once`);
  const { prompt, kind, limit, take } = /** @type {Record<string, string | undefined>} */ (given);

  if (take !== undefined) {
    if (!folder) return wrong('run it in the film\'s folder: the file is brought into that project');
    const fp = /^[0-9a-f]{32}$/.test(take) ? `f1-${take}` : take;
    const path = await takeByFingerprint(fp, folder).catch(() => null);
    if (!path) return { code: 1, lines: [`openfilm get ${MY_MEDIA}: no file ${take} in the person's media library now. Search again: it may have been removed, or be on a disk that is not connected.`] };
    return { code: 0, lines: [`In the project as ${path}. Use it as a clip's src in film.html.`] };
  }

  if (kind !== undefined && !spec.kind.choices.includes(kind)) return wrong(`--kind is one of ${spec.kind.choices.join(', ')}`);
  const count = limit === undefined ? spec.limit.default : Number(limit);
  if (!(Number.isInteger(count) && count >= spec.limit.min && count <= spec.limit.max)) return wrong(`--limit is a whole number from ${spec.limit.min} to ${spec.limit.max}, not ${limit}`);
  const q = (prompt ?? '').trim();
  const { files, total } = await searchLibrary({ q, kind: kind ?? null, sort: 'date', limit: count });
  const what = kind ?? '';
  if (!files.length) {
    return { code: 0, lines: [`Nothing in the person's media library${q ? ` for “${q}”` : ''}${what ? ` (${what})` : ''}. `
      + 'It finds a file by its name, folders and prompt, not by what is in the picture: try other words, or fewer. Then OpenFilm\'s library (`openfilm get`), or make it.'] };
  }
  /* which projects have each, and the prompt of what a service made: what tells a file from its neighbours */
  const projects = (await listProjects()).filter((p) => !p.missing);
  const records = projects.map((p) => ({ name: p.name || basename(p.path), fps: new Set(Object.values(readRecord(projectRecordFile(p.path)).files).filter((e) => !e.gone).map((e) => e.fp)) }));
  const asked = await wordsByFingerprint();
  const lines = [`${files.length}${total > files.length ? ` of ${total}` : ''} in the person's media library${q ? ` for “${q}”` : ''}${what ? ` (${what})` : ''}, what is kept in Saved first, then the newest:`, ''];
  for (const [i, f] of files.entries()) {
    const at = await placeOf(f.place);
    const file = at ? fileIn(at, f.path) : null;
    const fp = file ? await fingerprint(file.abs).catch(() => null) : null;
    if (!fp) continue;
    const usedIn = records.filter((r) => r.fps.has(fp)).map((r) => r.name);
    lines.push(`${String(i + 1).padStart(2)}. ${f.name}   ${f.kind} · ${size(f.size)} · ${new Date(f.mtime).toISOString().slice(0, 10)}`);
    lines.push(`    id ${fp.slice(3)}`);
    lines.push(`    in ${f.place === 'saved' ? `${f.where}, kept by the person to use in every film` : f.where}`);
    if (asked.get(fp)) lines.push(`    made with the prompt: ${JSON.stringify(/** @type {string} */ (asked.get(fp)).slice(0, 300))}`);
    lines.push(`    ${usedIn.length ? `used in: ${usedIn.join(', ')}` : 'not used in any project yet'}`);
  }
  lines.push('', `Bring one into the film: \`openfilm get ${MY_MEDIA} --take <id>\` (it says its path in the project; then look at it before you use it).`);
  return { code: 0, lines };
}
