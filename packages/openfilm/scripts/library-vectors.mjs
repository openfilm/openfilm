#!/usr/bin/env node
// @ts-check
/**
 * The library's vectors for semantic search (OpenFilm's service searches them, src/library-semantic.mjs): every thing
 * `openfilm get` searches, what it is (passageOf) turned into a vector by the model, written as library/vectors.i8
 * (int8, 384 a thing) and library/vectors.json (the model, the ids in order, each one's category, each vector's
 * scale); and library/models.json, each file of the model and its runtime with its size and sha256; and the model's
 * vocabulary packed for a quick start (vocab.bin beside its tokenizer.json, sentence-model.mjs packVocabulary). Run on
 * the computer that has them under library/models/ (not in git), after the library's things or their descriptions
 * change:
 *
 *   node scripts/library-vectors.mjs
 *
 * The model: multilingual-e5-small (MIT), int8 ONNX as Xenova/multilingual-e5-small publishes it (onnx/model_quantized.onnx,
 * tokenizer.json), in library/models/multilingual-e5-small/. Its runtime: onnxruntime-web (MIT), dist/ort.wasm.min.mjs,
 * ort-wasm-simd-threaded.mjs and .wasm of the version its folder names, in library/models/onnxruntime-web-<version>/.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInRoot, libraryIndex } from '../studio/server/library.mjs';
import { KINDS } from '../src/library-search.mjs';
import { embedder, passageOf } from '../src/library-semantic.mjs';
import { packVocabulary } from '../src/sentence-model.mjs';
import { vocabulary } from '../src/library-words.mjs';

const MODEL = 'multilingual-e5-small';
const root = builtInRoot();
const runtime = readdirSync(join(root, 'models')).find((d) => d.startsWith('onnxruntime-web-'));
if (!runtime) throw new Error('no library/models/onnxruntime-web-<version>/ here');
const rel = (/** @type {string[]} */ ...parts) => ['models', ...parts].join('/');
writeFileSync(join(root, rel(MODEL, 'vocab.bin')), packVocabulary(join(root, rel(MODEL, 'tokenizer.json'))));
const files = [rel(MODEL, 'model_quantized.onnx'), rel(MODEL, 'vocab.bin'),
  rel(runtime, 'ort.wasm.min.mjs'), rel(runtime, 'ort-wasm-simd-threaded.mjs'), rel(runtime, 'ort-wasm-simd-threaded.wasm')];
const manifest = {
  version: 1, model: MODEL, dims: 384, onnx: files[0], tokenizer: files[1], runtime: files[2],
  files: files.map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }),
};
writeFileSync(join(root, 'models.json'), `${JSON.stringify(manifest, null, 1)}\n`);

const embed = await embedder(manifest);
const vocab = vocabulary(root);
const { items, groups } = /** @type {{ items: any[], groups: Record<string, { id: string, name: Record<string, string> }[]> }} */ (libraryIndex());
const cats = new Set(Object.values(KINDS));
const things = items.filter((i) => cats.has(i.cat));
const values = new Int8Array(things.length * manifest.dims);
const scales = [];
const started = Date.now();
for (const [n, item] of things.entries()) {
  const v = await embed(passageOf(item, vocab, groups[item.cat]?.find((g) => g.id === item.group)));
  /* int8, scaled to its largest value: the cosine is the same to a thousandth */
  const scale = Math.max(...v.map(Math.abs)) / 127;
  for (let k = 0; k < v.length; k++) values[n * manifest.dims + k] = Math.round(v[k] / scale);
  scales.push(Number(scale.toPrecision(6)));
  if ((n + 1) % 1000 === 0) console.error(`${n + 1} of ${things.length}`);
}
writeFileSync(join(root, 'vectors.i8'), values);
writeFileSync(join(root, 'vectors.json'), `${JSON.stringify({ version: 1, model: MODEL, dims: manifest.dims, ids: things.map((i) => i.id), cats: things.map((i) => i.cat), scales })}\n`);
const mb = (/** @type {number} */ b) => `${(b / 1e6).toFixed(1)} MB`;
console.log(`${things.length} vectors in ${Math.round((Date.now() - started) / 1000)} s (${mb(values.length)}); the model and its runtime: ${mb(manifest.files.reduce((s, f) => s + f.bytes, 0))} to fetch`);
