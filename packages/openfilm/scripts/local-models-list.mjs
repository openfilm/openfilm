#!/usr/bin/env node
// @ts-check
/**
 * library/local-models.json: the files of each Local model (src/local-models.mjs) other than the library search's,
 * with their size and sha256, read from a folder laid out as the published library is (its `models/`).
 *
 *   node scripts/local-models-list.mjs [folder]     (default: the package's library, where library-publish.mjs looks)
 *
 * Each model lists every file it runs with: the runtime and transformers.js are listed with each model that needs them,
 * so any one of them installed alone works.
 */
import { createHash } from 'node:crypto';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { builtInRoot } from '../studio/server/library.mjs';

const RUNTIME = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'].map((f) => `models/onnxruntime-web-1.31.1/${f}`);
const WHISPER = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const whisper = (/** @type {string} */ id) => [...RUNTIME, 'models/transformers-4.3.2/transformers.min.js', ...WHISPER.map((f) => `models/${id}/${f}`)];

const MODELS = [
  { id: 'whisper-small', files: whisper('whisper-small') },
  { id: 'whisper-large-v3-turbo', files: whisper('whisper-large-v3-turbo') },
  { id: 'birefnet-lite', files: [...RUNTIME, 'models/birefnet-lite/model.onnx'] },
];

const root = process.argv[2] ?? builtInRoot();
const sum = async (/** @type {string} */ file) => { const h = createHash('sha256'); await pipeline(createReadStream(file), h); return h.digest('hex'); };
const models = [];
for (const m of MODELS) {
  const files = [];
  for (const path of m.files) files.push({ path, bytes: statSync(join(root, path)).size, sha256: await sum(join(root, path)) });
  models.push({ id: m.id, files });
  console.log(`${m.id}: ${files.length} files, ${Math.round(files.reduce((n, f) => n + f.bytes, 0) / 1e6)} MB`);
}
writeFileSync(join(builtInRoot(), 'local-models.json'), `${JSON.stringify({ version: 1, models }, null, 1)}\n`);
