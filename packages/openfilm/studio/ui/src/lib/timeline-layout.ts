/**
 * The timeline's arithmetic: milliseconds to pixels, zoom, ruler steps, and which tracks a film spreads into.
 *
 * Kept apart because these are the things that go wrong at the edges and are hardest to see on screen: a zero-length
 * clip turns a division into Infinity, a wrong ruler step only looks "a bit dense", a wrong track index shows the
 * wrong name on a row.
 */
import { clipSpan } from '../../../../src/film-doc.mjs';
import { fileStem, filmTrackBadges, filmTrackKind, filmTrackPrefix, type FilmBox } from './film.ts';

import { DISPLAY_FPS, exactRate } from './timecode.ts';
import { trimFence } from './timeline-drag.ts';

/**
 * What film.html says about a clip beyond its placement. Only drag gestures and menus read these; placement never
 * does.
 */
export interface TimelineClipMeta {
  /** Word cues (voice only), relative to the clip's own start. */
  cues?: readonly { word: string; tMs: number }[];
  /** The `at` as written, only when it is a reference (`"sc-02.end"`); dragging the clip turns it into a number. */
  atRef?: string;
  /** The duration as written, only when it is a reference. */
  durRef?: string;
  /** It has no length: no `time`, and none of its own (a still, a page without a duration). Drawn at a stand-in length. */
  noLength?: boolean;
}

/** A row's kind on film.html: the kind of clip it holds. */
export type FilmLaneRole = 'mg' | 'video' | 'audio';
export type TimelineLaneKind = 'visual' | 'audio';

/* ── Zoom ─────────────────────────────────────────────────────────────────── */

/**
 * Zoom is how much time one screen shows, not a pixel density.
 *
 * 100% = the whole film just fills the width. Default 80%: a 10 s film shows 12.5 s, with room on the right. Widest:
 * four times the film. Narrowest: always 1 s (30 frames), whatever the film's length, so a short film can still be
 * zoomed all the way in.
 */
/** The narrowest view: 1 s = 30 frames. */
export const VIEW_SPAN_MIN_MS = 1000;
/**
 * What an empty timeline (length 0: a new project, just cleared) shows across.
 *
 * It used to borrow VIEW_SPAN_MIN_MS, so the whole empty track was one second: dropping in the middle landed at
 * 0.5 s and an 8 s clip spread over ten thousand pixels — it looked like "it jumps back to the start". 30 s fits a
 * first short clip and makes the drop position mean something.
 */
export const VIEW_SPAN_EMPTY_MS = 30_000;
/** The widest view, as a multiple of the film's length. */
export const VIEW_SPAN_MAX_FACTOR = 4;
/** Widest zoom: the film takes a quarter of the view. */
export const ZOOM_MIN = 1 / VIEW_SPAN_MAX_FACTOR;
/** Opening zoom: the film takes 80%. */
export const ZOOM_DEFAULT = 0.8;

/** One zoom click. 1.6×: four clicks is about ten times. */
export const ZOOM_STEP = 1.6;

/** The most time one view can show. */
export function viewSpanMaxMs(totalMs: number): number {
  return Math.max(Math.max(0, totalMs) * VIEW_SPAN_MAX_FACTOR, VIEW_SPAN_MIN_MS);
}

/** The lowest zoom (relative to fitting the film). */
export function zoomMinOf(totalMs: number): number {
  if (!(totalMs > 0)) return ZOOM_MIN;
  return totalMs / viewSpanMaxMs(totalMs);
}

/** The highest zoom: film length / 1 s; a 1 s film tops out at 100%. */
export function zoomMaxOf(totalMs: number): number {
  if (!(totalMs > 0)) return ZOOM_MIN;
  return Math.max(zoomMinOf(totalMs), totalMs / VIEW_SPAN_MIN_MS);
}

/** How many milliseconds one view shows at this zoom. */
export function viewSpanMs(totalMs: number, zoom: number): number {
  /* an empty timeline gets a span that means something, not the narrowest one (see VIEW_SPAN_EMPTY_MS) */
  if (!(totalMs > 0)) return VIEW_SPAN_EMPTY_MS;
  const z = clamp(zoom, zoomMinOf(totalMs), zoomMaxOf(totalMs));
  return clamp(totalMs / z, VIEW_SPAN_MIN_MS, viewSpanMaxMs(totalMs));
}

/** Pixels per millisecond at this zoom, from how much time the view shows. */
export function zoomedPxPerMs(totalMs: number, width: number, zoom: number): number {
  if (width <= 0) return 0;
  const span = viewSpanMs(totalMs, zoom);
  if (!(span > 0)) return 0;
  return width / span;
}

/**
 * The zoom that keeps `pxPerMs` once the film is `totalMs` long — the inverse of `zoomedPxPerMs`. A drag past the
 * end, an undo or an agent's change of length changes the zoom factor, not the time in view.
 */
export function zoomForPxPerMs(totalMs: number, width: number, pxPerMs: number): number {
  if (!(totalMs > 0) || width <= 0 || !(pxPerMs > 0)) return ZOOM_DEFAULT;
  return clamp((pxPerMs * totalMs) / width, zoomMinOf(totalMs), zoomMaxOf(totalMs));
}

/** The time the canvas spans at this zoom: at least one view, so the ruler runs on past the end of the film. */
export function canvasTimeMs(totalMs: number, width: number, pxPerMs: number): number {
  if (!(pxPerMs > 0)) return Math.max(0, totalMs);
  return Math.max(totalMs, width / pxPerMs);
}

