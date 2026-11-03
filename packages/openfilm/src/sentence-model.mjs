// @ts-check
/**
 * The sentence model of the library's semantic search (multilingual-e5-small, int8), on its own: its tokenizer
 * (SentencePiece's unigram model, its vocabulary packed as vocab.bin) and the model run by onnxruntime-web
 * (WebAssembly, one thread), a text to its vector. It needs nothing but its files, so that the library's vectors
 * (scripts/library-vectors.mjs) and a search's query (OpenFilm's service, `POST /v1/library/query`) are made by the
 * same code, and so are the same.
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/**
 * The model, loaded from its files: a text (with its `query: ` or `passage: `, as the model was trained) to its
 * vector, the mean of its tokens' last states, of length 1.
 * @param {{ runtime: string, onnx: string, tokenizer: string }} files where each is on this computer: the tokenizer
 * packed (vocab.bin), or as the model's maker publishes it (tokenizer.json)
 * @returns {Promise<(text: string) => Promise<Float32Array>>}
 */
export async function loadEmbedder(files) {
  const ort = await import(pathToFileURL(files.runtime).href);
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = pathToFileURL(`${dirname(files.runtime)}/`).href;
  ort.env.logLevel = 'error';
  const vocab = files.tokenizer.endsWith('.json') ? readVocabulary(files.tokenizer) : readPacked(readFileSync(files.tokenizer));
  const session = await ort.InferenceSession.create(readFileSync(files.onnx));
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
}
