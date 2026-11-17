import { hasVideoEffects, videoEffects, hasBeauty } from './vision-config.mjs';
import { adaptiveSide, PREVIEW_MODES, previewPlan } from './vision-preview.mjs';

const states = new Map(), lanes = new Map(), pending = new Map(), identities = new Map();
let nextId = 0, previewMode = 'auto', editorPreview = false;
const now = () => window.filmHost?.now?.() ?? performance.now();
function rejectLane(lane, error) {
  lanes.get(lane)?.terminate(); lanes.delete(lane);
  for (const [id, job] of pending) if (job.lane === lane) { clearTimeout(job.timer); job.reject(error); pending.delete(id); }
}
function rejectAll(error) { for (const lane of [...lanes.keys()]) rejectLane(lane, error); }
function processFrame(frame, options, progress = () => {}, lane = 'interactive') {
  let worker = lanes.get(lane);
  if (!worker) {
    worker = new Worker(new URL('./vision-worker.mjs', import.meta.url), { type: 'module' }); lanes.set(lane, worker);
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) { data.bitmap?.close(); return; }
      if (!['ready', 'error'].includes(data.phase)) { job.progress(data); return; }
      pending.delete(data.id); clearTimeout(job.timer);
      if (data.error) job.reject(new Error(data.error)); else job.resolve({ bitmap: data.bitmap, meta: data.meta });
    };
    worker.onerror = (event) => { event.preventDefault(); rejectLane(lane, new Error(event.message || 'Video effects worker failed.')); };
    worker.onmessageerror = () => rejectLane(lane, new Error('Video effects returned an unreadable frame.'));
  }
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => rejectLane(lane, new Error('Video effects timed out. Retry processing.')), 660000);
    pending.set(id, { lane, timer, resolve, reject, progress });
    try { worker.postMessage({ id, frame, ...options }, frame ? [frame] : []); }
    catch (error) { clearTimeout(timer); pending.delete(id); frame?.close(); reject(error); }
  });
}
async function identity(c) {
  const src = c.el.currentSrc || c.el.src;
  if (!src) return null;
  if (!identities.has(src)) identities.set(src, fetch(src, { method: 'HEAD' }).then((r) => r.headers.get('x-openfilm-media-id'), () => null));
  return identities.get(src);
}
let style;
const APPEARANCE = [
  'position',
  'left',
  'top',
  'width',
  'height',
  'translate',
  'rotate',
  'scale',
  'transform',
  'transform-origin',
  'opacity',
  'mix-blend-mode',
  'clip-path',
  'filter',
  'border',
  'border-radius',
  'box-shadow',
  'box-sizing',
  'object-fit',
  'object-position',
  'mask-image',
  'mask-size',
  'mask-position',
  'mask-repeat',
  'mask-composite',
  'mask-mode',
  'z-index',
  'backface-visibility',
];
/** A canvas drawn in a video clip's place: its look as the video's (APPEARANCE), shown while the clip is, just after it. */
export function followVideo(c, canvas) {
  const css = getComputedStyle(c.el);
  for (const key of APPEARANCE) {
    const value = css.getPropertyValue(key);
    if (canvas.style.getPropertyValue(key) !== value) canvas.style.setProperty(key, value);
  }
  canvas.style.visibility = c.shown && c.el.style.visibility === 'visible' ? 'visible' : 'hidden';
  if (canvas.previousElementSibling !== c.el) c.el.after(canvas);
}
function sync(c, state) {
  if (state.canvas) followVideo(c, state.canvas);
}
export function videoEffectsOn(c) { const css = getComputedStyle(c.el); return hasVideoEffects(videoEffects((k) => css.getPropertyValue(k))); }
export function videoEffectsState(c) {
  const s = states.get(c);
  return {
    phase: s?.phase ?? 'idle', sourceTime: s?.profile === 'original' ? c.el.currentTime : s?.time ?? null, frames: s?.frames ?? 0,
    preview: s?.profile ?? null, needsDetail: s?.needsDetail ?? false, backend: s?.backend ?? null, processingMs: s?.ms ?? null, fps: s?.fps ?? null,
    cache: s?.cache ?? null, refining: Boolean(s?.refining), policy: previewMode,
    ...(s?.error ? { error: s.error } : {}), ...(s?.download ? { download: s.download } : {}),
  };
}
function restoreVideo(c) { c.el?.removeAttribute('data-film-vision-source'); }
export function hideVideoEffects(c) { const s = states.get(c); if (s?.canvas) s.canvas.style.visibility = 'hidden'; }
/** A rendered preview covers this source. Stop queued still work until the source is needed again. */
export function suspendVideoEffects(c) {
  const s = states.get(c); hideVideoEffects(c); restoreVideo(c);
  if (!s || s.suspended) return;
  s.suspended = true; s.generation++; s.desired = null; s.refining = false;
  clearTimeout(s.stillTimer); s.requestKey = ''; s.lastPaused = '';
}
export function clearVideoEffects(c) {
  const s = states.get(c);
  if (s) { s.active = false; s.generation++; clearTimeout(s.stillTimer); s.canvas?.remove(); states.delete(c); }
  restoreVideo(c);
  if (!states.size) rejectAll(new DOMException('Video effects stopped.', 'AbortError'));
}
export function retryVideoEffects(c) { clearVideoEffects(c); }
export function setVideoPreview({ mode, editor } = {}) {
  if (typeof editor === 'boolean') editorPreview = editor;
  if (!PREVIEW_MODES.includes(mode) || mode === previewMode) return;
  previewMode = mode;
  for (const [c, s] of states) { if (s.playing && s.lane === 'precise') s.job = null; s.generation++; s.requestKey = ''; s.lastPaused = ''; s.error = null; if (c.shown) void drawVideoEffects(c, c.lastWant ?? c.el.currentTime); }
}
export async function clearVideoAnalysisCache() {
  await Promise.all([...new Set(['interactive', ...lanes.keys()])].map((lane) => processFrame(null, { type: 'clear' }, undefined, lane)));
}
function ensureState(c) {
  let s = states.get(c);
  if (!s) { s = { active: true, phase: 'loading', settings: '', generation: 0, job: null, desired: null, playing: false, side: 256, frames: 0 }; states.set(c, s); }
  return s;
}
async function run(c, s, request) {
  let bitmap;
  const { settings, config, generation, exact, policy, draft } = request;
  const lane = exact ? 'export' : draft ? 'interactive' : 'precise';
  s.lane = lane;
  try {
    if (!s.active || s.generation !== generation || c.el.readyState < 2 || c.el.seeking) return;
    const sourceVersion = await identity(c);
    if (!s.active || s.generation !== generation) return;
    const playing = draft || (!exact && s.playing);
    const pts = draft && s.playing && c.presented != null && Math.abs(c.el.currentTime - c.presented) < .15 ? c.presented : request.time;
    const captureStamp = `${generation}:${pts.toFixed(6)}:${draft}`;
    if (!exact && s.captureStamp === captureStamp && s.time === pts) return;
    s.captureStamp = captureStamp;
    const plan = previewPlan(settings, { playing, exact, mode: policy, side: s.side });
    const ratio = Math.min(1, plan.side / Math.max(c.el.videoWidth, c.el.videoHeight));
    let snapshot;
    try { if (globalThis.VideoFrame) snapshot = new VideoFrame(c.el, { timestamp: Math.round(pts * 1e6) }); } catch {}
    let frame;
    try { frame = await createImageBitmap(snapshot ?? c.el, { resizeWidth: Math.max(1, Math.round(c.el.videoWidth * ratio)), resizeHeight: Math.max(1, Math.round(c.el.videoHeight * ratio)) }); }
    finally { snapshot?.close(); }
    const started = now();
    const result = await processFrame(frame, {
      src: c.src, time: pts, settings, exact, playing, policy, sourceVersion,
      sourceSize: `${c.el.videoWidth}x${c.el.videoHeight}`, analysisSide: s.side,
    }, (status) => { if (s.active && s.generation === generation) { s.phase = status.phase; s.download = status.download; } }, lane);
    bitmap = result.bitmap;
    if (!s.active || s.generation !== generation || s.settings !== config || s.bypassed) return;
    if (!exact && !s.playing && Math.abs((c.lastWant ?? request.time) - request.time) > .002) return;
    if (!exact && s.playing && !draft && policy !== 'quality') return;
    const elapsed = now() - started;
    if (draft && result.meta?.analysisMs) s.side = adaptiveSide(s.side, elapsed);
    // Never cover a moving source with a result that has fallen far behind it.
    if (!exact && s.playing && draft && Math.abs(c.el.currentTime - pts) > .18) { hideVideoEffects(c); restoreVideo(c); s.profile = 'original'; return; }
    if (!s.canvas) {
      style ??= document.head.appendChild(document.createElement('style'));
      style.textContent = 'video[data-film-vision-source]{visibility:hidden!important}';
      s.canvas = document.createElement('canvas'); s.canvas.setAttribute('data-film-vision', c.id); s.canvas.style.pointerEvents = 'none';
    }
    if (s.canvas.width !== bitmap.width || s.canvas.height !== bitmap.height) { s.canvas.width = bitmap.width; s.canvas.height = bitmap.height; }
    const context = s.canvas.getContext('2d');
    context.globalCompositeOperation = 'copy'; context.drawImage(bitmap, 0, 0); context.globalCompositeOperation = 'source-over';
    c.el.setAttribute('data-film-vision-source', '');
    const completed = now();
    if (s.completed && s.playing) { const fps = 1000 / Math.max(1, completed - s.completed); s.fps = s.fps == null ? fps : s.fps * .8 + fps * .2; }
    s.completed = completed; s.frames++; s.time = pts; s.phase = 'ready'; s.error = null; s.download = null;
    s.profile = result.meta?.profile ?? (exact ? 'export' : draft ? 'draft' : 'quality'); s.backend = result.meta?.backend; s.cache = result.meta?.cache; s.ms = Math.round(elapsed);
    sync(c, s);
  } catch (error) {
    if (error?.name === 'AbortError' || !s.active || s.generation !== generation) return;
    s.phase = 'error'; s.error = error?.message ?? String(error); s.canvas?.remove(); s.canvas = null; restoreVideo(c);
    if (exact) throw new Error(`clip "${c.id}": ${s.error}`);
  } finally { bitmap?.close(); }
}
function pump(c, s) {
  if (s.exactActive || s.job || !s.desired || !s.active || !c.shown) return;
  const request = s.desired; s.desired = null;
  const job = run(c, s, request).finally(() => { if (s.job === job) s.job = null; if (s.desired) queueMicrotask(() => pump(c, s)); });
  s.job = job;
}
/** Playback is frame-driven. Interaction keeps only its newest request; still refinement is debounced. */
export async function drawVideoEffects(c, time, exact = false, context = {}) {
  // Editor replacement frames wait for the page, but must not run the export pipeline for their first picture.
  exact = exact && !editorPreview;
  const css = getComputedStyle(c.el), settings = videoEffects((key) => css.getPropertyValue(key));
  if (settings.bypass) { const s = states.get(c); if (s) { s.bypassed = true; s.generation++; clearTimeout(s.stillTimer); hideVideoEffects(c); } restoreVideo(c); return; }
  if (!hasVideoEffects(settings)) { clearVideoEffects(c); return; }
  const s = ensureState(c), config = JSON.stringify(settings), playing = !exact && (context.playing ?? !c.el.paused);
  if (s.suspended) { s.suspended = false; s.requestKey = ''; s.lastPaused = ''; }
  if (!exact && s.exactActive) return;
  if (s.settings !== config) {
    const model = `${settings.mode}:${settings.quality}`;
    if (s.job && s.model !== model) rejectLane(s.lane, new DOMException('Video effects model changed.', 'AbortError'));
    s.needsDetail = (settings.cutout && [2, 4].includes(settings.mode)) || (hasBeauty(settings) && settings.quality >= .5);
    s.settings = config; s.model = model; s.generation++; s.requestKey = ''; s.lastPaused = ''; s.error = null;
  }
  if (s.playing !== playing) { if (playing && s.lane === 'precise') s.job = null; s.generation++; s.playing = playing; s.requestKey = ''; s.lastPaused = ''; s.fps = null; s.completed = null; }
  s.bypassed = false;
  if (playing) clearTimeout(s.stillTimer);
  // Seeks/cuts invalidate pending results. Continuous playback itself does not cancel every in-flight frame.
  const pts = playing && c.presented != null && Math.abs(c.el.currentTime - c.presented) < .15 ? c.presented : time;
  if (playing && s.lastRequested != null && (pts < s.lastRequested - .002 || pts - s.lastRequested > .2)) { s.generation++; s.requestKey = ''; }
  if (!playing && s.pausedTime != null && Math.abs(pts - s.pausedTime) > .002) { s.generation++; s.requestKey = ''; if (s.lane === 'precise') s.job = null; }
  if (!playing) s.pausedTime = pts;
  s.lastRequested = pts;
  sync(c, s);
  if (!exact && s.canvas && Math.abs(time - (s.time ?? time)) > .18) { hideVideoEffects(c); restoreVideo(c); }
  if (c.el.readyState < 2 || c.el.seeking) { if (exact) throw new Error(`clip "${c.id}": its video frame is not decoded for processing`); return; }
  const request = { settings, config, generation: s.generation, time: pts, exact, policy: previewMode, draft: playing && previewMode !== 'quality' };
  if (exact) {
    s.exactActive = true; clearTimeout(s.stillTimer); s.desired = null; s.generation++;
    try { if (s.job) await s.job; s.desired = null; await run(c, s, { ...request, generation: s.generation }); }
    finally { s.exactActive = false; s.refining = false; }
    return;
  }
  const key = `${s.generation}:${pts.toFixed(6)}:${playing}`;
  if (key !== s.requestKey) {
    s.requestKey = key;
    // Paused scrubbing gets a lightweight frame first, followed by the selected precise effect.
    s.desired = { ...request, draft: playing ? previewMode !== 'quality' : true, policy: playing ? previewMode : 'smooth' };
    pump(c, s);
  }
  if (!playing && s.lastPaused !== key) {
    s.lastPaused = key; clearTimeout(s.stillTimer); s.refining = true;
    const refine = () => {
      if (!s.active || s.playing || s.lastPaused !== key) return;
      if ([...states].some(([clip, state]) => clip.shown && state.playing)) { s.stillTimer = setTimeout(refine, 250); return; }
      s.desired = { ...request, draft: false }; pump(c, s);
      const wait = () => { if (s.job) void s.job.finally(wait); else if (s.lastPaused === key) s.refining = false; }; wait();
    };
    s.stillTimer = setTimeout(refine, 180);
  }
  if (!playing && s.job) await s.job;
}
window.addEventListener('pagehide', () => { for (const c of states.keys()) clearVideoEffects(c); rejectAll(new DOMException('The film was closed.', 'AbortError')); });
