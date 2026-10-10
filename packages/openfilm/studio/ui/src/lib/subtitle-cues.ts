/**
 * The subtitle row's edits, worked out here and written by the server (studio/server/subtitle-edits.mjs).
 *
 * Two sides:
 *   · on the film (film ms), what the row shows: where a dragged edge or cue may go (never over a neighbor), where a
 *     cue can be split, which two can be merged, where a new one fits;
 *   · in the source (its own ms, what its transcript holds): the same edit made to the source's subtitles, one cue per
 *     subtitle, each with its timed words and its translations. A cue on the film shows a source's subtitle through
 *     its clip (`at`, the `#t=` in point, `speed`): toSourceMs takes a film time back there.
 *
 * Cues never overlap after an edit: on the row, a cue keeps between its neighbors; in the source, the same.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import type { Clip } from '../api.ts';
import type { SubtitleCue } from './subtitles.ts';

/** The shortest a cue can be made (ms): a frame or two at most is not a subtitle. */
export const MIN_CUE_MS = 100;
/** How long a cue added at the playhead is, room allowing (ms). */
export const NEW_CUE_MS = 2000;

/* ── the film's side ─────────────────────────────────────────────────────── */

export const cueEnd = (c: Pick<SubtitleCue, 'startMs' | 'durMs'>) => c.startMs + c.durMs;

/** A cue's name on the row, stable while it is edited: its source, its line and its piece. */
export const cueKey = (c: SubtitleCue) => `${c.src ?? ''}\u0000${c.clip ?? ''}\u0000${c.line ?? c.startMs}\u0000${c.part ?? ''}`;

/** The cues as the row lays them out: by start. */
export const rowOrder = (cues: readonly SubtitleCue[]): SubtitleCue[] => [...cues].sort((a, b) => a.startMs - b.startMs || a.durMs - b.durMs);

/**
 * The room cue `i` of `cues` (in row order) has: from the end of the cues before it to the start of those after it.
 * Never less than the cue itself: two cues that overlap already (two voices at once) are not pushed apart, only kept
 * from overlapping more.
 */
export function cueRoom(cues: readonly SubtitleCue[], i: number): { lo: number; hi: number } {
  const cue = cues[i]!;
  let lo = 0;
  let hi = Infinity;
  cues.forEach((c, j) => {
    if (j < i) lo = Math.max(lo, cueEnd(c));
    if (j > i) hi = Math.min(hi, c.startMs);
  });
  return { lo: Math.min(lo, cue.startMs), hi: Math.max(hi, cueEnd(cue)) };
}

/** One edge of cue `i` dragged to `ms`: kept inside its room, and at least MIN_CUE_MS long. */
export function retimeCue(cues: readonly SubtitleCue[], i: number, edge: 'start' | 'end', ms: number): { startMs: number; endMs: number } {
  const cue = cues[i]!;
  const { lo, hi } = cueRoom(cues, i);
  const startMs = cue.startMs, endMs = cueEnd(cue);
  if (edge === 'start') return { startMs: Math.round(Math.min(Math.max(ms, lo), Math.max(lo, endMs - MIN_CUE_MS))), endMs };
  return { startMs, endMs: Math.round(Math.max(Math.min(ms, hi), Math.min(hi, startMs + MIN_CUE_MS))) };
}

/** Cue `i` moved to start at `startMs`, its length kept, inside its room. */
export function moveCue(cues: readonly SubtitleCue[], i: number, startMs: number): { startMs: number; endMs: number } {
  const cue = cues[i]!;
  const { lo, hi } = cueRoom(cues, i);
  const at = Math.round(Math.min(Math.max(startMs, lo), Math.max(lo, hi - cue.durMs)));
  return { startMs: at, endMs: at + cue.durMs };
}

/** Whether a cue can be split at `atMs`: inside it, with MIN_CUE_MS on each side. */
export const canSplitAt = (cue: SubtitleCue, atMs: number) => atMs - cue.startMs >= MIN_CUE_MS && cueEnd(cue) - atMs >= MIN_CUE_MS;

/** Whether cues `a` and `b` (a before b) can be one: the same source through the same clip. */
export const canMerge = (a: SubtitleCue | undefined, b: SubtitleCue | undefined) => Boolean(a && b && a !== b && a.src && a.src === b.src && a.clip === b.clip);

/** The cue at `ms` (the latest to start, when two voices overlap), or -1. */
export function cueIndexAt(cues: readonly SubtitleCue[], ms: number): number {
  let found = -1;
  cues.forEach((c, i) => { if (c.startMs <= ms && ms < cueEnd(c)) found = i; });
  return found;
}

/**
 * Where a cue added at `atMs` goes: from there for NEW_CUE_MS, or up to the next cue or `untilMs` (the end of the clip
 * it is said in); null when a cue is there already or there is less than MIN_CUE_MS of room.
 */
