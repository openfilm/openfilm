// @ts-check
/**
 * Semantic search of the library: what is asked and what each thing is, as vectors of one small multilingual sentence
 * model (multilingual-e5-small, int8), compared by cosine, so `sad goodbye at a train station` finds a farewell on
 * strings with no word in common. library-search.mjs merges its order with the keyword search's, by reciprocal rank.
 *
 *   library/vectors.i8, vectors.json   each thing's vector, made offline with the same model (scripts/library-vectors.mjs)
 *                                      from what it is (passageOf): int8, a scale each, in the order of vectors.json's ids
 *   library/models.json                the model, its vocabulary packed (vocab.bin) and its runtime (onnxruntime-web,
 *                                      WebAssembly, one thread): published parts of the library (library.mjs
 *                                      fetchLibrary), each file with its size and sha256
 *
 * A search in a CLI of its own loads the model each time (a few hundred milliseconds: the runtime starting, then the
 * model); a Studio running keeps it loaded, and the CLI asks it first (studio/client.mjs getMedia).
 *
 * Only the vectors come with the package. The first search fetches the rest in the background, in a process of its own
 * (`node src/library-semantic.mjs fetch`), so that search answers at once with keywords; each file is checked against
 * models.json and kept in the library's cache for every OpenFilm here. Offline, or a file that does not check: keyword
 * search, and another try an hour later. Nothing is sent anywhere: the question is turned into a vector here.
 * Settings → Services → Local models can turn it off (kept, not used: keyword search) or remove it (thrown away, and
 * off, so that no search fetches it again); turning it on again fetches it at once (local-models.mjs).
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { builtInRoot, fetchLibrary, libraryCache, libraryFile } from '../studio/server/library.mjs';

/** @typedef {{ path: string, bytes: number, sha256: string }} ModelFile */
/** @typedef {{ version: number, model: string, dims: number, onnx: string, tokenizer: string, runtime: string, files: ModelFile[] }} Manifest */

/** The model and its runtime, as library/models.json lists them; null without one. @returns {Manifest | null} */
export function manifest() {
  try { return JSON.parse(readFileSync(join(builtInRoot(), 'models.json'), 'utf8')); } catch { return null; }
}

/** Where what the fetching knows is kept: `{ pid, at }` while it runs, `{ failed }` after it failed. */
const stateFile = (/** @type {Manifest} */ m) => join(libraryCache(), 'models', `${m.model}.json`);
/** The mark of a model whose every file was checked, named for what models.json says of them. */
const okFile = (/** @type {Manifest} */ m) => join(libraryCache(), 'models', `${m.model}.${digest(m)}.ok`);
const digest = (/** @type {Manifest} */ m) => createHash('sha256').update(m.files.map((f) => f.sha256).join()).digest('hex').slice(0, 12);
/** The mark of a model turned off, or removed, in Settings → Services → Local models: not used, and not fetched. */
const offFile = (/** @type {Manifest} */ m) => join(libraryCache(), 'models', `${m.model}.off`);

/** Whether the model is to be used (and fetched when it is not here): not turned off. */
export const semanticOn = (m = manifest()) => Boolean(m) && !existsSync(offFile(/** @type {Manifest} */ (m)));

/** The model turned on (fetched now when it is not here: semanticState) or off (kept, not used). */
export function setSemanticOn(/** @type {boolean} */ on, m = manifest()) {
  if (!m) return;
  if (on) {
    rmSync(offFile(m), { force: true });
    /* a fetch that failed lately is tried again at once: the person asked for it */
    rmSync(stateFile(m), { force: true });
    semanticState();
  } else {
    mkdirSync(dirname(offFile(m)), { recursive: true });
    writeFileSync(offFile(m), '');
  }
}

