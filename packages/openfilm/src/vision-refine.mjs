/** Trimap-guided alpha refinement. MODNet supplies the person; ViTMatte resolves the uncertain boundary. */
import { inputKey, previousInput, keepInput } from './vision-input-cache.mjs';
import * as ort from './vision/ort-1.31.1/ort.webgpu.bundle.min.mjs';
import { matte, visionSession, visionBackends } from './vision-matting.mjs';

// Separable min/max filters keep trimap construction linear in image size, even at export resolution.
function extreme(data, w, h, radius, maximum) {
  let input = data;
  for (const vertical of [false, true]) {
    const output = new Uint8Array(w * h), queue = new Int32Array(Math.max(w, h));
    const length = vertical ? h : w, lines = vertical ? w : h;
    for (let line = 0; line < lines; line++) {
      let head = 0, tail = 0, end = 0;
      const index = (p) => vertical ? p * w + line : line * w + p;
      for (let p = 0; p < length; p++) {
        while (end < Math.min(length, p + radius + 1)) {
          const v = input[index(end)];
          while (tail > head && (maximum ? input[index(queue[tail - 1])] <= v : input[index(queue[tail - 1])] >= v)) tail--;
          queue[tail++] = end++;
        }
        while (queue[head] < p - radius) head++;
        output[index(p)] = input[index(queue[head])];
      }
    }
    input = output;
  }
  return input;
}
export function trimapOf(data, w, h, radius) {
  const lo = extreme(data, w, h, radius, false), hi = extreme(data, w, h, radius, true);
  return Uint8Array.from(data, (_, i) => lo[i] >= 245 ? 255 : hi[i] <= 10 ? 0 : 128);
}
export function personComponents(mask, faces = []) {
  const { w, h, data } = mask, labels = new Int32Array(data.length), queue = new Int32Array(data.length), sizes = [0];
  let component = 0;
  for (let start = 0; start < data.length; start++) {
    if (data[start] < 32 || labels[start]) continue;
    component++; let head = 0, tail = 1; queue[0] = start; labels[start] = component;
    while (head < tail) {
      const i = queue[head++], x = i % w;
      for (const next of [x ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (next < 0 || next >= data.length || data[next] < 32 || labels[next]) continue;
        labels[next] = component; queue[tail++] = next;
      }
    }
    sizes.push(tail);
  }
  const keep = new Set();
  for (const face of faces) for (const id of [1, 4, 33, 263, 152]) {
    const x = Math.max(0, Math.min(w - 1, Math.round(face[id].x * w)));
    const y = Math.max(0, Math.min(h - 1, Math.round(face[id].y * h)));
    if (labels[y * w + x]) keep.add(labels[y * w + x]);
  }
  // Without a detected face, retain large components (backs of heads, partial people), dropping isolated graphic noise.
  if (!keep.size) { const largest = sizes.reduce((a, b) => Math.max(a, b), 0); sizes.forEach((size, id) => { if (id && size >= largest * .12) keep.add(id); }); }
  // A one-pixel dilation restores faint alpha immediately outside a kept component.
  return { ...mask, data: Uint8Array.from(data, (alpha, i) => {
    const x = i % w;
    return [i, x ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w].some((j) => j >= 0 && j < labels.length && keep.has(labels[j])) ? alpha : 0;
  }) };
}
/** Saturated skin is still foreground. An inset face oval prevents coarse matte holes becoming definite background. */
export function protectFaceInterior(mask, faces = []) {
  if (!faces.length) return mask;
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  const { w, h } = mask, canvas = new OffscreenCanvas(w,h), ctx = canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle = '#fff';
  for (const face of faces) {
    const points = oval.map((id)=>face[id]);
    if (points.some((p)=>!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
    const cx = points.reduce((n,p)=>n+p.x,0)/points.length, cy = points.reduce((n,p)=>n+p.y,0)/points.length;
    const width = (Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)))*w;
    ctx.filter = `blur(${Math.max(.5,width*.004)}px)`;
    ctx.beginPath(); points.forEach((p,i)=>ctx[i?'lineTo':'moveTo']((cx+(p.x-cx)*.96)*w,(cy+(p.y-cy)*.96)*h)); ctx.closePath(); ctx.fill();
  }
  const pixels = ctx.getImageData(0,0,w,h).data;
  return {...mask,data:Uint8Array.from(mask.data,(v,i)=>Math.max(v,pixels[i*4+3]))};
}
export async function refinedMatte(frame, progress, preview = false, faces = []) {
  const coarse = await matte(frame, 1, progress, preview);
  const cleaned = protectFaceInterior(personComponents(coarse, faces), faces);
  const task = await visionSession('refine.onnx', progress);
  progress?.({ phase: 'processing', download: null });
  const scale = Math.min(1, (preview ? 512 : 1024) / Math.max(frame.width, frame.height));
  const iw = Math.max(1, Math.round(frame.width * scale)), ih = Math.max(1, Math.round(frame.height * scale));
  const w = Math.ceil(iw / 32) * 32, h = Math.ceil(ih / 32) * 32, n = w * h;
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  const m = new OffscreenCanvas(coarse.w, coarse.h), mx = m.getContext('2d');
  const pixels = new Uint8ClampedArray(coarse.w * coarse.h * 4);
  for (let i = 0; i < cleaned.data.length; i++) pixels.set([cleaned.data[i], cleaned.data[i], cleaned.data[i], 255], i * 4);
  mx.putImageData(new ImageData(pixels, coarse.w, coarse.h), 0, 0);
  x.drawImage(m, 0, 0, iw, ih);
  const rgbaMask = x.getImageData(0, 0, w, h).data;
  const alpha = Uint8Array.from({ length: n }, (_, i) => rgbaMask[i * 4]);
  const trimap = trimapOf(alpha, w, h, Math.max(4, Math.round(Math.max(iw, ih) / 64)));
  x.clearRect(0, 0, w, h);
  x.drawImage(frame, 0, 0, iw, ih);
  const rgb = x.getImageData(0, 0, w, h).data, input = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let channel = 0; channel < 3; channel++) input[channel * n + i] = rgb[i * 4 + channel] / 127.5 - 1;
    input[n * 3 + i] = trimap[i] / 255;
  }
  const name = `refine:${visionBackends()['refine.onnx']}:${iw}x${ih}`, key = await inputKey(name, input), previous = previousInput(name, key);
  if (previous) return previous;
  const tensor = new ort.Tensor('float32', input, [1, 4, h, w]);
  let output;
  try {
    output = await task.run({ [task.inputNames[0]]: tensor });
    const values = await output[task.outputNames[0]].getData();
    const data = new Uint8Array(iw * ih);
    for (let y = 0; y < ih; y++) for (let xx = 0; xx < iw; xx++) {
      const i = y * w + xx;
      // Definite regions remain exact; only unknown pixels use predicted alpha.
      data[y * iw + xx] = trimap[i] === 128 ? Math.round(Math.max(0, Math.min(1, values[i])) * 255) : trimap[i];
    }
    const mask = { w: iw, h: ih, data, alpha: true }; keepInput(name, key, mask); return mask;
  } finally {
    tensor.dispose();
    for (const value of Object.values(output ?? {})) value.dispose();
  }
}