export function addSpan(cues: readonly SubtitleCue[], atMs: number, untilMs = Infinity): { startMs: number; endMs: number } | null {
  if (cueIndexAt(cues, atMs) >= 0) return null;
  const next = Math.min(untilMs, ...cues.filter((c) => c.startMs >= atMs).map((c) => c.startMs));
  const endMs = Math.min(atMs + NEW_CUE_MS, next);
  return endMs - atMs >= MIN_CUE_MS ? { startMs: Math.round(atMs), endMs: Math.round(endMs) } : null;
}

/* ── from the film to the source ─────────────────────────────────────────── */

/** Where a clip plays its source: it starts on the film at `atMs`, at source ms `fromMs`, `speed` source ms a film ms. */
export type ClipSpan = { atMs: number; fromMs: number; speed: number };

export function clipSpanOf(clip: Pick<Clip, 'at' | 'time' | 'speed'>): ClipSpan {
  return { atMs: Math.round((clip.at ?? 0) * 1000), fromMs: Math.round((clip.time?.[0] ?? 0) * 1000), speed: clip.speed && clip.speed > 0 ? clip.speed : 1 };
}

export const toSourceMs = (span: ClipSpan, filmMs: number) => Math.max(0, Math.round(span.fromMs + (filmMs - span.atMs) * span.speed));
export const toFilmMs = (span: ClipSpan, sourceMs: number) => Math.round(span.atMs + (sourceMs - span.fromMs) / span.speed);

/* ── the source's side ───────────────────────────────────────────────────── */

export type Mark = { index: number; startMs: number };
/** A subtitle of a source, in its ms (GET captions/source); `line` and `part` name it as a film cue does. */
export type SourceCue = { startMs: number; endMs: number; text: string; marks?: Mark[]; alt?: Record<string, string>; line?: number; part?: number };

/** The source subtitle a film cue shows, or -1. */
export const findSourceCue = (list: readonly SourceCue[], cue: Pick<SubtitleCue, 'line' | 'part'>) =>
  list.findIndex((c) => c.line === cue.line && (c.part ?? null) === (cue.part ?? null));

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}　-〿＀-￯]/u;
/** Marks that never start a line (Chinese and Japanese typesetting): a cut is moved past them. */
const NO_START = /[\s，。、；：！？,.;:!?)）」』》〉”’…]/u;

/** Two subtitles' texts as one: a space between words, none where either side is CJK. */
export function joinText(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return CJK.test(a.slice(-1)) || CJK.test(b.slice(0, 1)) ? `${a}${b}` : `${a} ${b}`;
}

/**
 * Where to cut a text `fraction` of the way through: at the nearest space for words, else between characters (CJK),
 * never before a closing mark nor inside a character. 0 when it cannot be cut (one word, one character).
 */
export function cutIndex(text: string, fraction: number): number {
  const want = Math.round(Math.min(1, Math.max(0, fraction)) * text.length);
  const ok = (k: number) => k > 0 && k < text.length && !NO_START.test(text[k]!) && !/[\uDC00-\uDFFF]/.test(text[k]!)
    && text.slice(0, k).trim().length > 0 && text.slice(k).trim().length > 0;
  /* words: right after the nearest space */
  if (/\s/.test(text.trim())) {
    let best = 0;
    for (let k = 1; k < text.length; k += 1) {
      if (/\s/.test(text[k - 1]!) && ok(k) && (!best || Math.abs(k - want) < Math.abs(best - want))) best = k;
    }
    return best;
  }
  /* no spaces: between characters, where either side is CJK (a Latin word is never cut) */
  const between = (k: number) => ok(k) && (CJK.test(text[k - 1]!) || CJK.test(text[k]!));
  for (let d = 0; d < text.length; d += 1) {
    if (between(want + d)) return want + d;
    if (between(want - d)) return want - d;
  }
  return 0;
}

/** A cue's timed words, moved with its span to [startMs, endMs] (each word keeps its share of the time). */
function scaledMarks(cue: SourceCue, startMs: number, endMs: number): Mark[] | undefined {
  if (!cue.marks?.length) return undefined;
  const from = cue.endMs - cue.startMs;
  const k = from > 0 ? (endMs - startMs) / from : 0;
  return cue.marks.map((m) => ({ index: m.index, startMs: Math.round(startMs + (m.startMs - cue.startMs) * k) }));
}

const withMarks = (cue: SourceCue, marks: Mark[] | undefined): SourceCue => {
  const { marks: _old, ...rest } = cue;
  return marks?.length ? { ...rest, marks } : rest;
};

/** The room source cue `i` has between its neighbors. */
function sourceRoom(list: readonly SourceCue[], i: number) {
  return { lo: i > 0 ? list[i - 1]!.endMs : 0, hi: i < list.length - 1 ? list[i + 1]!.startMs : Infinity };
}

