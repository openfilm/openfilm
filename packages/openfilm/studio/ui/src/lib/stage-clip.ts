/**
 * A picture clip's box between film.html (`{ x, y, w, h, r }`, its style's left, top, width, height, rotate) and the
 * stage's five numbers (see mg-transform). The stage holds the clip as it is drawn (film-doc's pictureRect): its top
 * left, and its size over its picture's own size. A page is never stretched; a video or still is its box, whose
 * proportions may be its own (the film's CSS fits the picture in it, or crops it to it): what Studio writes is the
 * width, and the height only when it does not follow from the picture.
 */
import { pictureRect } from '../../../../src/film-doc.mjs';
import type { FilmBox, FilmSrcKind } from '@/lib/film';
import type { MgBox, MgTransform } from '@/lib/stage-types';

/**
 * The stage's numbers for a clip of kind `kind` whose picture is `own` px, placed by `box`; without one, where it is
 * drawn by default (a video the stage, a page its own size, centered). A page in a box of other proportions than its
 * own is held by the page drawn inside it, so a move or a resize keeps it where it shows.
 */
export function transformOf(kind: FilmSrcKind | null, own: MgBox, stage: { w: number; h: number }, box?: FilmBox | null): MgTransform {
  const at = pictureRect(kind, own, stage, box);
  return { x: at.x, y: at.y, scaleX: at.w / own.w, scaleY: at.h / own.h, rotate: box?.r ?? 0 };
}

const round = (n: number, digits: number) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/**
 * Back to film.html's box for a picture of `own` px: its width only when it is not the picture's own, and its height
 * only when it does not follow from the width (a box of its own proportions). In whole pixels (a tenth of a pixel
 * shows nowhere, and `width: 1436.7px` reads as noise in the file); the turn to a tenth of a degree.
 */
export function compactBox(d: MgTransform, own: MgBox): FilmBox {
  const w = round(own.w * d.scaleX, 0);
  const h = round(own.h * d.scaleY, 0);
  const r = round(d.rotate, 1);
  const out: FilmBox = { x: round(d.x, 0), y: round(d.y, 0) };
  const shaped = Math.abs(h - round((own.h * w) / own.w, 0)) >= 1;
  if (w !== own.w || shaped) out.w = w;
  if (shaped) out.h = h;
  if (r !== 0) out.r = r;
  return out;
}

/** A clip's X / Y / W / H on the stage (its unturned box, as Figma shows them) for transform `t` in `box`. */
export function clipFields(t: MgTransform, box: MgBox): { x: number; y: number; w: number; h: number } {
  return { x: (box.x ?? 0) + t.x, y: (box.y ?? 0) + t.y, w: box.w * t.scaleX, h: box.h * t.scaleY };
}

/**
 * A typed X / Y / W / H back to the transform's own numbers, worked out from the written transform `t` and the box
 * alone. Never from where the clip is drawn now: while a number is typed the picture already shows it, and counting
 * from there would add the change twice. W and H keep the picture's proportions: typing one sets the other.
 */
export function clipFieldPart(field: 'x' | 'y' | 'w' | 'h', n: number, box: MgBox): Partial<MgTransform> {
  if (field === 'x') return { x: round(n - (box.x ?? 0), 0) };
  if (field === 'y') return { y: round(n - (box.y ?? 0), 0) };
  /* not rounded: what is written is px (see compactBox), and a rounded factor would land off the typed number */
  const k = field === 'w' ? n / (box.w || 1) : n / (box.h || 1);
  return { scaleX: k, scaleY: k };
}
