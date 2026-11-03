// @ts-check
/**
 * Semantic search of the library: what is asked and what each thing is, as vectors of one small multilingual sentence
 * model (multilingual-e5-small, int8, src/sentence-model.mjs), compared by cosine, so `sad goodbye at a train station`
 * finds a farewell on strings with no word in common. library-search.mjs merges its order with the keyword search's,
 * by reciprocal rank.
 *
 *   library/vectors.i8, vectors.json   each thing's vector, made offline with the model (scripts/library-vectors.mjs)
 *                                      from what it is (passageOf): int8, a scale each, in the order of vectors.json's ids
 *   library/models.json                the model's files and its runtime, each with its size and sha256
 *
 * The things' vectors come with the package; what is asked is turned into a vector by OpenFilm's service (`POST
 * /v1/library/query` on openfilm.dev, or OPENFILM_API_URL: free, no account, the words of the search and nothing
 * else), so no computer here downloads or runs the model. The comparing is done here. Offline, or the service not
 * answering: the keyword search alone.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceUrl } from '../studio/server/providers/common.mjs';
import { builtInRoot, libraryFile } from '../studio/server/library.mjs';
import { loadEmbedder } from './sentence-model.mjs';

/** @typedef {{ path: string, bytes: number, sha256: string }} ModelFile */
/** @typedef {{ version: number, model: string, dims: number, onnx: string, tokenizer: string, runtime: string, files: ModelFile[] }} Manifest */

/** The model and its runtime, as library/models.json lists them; null without one. @returns {Manifest | null} */
export function manifest() {
  try { return JSON.parse(readFileSync(join(builtInRoot(), 'models.json'), 'utf8')); } catch { return null; }
}

/** @type {Promise<(text: string) => Promise<Float32Array>> | null} */
let loading = null;

/** The model run here, from the library's files on this computer (scripts/library-vectors.mjs makes the vectors with it). */
export function embedder(m = /** @type {Manifest} */ (manifest())) {
  const at = (/** @type {string} */ rel) => /** @type {string} */ (libraryFile(rel));
  loading ??= loadEmbedder({ runtime: at(m.runtime), onnx: at(m.onnx), tokenizer: at(m.tokenizer) });
  return loading;
}

/* ── the things' vectors ─────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What a thing is, in the words its vector is made from: its category, names (English and Chinese), what it is about,
 * its group, its tags (English and Chinese), how lively it is and its tempo.
 * @param {{ cat: string, group: string, name: Record<string, string>, about?: string, tags?: string[], energy?: number, bpm?: number }} item
 * @param {{ byId: Map<string, { name: Record<string, string> }> }} vocab the tags (library-words.mjs vocabulary)
 * @param {{ name: Record<string, string> } | undefined} group
 */
export function passageOf(item, vocab, group) {
  const tags = (item.tags ?? []).map((t) => vocab.byId.get(t)?.name).filter(Boolean);
  const lively = ['', 'very calm', 'calm', 'moderate', 'lively', 'very energetic'][item.energy ?? 0] ?? '';
  return [`passage: ${item.cat}: ${item.name.en} (${item.name['zh-CN']}).`, item.about ?? '', group ? `${group.name.en}.` : '',
    tags.length ? `${tags.map((n) => n?.en).join(', ')}. ${tags.map((n) => n?.['zh-CN']).join('，')}.` : '',
    [lively, item.bpm ? `${item.bpm} bpm` : ''].filter(Boolean).join(', ')].filter(Boolean).join(' ');
}

/** @type {{ ids: string[], scales: Float32Array, values: Int8Array, dims: number, model: string } | null | undefined} */
let vectors;

/** The things' vectors as the package has them; null without them. */
export function itemVectors() {
  if (vectors !== undefined) return vectors;
  try {
    const about = JSON.parse(readFileSync(join(builtInRoot(), 'vectors.json'), 'utf8'));
    const bytes = readFileSync(join(builtInRoot(), 'vectors.i8'));
    vectors = { ids: about.ids, scales: Float32Array.from(about.scales), values: new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length), dims: about.dims, model: about.model };
  } catch {
    vectors = null;
  }
  return vectors;
}

/** How long a search waits for the service before it goes on with keywords alone. */
export const QUERY_TIMEOUT_MS = 2500;
/** What was asked lately, and its vector (a Studio running asks the same again as the person types). */
const asked = new Map();

/**
 * What is asked, as OpenFilm's service turns it into a vector of the model (`{ model, vector }`); null when it does
 * not answer in time, answers something else, or is of another model than the things' vectors.
 * @param {string} query @param {string} model the things' vectors' model
 * @returns {Promise<Float32Array | null>}
 */
export async function queryVector(query, model) {
  const key = `${model}\n${query}`;
  if (asked.has(key)) return asked.get(key);
  try {
    const res = await fetch(`${serviceUrl('API', 'https://openfilm.dev')}/v1/library/query`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: query }),
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const got = /** @type {{ model?: unknown, vector?: unknown }} */ (await res.json());
    if (got.model !== model || !Array.isArray(got.vector) || !got.vector.every((x) => typeof x === 'number')) return null;
    const v = Float32Array.from(/** @type {number[]} */ (got.vector));
    if (asked.size >= 200) asked.delete(asked.keys().next().value);
    asked.set(key, v);
    return v;
  } catch {
    return null;
  }
}

/**
 * The things that `keep` lets through, nearest to what was asked first, at most `limit`: [id, cosine]. Null when
 * there are no vectors, or what was asked could not be turned into one.
 * @param {string} query @param {(id: string) => boolean} keep @param {number} [limit]
 * @returns {Promise<[string, number][] | null>}
 */
export async function nearest(query, keep, limit = 50) {
  const v = itemVectors();
  if (!v) return null;
  const q = await queryVector(query, v.model);
  if (!q || q.length !== v.dims) return null;
  /** @type {[string, number][]} */
  const scored = [];
  for (let i = 0; i < v.ids.length; i++) {
    if (!keep(v.ids[i])) continue;
    let dot = 0;
    const at = i * v.dims;
    for (let k = 0; k < v.dims; k++) dot += v.values[at + k] * q[k];
    scored.push([v.ids[i], dot * v.scales[i]]);
  }
  return scored.sort((a, b) => b[1] - a[1]).slice(0, limit);
}