/** The furthest the dragged clip (and those moving with it) reaches. 0 when nothing is being dragged. */
export function dragReachMs(preview: {
  endMs: number;
  moves?: readonly { endMs: number }[];
} | null | undefined): number {
  if (!preview) return 0;
  let ms = preview.endMs;
  for (const move of preview.moves ?? []) {
    if (move.endMs > ms) ms = move.endMs;
  }
  return Math.max(0, ms);
}

/**
 * The time the canvas spans during a drag: the dragged right edge plus some room after it, so the ruler grows as the
 * clip moves right instead of after release. Density still follows the film's length; only the canvas grows.
 */
export function liveCanvasMs(args: {
  canvasMs: number;
  clipEndMs: number;
  dragReachMs?: number;
  tailMs?: number;
}): number {
  const reach = Math.max(0, args.clipEndMs, args.dragReachMs ?? 0);
  const tail = (args.dragReachMs ?? 0) > 0 ? Math.max(0, args.tailMs ?? 0) : 0;
  return Math.max(0, args.canvasMs, reach + tail);
}

/**
 * The thumb of the range bar under the timeline. Its width goes against the zoom: at 100% or less the film is all in
 * view, the thumb fills the bar and cannot move; above that it is bar / zoom, shortest at the highest zoom.
 */
export function filmZoomThumb(args: {
  zoom: number;
  width: number;
  fromMs?: number;
  totalMs?: number;
  viewMs?: number;
  minThumbPx?: number;
}): { left: number; width: number; canDrag: boolean } {
  const { width } = args;
  const canDrag = args.zoom > 1;
  if (!(width > 0)) return { left: 0, width: 0, canDrag };
  const ratio = args.zoom > 0 ? Math.min(1, 1 / args.zoom) : 1;
  const minThumb = canDrag ? Math.min(width, Math.max(0, args.minThumbPx ?? 16)) : 0;
  const thumb = Math.min(width, Math.max(minThumb, ratio * width));
  const travel = width - thumb;
  const totalMs = args.totalMs ?? 0;
  const viewMs = args.viewMs ?? 0;
  const fromMs = args.fromMs ?? 0;
  const scrollable = Math.max(0, totalMs - viewMs);
  const left = !canDrag || travel <= 0 || scrollable <= 0
    ? 0
    : clamp((fromMs / scrollable) * travel, 0, travel);
  return { left, width: thumb, canDrag };
}

/** Slider position (0–1) ↔ zoom, exponential: fine steps at low zoom, fast at high zoom. The top follows the film. */
export function sliderToZoom(pos: number, totalMs = 0): number {
  const lo = zoomMinOf(totalMs);
  const hi = zoomMaxOf(totalMs);
  if (hi <= lo) return lo;
  return lo * (hi / lo) ** clamp(pos, 0, 1);
}

export function zoomToSlider(zoom: number, totalMs = 0): number {
  const lo = zoomMinOf(totalMs);
  const hi = zoomMaxOf(totalMs);
  if (hi <= lo) return 0;
  return Math.log(clamp(zoom, lo, hi) / lo) / Math.log(hi / lo);
}

/** The millisecond at a horizontal position, clamped to `maxMs` (canvas or film length, the caller's choice). */
export function timeAtPx(px: number, pxPerMs: number, maxMs: number): number {
  if (pxPerMs <= 0) return 0;
  return clamp(px / pxPerMs, 0, maxMs);
}

/**
 * How many views of ticks to draw ahead. The ruler's scrollLeft changes at once while the view state catches up a
 * frame later; without padding a fast flick shows an empty ruler. Counted in views because zoomed in, a flick is a
 * whole view.
 */
export const RULER_VIEW_PAD = 3;

/** The milliseconds to draw ticks for: the view plus `padViews` views either side, clamped to `maxMs`. */
export function rulerWindowMs(args: {
  leftPx: number;
  widthPx: number;
  pxPerMs: number;
  maxMs: number;
  padViews?: number;
}): { fromMs: number; toMs: number } {
  const width = Math.max(0, args.widthPx);
  const pad = width * (args.padViews ?? RULER_VIEW_PAD);
  return {
    fromMs: timeAtPx(args.leftPx - pad, args.pxPerMs, args.maxMs),
    toMs: timeAtPx(args.leftPx + width + pad, args.pxPerMs, args.maxMs),
  };
}

/** A short film draws its whole ruler at once; only past this many ticks does it draw around the view. */
export const RULER_TICK_DOM_MAX = 800;

