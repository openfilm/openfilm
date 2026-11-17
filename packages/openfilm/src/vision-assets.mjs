/** Pinned local inference assets. Small models ship in the package; the general model downloads atomically. */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, rm, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { studioHomeDir } from './locations.mjs';
import { VISION_MODELS } from './vision-models.mjs';
const require = createRequire(import.meta.url);
const runtime = dirname(require.resolve('@mediapipe/tasks-vision'));
const ort = dirname(require.resolve('onnxruntime-web'));
const bundled = fileURLToPath(new URL('../models/vision/', import.meta.url));
const loading = new Map(),
  verified = new Set();
const downloads = new Map();
const controllers = new Map();
/** Stop this home's optional model transfers when Studio closes; verified model files are kept. */
export function stopVisionDownloads(home = studioHomeDir()) {
  const prefix = join(home,'cache','vision','1') + sep;
  for (const [file,controller] of controllers) if (file.startsWith(prefix)) controller.abort();
}
async function valid(file, expected) {
  if (!existsSync(file)) return false;
  if (verified.has(file)) return true;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) return false;
  verified.add(file);
  return true;
}
export function visionModelStatus() {
  return Object.fromEntries(
    Object.entries(VISION_MODELS).map(([name, model]) => [
      name,
      {
        bytes: model.bytes,
        bundled: model.bundled,
        license: model.license,
        ready: existsSync(join(bundled, name)) || existsSync(join(studioHomeDir(), 'cache', 'vision', '1', name)),
        ...(downloads.get(name) ?? {}),
      },
    ]),
  );
}
export async function visionModel(name) {
  const model = Object.hasOwn(VISION_MODELS, name) ? VISION_MODELS[name] : null;
  if (!model) throw new Error('Unknown vision model');
  const local = join(bundled, name);
  if (model.bundled && (await valid(local, model.sha256))) return local;
  const file = join(studioHomeDir(), 'cache', 'vision', '1', name);
  if (await valid(file, model.sha256)) return file;
  if (!loading.has(file))
    loading.set(
      file,
      (async () => {
        const controller = new AbortController(); controllers.set(file,controller);
        downloads.set(name, { downloading: true, received: 0 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        let handle;
        try {
          await mkdir(dirname(file), { recursive: true });
          const res = await fetch(model.url, { signal: AbortSignal.any([controller.signal,AbortSignal.timeout(600000)]) });
          if (!res.ok) throw new Error(`Could not download the vision model (${res.status})`);
          handle = await open(temporary, 'wx');
          const hash = createHash('sha256');
          let size = 0;
          for await (const chunk of res.body) {
            size += chunk.length;
            if (size > model.bytes + 1024) throw new Error('Vision model exceeds its download limit');
            hash.update(chunk);
            await handle.writeFile(chunk);
            downloads.set(name, { downloading: true, received: size });
          }
          if (hash.digest('hex') !== model.sha256) throw new Error('The vision model download is invalid');
          await handle.close();
          handle = null;
          await rename(temporary, file);
          verified.add(file);
          downloads.delete(name);
          return file;
        } catch (error) {
          downloads.set(name, { error: error.message });
          throw error;
        } finally {
          controllers.delete(file);
          await handle?.close();
          await rm(temporary, { force: true });
        }
      })().finally(() => loading.delete(file)),
    );
  return loading.get(file);
}
const scripts = new Set([
  'video-effects.mjs',
  'vision-config.mjs',
  'vision-preview.mjs',
  'vision-cache.mjs',
  'vision-input-cache.mjs',
  'vision-models.mjs',
  'vision-worker.mjs',
  'vision-analyzer.mjs',
  'vision-matting.mjs',
  'vision-face.mjs',
  'vision-refine.mjs',
  'vision-parse.mjs',
  'vision-composite.mjs',
  /* live grading (video-lut.mjs), and the color transform evaluator its worker bakes a clip's grade with */
  'video-lut.mjs',
  'color/live-worker.mjs',
  'color/ctf.mjs',
  'color/ops.mjs',
  'color/grading.mjs',
  'color/bspline.mjs',
  'color/fixed-function.mjs',
  'color/aces2.mjs',
  /* a page's or a still's grade, drawn as an SVG filter (timeline.mjs), and the parts of a grade's files by their names */
  'color/page-grade.mjs',
  'color/chain.mjs',
]);
const files = new Set([
  'vision_bundle.mjs',
  'wasm/vision_wasm_module_internal.js',
  'wasm/vision_wasm_module_internal.wasm',
]);
const ortFiles = new Set([
  'ort.webgpu.bundle.min.mjs',
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.asyncify.mjs',
  'ort-wasm-simd-threaded.asyncify.wasm',
  'ort-wasm-simd-threaded.jspi.mjs',
  'ort-wasm-simd-threaded.jspi.wasm',
]);
export function serveVision(req, res, path, headers = {}) {
  const index = path.lastIndexOf('/__film/');
  if (index < 0) return false;
  const name = path.slice(index + 8);
  if (!scripts.has(name) && !name.startsWith('vision/')) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const send = (file, type) => {
    if (res.destroyed) return;
    res.writeHead(200, { ...headers, 'content-type': type, 'cache-control': file.endsWith('.mjs') && !file.includes('node_modules') ? 'no-cache' : 'public, max-age=31536000, immutable' });
    const stream = createReadStream(file);
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    if (req.method === 'HEAD') {
      stream.destroy();
      res.end();
    } else stream.pipe(res);
  };
  if (scripts.has(name)) {
    res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(new URL(name, import.meta.url)));
    return true;
  }
  const asset = name.slice(7);
  if (asset === 'models.json') {
    res.writeHead(200, { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify(visionModelStatus()));
    return true;
  }
  const mp = asset.startsWith('1.2.2/') ? asset.slice(6) : null;
  const onnx = asset.startsWith('ort-1.31.1/') ? asset.slice(11) : null;
  if (mp && files.has(mp))
    send(join(runtime, mp), mp.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
  else if (onnx && ortFiles.has(onnx))
    send(join(ort, onnx), onnx.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8');
  else if (Object.hasOwn(VISION_MODELS, asset))
    void visionModel(asset)
      .then((file) => send(file, 'application/octet-stream'))
      .catch((error) => {
        if (!res.destroyed) {
          res.writeHead(503, { ...headers, 'content-type': 'text/plain' });
          res.end(error.message);
        }
      });
  else {
    res.writeHead(404);
    res.end();
  }
  return true;
}
