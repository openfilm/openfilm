// @ts-check
/**
 * Transcription on this computer: OpenAI's Whisper (Small, or Large v3 Turbo), each word timed, run by transformers.js
 * (its browser build, a file of the library) on the WebAssembly onnxruntime the library search runs too, nothing sent
 * anywhere. Its models are Local services' (local-models.mjs), each in the transformers.js layout under models/<id>/.
 *
 * Whisper says what it heard in pieces: a word in languages with spaces, a run of characters in Chinese and Japanese.
 * A run is split into its characters, the run's time shared between them by how long each is (piecesOf), so every
 * character is timed as subtitles need. It sometimes drifts from simplified Chinese into traditional, or back, within
 * one recording: the whole transcript is kept in the script most of it is in (oneScript).
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { modelFile } from './local-models.mjs';

/** The runtime and transformers.js, as the library publishes them. */
export const RUNTIME = 'models/onnxruntime-web-1.31.1/ort.wasm.min.mjs';
export const TRANSFORMERS = 'models/transformers-4.3.2/transformers.min.js';

/**
 * The runtime's folder, as its threads find its files: a path with forward slashes (a file: URL is fetched, which
 * Node cannot do from a worker).
 */
export const runtimeFolder = () => `${dirname(modelFile(RUNTIME)).split(sep).join('/')}/`;

/** How many threads the runtime takes: most of the computer, not all of it. */
export const threads = () => Math.max(1, Math.min(4, availableParallelism() - 1));

/**
 * transformers.js on the library's runtime. It is its browser build (the Node build needs a native runtime): told to
 * use the runtime given to it, and loaded as on a page, every file it asks for read from this computer.
 */
async function transformers() {
  const ort = await import(pathToFileURL(modelFile(RUNTIME)).href);
  ort.env.wasm.wasmPaths = runtimeFolder();
  ort.env.wasm.numThreads = threads();
  /** @type {any} */ (globalThis)[Symbol.for('onnxruntime')] = ort;
  const release = process.release;
  Object.defineProperty(process, 'release', { value: { name: 'openfilm' }, configurable: true, writable: true });
  try {
    const lib = await import(pathToFileURL(modelFile(TRANSFORMERS)).href);
    lib.env.allowRemoteModels = false;
    lib.env.useBrowserCache = false;
    lib.env.fetch = async (/** @type {string} */ url) => {
      try { return new Response(await readFile(String(url))); } catch { return new Response(null, { status: 404 }); }
    };
    return lib;
  } finally {
    Object.defineProperty(process, 'release', { value: release, configurable: true, writable: true });
  }
}

/** @typedef {{ token: string, start: number, end: number }} Word */

/**
 * What was said in `audio` (16 kHz mono samples), with each word's (each Chinese or Japanese character's) start and end
 * in seconds, its text, and the language it is in (a code: zh, en, ja…), by the model `id`.
 * @param {string} id @param {Float32Array} audio
 * @returns {Promise<{ text: string, words: Word[], language: string }>}
 */
export async function transcribe(id, audio) {
  const { pipeline, env } = await transformers();
  /* models/<id>/config.json: the folder above the model's is where transformers.js looks for it by name */
  env.localModelPath = `${dirname(dirname(modelFile(`models/${id}/config.json`)))}/`;
  const asr = await pipeline('automatic-speech-recognition', id, { dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'auto' });
  const language = await languageOf(asr, audio);
  const out = await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, language, task: 'transcribe' });
  return { ...timedWords(out.chunks ?? [], audio.length / 16000), language };
}

/**
 * The language spoken, as Whisper itself finds it: from the first 30 seconds, the language token it would say first
 * (transformers.js, given none, takes English, and translates into it).
 * @param {any} asr @param {Float32Array} audio
 */
async function languageOf(asr, audio) {
  const { input_features } = await asr.processor(audio.subarray(0, 30 * 16000));
  const config = asr.model.generation_config;
  const { Tensor } = await import(pathToFileURL(modelFile(TRANSFORMERS)).href);
  const start = new Tensor('int64', BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1]);
  const { logits } = await asr.model({ input_features, decoder_input_ids: start });
  const scores = /** @type {Float32Array} */ (logits.data);
  const last = scores.length - logits.dims.at(-1);
  let best = 'en';
  let top = -Infinity;
  for (const [token, at] of Object.entries(/** @type {Record<string, number>} */ (config.lang_to_id))) {
    if (scores[last + at] > top) { top = scores[last + at]; best = token.slice(2, -2); }
  }
  return best;
}

