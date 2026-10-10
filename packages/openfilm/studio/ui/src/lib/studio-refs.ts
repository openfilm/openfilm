/**
 * What the person points at in Studio, as references for the chat of the app around it (lib/host.ts StudioRef): a
 * clip, a layer, a box drawn on the picture, a moment, a stretch marked on the timeline, a track, a file of the media
 * pane, a subtitle line or words in it, each with the picture its pill shows. Built here from what the editor already knows, so the rules (which
 * clips a range or a box takes in, which frame stands for a clip) are the same wherever the reference comes from.
 */
import type { StageBox, StudioRef } from './host';
import { filmSrcIsStill, parseFilmDocLoc } from './film.ts';
import type { StageElement } from './stage-types';
import type { SubtitleCue } from './subtitles';
import { formatTimecode } from './timecode.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout';
import type { WorkspaceResource } from './workspace-resources';

type Stage = { w: number; h: number };
/** A stretch of the film, in ms. */
export interface FilmRange { startMs: number; endMs: number }

/** A box drawn on the picture is a box from this many screen px each way; less is a click. */
export const REGION_MIN_PX = 8;
/** How many lines of words a region carries: enough to say what is there, not the page's whole text. */
const REGION_TEXTS = 10;
/** A clip is shown by its frame this far past its in point (film ms): its very first frame is often a fade, black. */
const CLIP_PEEK_MS = 500;

const sec = (ms: number) => Math.round(ms) / 1000;
const media = (projectId: string, path: string, ms: number, w: number) =>
  `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${Math.round(ms)}&w=${w}`;


/** Which project a clip's file is in, and which version of it (the frames the server cuts are kept by address). */
export interface ClipFrameSource {
  projectId: string;
  version?: (path: string) => number | undefined;
}

/**
 * A still as a picture on Studio's own origin (the server cuts it as it cuts a video's frame): the chat crops and
 * sends pictures, and one from the film's origin, another origin, cannot be read back from a canvas.
 */
export function stillUrl(projectId: string, path: string, version?: number): string {
  return `${media(projectId, path, 0, 640)}${version != null ? `&v=${version}` : ''}`;
}

/**
 * The clip's own picture a little past its in point: a video's frame or a page's (cut by the server, as the
 * timeline's thumbnails are), a still itself (see stillUrl). Null for sound.
 */
export function clipFrameUrl(block: TimelineBlock, at: ClipFrameSource): string | null {
  const src = block.src;
  if (!src || (block.kind !== 'video' && block.kind !== 'mg')) return null;
  const v = at.version?.(src);
  if (filmSrcIsStill(src)) return stillUrl(at.projectId, src, v);
  const speed = block.speed && block.speed > 0 ? block.speed : 1;
  const peek = Math.min(CLIP_PEEK_MS, (block.endMs - block.startMs) / 2) * speed;
  const last = block.sourceDurMs != null ? block.sourceDurMs - 40 : Infinity;
  const ms = Math.max(0, Math.min(inPointMs(block) + peek, last));
  return `${media(at.projectId, src, ms, 320)}${v != null ? `&v=${v}` : ''}`;
}

/** The source ms a clip starts at, as the timeline reads it. */
function inPointMs(block: TimelineBlock): number {
  return block.inMs ?? Math.round((block.anchor?.trimFrom ?? 0) * 1000);
}

export function clipRef(block: TimelineBlock, at: ClipFrameSource): StudioRef {
  const loc = block.loc ?? null;
  const track = loc ? parseFilmDocLoc(loc)?.track : undefined;
  const image = clipFrameUrl(block, at);
  return {
    kind: 'clip', id: block.clipId ?? null, loc, label: block.title, clipKind: block.kind, src: block.src ?? null,
    start: sec(block.startMs), end: sec(block.endMs),
    ...(track != null ? { track } : {}),
    ...(block.src ? { in: sec(inPointMs(block)), speed: block.speed && block.speed > 0 ? block.speed : 1 } : {}),
    ...(image ? { image: { src: image } } : {}),
  };
}

/**
 * A layer of a page at `ms`, where it is drawn then (`box`, stage px, when measured). Its source line is not known:
 * the stage finds a layer by its selector in the page, not by where it is written.
 */
