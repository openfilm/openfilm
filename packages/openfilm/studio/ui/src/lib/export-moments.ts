/**
 * The moments an image or slides export takes: any frames of the film the person picks, one file or page each.
 *
 * A moment is film ms on the project's frame grid. The quick picks (the playhead, the middle of each scene, each
 * marker, one every few seconds) only fill the list; the person adds, moves and removes frames from there. What was
 * picked is kept per project in this browser, so the dialog opens on it next time.
 */
import { FILM_DOC_FILE } from './film.ts';
import { frameAt, frameMs } from './timecode.ts';

export type MomentsKind = 'images' | 'slides' | 'frames';

/** The most each export takes (exports.mjs checks the same). */
export const MOMENTS_MAX: Record<MomentsKind, number> = { images: 500, slides: 200, frames: 500 };

/** The film drawn at `ms`, `w` px wide, as Studio's server draws it for an export (pageframes.mjs). */
export function filmFrameUrl(projectId: string, ms: number, w: number): string {
  return `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(FILM_DOC_FILE)}&ms=${Math.round(ms)}&w=${Math.round(w)}`;
}

/** The last frame of a film `totalMs` long. */
export function lastFrameMs(totalMs: number, fps: number): number {
  const f = frameAt(totalMs, fps);
  return frameMs(Math.max(0, frameMs(f, fps) >= totalMs - 1e-3 ? f - 1 : f), fps);
}

/** `ms` on the film's nearest frame, inside the film. */
export function momentAt(ms: number, totalMs: number, fps: number): number {
  return frameMs(Math.min(frameAt(Math.max(0, ms), fps), frameAt(lastFrameMs(totalMs, fps), fps)), fps);
}

/** The moments as kept: on frames, inside the film, each frame once, in time order, at most `max`. */
export function cleanMoments(list: readonly number[], totalMs: number, fps: number, max: number): number[] {
  if (!(totalMs > 0)) return [];
  const frames = new Set<number>();
  for (const ms of list) if (Number.isFinite(ms)) frames.add(frameAt(momentAt(ms, totalMs, fps), fps));
  return [...frames].sort((a, b) => a - b).slice(0, max).map((f) => frameMs(f, fps));
}

/** Whether two moments are the same frame. */
export function sameFrame(a: number, b: number, fps: number): boolean {
  return frameAt(a, fps) === frameAt(b, fps);
}

/** The list with `ms` added, or taken out when that frame is in it already. */
export function toggleMoment(list: readonly number[], ms: number, totalMs: number, fps: number, max: number): number[] {
  const at = momentAt(ms, totalMs, fps);
  return list.some((m) => sameFrame(m, at, fps))
    ? list.filter((m) => !sameFrame(m, at, fps))
    : cleanMoments([...list, at], totalMs, fps, max);
}

/**
 * The middle of each picture clip, as the server picks scene stills when it is given no moments (exports.mjs
 * stillFrames): clips starting within 0.4 s of the one before count once.
 */
export function sceneMiddles(scenes: readonly { startMs: number; durMs: number }[], totalMs: number, fps: number, max = 120): number[] {
  const out: number[] = [];
  let lastAt = -Infinity;
  for (const sc of [...scenes].sort((a, b) => a.startMs - b.startMs)) {
    if (!(sc.durMs > 0) || sc.startMs >= totalMs || sc.startMs - lastAt < 400) continue;
    lastAt = sc.startMs;
    out.push((sc.startMs + Math.min(sc.startMs + sc.durMs, totalMs)) / 2);
  }
  return cleanMoments(out.length ? out : [totalMs / 2], totalMs, fps, max);
}

/** One frame every `stepMs`, each from the middle of its stretch (the very first frame is often a fade from black). */
export function everyMoments(stepMs: number, totalMs: number, fps: number, max: number): number[] {
  if (!(stepMs > 0) || !(totalMs > 0)) return [];
  const out: number[] = [];
  for (let at = stepMs / 2; at < totalMs && out.length < max; at += stepMs) out.push(at);
  return cleanMoments(out.length ? out : [totalMs / 2], totalMs, fps, max);
}

