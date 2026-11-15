/** Optional BiSeNet semantic face masks. RGB ImageNet normalization and the model's 19-class ordering. */
import * as ort from './vision/ort-1.31.1/ort.webgpu.bundle.min.mjs';
import { visionSession } from './vision-matting.mjs';

export async function parseFaces(frame, faces, analysis, progress) {
  if (!faces.length) return;
  const task = await visionSession('face-parse.onnx', progress);
  progress?.({ phase: 'processing', download: null });
  const w = analysis.skin.w, h = analysis.skin.h;
  const skin = new Uint8Array(w * h), features = new Uint8Array(w * h * 4);
  const glasses = new Uint8Array(w * h);
  analysis.glasses = new Float32Array(4);
  const c = new OffscreenCanvas(512, 512), x = c.getContext('2d', { willReadFrequently: true });
  const mean = [.485, .456, .406], std = [.229, .224, .225], n = 512 * 512;
  for (const [faceIndex, face] of faces.slice(0, 4).entries()) {
    const xs = face.map((p) => p.x * frame.width), ys = face.map((p) => p.y * frame.height);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.45;
    const left = cx - size / 2, top = cy - size / 2;
    x.fillStyle = '#000'; x.fillRect(0, 0, 512, 512);
    x.drawImage(frame, left, top, size, size, 0, 0, 512, 512);
    const rgb = x.getImageData(0, 0, 512, 512).data, input = new Float32Array(n * 3);
    for (let ch = 0; ch < 3; ch++) for (let i = 0; i < n; i++) input[ch * n + i] = (rgb[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    const tensor = new ort.Tensor('float32', input, [1, 3, 512, 512]);
    let output;
    try {
      output = await task.run({ [task.inputNames[0]]: tensor });
      const result = output[task.outputNames[0]], logits = await result.getData();
      const oh = Number(result.dims[2]), ow = Number(result.dims[3]), count = oh * ow, labels = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        let best = -Infinity;
        for (let ch = 0; ch < Number(result.dims[1]); ch++) if (logits[ch * count + i] > best) { best = logits[ch * count + i]; labels[i] = ch; }
      }
      let glassPixels = 0;
      for (let y = Math.max(0, Math.floor(top / frame.height * h)); y < Math.min(h, Math.ceil((top + size) / frame.height * h)); y++) {
        for (let xx = Math.max(0, Math.floor(left / frame.width * w)); xx < Math.min(w, Math.ceil((left + size) / frame.width * w)); xx++) {
          const sx = Math.min(ow - 1, Math.max(0, Math.floor(((xx + .5) / w * frame.width - left) / size * ow)));
          const sy = Math.min(oh - 1, Math.max(0, Math.floor(((y + .5) / h * frame.height - top) / size * oh)));
          const label = labels[sy * ow + sx], i = y * w + xx;
          // Landmark oval prevents a crop's second person or neck from being retouched as this face.
          if (label === 1 || label === 10) skin[i] = Math.max(skin[i], analysis.skin.data[i]);
          if (label === 12 || label === 13) features[i * 4] = 255;
          if (label === 4 || label === 5) features[i * 4 + 1] = 255;
          if (label === 11) features[i * 4 + 2] = 255;
          if (label === 6) { glasses[i] = 255; glassPixels++; }
        }
      }
      // Geometry around spectacles is attenuated so eye enlargement does not bend the frame.
      analysis.glasses[faceIndex] = glassPixels > Math.max(3, (size / frame.width * w) ** 2 * .004) ? 1 : 0;
    } finally {
      tensor.dispose();
      for (const value of Object.values(output ?? {})) value.dispose();
    }
  }
  // Feather semantic class boundaries by one output pixel without bleeding into glasses or hair.
  const soften = (data, channels) => {
    const out = new Uint8Array(data.length);
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) for (let ch = 0; ch < channels; ch++) {
      let sum = data[(y * w + xx) * channels + ch] * 4, weight = 4;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (xx + dx >= 0 && xx + dx < w && y + dy >= 0 && y + dy < h) { sum += data[((y + dy) * w + xx + dx) * channels + ch]; weight++; }
      out[(y * w + xx) * channels + ch] = Math.round(sum / weight);
    }
    return out;
  };
  analysis.skin.data = soften(skin, 1);
  const softFeatures = soften(features, 4);
  for (let i = 0; i < w * h; i++) {
    softFeatures[i * 4 + 3] = analysis.features?.data[i * 4 + 3] ?? 0;
    if (glasses[i]) { analysis.skin.data[i] = 0; softFeatures[i * 4 + 1] = 0; }
    if (analysis.makeup) {
      analysis.makeup.data[i * 4] *= analysis.skin.data[i] / 255;
      analysis.makeup.data[i * 4 + 1] *= analysis.skin.data[i] / 255;
    }
  }
  analysis.features = { w, h, data: softFeatures, rgba: true };
}