export function rulerCoverMs(args: {
  leftPx: number;
  widthPx: number;
  pxPerMs: number;
  maxMs: number;
  tickMs: number;
  padViews?: number;
}): { fromMs: number; toMs: number } {
  const maxMs = Math.max(0, args.maxMs);
  if (!(args.tickMs > 0)) return { fromMs: 0, toMs: maxMs };
  const full = Math.floor(maxMs / args.tickMs) + 1;
  if (full <= RULER_TICK_DOM_MAX) return { fromMs: 0, toMs: maxMs };
  return rulerWindowMs(args);
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

/* ── Ruler ────────────────────────────────────────────────────────────────── */

/**
 * Label and tick spacing, worked out separately: labels need room to read (≥96 px), ticks are lines and can sit
 * 12 px apart. One shared spacing forces a choice between overlapping labels and ticks too sparse to aim by (OpenCut's
 * approach, which it says is CapCut's table).
 *
 * Steps are in frames of the project's rate, then whole seconds, because frames are what gets lined up: a
 * "1/2/5 × 10ⁿ ms" family gives 200 ms steps that are neither whole seconds nor whole frames. A step shorter than a
 * second divides the second's frames (5 at 25 fps, 6 at 24), so the ticks of every second fall alike and a label sits
 * on each whole second. At 23.976, 29.97 and 59.94 the ticks start again on each second of the clock, as the
 * timecode counts (lib/timecode), so the last step of a second is a frame short now and then.
 */
export interface RulerSteps {
  /** A label every this many milliseconds (nominal: at 29.97 a frame step is 1001/30 ms). */
  labelMs: number;
  /** A tick every this many milliseconds. Always divides labelMs: a label must sit on a tick. */
  tickMs: number;
  /** The rate the steps are counted in. */
  fps: number;
  /** The steps in frames: under a second's worth, frames within each second; else whole seconds' frames. */
  labelFrames: number;
  tickFrames: number;
}

/* the least room between two labels: 64 px was too tight for `00:12` */
const MIN_LABEL_PX = 96;
const MIN_TICK_PX = 12;

/** Steps coarser than a second: seconds, whole minutes, quarter hours. */
const SECOND_STEPS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Whole frames a second at `fps`, as frames are numbered in it (30 at 29.97). */
function framesPerSecond(fps: number): number {
  return Math.max(1, Math.round(exactRate(fps)));
}

/** Every step in frames, fine to coarse: the divisors of a second's frames (from `from`), then whole seconds. */
function frameStepLadder(fps: number, from: number): number[] {
  const perSec = framesPerSecond(fps);
  const frames: number[] = [];
  for (let n = from; n < perSec; n++) if (perSec % n === 0) frames.push(n);
  return [...frames, ...SECOND_STEPS.map((s) => s * perSec)];
}

/** The first step at least `minPx` wide (in frames); the coarsest when none is. */
function coarsestStep(ladder: readonly number[], msPerFrame: number, pxPerMs: number, minPx: number): number {
  const found = ladder.find((frames) => frames * msPerFrame * pxPerMs >= minPx);
  return found ?? ladder[ladder.length - 1]!;
}

export function rulerSteps(pxPerMs: number, fps = DISPLAY_FPS): RulerSteps {
  const perSec = framesPerSecond(fps);
  if (!(pxPerMs > 0)) return { labelMs: 1000, tickMs: 1000, fps, labelFrames: perSec, tickFrames: perSec };
  /* a frame's nominal length: a second is perSec of them */
  const msPerFrame = 1000 / perSec;
  /* from 2: a label every frame leaves no room for a tick between labels */
  const labels = frameStepLadder(fps, 2);
  const ticks = frameStepLadder(fps, 1);
  const labelFrames = coarsestStep(labels, msPerFrame, pxPerMs, MIN_LABEL_PX);
  const wanted = coarsestStep(ticks, msPerFrame, pxPerMs, MIN_TICK_PX);

  /* the tick step must divide the label step, or labels fall between ticks: from the wanted step go coarser until one
     divides; failing that, ticks only at the labels */
  const tickFrames = labelFrames % wanted === 0
    ? wanted
    : ticks.find((frames) => frames >= wanted && labelFrames % frames === 0) ?? labelFrames;

  return { labelMs: labelFrames * msPerFrame, tickMs: tickFrames * msPerFrame, fps, labelFrames, tickFrames };
}

/** A tick on the ruler: where (ms), and whether it carries a label. */
export type RulerMark = { ms: number; label: boolean };

/**
 * The ticks in `[fromMs, toMs]`, only the visible stretch (zoomed in, a long film has tens of thousands). Steps of
 * whole seconds fall on the clock's seconds; finer ones on frames, counted again from each second.
 */
export function rulerMarks(fromMs: number, toMs: number, steps: RulerSteps): RulerMark[] {
  if (toMs < fromMs || !(steps.tickFrames > 0)) return [];
  const perSec = framesPerSecond(steps.fps);
  const out: RulerMark[] = [];
  if (steps.tickFrames >= perSec) {
    const tickSecs = Math.round(steps.tickFrames / perSec);
    const labelSecs = Math.max(1, Math.round(steps.labelFrames / perSec));
    for (let s = Math.floor(Math.max(0, fromMs) / 1000 / tickSecs) * tickSecs; s * 1000 <= toMs; s += tickSecs) {
      out.push({ ms: s * 1000, label: s % labelSecs === 0 });
    }
    return out;
  }
  const rate = exactRate(steps.fps);
  const labelSecs = steps.labelFrames >= perSec ? Math.max(1, Math.round(steps.labelFrames / perSec)) : 0;
  for (let s = Math.floor(Math.max(0, fromMs) / 1000); s * 1000 <= toMs; s++) {
    /* the frames that start within second s: from its first to the next second's first */
    const first = Math.ceil(s * rate - 1e-9);
    const count = Math.ceil((s + 1) * rate - 1e-9) - first;
    for (let j = 0; j < count; j += steps.tickFrames) {
      /* a second's first tick is the clock's whole second, labeled as one even where no frame starts on it */
      const ms = j === 0 ? s * 1000 : ((first + j) * 1000) / rate;
      if (ms < fromMs) continue;
      if (ms > toMs) break;
      out.push({ ms, label: labelSecs ? j === 0 && s % labelSecs === 0 : j % steps.labelFrames === 0 });
    }
  }
  return out;
}

/* ── Tracks and clips ─────────────────────────────────────────────────────── */

/** What a clip on the timeline is — the timeline's own grouping: its color and the kind of row it sits on. */
export type TimelineBlockKind = 'mg' | 'video' | 'voice' | 'sfx' | 'music' | 'caption';

export interface TimelineBlock {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  kind: TimelineBlockKind;
  /** Turned off (or on a hidden track): drawn see-through. */
  off?: boolean;
  /**
   * Where the clip is written in film.html (`film.html#track.clip`). Without it the clip can be selected but not
   * edited: there is nowhere to write a change.
   */
  loc?: string;
  /**
   * How it can be changed, and where its parent window starts. `parentStartMs` is required: `at` is relative to it,
   * and without it a clip inside a scene at 30 s would be moved to 30 s of the film.
   */
  anchor?: {
    move?: 'at'; resize?: 'end'; trimFrom?: number; still?: boolean; parentStartMs: number;
  };
  /** The file the clip plays (project-relative path); its waveform and poster are found by it. */
  src?: string;
  /** Who speaks (voice only). */
  cast?: string;
  /**
   * How far the clip can still be pulled at either end (ms of film). Absent = no source to run out of (an MG page).
   * No `tailMs` = the right edge is unlimited: an MG past its end holds its last frame.
   */
  room?: { headMs: number; tailMs?: number };
  /**
   * Where the next clip on its film.html track starts (ms of film): a clip made longer stops there, from the timeline
   * (see timeline-drag trimFence) or the inspector — clips on one track do not overlap. Absent = nothing after it.
   */
  nextMs?: number;
  /** The source's own length (ms of the source): a trim is written inside `[0, sourceDurMs]`. */
  sourceDurMs?: number;
  /**
   * The source millisecond the clip starts at (its in point). The waveform needs it: the peaks are the whole file's,
   * and the clip shows only `[inMs, inMs + length)` of it.
   */
  inMs?: number;
  /** Source ms per film ms (the clip's `speed`); absent = 1. The block covers `[inMs, inMs + length × speed)` of its source. */
  speed?: number;
  /** Gain in dB. */
  gainDb?: number;
  /** Linear volume from film.html; 1 = as is. */
  volume?: number;
  /** Music: ducks under voices. */
  duck?: boolean;
  /** Video: without its own sound. */
  silent?: boolean;
  /** A video with sound of its own: its audio band shows the sound's waveform. */
  ownAudio?: boolean;
  /** The clip's id in film.html. */
  clipId?: string;
  /** film.html's `box`: where its picture sits. */
  box?: FilmBox;
  /** The source's own size (a page's width × height, a video's frame), when known: where its picture lands. */
  size?: { w: number; h: number };
  z?: number;
  /** Word cues relative to the clip's start. Drawn on voice clips. */
  cues?: readonly { word: string; tMs: number }[];
  /** The `at` is a reference (as written): shown in the tooltip; dragging the clip turns it into a number. */
  atRef?: string;
  /** The duration is a reference (as written). */
  durRef?: string;
  /** It has no length (see TimelineClipMeta): the film cannot be drawn until it gets one. */
  noLength?: boolean;
}

export interface TimelineTrack {
  lane: string;
  /** The film.html track's kind (mg / video / audio). */
  role: FilmLaneRole;
  /** Which row of the same track (overlapping clips spread into extra rows). */
  index: number;
  /** Row title. */
  name: string | null;
  /**
   * The row's badge: `P1` / `V2` / `A1`, the Premiere / Resolve naming (pictures counted bottom up, sound top
   * down), one per drawn row (rows of one track spread by overlap each get their own, see badgeRows).
   */
  badge?: string;
  kind: TimelineLaneKind;
  /** The film.html track index. Rows spread by overlap share it. Absent = a row not on film.html (a pending drop). */
  docIndex?: number;
  muted?: boolean;
  hidden?: boolean;
  locked?: boolean;
  /**
   * film.html has clips on this track that are not drawn yet (just put back by an undo, the preview still evaluating
   * them). What is worked out from the drawn clips alone — closing a gap — would move clips onto them.
   */
  incomplete?: boolean;
  /** How tall the row is drawn, px, when the person set it (lib/track-heights); else the timeline's own for its kind. */
  height?: number;
  blocks: TimelineBlock[];
}

/** A track as the evaluated film reports it (only what the timeline draws). */
type DocTrackRef = {
  index: number; name: string; kind: string;
  hidden?: boolean; muted?: boolean; locked?: boolean;
};

/** The evaluated film, as the timeline needs it: every clip with its time, file, track and film.html location. */
export interface TimelineFilm {
  scenes: readonly {
    key: string; label: string; startMs: number; durMs: number;
    loc?: string; anchor?: TimelineBlock['anchor'];
    track?: DocTrackRef;
    meta?: TimelineClipMeta;
    clipId?: string;
    src?: string;
    /** The element's own length. With it a trim stops where the element ends. */
    sourceDurMs?: number;
    /** The element millisecond the clip starts at. */
    inMs?: number;
    box?: TimelineBlock['box'];
    size?: TimelineBlock['size'];
    z?: number;
    silent?: boolean;
    volume?: number;
  }[];
  sounds: readonly {
    key: string; kind: 'voice' | 'music' | 'sfx'; src: string; startMs: number; durMs: number;
    /** Who speaks (voice only). */
    cast?: string;
    loc?: string; anchor?: TimelineBlock['anchor'];
    /** The source's whole length: how far the clip can still be pulled. */
    sourceDurMs?: number;
    /** The source millisecond the clip starts at. */
    inMs?: number;
    speed?: number;
    rate?: number;
    gainDb?: number;
    duck?: boolean;
    off?: boolean;
    track?: DocTrackRef;
    meta?: TimelineClipMeta;
    clipId?: string;
  }[];
  videos: readonly {
    key: string;
    src: string;
    startMs: number;
    durMs: number;
    inMs?: number;
    speed?: number;
    /** The file's whole length: how far the clip can still be pulled. */
    sourceDurMs?: number;
    label?: string;
    loc?: string;
    track?: DocTrackRef;
    meta?: TimelineClipMeta;
    clipId?: string;
    box?: TimelineBlock['box'];
    size?: TimelineBlock['size'];
    z?: number;
    gainDb?: number;
    volume?: number;
    silent?: boolean;
  }[];
  captions: readonly { key: string; startMs: number; durMs: number; text: string; loc?: string }[];
  /**
   * film.html as on disk. The evaluated lists only hold clips with a length, so an empty track vanishes from them;
   * the timeline still draws it, as a place to drop onto.
   */
  doc?: unknown;
}

/** A clip on its way to a row (see layered). */
interface Block {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  kind: TimelineBlock['kind'];
  loc?: string;
  anchor?: TimelineBlock['anchor'];
  src?: string;
  cast?: string;
  room?: TimelineBlock['room'];
  sourceDurMs?: number;
  inMs?: number;
  speed?: number;
  gainDb?: number;
  volume?: number;
  duck?: boolean;
  silent?: boolean;
  ownAudio?: boolean;
  off?: boolean;
  clipId?: string;
  box?: TimelineBlock['box'];
  size?: TimelineBlock['size'];
  z?: number;
  cues?: readonly { word: string; tMs: number }[];
  atRef?: string;
  durRef?: string;
  noLength?: boolean;
}

/** The meta fields onto the block; nothing for empty ones. */
function metaFields(meta: TimelineClipMeta | undefined): Pick<Block, 'cues' | 'atRef' | 'durRef' | 'noLength'> {
  if (!meta) return {};
  return {
    ...(meta.cues?.length ? { cues: meta.cues } : {}),
    ...(meta.atRef ? { atRef: meta.atRef } : {}),
    ...(meta.durRef ? { durRef: meta.durRef } : {}),
    ...(meta.noLength ? { noLength: true } : {}),
  };
}

/**
 * A clip's tooltip, with its references as written: `03-generate@[pours] + 0.05` says why it is where it is, which a
 * number of seconds cannot — and it is the only hint that dragging the clip unties it from the narration.
 */
export function blockTitleOf(block: { title: string; atRef?: string | undefined; durRef?: string | undefined }): string {
  const notes = [
    block.atRef ? `at: ${block.atRef}` : null,
    block.durRef ? `duration: ${block.durRef}` : null,
  ].filter(Boolean);
  return notes.length ? `${block.title} · ${notes.join(' · ')}` : block.title;
}

/**
 * Clips that overlap by no more than this touch (SPEC): times are kept to the millisecond, a clip's start and its
 * length each rounded alone, so two that touch can overlap by one.
 */
const TOUCH_MS = 1;

/**
 * Lay clips into rows that do not overlap. Two clips overlapping on one row cannot be drawn honestly, so an overlap
 * opens another row. Greedy (the first row it fits), so the rows stay stable: drawing the same film again must not
 * move the clip just clicked.
 */
function layered(blocks: Block[]): Block[][] {
  const rows: Block[][] = [];
  for (const block of [...blocks].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)) {
    const row = rows.find((r) => (r.at(-1)?.endMs ?? 0) <= block.startMs + TOUCH_MS);
    if (row) row.push(block); else rows.push([block]);
  }
  return rows;
}

