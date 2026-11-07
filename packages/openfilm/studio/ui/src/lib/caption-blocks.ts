/**
 * A caption track's cues as clips of the timeline (SPEC §1 Captions): each cue a block on its track's row, selected,
 * boxed, moved, trimmed, split, deleted, rippled and carried by linkage as any clip is, by the same edits
 * (lib/timeline-edit). film.html has no clip for a cue: an edit's operations that name one are taken out of what
 * film.html is sent, and made what they do to the cues of the caption files instead (cueEditOf).
 *
 * How: the film is worked out with each caption track holding its cues as stand-in clips (stills, a cue's length) and
 * the edit's operations applied to it as the server applies them (ops.mjs); where each stand-in ends up is where its
 * cue goes: its new times (its words' timestamps with them), another caption track's file, a half of it after a cut,
 * a copy, or nothing. A cue that stayed is cut short where one that moved reaches it.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import { applyOps } from '../../../server/ops.mjs';
import { cuePlain } from '../../../../src/captions.mjs';
import type { Op } from '../api.ts';
import { cueRule, keepApart, setCueRule, shifted, splitCue, type Vtt, type VttCue } from './caption-edits.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout.ts';

const PREFIX = 'cue:';
/** A stand-in's src: a still, which any length suits (ops.mjs reads it as one). */
const STAND_IN = 'openfilm-cue.png';

/** A cue kept apart from its file (copied, then cut from it): its words, times and settings, and its own look. */
export type KeptCue = { cue: VttCue; rule: Record<string, string> };

/** A new clip standing for a cue kept apart (a paste of a cue cut since it was copied): its stand-in, put in by an insert. */
export const cueStandIn = (clipId: string, durMs: number) => ({ src: STAND_IN, time: [0, r3(durMs / 1000)], attrs: { 'data-cue': clipId } });

/** A cue's clip id on the timeline. */
export const cueClipId = (src: string, id: string): string => `${PREFIX}${src}#${id}`;
export const isCueClip = (clipId: string | undefined): boolean => Boolean(clipId?.startsWith(PREFIX));
/** The file and id of a cue's clip id; null for a clip of film.html. */
export function cueOf(clipId: string | undefined): { src: string; id: string } | null {
  if (!clipId?.startsWith(PREFIX)) return null;
  const rest = clipId.slice(PREFIX.length);
  const hash = rest.lastIndexOf('#');
  return hash > 0 ? { src: rest.slice(0, hash), id: rest.slice(hash + 1) } : null;
}

const ms = (s: number) => Math.round(s * 1000);
const r3 = (s: number) => Math.round(s * 1000) / 1000;

/** The timeline's rows with each caption track's cues on its row as blocks (its file not read yet: none). */
export function withCueBlocks(tracks: readonly TimelineTrack[], vttOf: (src: string) => Vtt | null): TimelineTrack[] {
  return tracks.map((row) => {
    if (!row.captions) return row;
    const src = row.captions.src;
    const blocks = (vttOf(src)?.cues ?? []).map((c): TimelineBlock => {
      const words = cuePlain(c.text).replace(/\s+/g, ' ').trim();
      const id = cueClipId(src, c.id);
      return {
        /* its place is its id: no clip of film.html has one like it, and a block with a place is edited as a clip is */
        id, clipId: id, loc: id, title: words, words, kind: 'caption', startMs: ms(c.start), endMs: ms(c.end),
        /* moved by its start, trimmed by its end, any length: as a still is */
        anchor: { move: 'at', resize: 'end', still: true, parentStartMs: 0 },
        cue: { src, id: c.id }, ...(row.hidden ? { off: true as const } : {}),
      };
    });
    return { ...row, text: true, blocks };
  });
}

type FilmTrack = { clips: { id: string; src: string; at?: number; time?: number[]; attrs?: Record<string, string> }[]; captions?: { src: string } };
type FilmValue = { tracks: FilmTrack[] };

/** What an edit is, once its cues are taken out: what film.html is sent, and the caption files it changes. */
export type CueEdit = { ops: Op[]; files: { src: string; next: Vtt }[] };

/**
 * An edit of the timeline's clips, cues among them, as film.html's operations and the caption files' new versions.
 * `vttOf`: each caption track's cues as held (with their ids); `kept`: cues no file has any more that the edit puts back
 * (cueStandIn), by their clip id. Null: the edit puts a cue where only clips go, or a clip onto a caption track; it is
 * not made.
 */