/** Cue `i` given new times (each kept between its neighbors), its words moved with it. */
export function retimeSource(list: readonly SourceCue[], i: number, startMs: number, endMs: number): SourceCue[] {
  const cue = list[i]!;
  const { lo, hi } = sourceRoom(list, i);
  const s = Math.round(Math.max(lo, startMs));
  const e = Math.round(Math.min(hi, endMs));
  if (e - s < 1) return [...list];
  return list.map((c, j) => (j === i ? withMarks({ ...c, startMs: s, endMs: e }, scaledMarks(cue, s, e)) : c));
}

/**
 * Cue `i` cut in two at source ms `atMs`: the words said before it on the first, the rest on the second (by the timed
 * words; without them, by how far through the cue the cut is). A cue of one word keeps it on both halves, to be typed
 * over. Its translations are cut at the same share of their text.
 */
export function splitSource(list: readonly SourceCue[], i: number, atMs: number): SourceCue[] {
  const cue = list[i]!;
  const at = Math.round(atMs);
  if (at - cue.startMs < 1 || cue.endMs - at < 1) return [...list];
  const fraction = (at - cue.startMs) / (cue.endMs - cue.startMs);
  const byWord = cue.marks?.find((m) => m.index > 0 && m.startMs >= at)?.index;
  const k = byWord != null && cutIndex(cue.text, byWord / cue.text.length) === byWord ? byWord : cutIndex(cue.text, fraction);
  const leftText = k ? cue.text.slice(0, k).trim() : cue.text;
  const rightRaw = k ? cue.text.slice(k) : cue.text;
  const rightText = rightRaw.trim();
  const lead = k ? k + (rightRaw.length - rightRaw.trimStart().length) : 0;
  const leftMarks = k ? cue.marks?.filter((m) => m.index < leftText.length) : cue.marks?.filter((m) => m.startMs < at);
  const rightMarks = (k ? cue.marks?.filter((m) => m.index >= lead).map((m) => ({ index: m.index - lead, startMs: Math.max(at, m.startMs) })) : undefined);
  const altLeft: Record<string, string> = {};
  const altRight: Record<string, string> = {};
  for (const [language, text] of Object.entries(cue.alt ?? {})) {
    const c = cutIndex(text, k ? k / cue.text.length : fraction);
    altLeft[language] = c ? text.slice(0, c).trim() : text;
    altRight[language] = c ? text.slice(c).trim() : text;
  }
  const { line: _line, part: _part, alt: _alt, ...base } = cue;
  const left = withMarks({ ...base, endMs: at, text: leftText, ...(cue.alt ? { alt: altLeft } : {}) }, leftMarks);
  const right = withMarks({ ...base, startMs: at, text: rightText, ...(cue.alt ? { alt: altRight } : {}) }, rightMarks);
  return [...list.slice(0, i), left, right, ...list.slice(i + 1)];
}

/** Cues `i` and `i + 1` as one, from the first's start to the second's end, their words and translations joined. */
export function mergeSource(list: readonly SourceCue[], i: number): SourceCue[] {
  const a = list[i], b = list[i + 1];
  if (!a || !b) return [...list];
  const text = joinText(a.text, b.text);
  const offset = text.length - b.text.length;
  const marks = a.marks?.length || b.marks?.length
    ? [...(a.marks ?? [{ index: 0, startMs: a.startMs }]), { index: offset, startMs: b.startMs }, ...(b.marks ?? []).filter((m) => m.index > 0).map((m) => ({ index: m.index + offset, startMs: m.startMs }))]
    : undefined;
  const alt: Record<string, string> = {};
  for (const language of new Set([...Object.keys(a.alt ?? {}), ...Object.keys(b.alt ?? {})])) alt[language] = joinText(a.alt?.[language] ?? '', b.alt?.[language] ?? '');
  const { line: _line, part: _part, alt: _alt, ...base } = a;
  const one = withMarks({ ...base, endMs: Math.max(a.endMs, b.endMs), text, ...(Object.keys(alt).length ? { alt } : {}) }, marks);
  return [...list.slice(0, i), one, ...list.slice(i + 2)];
}

export const removeSource = (list: readonly SourceCue[], i: number): SourceCue[] => list.filter((_, j) => j !== i);

/** A new cue, put in order and kept clear of its neighbors; the list as it was when there is no room. */
export function addSource(list: readonly SourceCue[], cue: SourceCue): SourceCue[] {
  const at = list.findIndex((c) => c.startMs > cue.startMs);
  const i = at < 0 ? list.length : at;
  const startMs = Math.max(cue.startMs, i > 0 ? list[i - 1]!.endMs : 0);
  const endMs = Math.min(cue.endMs, i < list.length ? list[i]!.startMs : Infinity);
  if (endMs - startMs < 1) return [...list];
  return [...list.slice(0, i), { ...cue, startMs, endMs }, ...list.slice(i)];
}

/** Cue `i`'s words typed again: timed as a whole (its word times went with the words). */
export function textSource(list: readonly SourceCue[], i: number, text: string): SourceCue[] {
  return list.map((c, j) => (j === i ? withMarks({ ...c, text: text.replace(/\s+/g, ' ').trim() }, undefined) : c));
}