/**
 * Each clip where film.html puts it now.
 *
 * The evaluated spans can be an edit behind film.html: an edit (or an undo) applies to film.html at once, the preview
 * evaluates it a moment later. Drawn from the old spans, a ripple delete just undone still shows its closed gap — and
 * the next edit, worked out from those clips, writes the wrong times (two clips overlapping on one track). So where
 * film.html says a clip's timing plainly (a numeric `at`, a length by its `#t=`, read by the format's own clipSpan),
 * that wins; when both agree, nothing changes.
 */
function withDocTimes(film: TimelineFilm): TimelineFilm {
  const clips = new Map<string, Record<string, unknown> & { src: string }>();
  for (const track of docTracksOf(film.doc)) {
    for (const c of Array.isArray(track.clips) ? track.clips : []) {
      const clip = c as Record<string, unknown>;
      if (typeof clip?.id === 'string' && typeof clip.src === 'string' && !clips.has(clip.id)) {
        clips.set(clip.id, clip as Record<string, unknown> & { src: string });
      }
    }
  }
  if (!clips.size) return film;
  const fix = <T extends {
    clipId?: string; startMs: number; durMs: number; sourceDurMs?: number;
  }>(entry: T): T => {
    const clip = entry.clipId ? clips.get(entry.clipId) : undefined;
    if (!clip) return entry;
    const at = clip.at == null ? 0 : typeof clip.at === 'number' ? clip.at : null;
    let length: number | null = null;
    try {
      length = clipSpan(clip as Parameters<typeof clipSpan>[0], entry.sourceDurMs != null ? entry.sourceDurMs / 1000 : undefined).length;
    } catch { /* film.html alone cannot say (or says something impossible): the preview's length stands */ }
    const startMs = at != null && Math.abs(at * 1000 - entry.startMs) >= 1 ? Math.round(at * 1000) : entry.startMs;
    /* the end rounded as one (start and length rounded apart can end a millisecond late: into the next clip) */
    const durMs = length != null && Number.isFinite(length) && length > 0 && Math.abs(length * 1000 - entry.durMs) >= 1
      ? (at != null ? Math.round((at + length) * 1000) - startMs : Math.round(length * 1000)) : entry.durMs;
    if (startMs === entry.startMs && durMs === entry.durMs) return entry;
    return { ...entry, startMs, durMs };
  };
  return {
    ...film,
    scenes: film.scenes.map(fix),
    videos: film.videos.map(fix),
    sounds: film.sounds.map(fix),
  };
}

