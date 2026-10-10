/**
 * Subtitles in the editor: the style table and CSS are in studio/server/film-subtitle.mjs (shared with the export,
 * which burns subtitles in the same way); this adds what only the editor needs: the preview's font size, the snap
 * lines for dragging, the color controls' split, the look the person used last, and the server calls.
 *
 * Kept free of React and of `@/` imports so the editor's tests can import it as it is.
 */
import {
  FILM_SUBTITLE_DEFAULT,
  FILM_SUBTITLE_HOME_Y,
  FILM_SUBTITLE_LOOKS,
  FILM_SUBTITLE_LOOK_IDS,
  FILM_SUBTITLE_PORTRAIT_Y,
  FILM_SUBTITLE_SIZE_PCT,
  FILM_SUBTITLE_SIZE_PCT_MAX,
  FILM_SUBTITLE_SIZE_PCT_MIN,
  filmSubtitleAt,
  filmSubtitleCss,
  filmSubtitleText,
  matchFilmSubtitleLook,
  parseFilmSubtitleStyle,
} from '../../../server/film-subtitle.mjs';
import type {
  FilmSubtitleCss,
  FilmSubtitleCue,
  FilmSubtitleLookId,
  FilmSubtitleSize,
  FilmSubtitleStyle,
} from '../../../server/film-subtitle.mjs';
import type { SourceCue } from './subtitle-cues.ts';

export {
  FILM_SUBTITLE_KARAOKE_DEFAULT,
  FILM_SUBTITLE_LANGUAGES,
  filmSubtitleShown,
  filmSubtitleStyleFor,
  filmSubtitleWordCss,
  filmSubtitleWords,
  sameFilmSubtitleLanguage,
} from '../../../server/film-subtitle.mjs';

export type SubtitleCue = FilmSubtitleCue;
export type SubtitleStyle = FilmSubtitleStyle;
export type SubtitleLookId = FilmSubtitleLookId;
export type SubtitleSizeId = FilmSubtitleSize;

export const SUBTITLE_LOOKS = FILM_SUBTITLE_LOOKS;
export const SUBTITLE_LOOK_IDS = FILM_SUBTITLE_LOOK_IDS;
const SUBTITLE_SIZE_PCT = FILM_SUBTITLE_SIZE_PCT;
export const SUBTITLE_SIZE_PCT_MIN = FILM_SUBTITLE_SIZE_PCT_MIN;
export const SUBTITLE_SIZE_PCT_MAX = FILM_SUBTITLE_SIZE_PCT_MAX;
export const SUBTITLE_DEFAULT = FILM_SUBTITLE_DEFAULT;
export const SUBTITLE_HOME_Y = FILM_SUBTITLE_HOME_Y;
export const cueAt = filmSubtitleAt;
export const cueText = filmSubtitleText;
export const matchSubtitleLook = matchFilmSubtitleLook;

/** The nearest of the three size ticks to a continuous size. */
export function nearestSizeId(sizePct: number): SubtitleSizeId {
  const ids = Object.keys(SUBTITLE_SIZE_PCT) as SubtitleSizeId[];
  return ids.reduce((best, id) => (
    Math.abs(SUBTITLE_SIZE_PCT[id] - sizePct) < Math.abs(SUBTITLE_SIZE_PCT[best] - sizePct) ? id : best
  ), ids[0]!);
}

/**
 * The preview's CSS. The font size is in `cqmin` (a hundredth of the frame box's short side, the box being a size
 * container), so the subtitles keep their size against the picture in a small pane and full screen alike; 11px at
 * least, or a narrow pane shows a gray smear instead of small text.
 */
export function subtitleCss(style: SubtitleStyle): FilmSubtitleCss {
  return filmSubtitleCss(style, { fontSize: `max(11px, ${style.font.sizePct}cqmin)` });
}

/* ── dragging ────────────────────────────────────────────────────────────── */

/**
 * Where a dragged subtitle snaps. Across: the middle (centered is by far the usual, and two pixels off-center cannot be
 * seen; that is what a snap is for). Down: the middle and the two safe lines (the default spot and its mirror at the
 * top), plus the vertical default spot: a subtitle moved out of the way is usually moved back, and "back" is a number.
 */
