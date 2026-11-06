// @ts-check
/**
 * A picture's background taken out on this computer: BiRefNet Lite finds what the picture is of, at 512 × 512 on the
 * library's WebAssembly onnxruntime (local-asr.mjs RUNTIME), and the mask it gives, scaled back to the picture's own
 * size, becomes the alpha of a PNG of the whole picture. ffmpeg reads and writes the pictures. Nothing is sent anywhere.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { modelFile } from './local-models.mjs';
import { RUNTIME, runtimeFolder, threads } from './local-asr.mjs';

const run = promisify(execFile);
/** The side the model looks at the picture in. */
const SIDE = 512;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/**
 * The picture `src` as a PNG at `out`, its background transparent, by the model `id`. Returns its width and height,
 * and how much of it was kept (0 to 1: none means the model found nothing it is of).
 * @param {string} id @param {string} src @param {string} out
 */
export async function cutout(id, src, out) {
  const { stdout: probe } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src]);
  const [width, height] = probe.trim().split(',').map(Number);
  if (!width || !height) throw new Error(`${src} is not a picture ffmpeg can read.`);
  const { stdout: rgb } = await run('ffmpeg', ['-v', 'error', '-nostdin', '-i', src, '-frames:v', '1', '-vf', `scale=${SIDE}:${SIDE}:flags=bicubic`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { encoding: 'buffer', maxBuffer: 16 << 20 });

  const ort = await import(pathToFileURL(modelFile(RUNTIME)).href);
  ort.env.wasm.wasmPaths = runtimeFolder();
  ort.env.wasm.numThreads = threads();
  /* its notes on how it optimized the graph are not ours to print */
  ort.env.logLevel = 'error';
  const session = await ort.InferenceSession.create(readFileSync(modelFile(`models/${id}/model.onnx`)), { logSeverityLevel: 3 });
  const n = SIDE * SIDE;
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIDE, SIDE]) });
  const logits = /** @type {Float32Array} */ (result[session.outputNames[0]].data);

  const mask = Buffer.alloc(n);
  let kept = 0;
  for (let i = 0; i < n; i++) {
    const a = 1 / (1 + Math.exp(-logits[i]));
    mask[i] = Math.round(a * 255);
    kept += a;
  }
  await new Promise((done, fail) => {
    const proc = execFile('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${SIDE}x${SIDE}`, '-i', '-',
      '-filter_complex', `[1:v]scale=${width}:${height}:flags=bicubic[m];[0:v]format=rgba[c];[c][m]alphamerge`, '-frames:v', '1', out],
    (e) => (e ? fail(e) : done(undefined)));
    proc.stdin?.end(mask);
  });
  return { width, height, kept: Math.round((kept / n) * 1000) / 1000 };
}
