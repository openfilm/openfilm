/**
 * A film's canvas changing shape: the canvas takes the new shape with its short side kept (a
 * 1920×1080 film made 3:4 is 1080×1440), and each picture is fitted to it on its own. A picture's place is read as
 * two shares: its size as a share of the size that fits it whole in the canvas (1: it meets the canvas's edges
 * one way), and its center as a share of the canvas from the canvas's center. Both are kept, so a full-frame video
 * stays full-frame in any shape, a portrait photo on another clip fits by its own height, a title halfway up stays
 * halfway up, and shapes picked one after another never shrink anything.
 *
 * A video or still without a box is the canvas (its picture fitted inside by CSS). Fitted whole (`contain`), it is
 * given a box of its picture's shape once the canvas is another, as it would be if dropped on that canvas: else its
 * box would be the whole canvas, bars and all, and what is done in % of the box (faded edges, a crop, a mask, round
 * corners) would land on the bars. Filling the canvas (`cover`, `fill`), it is left without one. A page is written its
 * box. A page that sets no size of its own is laid out at the canvas's: it is given the old canvas as its `size`, so
 * it is scaled as a video is rather than laid out again in the new shape.
 */
import { pictureRect } from '../../../../src/film-doc.mjs';
import { customFilmFrame, frameRatioOf, type FilmFrameId } from './film-frame.ts';
import { filmSrcKind, type FilmBox, type FilmSrcKind } from './film.ts';

type Size = { w: number; h: number };

/** Even sizes: H.264 samples chroma in 2×2 blocks and refuses odd dimensions. At most 8192 a side. */
const even = (n: number) => Math.max(2, Math.min(8192, Math.round(n / 2) * 2));

/** A canvas's sides, in px, and how far from square it may be (as a ratio typed for an export: 1:4 to 4:1). */
export const CANVAS_SIDE = { min: 16, max: 8192 } as const;
const CANVAS_STRETCH = 4;

/**
 * A canvas `side` (its width or height) of `n` px, the other side kept: whole even px within CANVAS_SIDE, and no more
 * than 4 times the other side or less than a quarter of it.
 */
export function canvasSide(n: number, other: number): number {
  const lo = Math.max(CANVAS_SIDE.min, other / CANVAS_STRETCH);
  const hi = Math.min(CANVAS_SIDE.max, other * CANVAS_STRETCH);
  return Math.min(Math.floor(hi / 2) * 2, Math.max(Math.ceil(lo / 2) * 2, Math.round(n / 2) * 2));
}

/** The canvas in another shape, its short side kept (a typed size is taken as it is elsewhere). */
export function canvasFor(stage: Size, frame: FilmFrameId): Size {
  const ratio = frame === 'native' ? null : frameRatioOf(frame);
  if (ratio == null) return { w: even(stage.w), h: even(stage.h) };
  const short = Math.min(stage.w, stage.h);
  return ratio >= 1 ? { w: even(short * ratio), h: even(short) } : { w: even(short), h: even(short / ratio) };
}

/**
 * A picture clip as the fit needs it: its kind, its picture's own size (unknown: the old canvas), its box if any, for
 * a page, whether it sets no size of its own (`reflows`) and the `size` its clip gives it, and for a video or still,
 * its `object-fit` and `object-position` as the film's CSS makes them.
 */
export interface CanvasClip {
  id: string; kind: FilmSrcKind | null; own?: Size | null; box?: FilmBox | null; reflows?: boolean; size?: Size | null;
  fit?: string | null; position?: readonly [number, number] | null;
}

/** A clip on the new canvas: its box, and for a page laid out at the old canvas, that size. */
export interface CanvasFit { id: string; box: FilmBox; size?: Size }

/** The size of a picture shaped `ratio` (width / height) that fits whole in `canvas`, meeting its edges one way. */
const fitted = (ratio: number, canvas: Size): Size => (
  canvas.w / canvas.h > ratio ? { w: canvas.h * ratio, h: canvas.h } : { w: canvas.w, h: canvas.w / ratio }
);

/** Where `contain` puts a picture `own` in size on the whole `canvas`, `position` its `object-position` in %. */
const contained = (own: Size, canvas: Size, [px, py]: readonly [number, number] = [50, 50]) => {
  const { w, h } = fitted(own.w / own.h, canvas);
  return { x: ((canvas.w - w) * px) / 100, y: ((canvas.h - h) * py) / 100, w, h, r: 0 };
};