export function layerRef(
  element: Pick<StageElement, 'label' | 'loc' | 'clipId' | 'text' | 'tag'>,
  at: { projectId: string; ms: number; box: StageBox | null; stage: Stage },
): StudioRef {
  return {
    kind: 'layer', label: element.label, loc: element.loc, clipId: element.clipId ?? null,
    text: element.text?.value ?? null, tag: element.tag ?? null, time: sec(at.ms),
    ...(at.box ? { box: at.box } : {}),
    source: null,
    image: { viewer: true, stage: at.stage, ...(at.box ? { crop: at.box } : {}) },
  };
}

export function momentRef(_projectId: string, ms: number): StudioRef {
  return { kind: 'time', time: sec(ms), image: { viewer: true } };
}

/** The clips playing in a range: any part of them in it. */
export function rangeClipIds(blocks: readonly TimelineBlock[], range: FilmRange): string[] {
  const ids = blocks.filter((b) => b.clipId && b.startMs < range.endMs && b.endMs > range.startMs).map((b) => b.clipId!);
  return [...new Set(ids)];
}

/** A range: its span and the clips in it (no picture, see StudioRefImage). */
export function rangeRef(_projectId: string, range: FilmRange, blocks: readonly TimelineBlock[]): StudioRef {
  return { kind: 'range', start: sec(range.startMs), end: sec(range.endMs), clipIds: rangeClipIds(blocks, range) };
}

/** Two times as a range, either way round; none when they are the same moment. */
export function orderedRange(a: number, b: number): FilmRange | null {
  const startMs = Math.max(0, Math.min(a, b));
  const endMs = Math.max(a, b);
  return endMs - startMs >= 1 ? { startMs, endMs } : null;
}

/**
 * I and O, as editors have them: I puts the range's start at `ms` (its end stays when it is later, else the film's
 * end), O its end (its start stays when it is earlier, else the film's start).
 */
export function markRange(range: FilmRange | null, which: 'in' | 'out', ms: number, totalMs: number): FilmRange | null {
  if (which === 'in') return orderedRange(ms, range && range.endMs > ms ? range.endMs : totalMs);
  return orderedRange(range && range.startMs < ms ? range.startMs : 0, ms);
}

/** The range's label on the timeline: `00:12:18 – 00:17:06 · 4.6 s`, then the key that references it. */
export function rangeLabel(range: FilmRange, shortcut?: string): string {
  const at = (ms: number) => formatTimecode(ms, { hours: false });
  const span = `${at(range.startMs)} – ${at(range.endMs)} · ${((range.endMs - range.startMs) / 1000).toFixed(1)} s`;
  return shortcut ? `${span} · ${shortcut}` : span;
}

/**
 * A box dragged on the picture (px from the film's top left on screen, `viewScale` screen px per stage px) in stage
 * px, inside the stage; null when it is too small to be meant (REGION_MIN_PX).
 */
export function regionBox(drag: { x1: number; y1: number; x2: number; y2: number }, viewScale: number, stage: Stage): StageBox | null {
  if (Math.abs(drag.x2 - drag.x1) < REGION_MIN_PX || Math.abs(drag.y2 - drag.y1) < REGION_MIN_PX || !(viewScale > 0)) return null;
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v / viewScale));
  const x = clamp(Math.min(drag.x1, drag.x2), stage.w);
  const y = clamp(Math.min(drag.y1, drag.y2), stage.h);
  const w = clamp(Math.max(drag.x1, drag.x2), stage.w) - x;
  const h = clamp(Math.max(drag.y1, drag.y2), stage.h) - y;
  return w > 0 && h > 0 ? { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } : null;
}

/** The picture clips showing now whose box on the stage meets the region (the stage's `clips` answer). */
export function regionClipIds(clips: readonly { id: string; visible: boolean; x: number; y: number; w: number; h: number }[], box: StageBox): string[] {
  return [...new Set(clips
    .filter((c) => c.visible && c.x < box.x + box.w && c.x + c.w > box.x && c.y < box.y + box.h && c.y + c.h > box.y)
    .map((c) => c.id))];
}

/**
 * The words of the layers inside a region, at most REGION_TEXTS lines: each line once, and not the words of a
 * part (`<em>`) again when the line it is in is there.
 */
