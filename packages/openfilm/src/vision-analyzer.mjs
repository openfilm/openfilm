import { FaceLandmarker, FilesetResolver, ImageSegmenter } from './vision/1.2.2/vision_bundle.mjs';
import { AnalysisCache, analysisKey, hasBeauty, faceMaskKey } from './vision-config.mjs';
import { analysisVariant, analysisBytes } from './vision-preview.mjs';
import { clearInputCache } from './vision-input-cache.mjs';
import { matte, visionBackends } from './vision-matting.mjs';
import { refinedMatte, personComponents, protectFaceInterior } from './vision-refine.mjs';
import { parseFaces } from './vision-parse.mjs';
import { faceAnalysis } from './vision-face.mjs';
import ModuleFactory from './vision/1.2.2/wasm/vision_wasm_module_internal.js';

const cache = new AnalysisCache();
const mattes = new AnalysisCache(24 * 1024 * 1024);
const faceCache = new AnalysisCache(24 * 1024 * 1024);
const delegates = {};
let segmenter, landmarker;
const files = () => FilesetResolver.forVisionTasks(new URL('./vision/1.2.2/wasm', import.meta.url).href, true);
async function make(Task, model, options) {
  const wasm = await files();
  const common = { runningMode: 'IMAGE', ...options };
  const create = (delegate) => {
    // MediaPipe consumes its global factory. ESM imports are cached, so restore it for each task and fallback.
    self.ModuleFactory = ModuleFactory;
    return Task.createFromOptions(wasm, {
      ...common,
      canvas: new OffscreenCanvas(1, 1),
      baseOptions: { modelAssetPath: new URL(`./vision/${model}`, import.meta.url).href, delegate },
    });
  };
  try {
    const task = await create('GPU'); delegates[model] = 'WebGL'; return task;
  } catch {
    delegates[model] = 'CPU'; return create('CPU');
  }
}
const personTask = () =>
  (segmenter ??= make(ImageSegmenter, 'person.tflite', {
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  }).catch((error) => {
    segmenter = null;
    throw error;
  }));
const faceTask = () =>
  (landmarker ??= make(FaceLandmarker, 'face.task', {
    numFaces: 4,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  }).catch((error) => {
    landmarker = null;
    throw error;
  }));

/** Shared directly with the compositor worker: masks no longer cross a second worker boundary every frame. */
export async function analyzeFrame({ frame, src, time, settings, preview = false }, progress = () => {}) {
  const beauty = hasBeauty(settings);
  const dimensions = `${frame.width}x${frame.height}`;
  const featureSet = preview ? faceMaskKey(settings) : 'all';
  const key = `${analysisKey(src, time, beauty)}\0${analysisVariant(settings)}\0${featureSet}\0${!!preview}\0${settings.analysisSize ?? 384}\0${dimensions}`;
  let analysis = cache.get(key);
  if (analysis) return analysis;
  const matteKey = `${analysisKey(src, time, false)}\0${settings.mode}\0${!!settings.personPreview}\0${!!preview}\0${settings.analysisSize ?? 384}\0${dimensions}`;
  const savedMatte = settings.cutout ? mattes.get(matteKey) : null;
  const faceKey = `${analysisKey(src, time, true)}\0${settings.quality >= .5}\0${featureSet}\0${!!preview}\0${dimensions}`;
  let facial = beauty ? faceCache.get(faceKey) : null;
  progress({ phase: 'processing' });
  // MediaPipe's loader is global. Initialize its tasks sequentially.
  const person = settings.cutout && settings.mode === 0 && !savedMatte ? await personTask() : null;
  const face = (beauty && !facial) || (settings.cutout && (settings.mode === 4 || settings.personPreview) && !savedMatte) ? await faceTask() : null;
  const faces = face ? face.detect(frame).faceLandmarks : [];
  analysis = savedMatte ? { person: savedMatte } : {};
  if (person) person.segment(frame, (result) => {
    const labels = person.getLabels(), index = Math.max(0, labels.findIndex((name) => /person|foreground/i.test(name)));
    const mask = result.confidenceMasks[index], values = mask.getAsFloat32Array();
    const invert = result.confidenceMasks.length === 1 && /background/i.test(labels[0] ?? '');
    analysis.person = { w: mask.width, h: mask.height, data: Uint8Array.from(values, (v) => Math.round(255 * (invert ? 1 - v : v))) };
  });
  if (settings.cutout && !savedMatte && settings.mode > 0 && settings.mode < 3)
    analysis.person = await matte(frame, settings.mode, progress, preview, settings.analysisSize ?? 384);
  if (settings.personPreview && analysis.person && !savedMatte)
    analysis.person = protectFaceInterior(personComponents(analysis.person, faces), faces);
  if (settings.cutout && !savedMatte && settings.mode === 4)
    analysis.person = await refinedMatte(frame, progress, preview, faces);
  if (analysis.person && !savedMatte) mattes.set(matteKey, analysis.person, analysis.person.data.byteLength);
  if (beauty) {
    if (!facial) {
      // All feature regions are strength-independent: turning a slider on no longer repeats neural inference.
      facial = faceAnalysis(faces, frame.width, frame.height, preview, preview ? settings : { lip: 1, eyeBright: 1, teeth: 1, darkCircles: 1, blush: 1, shadow: 1 });
      if (settings.quality >= .5) await parseFaces(frame, faces, facial, progress);
      faceCache.set(faceKey, facial, analysisBytes(facial));
    }
    Object.assign(analysis, facial);
  }
  const backends = visionBackends(), used = [];
  if (settings.cutout && settings.mode === 0) used.push(delegates['person.tflite']);
  if (settings.cutout && [1, 4].includes(settings.mode)) used.push(backends['portrait.onnx']);
  if (settings.cutout && settings.mode === 2) used.push(backends['subject.onnx']);
  if (settings.cutout && settings.mode === 4) used.push(backends['refine.onnx']);
  if (beauty || settings.personPreview || (settings.cutout && settings.mode === 4)) used.push(delegates['face.task']);
  if (beauty && settings.quality >= .5) used.push(backends['face-parse.onnx']);
  analysis.backend = [...new Set(used.filter(Boolean))].join(' / ') || 'WebGL';
  cache.set(key, analysis, analysisBytes(analysis));
  return analysis;
}

export function clearFrameAnalysis() { clearInputCache(); for (const entry of [cache, mattes, faceCache]) { entry.items.clear(); entry.bytes = 0; } }

// Also usable as a standalone worker by quality checks and independent consumers.
if (self.location.pathname.endsWith('/vision-analyzer.mjs')) {
  let queue = Promise.resolve();
  self.onmessage = ({ data }) => {
    queue = queue.then(async () => {
      try {
        const analysis = await analyzeFrame(data, (status) => self.postMessage({ id: data.id, ...status }));
        self.postMessage({ id: data.id, phase: 'ready', analysis });
      } catch (error) { self.postMessage({ id: data.id, phase: 'error', error: error?.message ?? String(error) }); }
      finally { data.frame.close(); }
    });
  };
}