/**
 * Each picture clip's box on the new canvas `to` (the old one is `from`), each clip fitted on its own: the same
 * share of its fitted size, its center the same share of the canvas from the canvas's center. Sounds are left out,
 * and so are videos and stills without a box that fill the canvas whatever its shape (cover, fill) or whose picture
 * is the new canvas's shape: they stay the canvas.
 */
export function fitToCanvas(clips: readonly CanvasClip[], from: Size, to: Size): CanvasFit[] {
  const out: CanvasFit[] = [];
  for (const clip of clips) {
    if (!clip.kind || clip.kind === 'sound') continue;
    /* a video or still that is the canvas: its picture where contain puts it, if its own size is known */
    const free = clip.kind !== 'page' && !clip.box;
    if (free && (!(clip.own && clip.own.w > 0 && clip.own.h > 0) || (clip.fit ?? 'contain') !== 'contain')) continue;
    const own = clip.own && clip.own.w > 0 && clip.own.h > 0 ? clip.own : from;
    const at = free ? contained(own, from, clip.position ?? undefined) : pictureRect(clip.kind, own, from, clip.box ?? undefined);
    if (!(at.w > 0 && at.h > 0)) continue;
    /* the box's shape; its picture's own when they differ only by rounding (a box written in whole px), so shapes
       picked one after another do not drift */
    const ownRatio = own.w / own.h;
    const ratio = Math.abs(at.w / at.h / ownRatio - 1) < 0.01 ? ownRatio : at.w / at.h;
    const share = at.w / fitted(ratio, from).w;
    const fit = fitted(ratio, to);
    const w = fit.w * share, h = fit.h * share;
    const cx = to.w / 2 + ((at.x + at.w / 2 - from.w / 2) / from.w) * to.w;
    const cy = to.h / 2 + ((at.y + at.h / 2 - from.h / 2) / from.h) * to.h;
    /* whole px; an edge within 2 px of the canvas's meets it, so rounding never leaves a hairline of black */
    const near = (v: number, edge: number) => (Math.abs(v - edge) <= 2 ? edge : Math.round(v));
    const left = near(cx - w / 2, 0), top = near(cy - h / 2, 0);
    const box: FilmBox = { x: left, y: top, w: near(cx + w / 2, to.w) - left, h: near(cy + h / 2, to.h) - top };
    if (free && box.x === 0 && box.y === 0 && box.w === to.w && box.h === to.h) continue;
    if (at.r) box.r = at.r;
    out.push(clip.kind === 'page' && clip.reflows && !clip.size ? { id: clip.id, box, size: { w: from.w, h: from.h } } : { id: clip.id, box });
  }
  return out;
}

/** Whether the stage has this ratio: its width within 2 px of it (a size made from a ratio is rounded to even px). */
export const shaped = (stage: Size, ratio: number) => Math.abs(stage.w - stage.h * ratio) <= 2;

/**
 * The film's first picture's own size, which "Original" fits the canvas to: the earliest clip on the film with a
 * picture whose size the preview knows (`spans`). A page that sets no size of its own is passed over: it is laid out at
 * the canvas's size, so it has no shape of its own, and a film of such pages would always read as "Original".
 */
export function firstPictureSize(
  clips: readonly { id: string; src: string; at?: number | null; sound?: unknown }[],
  spans: readonly { id: string; w?: number; h?: number; reflows?: true }[],
): Size | null {
  const sized = new Map(spans.filter((span) => span.w && span.h && !span.reflows).map((span) => [span.id, { w: span.w!, h: span.h! }]));
  const first = clips
    .filter((clip) => !clip.sound && filmSrcKind(clip.src) !== 'sound' && sized.has(clip.id))
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
  return first ? sized.get(first.id) ?? null : null;
}

/**
 * The canvas's "Original" shape: the first picture's own (`original`), when there is one and it is between 1:4 and
 * 4:1; and whether the stage has it now.
 */
export function originalShape(stage: Size, original: Size | null): { frame: FilmFrameId | null; current: boolean } {
  const frame = original ? customFilmFrame(original.w, original.h) : null;
  return { frame, current: Boolean(frame && original && shaped(stage, original.w / original.h)) };
}