function docTracksOf(doc: unknown): readonly Record<string, unknown>[] {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [];
  const tracks = (doc as { tracks?: unknown }).tracks;
  if (!Array.isArray(tracks)) return [];
  return tracks.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}

/** A film.html track's kind: written on older films, otherwise worked out from its clips (see filmTrackKind). */
function docTrackKind(track: Record<string, unknown>): string {
  if (typeof track.kind === 'string') return track.kind;
  const clips = Array.isArray(track.clips) ? track.clips : [];
  return filmTrackKind({
    clips: clips.filter((c): c is { src: string } => !!c && typeof (c as { src?: unknown }).src === 'string'),
  });
}

/**
 * Row badges, Premiere / Resolve style: P1, P2… for page tracks, V1… for picture tracks, A1… for sound tracks, counted
 * from position and kind, never read from the film (filmTrackBadges).
 *
 * Counted per drawn row, not per film.html track: a track spread into four rows by overlap is A2, A3, A4, A5 and the
 * music under it is A6. Four rows all called A2 could not be pointed at.
 */
function badgeRows<T extends { role: string }>(rows: readonly T[]): (T & { badge: string })[] {
  const badges = filmTrackBadges(rows.map((row) => ({ kind: row.role })));
  return rows.map((row, i) => ({ ...row, badge: badges[i]! }));
}