export function cueEditOf(film: FilmValue, ops: readonly Op[], vttOf: (src: string) => Vtt | null, kept: ReadonlyMap<string, KeptCue> = new Map()): CueEdit | null {
  const named = (id: unknown) => typeof id === 'string' && isCueClip(id);
  const touches = JSON.stringify(ops).includes(PREFIX) || JSON.stringify(ops).includes(STAND_IN);
  const captions = film.tracks.flatMap((t) => (t.captions ? [t.captions.src] : []));
  if (!captions.length) return { ops: [...ops], files: [] };

  /* the film with stand-ins for the cues, the edit applied to it */
  const shown = structuredClone(film) as FilmValue;
  for (const t of shown.tracks) {
    if (!t.captions) continue;
    const src = t.captions.src;
    t.clips = (vttOf(src)?.cues ?? []).map((c) => ({
      id: cueClipId(src, c.id), src: STAND_IN, ...(c.start ? { at: r3(c.start) } : {}), time: [0, r3(c.end - c.start)], attrs: { 'data-cue': cueClipId(src, c.id) },
    }));
  }
  let after: FilmValue;
  try { after = applyOps(shown as never, structuredClone(ops) as never) as unknown as FilmValue; }
  catch { return { ops: [...ops], files: [] }; }
  /* a cue only on a caption track, and nothing else there */
  for (const t of after.tracks) {
    for (const c of t.clips) if (Boolean(t.captions) !== (c.src === STAND_IN)) return null;
  }

  /* film.html's operations: the edit's, without what it does to cues */
  const own: Op[] = [];
  for (const op of ops) {
    if (op.op === 'props') {
      const edits = op.edits.filter((e) => !named(e.clip));
      if (edits.length) own.push({ ...op, edits });
      continue;
    }
    if ('clip' in op && named(op.clip)) continue;
    if (op.op === 'insert' && (named(op.from) || (op.clip as { src?: string } | undefined)?.src === STAND_IN)) continue;
    own.push(op);
  }
  if (!touches) return { ops: own, files: [] };

  /* where each cue went: its stand-ins, by the cue they stand for */
  const cueOfStandIn = (c: FilmTrack['clips'][number]) => cueOf(c.attrs?.['data-cue']);
  const original = (src: string, id: string): VttCue | undefined => vttOf(src)?.cues.find((c) => c.id === id) ?? kept.get(cueClipId(src, id))?.cue;
  const ruleOf = (src: string, id: string) => (vttOf(src)?.cues.some((c) => c.id === id) ? cueRule(vttOf(src)!, `::cue(#${id})`) : kept.get(cueClipId(src, id))?.rule ?? {});
  const splits = new Set(ops.flatMap((op) => (op.op === 'split' && named(op.clip) ? [op.clip] : [])));
  /* the words of a cut cue's halves, by the cue's own cut (lib/caption-edits splitCue) at the left half's length */
  const halves = new Map<string, { left: string; right: string; at: number }>();
  for (const t of after.tracks) {
    for (const c of t.clips) {
      if (!splits.has(c.id)) continue;
      const of = cueOf(c.id)!;
      const cue = original(of.src, of.id);
      const vtt = vttOf(of.src);
      if (!cue || !vtt) continue;
      const at = r3(cue.start + (c.time?.[1] ?? 0) - (c.time?.[0] ?? 0));
      const cut = splitCue(vtt, of.id, at);
      if (!cut.id) continue;
      halves.set(c.id, { left: cut.vtt.cues.find((x) => x.id === of.id)!.text, right: cut.vtt.cues.find((x) => x.id === cut.id)!.text, at });
    }
  }

  const next = new Map<string, Vtt>();
  for (const src of captions) next.set(src, vttOf(src) ?? { header: 'WEBVTT', notes: [], regions: [], styles: [], cues: [] });
  const placed = new Map<string, { cues: VttCue[]; moved: Set<string>; rules: [string, Record<string, string>][] }>();
  for (const src of captions) placed.set(src, { cues: [], moved: new Set(), rules: [] });
  for (const t of after.tracks) {
    if (!t.captions) continue;
    const src = t.captions.src;
    const into = placed.get(src)!;
    const standIns = t.clips.flatMap((c) => {
      const from = cueOfStandIn(c);
      const cue = from && original(from.src, from.id);
      return from && cue ? [{ c, from, cue, itself: c.id === cueClipId(from.src, from.id) }] : [];
    });
    /* each keeps its id where it stays in its file; a half, a copy or one come from another file takes a free one */
    const used = new Set(standIns.filter((x) => x.itself && x.from.src === src).map((x) => x.cue.id));
    let n = 0;
    const free = () => { do n += 1; while (used.has(`c${n}`)); used.add(`c${n}`); return `c${n}`; };
    for (const { c, from, cue, itself } of standIns) {
      const start = r3(c.at ?? 0);
      const end = r3(start + (c.time?.[1] ?? 0) - (c.time?.[0] ?? 0));
      const half = halves.get(cueClipId(from.src, from.id));
      const words = half ? (itself ? half.left : half.right) : cue.text;
      const id = itself && from.src === src ? cue.id : free();
      /* its words move by as much as it did from where it was: a right half was at the cut */
      const was = half && !itself ? half.at : cue.start;
      into.cues.push({ ...cue, id, start, end, text: shifted(words, r3(start - was)) });
      if (id !== cue.id || from.src !== src || Math.abs(start - cue.start) > 1e-6 || Math.abs(end - cue.end) > 1e-6 || words !== cue.text) into.moved.add(id);
      /* its own look goes with it (one kept apart has none in any file now) */
      if (id !== cue.id || from.src !== src || !vttOf(from.src)?.cues.some((x) => x.id === cue.id)) {
        const rule = ruleOf(from.src, cue.id);
        if (Object.keys(rule).length) into.rules.push([id, rule]);
      }
    }
  }
  const files: CueEdit['files'] = [];
  for (const src of captions) {
    const was = next.get(src)!;
    const into = placed.get(src)!;
    let out: Vtt = { ...was, cues: keepApart(into.cues, into.moved) };
    /* the looks of cues gone from this file go; those of cues come into it come */
    const here = new Set(out.cues.map((c) => c.id));
    for (const c of was.cues) if (!here.has(c.id) || into.rules.some(([id]) => id === c.id)) out = setCueRule(out, `::cue(#${c.id})`, null);
    for (const [id, rule] of into.rules) out = setCueRule(out, `::cue(#${id})`, rule);
    const same = out.cues.length === was.cues.length && out.cues.every((c, i) => {
      const w = was.cues[i]!;
      return c.id === w.id && c.start === w.start && c.end === w.end && c.text === w.text;
    }) && out.styles.join('\n') === was.styles.join('\n');
    if (!same) files.push({ src, next: out });
  }
  return { ops: own, files };
}