/** The model's fetched files thrown away, and the model turned off (else the next search would fetch it again). */
export function removeModel(m = manifest()) {
  if (!m) return;
  setSemanticOn(false, m);
  for (const f of m.files) {
    const file = libraryFile(f.path);
    if (file && !file.startsWith(builtInRoot())) rmSync(file, { force: true });
  }
  rmSync(okFile(m), { force: true });
  rmSync(stateFile(m), { force: true });
}

/** Whether every file of the model is part of this checkout's library (a source checkout's: it cannot be removed). */
export const modelBuiltIn = (m = manifest()) => Boolean(m?.files.every((f) => libraryFile(f.path)?.startsWith(builtInRoot())));

/** How much of the model is on this computer, in bytes: its files here, and what is written of the one coming. */
export function modelBytesHere(m = manifest()) {
  if (!m) return 0;
  let bytes = 0;
  for (const f of m.files) {
    if (libraryFile(f.path)) { bytes += f.bytes; continue; }
    const at = join(libraryCache(), f.path);
    try {
      for (const name of readdirSync(dirname(at))) if (name.startsWith(`${basename(at)}.part-`)) bytes += statSync(join(dirname(at), name)).size;
    } catch { /* its folder is not made yet */ }
  }
  return bytes;
}

/** Whether the model can run here: every file of it on this computer, and checked (or part of this checkout's library). */
export function semanticReady(m = manifest()) {
  if (!m) return false;
  const files = m.files.map((f) => libraryFile(f.path));
  if (files.some((f) => !f)) return false;
  return files.every((f) => f?.startsWith(builtInRoot())) || existsSync(okFile(m));
}

/** How long a failed fetch waits before another try. */
const RETRY_MS = 60 * 60_000;
/** A fetch running longer than this has died. */
const STALE_MS = 2 * 60 * 60_000;

/**
 * Whether the model is coming: 'ready', 'fetching' (begun now, or still running), or 'off' (no model listed, or it
 * failed lately: keyword search, said nothing of). Starts the fetch when it is due: `start` runs it (a process of its
 * own by default).
 * @param {{ start?: () => void }} [o]
 * @returns {'ready' | 'fetching' | 'off'}
 */
export function semanticState(o = {}) {
  const m = manifest();
  if (!m || !semanticOn(m)) return 'off';
  if (semanticReady(m)) return 'ready';
  let state = /** @type {{ pid?: number, at?: number, failed?: number }} */ ({});
  try { state = JSON.parse(readFileSync(stateFile(m), 'utf8')); } catch { /* none yet */ }
  if (state.failed && Date.now() - state.failed < RETRY_MS) return 'off';
  if (state.pid && state.at && Date.now() - state.at < STALE_MS && alive(state.pid)) return 'fetching';
  mkdirSync(dirname(stateFile(m)), { recursive: true });
  (o.start ?? startFetch)();
  return 'fetching';
}

