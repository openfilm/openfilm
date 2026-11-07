// @ts-check
/**
 * The models that run on this computer: Settings → Services → Local services. Each is fetched from OpenFilm's published
 * library, checked, and kept in the library's cache for every OpenFilm here (src/local-models.mjs); nothing it is given
 * leaves the computer, and it costs nothing. A model is installed or not, and an installed one on or off (off: kept,
 * not used).
 *
 *   GET    /api/local-models                every model, with where it stands (shown)
 *   POST   /api/local-models/<id>/install   fetched now, in a process of its own; GET says how far it is
 *   PUT    /api/local-models/<id>           { on }: used or not
 *   DELETE /api/local-models/<id>           its files thrown away, and off
 *
 * They are what Local services runs (providers/local.mjs): transcripts and pictures' backgrounds; one coming, going
 * or turned on or off moves what Settings → Services chose for its kind (providers/index.mjs localModelsChanged).
 */
import { HttpError, json, readJson } from './http.mjs';
import { modelBuiltIn, modelBytesHere, modelEntries, modelEntry, modelFailed, modelFetching, modelOn, modelReady, removeModel, setModelOn } from '../../src/local-models.mjs';
import { localModelsChanged } from './providers/index.mjs';

/**
 * What a model is, for its page: what it is for (`kind`), who made it and where they publish it, its license, and
 * about how much memory it takes while it runs (measured).
 * @typedef {{ kind: 'asr' | 'cutout', name: string, by: string, site: string, license: string, memoryMb: number }} About
 */

/** @type {Record<string, About>} */
const ABOUT = {
  'whisper-small': { kind: 'asr', name: 'Whisper Small', by: 'OpenAI', site: 'github.com/openai/whisper', license: 'MIT', memoryMb: 1800 },
  'whisper-large-v3-turbo': { kind: 'asr', name: 'Whisper Large v3 Turbo', by: 'OpenAI', site: 'github.com/openai/whisper', license: 'MIT', memoryMb: 2400 },
  'birefnet-lite': { kind: 'cutout', name: 'BiRefNet Lite', by: 'Nankai University', site: 'github.com/ZhengPeng7/BiRefNet', license: 'MIT', memoryMb: 2600 },
};

/** Every model, as Settings shows it. */
export function localModels() {
  return modelEntries().filter((m) => ABOUT[m.id]).map((m) => {
    const ready = modelReady(m);
    const coming = !ready && modelFetching(m);
    return {
      id: m.id,
      ...ABOUT[m.id],
      bytes: m.files.reduce((n, f) => n + f.bytes, 0),
      installed: ready,
      on: ready && modelOn(m),
      builtIn: ready && modelBuiltIn(m),
      ...(coming ? { installing: { bytes: modelBytesHere(m) } } : {}),
      /* its last download failed (offline, or a file that did not check) */
      ...(!ready && !coming && modelFailed(m) ? { failed: true } : {}),
    };
  });
}

/**
 * The API above.
 * @param {import('./http.mjs').Req} req @param {import('./http.mjs').Res} res @param {string[]} parts
 */
export async function localModelsRoute(req, res, parts) {
  if (!parts.length && req.method === 'GET') {
    /* Capture readiness first: a download can finish while provider settings are read. Never report a model as
       installed before the provider refresh below has had a chance to select it for its kind. */
    const models = localModels();
    /* one that finished coming since: its kind may go to it now */
    await localModelsChanged();
    return json(res, 200, { models });
  }
  const m = ABOUT[parts[0]] ? modelEntry(parts[0]) : null;
  if (!m) throw new HttpError(404, 'no such model');
  if (parts.length === 2 && parts[1] === 'install' && req.method === 'POST') setModelOn(true, m);
  else if (parts.length === 1 && req.method === 'PUT') {
    const { on } = /** @type {{ on?: unknown }} */ (await readJson(req) ?? {});
    if (typeof on !== 'boolean') throw new HttpError(400, 'on: true or false');
    if (on && !modelReady(m)) throw new HttpError(409, 'install it first');
    setModelOn(on, m);
  } else if (parts.length === 1 && req.method === 'DELETE') {
    if (modelBuiltIn(m)) throw new HttpError(409, 'it is part of this checkout');
    removeModel(m);
  } else throw new HttpError(404, 'no such thing');
  const models = localModels();
  await localModelsChanged();
  return json(res, 200, { models });
}
