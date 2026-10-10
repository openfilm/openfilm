/**
 * Delivery frame: fitting a film into a box of another aspect ratio.
 *
 * The film stays as it is; the frame goes around it. A 16:9 film delivered vertically gets a 9:16 box with the film
 * centered and black bars above and below — not a 1080×1920 stage, which would break every px coordinate the film was
 * laid out with. Re-laying a film out is its author's job, not a button's.
 *
 * Two ways to fit it: `contain` (default) scales and centers with bars and never crops; `cover` fills the box and
 * crops the overflow, so the edges are really gone — a choice, never the default.
 *
 * The frame is a delivery preference, not part of the film: it is kept per project in this browser's localStorage
 * (unlike the subtitle style, which lives in the project folder's `.film/subtitles.json`) and sent along with an
 * export.
 */

/** A delivery frame. `native` = no frame, the film at its own size. */
export type FilmFrameId = 'native' | '16:9' | '9:16' | '1:1' | '4:5' | '4:3' | '21:9';

export const FILM_FRAME_IDS: FilmFrameId[] = [
  'native', '16:9', '9:16', '1:1', '4:5', '4:3', '21:9',
];

/** Width ÷ height of each frame. `native` has none: it follows the film. */
const FRAME_RATIO: Record<Exclude<FilmFrameId, 'native'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
};

export function filmFrameRatio(frame: FilmFrameId, stage: { w: number; h: number }): number {
  return frame === 'native' ? stage.w / Math.max(1, stage.h) : FRAME_RATIO[frame];
}

/** Even sizes: H.264 samples chroma in 2×2 blocks and refuses odd dimensions. */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

export type FilmFrameFill = 'contain' | 'cover';

export interface FilmFrameBox {
  /** The frame's pixel size (an export comes out this size). */
  w: number;
  h: number;
  /** The film inside the frame, scaled. With `cover`, `left`/`top` go negative: the overflow is cut by the frame. */
  inner: { w: number; h: number; left: number; top: number; scale: number };
}

/**
 * Fit `stage` into `frame`: the frame's size and the film's place in it. The frame's long side follows the film's
 * (a 4K film framed 9:16 stays 4K-sharp; a 720p film is not blown up), so the frame only decides the shape.
 */
export function filmFrameBox(
  stage: { w: number; h: number },
  frame: FilmFrameId,
  fill: FilmFrameFill = 'contain',
): FilmFrameBox {
  const sw = Math.max(1, stage.w);
  const sh = Math.max(1, stage.h);
  if (frame === 'native') {
    return { w: even(sw), h: even(sh), inner: { w: sw, h: sh, left: 0, top: 0, scale: 1 } };
  }
  const ratio = FRAME_RATIO[frame];
  /* the frame must hold the film both ways: take the larger */
  const byWidth = { w: sw, h: sw / ratio };
  const byHeight = { w: sh * ratio, h: sh };
  const box = byWidth.h >= sh ? byWidth : byHeight;
  const w = even(box.w);
  const h = even(box.h);
  const scale = fill === 'cover'
    ? Math.max(w / sw, h / sh)
    : Math.min(w / sw, h / sh);
  const iw = sw * scale;
  const ih = sh * scale;
  return {
    w,
    h,
    inner: { w: iw, h: ih, left: (w - iw) / 2, top: (h - ih) / 2, scale },
  };
}

/** Whether the frame has the film's own shape (then framing it changes nothing). */
export function filmFrameIsNative(stage: { w: number; h: number }, frame: FilmFrameId): boolean {
  if (frame === 'native') return true;
  return Math.abs(stage.w / Math.max(1, stage.h) - FRAME_RATIO[frame]) < 0.01;
}

/**
 * The stage itself in another shape (canvas mode: nothing has been laid out yet, so changing the stage breaks
 * nothing). 1080p family: the short side is pinned at 1080 (16:9 = 1920×1080, 21:9 = 2520×1080, 9:16 = 1080×1920).
 */
const HD = 1080;

export function filmFrameStage(
  stage: { w: number; h: number },
  frame: FilmFrameId,
): { w: number; h: number } {
  if (frame === 'native') return { w: even(stage.w), h: even(stage.h) };
  const ratio = FRAME_RATIO[frame];
  return ratio >= 1
    ? { w: even(HD * ratio), h: even(HD) }
    : { w: even(HD), h: even(HD / ratio) };
}

/** Which frame this stage's shape is (`native` when none). Canvas mode ticks this one. */
export function filmFrameOf(stage: { w: number; h: number }): FilmFrameId {
  return FILM_FRAME_IDS.find((id) => id !== 'native' && filmFrameIsNative(stage, id)) ?? 'native';
}

export function parseFilmFrame(raw: unknown): FilmFrameId {
  return typeof raw === 'string' && (FILM_FRAME_IDS as string[]).includes(raw)
    ? raw as FilmFrameId
    : 'native';
}

/**
 * Where the delivery frame is kept: per project ("this one goes vertical" is true of one film, not of every film the
 * person opens), and only in this browser — changing it should not make a version.
 */
const FRAME_KEY = 'openfilm.frame';

export function readFilmFrame(projectId: string): FilmFrameId {
  try {
    return parseFilmFrame(localStorage.getItem(`${FRAME_KEY}.${projectId}`));
  } catch {
    return 'native';
  }
}

export function writeFilmFrame(projectId: string, frame: FilmFrameId): void {
  try {
    localStorage.setItem(`${FRAME_KEY}.${projectId}`, frame);
  } catch { /* storage off (private window): the choice lasts this session only */ }
}
