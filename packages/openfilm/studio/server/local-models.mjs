// @ts-check
/**
 * The models that run on this computer: Settings → Services → Local models. Each is fetched from OpenFilm's published
 * library, checked, and kept in the library's cache for every OpenFilm here; nothing it is given leaves the computer,
 * and it costs nothing. A model is installed or not, and an installed one on or off (off: kept, not used).
 *
 *   GET    /api/local-models                every model, with where it stands (shown)
 *   POST   /api/local-models/<id>/install   fetched now, in a process of its own; GET says how far it is
 *   PUT    /api/local-models/<id>           { on }: used or not
 *   DELETE /api/local-models/<id>           its files thrown away, and off
 *
 * The first: the library search's sentence model (src/library-semantic.mjs), which a search fetches by itself unless it
 * was turned off or removed here.
 */
import { HttpError, json, readJson } from './http.mjs';
import { manifest, modelBuiltIn, modelBytesHere, modelFetching, removeModel, semanticOn, semanticReady, setSemanticOn } from '../../src/library-semantic.mjs';

/**
 * What a model is, for its page: what it is for (`kind`), who made it and where they publish it, its license, and
 * about how much memory it takes while it runs (measured).
 * @typedef {{ kind: 'search', name: string, by: string, site: string, license: string, memoryMb: number }} About
 */

/** @type {Record<string, About>} */
const ABOUT = {
  'multilingual-e5-small': { kind: 'search', name: 'Multilingual E5 Small', by: 'Microsoft', site: 'huggingface.co/intfloat/multilingual-e5-small', license: 'MIT', memoryMb: 600 },
};

/** Every model, as Settings shows it. */
export function localModels() {
  const m = manifest();
  const about = m ? ABOUT[m.model] : undefined;
  if (!m || !about) return [];
  const ready = semanticReady(m);
  const coming = !ready && modelFetching(m);
  return [{
    id: m.model,
    ...about,
    bytes: m.files.reduce((n, f) => n + f.bytes, 0),
    installed: ready,
    on: ready && semanticOn(m),
    builtIn: ready && modelBuiltIn(m),
    ...(coming ? { installing: { bytes: modelBytesHere(m) } } : {}),
  }];
}

/**
 * The API above.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts
 */
export async function localModelsRoute(req, res, parts) {
  if (!parts.length && req.method === 'GET') return json(res, 200, { models: localModels() });
  const m = manifest();
  if (!m || parts[0] !== m.model) throw new HttpError(404, 'no such model');
  if (parts.length === 2 && parts[1] === 'install' && req.method === 'POST') setSemanticOn(true, m);
  else if (parts.length === 1 && req.method === 'PUT') {
    const { on } = /** @type {{ on?: unknown }} */ (await readJson(req) ?? {});
    if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
    if (on && !semanticReady(m)) throw new HttpError(409, 'install it first');
    setSemanticOn(on, m);
  } else if (parts.length === 1 && req.method === 'DELETE') {
    if (modelBuiltIn(m)) throw new HttpError(409, 'it is part of this checkout');
    removeModel(m);
  } else throw new HttpError(404, 'no such thing');
  return json(res, 200, { models: localModels() });
}