const alive = (/** @type {number} */ pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Whether the model's fetch is running now (one that died, or failed, is not). */
export function modelFetching(m = manifest()) {
  if (!m) return false;
  let state = /** @type {{ pid?: number, at?: number }} */ ({});
  try { state = JSON.parse(readFileSync(stateFile(m), 'utf8')); } catch { return false; }
  return Boolean(state.pid && state.at && Date.now() - state.at < STALE_MS && alive(state.pid));
}

/** The fetch, in a process of its own that outlives the search that began it. */
function startFetch() {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'fetch'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

/**
 * Every file of the model fetched into the library's cache and checked against models.json: one that does not check
 * is thrown away. Marks the model checked when all are; says it failed otherwise. Returns whether it is ready.
 */
export async function fetchModel(m = manifest()) {
  if (!m) return false;
  mkdirSync(dirname(stateFile(m)), { recursive: true });
  writeFileSync(stateFile(m), JSON.stringify({ pid: process.pid, at: Date.now() }));
  try {
    for (const f of m.files) {
      const file = await fetchLibrary(f.path);
      if (!file) throw new Error(`${f.path} could not be fetched`);
      if (file.startsWith(builtInRoot())) continue;
      const sum = createHash('sha256').update(readFileSync(file)).digest('hex');
      if (sum !== f.sha256) { rmSync(file, { force: true }); throw new Error(`${f.path} is not what models.json says`); }
    }
    writeFileSync(okFile(m), '');
    rmSync(stateFile(m), { force: true });
    return true;
  } catch {
    writeFileSync(stateFile(m), JSON.stringify({ failed: Date.now() }));
    return false;
  }
}

/* ── the tokenizer: SentencePiece's unigram model, as the model's tokenizer.json has it ───────────────────────── */

/**
 * A text's token ids as the model was trained on them: NFKC, spaces as `▁` (one before the first word too), each word
 * cut into the pieces of the vocabulary whose scores add up highest (Viterbi); a character no piece has is `<unk>`.
 * Between `<s>` and `</s>`, at most 512.
 * @param {Vocabulary} vocab @param {string} text
 */
export function tokenize(vocab, text) {
  const ids = [0];
  const normal = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  for (const word of `▁${normal.replaceAll(' ', '▁')}`.split(/(?=▁)/)) {
    const chars = [...word];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1);
    const id = new Int32Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let piece = '';
      for (let j = i; j < Math.min(n, i + vocab.longest); j++) {
        piece += chars[j];
        const k = vocab.id(piece);
        /* the first four are <s>, <pad>, </s>, <unk>: never pieces of a text */
        if (k === undefined || k < 4) continue;
        const score = best[i] + vocab.scores[k];
        if (score > best[j + 1]) { best[j + 1] = score; from[j + 1] = i; id[j + 1] = k; }
      }
      if (best[i + 1] === -Infinity) { best[i + 1] = best[i] + vocab.unknown; from[i + 1] = i; id[i + 1] = 3; }
    }
    const out = [];
    for (let end = n; end > 0; end = from[end]) out.push(id[end]);
    ids.push(...out.reverse());
  }
  return [...ids.slice(0, 511), 2];
}

/**
 * A vocabulary as tokenize reads it: the id of a piece (undefined: none), each id's score, the longest piece (in
 * characters), and the score of a character no piece has.
 * @typedef {{ id: (piece: string) => number | undefined, scores: Float32Array, longest: number, unknown: number }} Vocabulary
 */

/** The vocabulary of a tokenizer.json. @param {string} file @returns {Vocabulary} */
export function readVocabulary(file) {
  /** @type {{ model: { vocab: [string, number][] } }} */
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const pieces = new Map();
  let longest = 0;
  let lowest = 0;
  json.model.vocab.forEach(([piece, score], i) => { pieces.set(piece, i); longest = Math.max(longest, [...piece].length); lowest = Math.min(lowest, score); });
  return { id: (piece) => pieces.get(piece), scores: Float32Array.from(json.model.vocab, ([, s]) => s), longest, unknown: lowest - 10 };
}

/*
 * A vocabulary packed (vocab.bin, made from tokenizer.json when the library is published): read in a few
 * milliseconds where the JSON takes a hundred, a piece found by binary search over its UTF-8 bytes. Little-endian:
 *   u32 count, u32 longest, f32 unknown, then count × f32 score (by id), count × u32 id (in the order of the pieces'
 *   bytes), (count + 1) × u32 offset (by id, into the text), and the text: every piece's UTF-8, by id.
 */

/** tokenizer.json's vocabulary, packed. @param {string} file @returns {Buffer} */
export function packVocabulary(file) {
  /** @type {{ model: { vocab: [string, number][] } }} */
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const { scores, longest, unknown } = readVocabulary(file);
  const bytes = json.model.vocab.map(([piece]) => Buffer.from(piece, 'utf8'));
  const n = bytes.length;
  const order = Uint32Array.from(bytes.keys()).sort((a, b) => Buffer.compare(bytes[a], bytes[b]));
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + bytes[i].length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(n, 0);
  head.writeUInt32LE(longest, 4);
  head.writeFloatLE(unknown, 8);
  return Buffer.concat([head, Buffer.from(scores.buffer), Buffer.from(order.buffer), Buffer.from(offsets.buffer), ...bytes]);
}