/**
 * A badge for rows not on film.html yet — the see-through row of a drop in flight (see withPendingBlocks), which
 * layoutTracks cannot count. Rows with a badge keep it; a new row takes the lowest free number of its prefix. It is
 * a placeholder: when the drop is written, the whole column is renumbered.
 */
export function renumberTracks<T extends { role: string; badge?: string }>(
  rows: readonly T[],
): T[] {
  const taken = new Set(rows.map((row) => row.badge).filter((b): b is string => !!b));
  return rows.map((row) => {
    if (row.badge) return row;
    const prefix = filmTrackPrefix(row.role);
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n += 1;
    const badge = `${prefix}${n}`;
    taken.add(badge);
    return { ...row, badge };
  });
}

/**
 * How far a clip can still be pulled at either end; unlimited without a source length.
 *
 * The left edge moves the in point and keeps `end` (see timeline-drag editsForMoves), so it reaches back to the start
 * of the source; the right edge moves `end`, so it reaches the end of the source. Limiting the left edge by what is
 * left after the clip too locked it in place once the clip ran to the end of its file: a video shortened from the left
 * could not be pulled back.
 */
function trimRoom(
  durMs: number,
  sourceDurMs?: number,
  inMs?: number,
  speed = 1,
): Pick<Block, 'room' | 'sourceDurMs'> {
  if (sourceDurMs == null) return {};
  const inPoint = Math.max(0, inMs ?? 0);
  /* the source's slack, in film ms: a sped-up clip reaches the end of its file sooner */
  const k = speed > 0 ? speed : 1;
  const spare = Math.max(0, sourceDurMs - inPoint - durMs * k);
  return {
    room: {
      headMs: inPoint / k,
      tailMs: spare / k,
    },
    sourceDurMs,
  };
}

function speedOf(speed: number | undefined): Pick<Block, 'speed'> {
  return speed != null && speed > 0 && speed !== 1 ? { speed } : {};
}

function soundBlockOf(s: TimelineFilm['sounds'][number]): Block {
  return {
    id: s.key,
    title: nameOf(s.src) || s.clipId || '',
    startMs: s.startMs,
    endMs: s.startMs + s.durMs,
    kind: s.kind,
    src: s.src,
    ...(s.cast ? { cast: s.cast } : {}),
    ...(s.loc ? { loc: s.loc } : {}),
    ...(s.anchor ? { anchor: s.anchor } : {}),
    ...(s.inMs ? { inMs: s.inMs } : {}),
    ...(s.clipId ? { clipId: s.clipId } : {}),
    ...(s.off ? { off: true } : {}),
    ...speedOf(s.speed ?? s.rate),
    ...audioExtras(s),
    ...trimRoom(s.durMs, s.sourceDurMs, s.inMs, s.speed ?? s.rate),
    ...metaFields(s.meta),
  };
}

function audioExtras(s: {
  gainDb?: number;
  volume?: number;
  duck?: boolean;
  silent?: boolean;
}): Pick<Block, 'gainDb' | 'volume' | 'duck' | 'silent'> {
  return {
    ...(s.gainDb != null ? { gainDb: s.gainDb } : {}),
    ...(s.volume != null ? { volume: s.volume } : {}),
    ...(s.duck != null ? { duck: s.duck } : {}),
    ...(s.silent ? { silent: true } : {}),
  };
}

function visualExtras(v: {
  clipId?: string;
  src?: string;
  box?: TimelineBlock['box'];
  size?: TimelineBlock['size'];
  z?: number;
}): Pick<Block, 'clipId' | 'src' | 'box' | 'size' | 'z'> {
  return {
    ...(v.clipId ? { clipId: v.clipId } : {}),
    ...(v.src ? { src: v.src } : {}),
    ...(v.box ? { box: v.box } : {}),
    ...(v.size ? { size: v.size } : {}),
    ...(v.z != null ? { z: v.z } : {}),
  };
}

function videoBlockOf(
  v: TimelineFilm['videos'][number],
  anchor?: TimelineBlock['anchor'],
  ownAudio?: boolean,
): Block {
  return {
    id: v.key,
    title: nameOf(v.src) || v.clipId || '',
    startMs: v.startMs,
    endMs: v.startMs + v.durMs,
    kind: 'video',
    src: v.src,
    inMs: v.inMs,
    ...(v.loc ? { loc: v.loc } : {}),
    ...(anchor ? { anchor } : {}),
    ...(ownAudio ? { ownAudio: true } : {}),
    ...speedOf(v.speed),
    ...trimRoom(v.durMs, v.sourceDurMs, v.inMs, v.speed),
    ...audioExtras(v),
    ...visualExtras(v),
    ...metaFields(v.meta),
  };
}