/** How many frames one every `stepMs` gives. */
export function everyCount(stepMs: number, totalMs: number): number {
  return stepMs > 0 && totalMs > 0 ? Math.max(1, Math.ceil((totalMs - stepMs / 2) / stepMs)) : 0;
}

/** The moments as an export asks for them: film seconds. */
export function momentSeconds(list: readonly number[]): number[] {
  return list.map((ms) => Math.round(ms) / 1000);
}

const STORE_KEY = 'openfilm.exportMoments.v1';
/** The projects whose picks are kept: the latest ones. */
const PROJECTS_KEPT = 50;

type Store = Record<string, Partial<Record<MomentsKind, number[]>>>;

function readStore(): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as unknown;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Store) : {};
  } catch {
    return {};
  }
}

/** What was picked for this project last time (null: nothing yet). */
export function loadMoments(projectId: string, kind: MomentsKind): number[] | null {
  const list = readStore()[projectId]?.[kind];
  return Array.isArray(list) ? list.filter((ms) => typeof ms === 'number' && Number.isFinite(ms)) : null;
}

/** One selection for every image delivery; migrate the previously used destination's picks on first use. */
export function loadSharedMoments(projectId: string, previous: 'images' | 'slides'): number[] | null {
  return loadMoments(projectId, 'frames') ?? loadMoments(projectId, previous)
    ?? loadMoments(projectId, previous === 'images' ? 'slides' : 'images');
}

export function saveMoments(projectId: string, kind: MomentsKind, list: readonly number[]): void {
  try {
    const store = readStore();
    const mine = { ...store[projectId], [kind]: [...list] };
    delete store[projectId];
    store[projectId] = mine;
    const ids = Object.keys(store);
    for (const id of ids.slice(0, Math.max(0, ids.length - PROJECTS_KEPT))) delete store[id];
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch { /* storage off (private window) */ }
}

/**
 * What the strip shows of the film: `zoom` times closer than the whole film across, from `start` (film ms) at its left
 * edge. Zoomed in, it scrolls; the closest is a second across.
 */
export interface StripView { zoom: number; start: number }

export const STRIP_WHOLE: StripView = { zoom: 1, start: 0 };

/** The closest the strip zooms: a second across. */
export function stripZoomMax(totalMs: number): number {
  return Math.max(1, totalMs / 1000);
}

/** The view kept inside the film and its zoom between the whole film and a second. */
export function clampView(view: StripView, totalMs: number): StripView {
  const zoom = Math.min(stripZoomMax(totalMs), Math.max(1, view.zoom));
  const span = totalMs / zoom;
  return { zoom, start: Math.min(Math.max(0, totalMs - span), Math.max(0, view.start)) };
}

/** Zoomed by `factor` around `at` (0 to 1 across the strip): the moment there stays there. */
export function zoomView(view: StripView, factor: number, at: number, totalMs: number): StripView {
  const span = totalMs / view.zoom;
  const anchor = view.start + at * span;
  const zoom = Math.min(stripZoomMax(totalMs), Math.max(1, view.zoom * factor));
  return clampView({ zoom, start: anchor - at * (totalMs / zoom) }, totalMs);
}

/** Scrolled, if need be, so `ms` is in sight, a tenth of the strip in from either edge. */
export function viewShowing(view: StripView, ms: number, totalMs: number): StripView {
  const span = totalMs / view.zoom;
  const margin = span / 10;
  if (ms < view.start + margin) return clampView({ ...view, start: ms - margin }, totalMs);
  if (ms > view.start + span - margin) return clampView({ ...view, start: ms - span + margin }, totalMs);
  return view;
}

/** The smallest of `steps` (ms) at least `minPx` wide when a pixel is `msPerPx`; the largest when none is. */
export function stepFor(msPerPx: number, minPx: number, steps: readonly number[]): number {
  return steps.find((s) => s / msPerPx >= minPx) ?? steps[steps.length - 1]!;
}
