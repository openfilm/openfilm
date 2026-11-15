/** MODNet alpha matting / optional BiRefNet subject extraction, entirely on-device through ONNX Runtime. */
import { inputKey, previousInput, keepInput } from './vision-input-cache.mjs';
import * as ort from './vision/ort-1.31.1/ort.webgpu.bundle.min.mjs';
ort.env.wasm.wasmPaths = new URL('./vision/ort-1.31.1/', import.meta.url).href;
ort.env.wasm.numThreads = 1;
const sessions = new Map();
const backends = new Map();
export const visionBackends = () => Object.fromEntries(backends);
export async function visionSession(name, progress) {
  if (!sessions.has(name))
    sessions.set(
      name,
      (async () => {
        const model = new URL(`./vision/${name}`, import.meta.url).href;
        // The downloaded bytes are verified by the local host. No frames leave this worker.
        progress?.({ phase: 'loading' });
        const timer = setInterval(async () => {
          try {
            const state = await (await fetch(new URL('./vision/models.json', import.meta.url))).json();
            const item = state[name];
            progress?.({
              phase: 'loading',
              download: item.downloading ? { received: item.received, bytes: item.bytes } : undefined,
            });
          } catch {}
        }, 600);
        let response;
        try {
          response = await fetch(model);
        } finally {
          clearInterval(timer);
        }
        if (!response.ok) throw new Error(await response.text());
        const bytes = await response.arrayBuffer();
        const options = { graphOptimizationLevel: 'all', executionProviders: ['wasm'] };
        // Preserve the exported NCHW layout. The default NHWC graph transform corrupted MODNet alpha on Metal.
        if (self.navigator.gpu) {
          try {
            const task = await ort.InferenceSession.create(bytes, {
              ...options,
              executionProviders: [{ name: 'webgpu', preferredLayout: 'NCHW' }, 'wasm'],
            });
            backends.set(name, 'WebGPU');
            return task;
          } catch (error) {
            console.warn('Local matting GPU unavailable; using CPU:', error.message);
          }
        }
        backends.set(name, 'CPU');
        return ort.InferenceSession.create(bytes, options);
      })().catch((error) => {
        sessions.delete(name);
        throw error;
      }),
    );
  return sessions.get(name);
}
export async function matte(frame, mode, progress, preview = false, analysisSize = 384) {
  const task = await visionSession(mode === 2 ? 'subject.onnx' : 'portrait.onnx', progress);
  progress?.({ phase: 'processing', download: null });
  let w = 512,
    h = 512;
  if (mode === 1) {
    // MODNet's official normalization and aspect-preserving multiple-of-32 input.
    const scale = preview
      ? analysisSize / Math.max(frame.width, frame.height)
      : Math.min(512 / Math.min(frame.width, frame.height), 1024 / Math.max(frame.width, frame.height));
    w = Math.max(32, Math.round((frame.width * scale) / 32) * 32);
    h = Math.max(32, Math.round((frame.height * scale) / 32) * 32);
  }
  const canvas = new OffscreenCanvas(w, h),
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(frame, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data,
    n = w * h;
  const name = `${mode}:${backends.get(mode === 2 ? 'subject.onnx' : 'portrait.onnx')}:${w}x${h}`;
  const key = await inputKey(name, rgba), previous = previousInput(name, key);
  if (previous) return previous;
  const input = new Float32Array(n * 3);
  const mean = mode === 2 ? [0.485, 0.456, 0.406] : [0.5, 0.5, 0.5];
  const std = mode === 2 ? [0.229, 0.224, 0.225] : [0.5, 0.5, 0.5];
  for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) input[c * n + i] = (rgba[i * 4 + c] / 255 - mean[c]) / std[c];
  const tensor = new ort.Tensor('float32', input, [1, 3, h, w]);
  let output;
  try {
    output = await task.run({ [task.inputNames[0]]: tensor });
    const result = output[task.outputNames.at(-1)];
    const values = await result.getData();
    const data = Uint8Array.from(values, (v) =>
      Math.round(255 * Math.max(0, Math.min(1, mode === 2 ? 1 / (1 + Math.exp(-v)) : v))),
    );
    const mask = { w: Number(result.dims.at(-1)), h: Number(result.dims.at(-2)), data, alpha: true };
    keepInput(name, key, mask); return mask;
  } finally {
    tensor.dispose();
    for (const value of Object.values(output ?? {})) value.dispose();
  }
}
