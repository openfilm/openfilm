/** Interactive drafts, exact stills and exports share analysis, with distinct quality and bounded caches. */
import { AnalysisCache, faceMaskKey, hasBeauty } from './vision-config.mjs';
import { previewPlan, analysisVariant, analysisBytes } from './vision-preview.mjs';
import { VisionComposite } from './vision-composite.mjs';
import { analyzeFrame, clearFrameAnalysis } from './vision-analyzer.mjs';
import { cachedAnalysis, storeAnalysis, clearAnalysisCache } from './vision-cache.mjs';
import { VISION_MODELS } from './vision-models.mjs';

let memory = new AnalysisCache(64 * 1024 * 1024), compositor;
const VERSION = '5:' + Object.values(VISION_MODELS).map((model) => model.sha256).join(':');
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const { id, frame, src, time, settings, exact = false, playing = false, policy = 'auto', sourceVersion, sourceSize } = data;
    try {
      if (data.type === 'clear') {
        memory = new AnalysisCache(64 * 1024 * 1024); clearFrameAnalysis(); await clearAnalysisCache();
        self.postMessage({ id, phase: 'ready', cleared: true }); return;
      }
      const started = performance.now(), plan = previewPlan(settings, { playing, exact, mode: policy, side: data.analysisSide ?? 256 });
      const identity = sourceVersion ?? src;
      const shape = sourceSize ?? `${frame.width}/${frame.height}`;
      const hqKey = `${VERSION}\0${identity}\0${time.toFixed(6)}\0${shape}\0${analysisVariant(settings)}\0quality`;
      const key = plan.profile === 'quality' ? hqKey : `${hqKey}\0${plan.profile}\0${plan.settings.analysisSize ?? '-'}\0${plan.preview ? faceMaskKey(plan.settings) : 'all'}\0${exact ? `${frame.width}x${frame.height}` : ''}`;
      let analysis, hit = null, profile = plan.profile;
      if (!exact && policy === 'auto' && playing) {
        analysis = memory.get(hqKey);
        if (analysis) hit = 'memory';
        else if (sourceVersion) { analysis = await cachedAnalysis(hqKey); if (analysis) { hit = 'disk'; memory.set(hqKey, analysis, analysisBytes(analysis)); } }
        if (analysis) profile = 'quality';
      }
      if (!analysis) { analysis = memory.get(key); if (analysis) hit = 'memory'; }
      if (!analysis && plan.profile === 'quality' && sourceVersion) { analysis = await cachedAnalysis(key); if (analysis) hit = 'disk'; }
      let analysisMs = 0;
      if (!analysis && plan.profile !== 'original') {
        const side = plan.preview && !hasBeauty(plan.settings) && !plan.settings.personPreview && plan.settings.mode === 1 ? Infinity : plan.analysisSide;
        const scale = Math.min(1, side / Math.max(frame.width, frame.height));
        const copy = scale === 1 ? frame : await createImageBitmap(frame, { resizeWidth: Math.max(1, Math.round(frame.width * scale)), resizeHeight: Math.max(1, Math.round(frame.height * scale)) });
        const analysisStart = performance.now();
        try {
          analysis = await analyzeFrame({ frame: copy, src: identity, time, settings: plan.settings, preview: plan.preview }, (status) => self.postMessage({ ...status, id }));
        } finally { if (copy !== frame) copy.close(); }
        analysisMs = performance.now() - analysisStart;
        memory.set(key, analysis, analysisBytes(analysis));
        // Persist only precise editor stills. Export uses originals and never depends on preview resolution/cache.
        if (!exact && !playing && plan.profile === 'quality' && sourceVersion) void storeAnalysis(key, analysis, analysisBytes(analysis));
      }
      compositor ??= new VisionComposite();
      const bitmap = profile === 'original' ? await createImageBitmap(frame) : compositor.render(frame, analysis ?? {}, settings, plan.side);
      self.postMessage({ id, phase: 'ready', bitmap, meta: {
        profile, cache: hit, processingMs: performance.now() - started, analysisMs,
        backend: hit ? 'Cache / WebGL' : analysis?.backend ?? 'WebGL', analysisSide: plan.settings.analysisSize ?? null,
      } }, [bitmap]);
    } catch (error) { self.postMessage({ id, phase: 'error', error: error?.message ?? String(error) }); }
    finally { frame?.close(); }
  });
};
