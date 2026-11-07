// @ts-check
/**
 * Semantic search of the library: what is asked and what each thing is, as vectors of one small multilingual sentence
 * model (multilingual-e5-small, int8, src/sentence-model.mjs), compared by cosine, so `sad goodbye at a train station`
 * finds a farewell on strings with no word in common. library-search.mjs merges its order with the keyword search's,
 * by reciprocal rank.
 *
 * The comparing is OpenFilm's service's (`POST /v1/library/search` on openfilm.dev, or OPENFILM_API_URL: free, no
 * account, the words of the search and nothing else): it keeps the model and every thing's vector, so this computer
 * keeps only the library's catalog and its keyword index, and downloads and runs no model. Offline, the service not
 * answering, or turned off in Settings → Services (Library search: None): the keyword search alone.
 *
 *   library/vectors.i8, vectors.json   each thing's vector, made with the model (scripts/library-vectors.mjs) from
 *                                      what it is (passageOf), as the service searches them: published with the
 *                                      library, not part of the package
 *   library/models.json                the model's files and its runtime, for making them
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSettings } from '../studio/server/keys.mjs';
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

/** How long a search waits for the service before it goes on with keywords alone. */
export const SEARCH_TIMEOUT_MS = 2500;
/** What was asked lately, and what the service said (a Studio running asks the same again as the person types). */
const asked = new Map();

/**
 * The things of the category `cat` nearest in meaning to what was asked, the nearest first, at most `limit`: [id,
 * cosine], as OpenFilm's service ranks them. Null when it does not answer in time, or answers something else.
 * @param {string} query @param {string} cat @param {number} [limit]
 * @returns {Promise<[string, number][] | null>}
 */
export async function nearest(query, cat, limit = 50) {
  /* turned off in Settings → Services: words alone */
  if ((await readSettings()).libraryOff) return null;
  const key = `${cat}\n${limit}\n${query}`;
  if (asked.has(key)) return asked.get(key);
  try {
    const res = await fetch(`${serviceUrl('API', 'https://openfilm.dev')}/v1/library/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: query, cat, limit }),
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const { found } = /** @type {{ found?: unknown }} */ (await res.json());
    if (!Array.isArray(found) || !found.every((f) => Array.isArray(f) && typeof f[0] === 'string' && typeof f[1] === 'number')) return null;
    if (asked.size >= 200) asked.delete(asked.keys().next().value);
    asked.set(key, found);
    return /** @type {[string, number][]} */ (found);
  } catch {
    return null;
  }
}