export const SNAP_X: readonly number[] = [0.5];
export const SNAP_Y: readonly number[] = [1 - SUBTITLE_HOME_Y, 0.5, FILM_SUBTITLE_PORTRAIT_Y, SUBTITLE_HOME_Y];

/**
 * The snap radius, in screen pixels rather than a fraction: 1% is a few pixels in a small pane (never catches) and
 * twenty at full screen (cannot be avoided). Figma's 6px.
 */
export const SNAP_PX = 6;

/** A position on one axis (fraction of `spanPx`), snapped to the first target within SNAP_PX; `guide` = the line it snapped to. */
export function snapAxis(value: number, spanPx: number, targets: readonly number[]): { value: number; guide: number | null } {
  for (const target of targets) {
    if (Math.abs(value - target) * spanPx <= SNAP_PX) return { value: target, guide: target };
  }
  return { value, guide: null };
}

/* ── color controls ─────────────────────────────────────────────────────── */

/**
 * A color as hue (`#rrggbb`, what a native color input takes) and alpha. Strokes and shadows default to translucent
 * `rgba(...)`: split, the picker sets the hue and a slider the alpha, and changing one keeps the other.
 * Unrecognised colors (named, hsl) give black as a starting point.
 */
export function splitColor(value: string): { hex: string; alpha: number } {
  const v = value.trim();
  const hex6 = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex6) return { hex: `#${hex6[1]!.toLowerCase()}`, alpha: 1 };
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (hex3) return { hex: `#${hex3[1]!}${hex3[1]!}${hex3[2]!}${hex3[2]!}${hex3[3]!}${hex3[3]!}`.toLowerCase(), alpha: 1 };
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(v);
  if (fn) {
    const to2 = (n: string) => Math.min(255, Math.round(Number(n))).toString(16).padStart(2, '0');
    return { hex: `#${to2(fn[1]!)}${to2(fn[2]!)}${to2(fn[3]!)}`, alpha: fn[4] ? Number(fn[4]) : 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

/** Back to one color: `#rrggbb` when opaque, else `rgba(...)`. */
export function joinColor(hex: string, alpha: number): string {
  if (alpha >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Number(alpha.toFixed(3))})`;
}

/* ── the look this person used last ──────────────────────────────────────── */

/**
 * The style is kept per project (in the project folder, see useSubtitleStyle); this browser also remembers the look
 * last used, the starting point for a project whose style was never changed: someone who set up large yellow
 * subtitles wants them in the next film too.
 */
const STORE_KEY = 'openfilm.subtitles';

/** The look used last, switched on: the switch belongs to each film (subtitles off in one do not hide another's). */
export function readLastSubtitleStyle(): SubtitleStyle | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? { ...parseFilmSubtitleStyle(JSON.parse(raw)), on: true } : null;
  } catch {
    return null;
  }
}

export function writeLastSubtitleStyle(style: SubtitleStyle): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(style));
  } catch { /* private mode */ }
}

/* ── Studio's API (studio/server/captions.mjs) ───────────────────────────── */

/** The film's subtitles as the server works them out (`GET /api/projects/:id/captions`). */
export type FilmCaptions = {
  cues: SubtitleCue[];
  /** The voices' language, by script (null: a Latin script, or nothing said). */
  sourceLanguage: string | null;
  /** Languages any line has a translation in. */
  languages: string[];
  /** The speech heard in the film with no transcript yet (POST subtitles/transcribe makes them). */
  untranscribed: string[];
};

/** How a translation went: `needsTranslator` when no service that translates is connected (the error says so). */
export type SubtitleTranslateResult = { ok: boolean; error?: string; needsTranslator?: boolean };

const subtitlesApi = (projectId: string, rest: string) => `/api/projects/${encodeURIComponent(projectId)}/${rest}`;

export async function fetchFilmCaptions(projectId: string, signal?: AbortSignal): Promise<FilmCaptions> {
  const res = await fetch(subtitlesApi(projectId, 'captions'), { signal });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
  return await res.json() as FilmCaptions;
}

/** The project's style, or null when it was never changed. */
export async function fetchSubtitleStyle(projectId: string, signal?: AbortSignal): Promise<SubtitleStyle | null> {
  const res = await fetch(subtitlesApi(projectId, 'subtitles'), { signal });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
  const body = await res.json() as { style: unknown };
  return body.style ? parseFilmSubtitleStyle(body.style) : null;
}

export async function saveSubtitleStyle(projectId: string, style: SubtitleStyle): Promise<void> {
  const res = await fetch(subtitlesApi(projectId, 'subtitles'), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style }),
  });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
}

/** How making subtitles went: `needsTranscriber` when no service can transcribe (the error says so). */
export type SubtitleTranscribeResult = { ok: boolean; error?: string; needsTranscriber?: boolean };

/** Transcribe the speech heard in the film that has no transcript yet (each gets a WebVTT beside it). */
export async function requestSubtitleTranscription(projectId: string): Promise<SubtitleTranscribeResult> {
  try {
    const res = await fetch(subtitlesApi(projectId, 'subtitles/transcribe'), { method: 'POST' });
    const body = await res.json().catch(() => null) as { failed?: { error: string }[]; error?: string; code?: string } | null;
    if (!res.ok) return { ok: false, error: body?.failed?.[0]?.error ?? body?.error ?? `HTTP ${res.status}`, ...(body?.code === 'no-transcriber' ? { needsTranscriber: true } : {}) };
    return body?.failed?.length ? { ok: false, error: body.failed[0]!.error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The person's correction of one line: it goes back into the transcript it comes from (or its translation into
 * `language`); with `part` (a cue's), into that subtitle's words of the spoken line only.
 */
export async function saveSubtitleLine(projectId: string, change: { src: string; line: number; part?: number; text: string; language?: string }): Promise<boolean> {
  const res = await fetch(subtitlesApi(projectId, 'captions/line'), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(change),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** Translate the film's voices into `language` (the lines then carry it; the style shows it). */
export async function requestSubtitleTranslation(projectId: string, language: string): Promise<SubtitleTranslateResult> {
  try {
    const res = await fetch(subtitlesApi(projectId, 'subtitles/translate'), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ language }),
    });
    const body = await res.json().catch(() => null) as { failed?: { error: string }[]; error?: string; code?: string } | null;
    if (!res.ok) return { ok: false, error: body?.failed?.[0]?.error ?? body?.error ?? `HTTP ${res.status}`, ...(body?.code === 'no-translator' ? { needsTranslator: true } : {}) };
    return body?.failed?.length ? { ok: false, error: body.failed[0]!.error } : { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/* ── the subtitle row's edits of one source (studio/server/subtitle-edits.mjs) ── */

/** A source's subtitles, one per cue, in its ms (lib/subtitle-cues SourceCue). */
export type SourceSubtitles = { src: string; cut: boolean; cues: SourceCue[] };
/** A source's transcript files as they were or are (path → text, null: none). */
export type SubtitleSnapshot = { files: Record<string, string | null> };

async function answer<T>(res: Response | null): Promise<T> {
  if (!res) throw new Error('Studio did not answer');
  const body = await res.json().catch(() => null) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new Error(body?.error ?? `Studio answered ${res.status}`);
  return body;
}

export async function fetchSourceSubtitles(projectId: string, src: string): Promise<SourceSubtitles> {
  return answer(await fetch(subtitlesApi(projectId, `captions/source?src=${encodeURIComponent(src)}`)).catch(() => null));
}

/** Write a source's subtitles; the files before and after, for undo and redo. */
export async function saveSourceSubtitles(projectId: string, src: string, cues: SourceCue[]): Promise<{ before: SubtitleSnapshot; after: SubtitleSnapshot }> {
  return answer(await fetch(subtitlesApi(projectId, 'captions/source'), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, cues }),
  }).catch(() => null));
}

/** Put a source's transcript files back as `to`, if they are still as `from` left them. */
export async function restoreSubtitleFiles(projectId: string, src: string, from: SubtitleSnapshot, to: SubtitleSnapshot): Promise<void> {
  await answer(await fetch(subtitlesApi(projectId, 'captions/files'), {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, from, to }),
  }).catch(() => null));
}