export function regionTexts(layers: readonly { text?: { value: string } | undefined }[]): string[] {
  const lines = layers.map((l) => l.text?.value.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
  const kept = [...new Set(lines)].filter((line, _, all) => !all.some((other) => other !== line && other.includes(line)));
  return kept.slice(0, REGION_TEXTS);
}

export function regionRef(_projectId: string, ms: number, box: StageBox, found: { clipIds: string[]; texts: string[] }, stage: Stage): StudioRef {
  return { kind: 'region', time: sec(ms), box, clipIds: found.clipIds, texts: found.texts, image: { viewer: true, crop: box, stage } };
}

/** A film.html track (all its rows on the timeline): its clips. */
export function trackRef(tracks: readonly TimelineTrack[], docIndex: number): StudioRef | null {
  const rows = tracks.filter((tr) => tr.docIndex === docIndex);
  if (!rows.length) return null;
  const first = rows[0]!;
  const label = [first.badge, first.name].filter(Boolean).join(' ') || first.kind;
  return { kind: 'track', track: docIndex, label, clipIds: [...new Set(rows.flatMap((tr) => tr.blocks.flatMap((b) => (b.clipId ? [b.clipId] : []))))] };
}

/** A file of the media pane; `image` its poster (a video, a page) or itself (a still). */
export function fileRef(file: WorkspaceResource, image?: string): StudioRef {
  return {
    kind: 'file', path: file.path, fileKind: file.kind === 'mg' ? 'page' : file.kind,
    ...(file.durationMs ? { duration: sec(file.durationMs) } : {}),
    ...(file.w && file.h ? { w: file.w, h: file.h } : {}),
    ...(image ? { image: { src: image } } : {}),
  };
}

/**
 * A subtitle line (no picture, see StudioRefImage). `text` is the line as the panel shows it (a translation
 * when `lang` is given; else the line's own words); `index` is its number in the panel, from 1.
 *
 * With `pick` (a selection inside `text`, character offsets), just the words picked: with the transcript's word times
 * (the original only: a translation has none), the whole words the selection touches, with their own span; without
 * them, the words picked over the line's span. A selection of nothing but spaces is the whole line.
 */
export function subtitleRef(
  _projectId: string,
  cue: Pick<SubtitleCue, 'startMs' | 'durMs' | 'text' | 'words'>,
  at: { index?: number; lang?: string | null; text?: string; pick?: { from: number; to: number } | null } = {},
): StudioRef {
  const text = at.text ?? cue.text;
  const timed = at.lang ? null : cueWordSpans(text, cue.words);
  let startMs = cue.startMs;
  let endMs = cue.startMs + cue.durMs;
  let said = text;
  let words = timed;
  const from = Math.max(0, Math.min(at.pick?.from ?? 0, at.pick?.to ?? 0));
  const to = Math.min(text.length, Math.max(at.pick?.from ?? 0, at.pick?.to ?? 0));
  if (to > from && text.slice(from, to).trim()) {
    const picked = timed?.filter((w) => w.from < to && w.to > from);
    if (picked?.length) {
      const first = picked[0]!;
      const last = picked[picked.length - 1]!;
      said = text.slice(first.from, last.to);
      startMs = first.startMs;
      endMs = last.startMs + last.durMs;
      words = picked;
    } else {
      said = text.slice(from, to);
      words = null;
    }
  }
  return {
    kind: 'subtitle', start: sec(startMs), end: sec(endMs), text: said.replace(/\s+/g, ' ').trim(),
    ...(at.lang ? { lang: at.lang } : {}),
    ...(at.index != null ? { index: at.index } : {}),
    ...(words?.length ? { words: words.map((w) => ({ text: w.text, start: sec(w.startMs), end: sec(w.startMs + w.durMs) })) } : {}),
  };
}

/**
 * Where each of a line's timed words is in its text (character offsets), found in order; null when the line has no
 * word times or its text no longer has them all (corrected since it was transcribed).
 */
function cueWordSpans(text: string, words: SubtitleCue['words']): Array<{ text: string; startMs: number; durMs: number; from: number; to: number }> | null {
  if (!words?.length) return null;
  const out = [];
  let cursor = 0;
  for (const w of words) {
    const word = w.text.trim();
    if (!word) continue;
    const from = text.indexOf(word, cursor);
    if (from < 0) return null;
    cursor = from + word.length;
    out.push({ text: word, startMs: w.startMs, durMs: w.durMs, from, to: cursor });
  }
  return out.length ? out : null;
}