/** A packed vocabulary (packVocabulary). @param {Buffer} buf @returns {Vocabulary} */
export function readPacked(buf) {
  const data = new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const view = new DataView(data.buffer);
  const n = view.getUint32(0, true);
  const scores = new Float32Array(data.buffer, 12, n);
  const order = new Uint32Array(data.buffer, 12 + 4 * n, n);
  const offsets = new Uint32Array(data.buffer, 12 + 8 * n, n + 1);
  const text = data.subarray(12 + 12 * n + 4);
  const encoder = new TextEncoder();
  /** the piece of id `k` against `want`, as Buffer.compare: by bytes */
  const compare = (/** @type {number} */ k, /** @type {Uint8Array} */ want) => {
    const from = offsets[k];
    const length = offsets[k + 1] - from;
    for (let i = 0; i < Math.min(length, want.length); i++) if (text[from + i] !== want[i]) return text[from + i] - want[i];
    return length - want.length;
  };
  return {
    id: (piece) => {
      const want = encoder.encode(piece);
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const c = compare(order[mid], want);
        if (c === 0) return order[mid];
        if (c < 0) lo = mid + 1; else hi = mid - 1;
      }
      return undefined;
    },
    scores, longest: view.getUint32(4, true), unknown: view.getFloat32(8, true),
  };
}

/* ── the model ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** @type {Promise<(text: string) => Promise<Float32Array>> | null} */
let loading = null;

/**
 * The model, loaded once: a text (with its `query: ` or `passage: `, as the model was trained) to its vector, the mean
 * of its tokens' last states, of length 1.
 */
export function embedder(m = /** @type {Manifest} */ (manifest())) {
  loading ??= (async () => {
    const at = (/** @type {string} */ rel) => /** @type {string} */ (libraryFile(rel));
    const ort = await import(pathToFileURL(at(m.runtime)).href);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = pathToFileURL(`${dirname(at(m.runtime))}/`).href;
    ort.env.logLevel = 'error';
    const vocab = readPacked(readFileSync(at(m.tokenizer)));
    const session = await ort.InferenceSession.create(readFileSync(at(m.onnx)));
    const int64 = (/** @type {number[]} */ v) => new ort.Tensor('int64', BigInt64Array.from(v, BigInt), [1, v.length]);
    return async (/** @type {string} */ text) => {
      const ids = tokenize(vocab, text);
      const out = (await session.run({ input_ids: int64(ids), attention_mask: int64(ids.map(() => 1)), token_type_ids: int64(ids.map(() => 0)) }))[session.outputNames[0]];
      const dims = out.dims[2];
      const v = new Float32Array(dims);
      for (let i = 0; i < ids.length; i++) for (let k = 0; k < dims; k++) v[k] += out.data[i * dims + k];
      const norm = Math.hypot(...v) || 1;
      return v.map((x) => x / norm);
    };
  })();
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

/**
 * The things that `keep` lets through, nearest to what was asked first, at most `limit`: [id, cosine]. Null when
 * the model is not ready, or the vectors are not of it.
 * @param {string} query @param {(id: string) => boolean} keep @param {number} [limit]
 * @returns {Promise<[string, number][] | null>}
 */
export async function nearest(query, keep, limit = 50) {
  const m = manifest();
  const v = itemVectors();
  if (!m || !v || v.model !== m.model || !semanticReady(m)) return null;
  let embed;
  try { embed = await embedder(m); } catch { return null; }
  const q = await embed(`query: ${query}`);
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

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'fetch') process.exitCode = (await fetchModel()) ? 0 : 1;