/**
 * The rows a film shows on the timeline: one per film.html track, in film.html order, a track spread into extra rows
 * where its clips overlap (see layered) — no overlap within a row is what makes a timeline readable.
 *
 * A video clip is reported twice, as a window (scene) and as footage (video), with the same loc: the timeline draws
 * the video one (it has the in point and the waveform) and skips the window.
 *
 * A block's id is the evaluated key (`label@startMs`); it changes when the clip moves, so it serves for selection,
 * not as a lasting reference.
 */
export function layoutTracks(evaluated: TimelineFilm): TimelineTrack[] {
  const film = withDocTimes(evaluated);
  const tracks: TimelineTrack[] = [];
  interface DocRow {
    name: string; kind: string; blocks: Block[];
    hidden?: boolean; muted?: boolean; locked?: boolean;
  }
  const byIndex = new Map<number, DocRow>();
  const take = (t: DocTrackRef): DocRow => {
    let row = byIndex.get(t.index);
    if (!row) {
      row = { name: t.name, kind: t.kind, blocks: [] };
      byIndex.set(t.index, row);
    }
    if (t.hidden) row.hidden = true;
    if (t.muted) row.muted = true;
    if (t.locked) row.locked = true;
    return row;
  };
  /* the clip ids seen on each evaluated track, to pin the row back to film.html's current index (see below) */
  const claimed = new Map<number, string[]>();
  const claim = (index: number, clipId: string | undefined): void => {
    if (!clipId) return;
    const list = claimed.get(index) ?? [];
    list.push(clipId);
    claimed.set(index, list);
  };

  const sceneAnchor = new Map<string, TimelineBlock['anchor']>();
  /* a video's own size is on its scene (one is registered for every picture clip) */
  const sceneSize = new Map<string, NonNullable<TimelineBlock['size']>>();
  for (const s of film.scenes) {
    if (s.loc && s.anchor) sceneAnchor.set(s.loc, s.anchor);
    if (s.loc && s.size) sceneSize.set(s.loc, s.size);
  }

  /* a video playing inside a page carries the page's location and clip id: it belongs to the page's block; only a
     video placed on a track replaces its scene's window */
  const mainVideos = film.videos.filter(video => !film.scenes.some(scene => {
    if (!scene.src || scene.src === video.src) return false;
    if (scene.clipId && video.clipId) return scene.clipId === video.clipId;
    return Boolean(scene.loc && scene.loc === video.loc);
  }));

  /* matched by loc, not by track kind: MG and footage can be neighbors on one picture track */
  const videoLocs = new Set<string>();
  for (const v of mainVideos) {
    if (v.track && v.loc) videoLocs.add(v.loc);
  }

  for (const s of film.scenes) {
    if (!s.track || s.durMs <= 0 || (s.loc != null && videoLocs.has(s.loc))) continue;
    claim(s.track.index, s.clipId);
    take(s.track).blocks.push({
      id: s.key,
      /* a clip is called by its file, as in any editor (its id is film.html's, shown in the inspector); a page's
         file name drops the extension: `.html` says what it is written in, not what the clip is */
      title: fileStem(s.src ?? '') || s.clipId || fileStem(s.label),
      startMs: s.startMs,
      endMs: s.startMs + s.durMs,
      kind: 'mg',
      ...(s.loc ? { loc: s.loc } : {}),
      ...(s.anchor ? { anchor: s.anchor } : {}),
      /* an MG's right edge is unlimited (past its end it holds the last frame); its left edge stops at its start,
         with or without a duration of its own (without the limit a left edge past 0 only slid the page along) */
      room: { headMs: Math.max(0, s.inMs ?? 0) },
      ...visualExtras(s),
      ...metaFields(s.meta),
    });
  }

  /* A video's own sound is also reported as a sound. It is not a clip of its own: drawn, it would overlap the video
     exactly, the track would spread into two rows with the same badge. It is skipped and the video marked "has sound"
     (its audio band draws the waveform).

     Matching by loc alone is not enough: right after a drop the film is evaluated before every clip carries its loc,
     and an unmatched sound would show as an extra audio track for a second. So a sound with no place in film.html, on
     the same file over exactly the same span as a video, is that video's sound. */
  const videoSpans = new Map<string, { startMs: number; durMs: number }[]>();
  for (const v of mainVideos) {
    if (!v.track || v.durMs <= 0) continue;
    const list = videoSpans.get(v.src) ?? [];
    list.push({ startMs: v.startMs, durMs: v.durMs });
    videoSpans.set(v.src, list);
  }
  /* a video's own sound stays with its clip */
  const ownAudioOf = (s: TimelineFilm['sounds'][number]): boolean => {
    if (s.loc && videoLocs.has(s.loc)) return true;
    /* a sound that is a clip of film.html is one of its own, even of a video's file at the video's very seconds (its
       sound taken apart from the picture) */
    if (s.loc) return false;
    return (videoSpans.get(s.src) ?? []).some(
      (span) => Math.abs(span.startMs - s.startMs) <= 2 && Math.abs(span.durMs - s.durMs) <= 2,
    );
  };
  const videoHasOwnAudio = new Set<string>();
  for (const s of film.sounds) {
    if (ownAudioOf(s)) videoHasOwnAudio.add(`${s.src}@${Math.round(s.startMs)}`);
  }

  for (const v of mainVideos) {
    if (!v.track || v.durMs <= 0) continue;
    claim(v.track.index, v.clipId);
    const size = v.loc ? sceneSize.get(v.loc) : undefined;
    take(v.track).blocks.push(videoBlockOf(
      size ? { ...v, size } : v,
      v.loc ? sceneAnchor.get(v.loc) : undefined,
      videoHasOwnAudio.has(`${v.src}@${Math.round(v.startMs)}`),
    ));
  }

  for (const s of film.sounds) {
    if (!s.track || !Number.isFinite(s.durMs) || s.durMs <= 0) continue;
    if (ownAudioOf(s)) continue;
    claim(s.track.index, s.clipId);
    take(s.track).blocks.push(soundBlockOf(s));
  }

  /*
   * film.html and the evaluated lists can be two versions apart: an edit applies to film.html at once (inserting a
   * track shifts every index after it) while the evaluation catches up later. Read by the old indexes, every row would
   * wear the name of the track above it, and the empty-track pass below would add one more row.
   *
   * Clips know which film.html clip they are (the id is stable), so each row is pinned to film.html's current index by
   * them. Rows without a known clip keep their index; when both sides agree this changes nothing.
   */
  const docIndexOfClip = new Map<string, number>();
  docTracksOf(film.doc).forEach((t, i) => {
    const clips = Array.isArray(t.clips) ? t.clips : [];
    for (const c of clips) {
      const id = c && typeof c === 'object' ? (c as { id?: unknown }).id : null;
      if (typeof id === 'string' && id && !docIndexOfClip.has(id)) docIndexOfClip.set(id, i);
    }
  });
  if (docIndexOfClip.size) {
    const moved = [...byIndex.entries()].map(([index, row]) => {
      const real = (claimed.get(index) ?? [])
        .map((id) => docIndexOfClip.get(id))
        .find((i) => i != null);
      return [real ?? index, row] as const;
    });
    byIndex.clear();
    for (const [index, row] of moved) {
      const there = byIndex.get(index);
      if (!there) {
        byIndex.set(index, row);
        continue;
      }
      /* two rows pinned to one track (a clip just moved here, the old row still reported): one row, no clip lost */
      there.blocks.push(...row.blocks);
      if (row.hidden) there.hidden = true;
      if (row.muted) there.muted = true;
      if (row.locked) there.locked = true;
    }
  }

  /* tracks with no evaluated clip (clips: []) are still on film.html, and drawn so things can be dragged onto them;
     a track just opened by a drop comes in here too, so the drop's placeholder joins it (see withPendingBlocks) */
  for (const [index, t] of docTracksOf(film.doc).entries()) {
    if (byIndex.has(index)) continue;
    const kind = docTrackKind(t);
    byIndex.set(index, {
      name: kind,
      kind,
      blocks: [],
      ...(t.hidden ? { hidden: true } : {}),
      ...(t.muted ? { muted: true } : {}),
      ...(t.locked ? { locked: true } : {}),
    });
  }

  const add = (
    lane: string,
    role: FilmLaneRole,
    kind: TimelineLaneKind,
    blocks: Block[],
    name?: string | null,
    docIndex?: number,
    flags?: { hidden?: boolean; muted?: boolean; locked?: boolean; incomplete?: boolean },
  ): void => {
    const hidden = Boolean(flags?.hidden);
    const muted = Boolean(flags?.muted);
    const locked = Boolean(flags?.locked);
    const painted = (hidden ? blocks.map((b) => ({ ...b, off: true as const })) : blocks).map((b) => {
      const nextMs = trimFence(b, blocks.filter((o) => o.id !== b.id)).endMs;
      return nextMs != null ? { ...b, nextMs } : b;
    });
    const layers = layered(painted);
    /* an empty track still takes a row: rows split on overlap, no clips is not no track */
    if (!layers.length) layers.push([]);
    for (const [i, row] of layers.entries()) {
      tracks.push({
        lane: i ? `${lane}#${i + 1}` : lane,
        role,
        index: i + 1,
        name: name == null || name === '' ? null : (i ? `${name} ${i + 1}` : name),
        kind,
        ...(docIndex != null ? { docIndex } : {}),
        muted,
        hidden,
        locked,
        ...(flags?.incomplete ? { incomplete: true } : {}),
        blocks: row,
      });
    }
  };

  const rows = [...byIndex.entries()].sort((a, b) => a[0] - b[0]);
  /* nothing at all: no rows, so the timeline shows its "drag assets here" state instead of dead rows (with length 0
     every gesture is off). Partly empty tracks are drawn: they are where things get dropped. */
  if (rows.every(([, row]) => row.blocks.length === 0)) return [];
  const docTracks = docTracksOf(film.doc);
  for (const [index, row] of rows) {
    const drawn = new Set(row.blocks.map((b) => b.clipId));
    const docClips = docTracks[index]?.clips;
    const incomplete = Array.isArray(docClips) && docClips.some((c) => {
      const id = (c as { id?: unknown } | null)?.id;
      return typeof id === 'string' && !drawn.has(id);
    });
    const role: FilmLaneRole = row.kind === 'mg' || row.kind === 'video' ? row.kind : 'audio';
    add(
      `doc-${index}`,
      role,
      role === 'audio' ? 'audio' : 'visual',
      row.blocks,
      row.name || row.kind,
      index,
      {
        hidden: row.hidden,
        muted: row.muted,
        locked: row.locked,
        incomplete,
      },
    );
  }

  /* badges last, per drawn row top to bottom (see badgeRows) */
  return badgeRows(tracks);
}

/**
 * The name shown on a clip without an id (a row not on film.html): the file name with its extension
 * (`assets/videos/opening.mp4` → `opening.mp4`). A clip on film.html is shown by its id, which names it in the film.
 */
function nameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