/** Characters written one by one, without spaces between words: each is timed on its own. */
const CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Whisper's pieces as the transcript's words: a piece of characters split into them (its time shared by length), the
 * marks after a word kept with it, and the text the pieces make, in one script.
 * @param {{ text: string, timestamp: [number, number | null] }[]} chunks @param {number} seconds
 */
export function timedWords(chunks, seconds) {
  const convert = oneScript(chunks.map((c) => c.text).join(''));
  /** @type {Word[]} */
  const words = [];
  let text = '';
  for (const chunk of chunks) {
    const said = convert(chunk.text);
    text += text ? said : said.trimStart();
    const [from, to] = chunk.timestamp;
    const start = Number.isFinite(from) ? from : (words.at(-1)?.end ?? 0);
    const end = Number.isFinite(to) && /** @type {number} */ (to) >= start ? /** @type {number} */ (to) : Math.max(start, seconds);
    /* marks a piece starts with end the word before it */
    const lead = /^\s*([^\p{L}\p{N}\s]+)/u.exec(said);
    const last = words.at(-1);
    const rest = lead && last ? said.slice(lead[0].length) : said;
    if (lead && last) last.token += lead[1];
    const pieces = piecesOf(rest);
    if (!pieces.length) {
      /* marks alone: they go with the word before them */
      if (last && rest.trim()) last.token += rest.trim();
      continue;
    }
    const weight = pieces.reduce((n, p) => n + p.weight, 0);
    let at = start;
    for (const p of pieces) {
      const next = at + ((end - start) * p.weight) / weight;
      words.push({ token: p.token, start: round(at), end: round(next) });
      at = next;
    }
  }
  return { text: cjkMarks(text.trim()), words: words.map((w) => ({ ...w, token: cjkMarks(w.token) })) };
}

/** Marks Whisper writes half-width after Chinese characters, and the space after them, as Chinese writes them. */
const FULL = /** @type {Record<string, string>} */ ({ ',': '，', '.': '。', '?': '？', '!': '！', ':': '：', ';': '；' });
const cjkMarks = (/** @type {string} */ s) => s.replace(/(\p{Script=Han})([,.?!:;])\s*/gu, (_, ch, mark) => ch + FULL[mark]);

const round = (/** @type {number} */ s) => Math.round(s * 1000) / 1000;

/**
 * A piece's words: each character of Chinese or Japanese, else each word between spaces, with the marks after it;
 * how long each is said, by its letters (a character as long as two of them).
 * @param {string} said
 */
export function piecesOf(said) {
  /** @type {{ token: string, weight: number }[]} */
  const pieces = [];
  for (const word of said.trim().split(/\s+/).filter(Boolean)) {
    let latin = '';
    const flush = () => { if (latin) pieces.push({ token: latin, weight: Math.max(1, latin.replace(/[^\p{L}\p{N}]/gu, '').length / 2) }); latin = ''; };
    for (const ch of word) {
      if (CHARACTER.test(ch)) { flush(); pieces.push({ token: ch, weight: 1 }); }
      else if (/[\p{L}\p{N}]/u.test(ch) || !pieces.length || latin) latin += ch;
      /* a mark after a character goes with it */
      else pieces[pieces.length - 1].token += ch;
    }
    flush();
  }
  /* a piece of marks alone (a dash before the first word) is not a word: the text keeps it */
  return pieces.filter((p) => /[\p{L}\p{N}]/u.test(p.token));
}

/** @type {{ t2s: Map<string, string>, s2t: Map<string, string> } | null} */
let scripts = null;
const pairs = (/** @type {string} */ s) => { const chars = [...s]; const m = new Map(); for (let i = 0; i + 1 < chars.length; i += 2) m.set(chars[i], chars[i + 1]); return m; };

/**
 * A text's conversion into the Chinese script most of it is in: simplified when most characters only simplified
 * Chinese writes are, traditional when most of those only traditional Chinese writes are (as it is, when it is neither).
 * @param {string} all
 * @returns {(text: string) => string}
 */
export function oneScript(all) {
  scripts ??= (() => {
    const { t2s, s2t } = /** @type {{ t2s: string, s2t: string }} */ (JSON.parse(String(readFileSync(new URL('./zh-script.json', import.meta.url)))));
    return { t2s: pairs(t2s), s2t: pairs(s2t) };
  })();
  const { t2s, s2t } = scripts;
  let traditional = 0;
  let simplified = 0;
  for (const ch of all) { if (t2s.has(ch)) traditional += 1; else if (s2t.has(ch)) simplified += 1; }
  if (!traditional || !simplified) return (text) => text;
  const map = simplified >= traditional ? t2s : s2t;
  return (text) => [...text].map((ch) => map.get(ch) ?? ch).join('');
}
