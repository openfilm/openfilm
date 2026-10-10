/**
 * Transitions, made of what film.html already says: fades (each clip's own `fade`, see lib/clip-fade) and where clips
 * are. Nothing new is written in the file, so an agent reads a transition as two clips that fade.
 *
 *   Cross dissolve   the incoming clip (with the clips linked to it) moves d earlier so the two overlap by d, onto a
 *                    track with room: a picture above the outgoing clip's track (the one right above when it is free
 *                    there, else a new one just above), a sound below. The incoming picture fades in over d while the
 *                    outgoing one stays whole under it, so the two blend (both fading would dip through the black
 *                    under them); sounds both fade, out and in. With the magnet on, what follows the cut moves d
 *                    earlier too (on the clips' tracks, and with sync lock every unlocked one), so no gap opens and
 *                    nothing comes apart; without it, what follows stays and a gap of d is left after the incoming
 *                    clip.
 *   Audio crossfade  the same, for two sounds (a sound track below).
 *   Dip to black     no clip moves: the outgoing clip fades out over d/2, the incoming one in over d/2. The picture dips
 *                    to what is under them: the stage's black where nothing is.
 *   Dip to white     the same, over a white page (`transitions/white.html`) cut in under the dip, on the track below.
 *   Fade in / out    one clip's fade.
 * Dropped on a clip's edge with no clip against it, a cross dissolve or a dip is that clip's fade (a dip to white
 * with its white page under it).
 *
 * The clips linked to a clip go with it (Linked switch; ⌥ for one): their fades at the same edge too. Nothing on a
 * locked track changes: a transition that would change one is refused.
 *
 * On the timeline a transition is found again from the fades (findTransitions): two clips whose fades meet as one of
 * the above made them. Removed, its fades go and its clips come back as they were cut (the incoming clip back against
 * the outgoing one, on its track when there is room, what follows moving back with the magnet on); resized, the clips
 * move and the fades change by the difference.
 *
 * Pure: every plan is film.html's operations, one write and one undo step.
 */
import type { Op, PropValue } from '../api.ts';
import {
  TOUCH_MS, draftOf, findInDraft, linkedIds, planOf, reach, rippleAt, trackAt,
  type Draft, type EditClip, type EditModel, type EditTrack, type TrackDest,
} from './timeline-edit.ts';

export type TransitionKind = 'dissolve' | 'crossfade' | 'dip-black' | 'dip-white' | 'fade-in' | 'fade-out';
/** The kinds that are found again on the timeline (a fade alone is a fade). */
export type FoundKind = 'dissolve' | 'crossfade' | 'dip-black' | 'dip-white';

/** The default length of a transition (ms). */
export const TRANSITION_MS = 500;

/** What a plan needs to know of each clip that the edit model does not say. */
export interface ClipFacts {
  /** It has a picture (a page, a video, a still); else a sound. */
  picture: boolean;
  /** Its fades, ms. */
  fade: readonly [number, number];
  /** It is the white page under a dip to white. */
  white?: boolean;
}
export type FactsOf = (id: string) => ClipFacts | undefined;

/** A cut: the clip ending there (`a`) and the one starting there (`b`); one of them alone is a clip's edge. */
export interface CutRef { a: string | null; b: string | null }

export interface FilmTransition {
  /** Its name on the timeline (stays while its clips do). */
  key: string;
  kind: FoundKind;
  a: string;
  b: string;
  startMs: number;
  endMs: number;
  /** The clip whose row it is drawn on: the incoming one's for an overlap, the outgoing one's for a dip. */
  on: string;
  /** The white page under a dip to white. */
  white?: string;
  /** Where the cut is: the outgoing clip's end. */
  cutMs: number;
}

/** What the timeline asks of the editor: a transition put on a cut, made longer or shorter, or taken away. */
export type TransitionAsk =
  | { kind: 'add'; type: TransitionKind; cut: CutRef }
  | { kind: 'resize'; key: string; durationMs: number }
  | { kind: 'remove'; key: string };

/** Where a transition is drawn when it is `durationMs` long: a dip around its cut, an overlap ending where it ends. */
export function transitionSpan(tr: FilmTransition, durationMs: number): { startMs: number; endMs: number } {
  if (tr.kind === 'dip-black' || tr.kind === 'dip-white') return { startMs: tr.cutMs - durationMs / 2, endMs: tr.cutMs + durationMs / 2 };
  return { startMs: tr.endMs - durationMs, endMs: tr.endMs };
}

export interface TransitionOpts {
  /** The magnet: an overlap closes up what follows, removing one opens it again. */
  ripple: boolean;
  sync: boolean;
  /** Linked clips go with each other (the Linked switch, unless ⌥). */
  linked: boolean;
  /** The white page's path (dip to white). */
  whiteSrc?: string;
}

export type TransitionPlan = { ops: Op[]; shortMs: number } | { error: 'locked' | 'none' | 'short' };

/* ── finding them again ── */

const EPS = 1.5; // ms: times are kept to the ms, each rounded alone

const allClips = (model: EditModel): { clip: EditClip; track: EditTrack }[] => model.flatMap((track) => track.clips.map((clip) => ({ clip, track })));

/** The transitions the fades on the timeline make (see the top). */
export function findTransitions(model: EditModel, facts: FactsOf): FilmTransition[] {
  const clips = allClips(model);
  const used = new Set<string>();
  const out: FilmTransition[] = [];
  const whites = clips.filter(({ clip }) => facts(clip.id)?.white);
  for (const { clip: a, track: ta } of [...clips].sort((x, y) => Number(facts(y.clip.id)?.picture) - Number(facts(x.clip.id)?.picture))) {
    const fa = facts(a.id);
    if (!fa || fa.white || used.has(`a:${a.id}`)) continue;
    for (const { clip: b, track: tb } of clips) {
      const fb = facts(b.id);
      if (!fb || b.id === a.id || fb.white || fb.picture !== fa.picture || !(fb.fade[0] > 0) || used.has(`b:${b.id}`)) continue;
      /* an overlap the incoming clip fades in over: the outgoing one fades out with it, or (a picture under it) stays whole */
      const lap = a.endMs - b.startMs;
      const overlap = lap > EPS && tb.index !== ta.index && Math.abs(fb.fade[0] - lap) <= EPS
        && (Math.abs(fa.fade[1] - lap) <= EPS || (fa.picture && fa.fade[1] <= EPS && tb.index < ta.index));
      const touch = fa.fade[1] > 0 && Math.abs(b.startMs - a.endMs) <= EPS && tb.index === ta.index;
      if (!overlap && !touch) continue;
      let kind: FoundKind = overlap ? (fa.picture ? 'dissolve' : 'crossfade') : 'dip-black';
      const startMs = overlap ? b.startMs : a.endMs - fa.fade[1];
      const endMs = overlap ? a.endMs : b.startMs + fb.fade[0];
      let white: string | undefined;
      if (touch && fa.picture) {
        white = whites.find(({ clip: w }) => Math.abs(w.startMs - startMs) <= EPS && Math.abs(w.endMs - endMs) <= EPS)?.clip.id;
        if (white) kind = 'dip-white';
      }
      used.add(`a:${a.id}`);
      used.add(`b:${b.id}`);
      out.push({ key: `${a.id}|${b.id}`, kind, a: a.id, b: b.id, startMs, endMs, on: overlap ? b.id : a.id, cutMs: a.endMs, ...(white ? { white } : {}) });
      break;
    }
  }
  /* a picture's transition takes the sounds linked to it along: theirs is part of it, not one of its own */
  const linkOf = new Map(clips.map(({ clip }) => [clip.id, clip.link]));
  const pictures = out.filter((x) => facts(x.a)?.picture);
  return out.filter((x) => facts(x.a)?.picture || !pictures.some((p) => linkOf.get(p.a) && linkOf.get(p.a) === linkOf.get(x.a) && linkOf.get(p.b) && linkOf.get(p.b) === linkOf.get(x.b)));
}

/** The cut on track `track` at `ms` (within `tolMs`): the clip ending there and the one starting there, either alone. */
export function cutNear(model: EditModel, track: number, ms: number, tolMs: number): (CutRef & { atMs: number }) | null {
  const clips = model.find((t) => t.index === track)?.clips ?? [];
  const ends = clips.filter((c) => Math.abs(c.endMs - ms) <= tolMs).sort((x, y) => Math.abs(x.endMs - ms) - Math.abs(y.endMs - ms));
  const starts = clips.filter((c) => Math.abs(c.startMs - ms) <= tolMs).sort((x, y) => Math.abs(x.startMs - ms) - Math.abs(y.startMs - ms));
  const a = ends[0], b = starts[0];
  if (a && b && Math.abs(a.endMs - b.startMs) <= TOUCH_MS) return { a: a.id, b: b.id, atMs: b.startMs };
  if (a && (!b || Math.abs(a.endMs - ms) <= Math.abs(b.startMs - ms))) return { a: a.id, b: null, atMs: a.endMs };
  if (b) return { a: null, b: b.id, atMs: b.startMs };
  return null;
}

/**
 * Where a tile clicked goes. Among the clips selected: a cut between two of them, else the cut or edge of theirs nearest
 * the playhead; with none selected, the cut nearest the playhead on the targeted track (else on any unlocked one). A
 * fade in goes on a clip's start, a fade out on its end; a transition goes on a cut before a lone edge.
 */
export function cutForClick(model: EditModel, kind: TransitionKind, selected: readonly string[], playheadMs: number, target: number | null): CutRef | null {
  const open = model.filter((t) => !t.locked);
  const pick = new Set(selected);
  const tracks = pick.size ? open : open.filter((t) => t.index === target && t.clips.length).length ? open.filter((t) => t.index === target) : open;
  type Edge = CutRef & { atMs: number; both: boolean };
  const edges: Edge[] = [];
  for (const t of tracks) {
    for (const c of t.clips) {
      if (pick.size && !pick.has(c.id)) continue;
      const before = t.clips.find((x) => x.id !== c.id && Math.abs(x.endMs - c.startMs) <= TOUCH_MS);
      const after = t.clips.find((x) => x.id !== c.id && Math.abs(x.startMs - c.endMs) <= TOUCH_MS);
      if (kind !== 'fade-out') edges.push({ a: before?.id ?? null, b: c.id, atMs: c.startMs, both: Boolean(before && pick.has(before.id)) });
      if (kind !== 'fade-in') edges.push({ a: c.id, b: after?.id ?? null, atMs: c.endMs, both: Boolean(after && pick.has(after.id)) });
    }
  }
  if (!edges.length) return null;
  const fade = kind === 'fade-in' || kind === 'fade-out';
  const rank = (e: Edge) => (fade ? 0 : e.both ? 0 : e.a && e.b ? 1 : 2);
  const best = [...edges].sort((x, y) => rank(x) - rank(y) || Math.abs(x.atMs - playheadMs) - Math.abs(y.atMs - playheadMs))[0]!;
  /* nothing selected: a lone edge only for a fade (a transition wants a cut) */
  if (!pick.size && !fade && !(best.a && best.b)) return null;
  return { a: best.a, b: best.b };
}

/* ── planning ── */

/** The fades an edit sets, by clip id (ms); written after the moves, in the same edit. */
type Fades = Map<string, [number, number]>;

const lengthOf = (c: EditClip) => c.endMs - c.startMs;
const free = (track: EditTrack, startMs: number, endMs: number, skip: ReadonlySet<string>) => !track.clips.some(
  (c) => !skip.has(c.id) && c.startMs < endMs - TOUCH_MS && c.endMs > startMs + TOUCH_MS,
);

function fadeOf(fades: Fades, facts: FactsOf, id: string): [number, number] {
  const had = fades.get(id) ?? facts(id)?.fade ?? [0, 0];
  return [had[0], had[1]];
}

/** Set one edge's fade, fitted to the clip's length with the other fade (which gives way when it has to). */
function setFade(fades: Fades, facts: FactsOf, clip: EditClip, edge: 'in' | 'out', ms: number) {
  const [fin, fout] = fadeOf(fades, facts, clip.id);
  const len = lengthOf(clip);
  const own = Math.max(0, Math.min(ms, len));
  fades.set(clip.id, edge === 'in' ? [own, Math.min(fout, len - own)] : [Math.min(fin, len - own), own]);
}

/** The clips linked to `id` (it among them) when linked clips go together. */
function groupOf(model: EditModel, id: string, opts: TransitionOpts): string[] {
  return opts.linked ? linkedIds(model, [id]) : [id];
}

/** `id` and the clips going with it whose `edge` is where its own is. */
function atEdge(d: Draft, model: EditModel, id: string, edge: 'in' | 'out', opts: TransitionOpts): EditClip[] {
  const self = findInDraft(d, id)?.clip;
  if (!self) return [];
  const at = (c: EditClip) => (edge === 'in' ? c.startMs : c.endMs);
  return groupOf(model, id, opts).map((x) => findInDraft(d, x)?.clip).filter((c): c is EditClip => Boolean(c && Math.abs(at(c) - at(self)) <= EPS));
}

const lockedIn = (d: Draft, ids: Iterable<string>) => [...ids].some((id) => findInDraft(d, id)?.track.locked);

/** The plan's operations: the moves (planOf), then the fades, then what it adds. */
function opsOf(d: Draft, fades: Fades, extra: Op[] = []): { ops: Op[]; shortMs: number } {
  const plan = planOf(d);
  const edits = [...fades].map(([clip, [fin, fout]]) => ({ clip, prop: 'fade', value: [secs(fin), secs(fout)] as PropValue }));
  return { ops: [...plan.ops, ...(edits.length ? [{ op: 'props' as const, edits }] : []), ...extra], shortMs: plan.shortMs };
}
const secs = (ms: number) => Math.round(ms) / 1000;

/** Synthetic tracks for clips going to a new one: their index is out of film.html's range (planOf writes the insert). */
let openedSeq = 0;
function openTrack(d: Draft, clip: EditClip, from: EditTrack, insertAt: number) {
  from.clips = from.clips.filter((c) => c.id !== clip.id);
  d.tracks.push({ index: 1_000_000 + openedSeq++, clips: [clip] });
  d.opened.set(clip.id, insertAt);
}
function moveTo(clip: EditClip, from: EditTrack, to: EditTrack) {
  if (from === to) return;
  from.clips = from.clips.filter((c) => c.id !== clip.id);
  to.clips.push(clip);
  to.clips.sort((x, y) => x.startMs - y.startMs);
}

/**
 * Where a clip moved to `[startMs, endMs)` goes: its own track when it has room there, else the track right beside
 * `against` (above for a picture, below for a sound) when that is free and of its kind, else a new one there.
 */
function landing(d: Draft, clip: EditClip, picture: boolean, against: number, skip: ReadonlySet<string>): void {
  const here = findInDraft(d, clip.id)!;
  if (free(here.track, clip.startMs, clip.endMs, new Set([...skip, clip.id]))) return;
  const side = trackAt(d, picture ? against - 1 : against + 1);
  if (side && !side.locked && (picture ? side.role !== 'audio' : side.role === 'audio') && free(side, clip.startMs, clip.endMs, skip)) {
    moveTo(clip, here.track, side);
    return;
  }
  openTrack(d, clip, here.track, picture ? against : against + 1);
}

/** The clip on another track that `x` is cut against: one ending where `x` started (+ `shiftMs`), of its kind. */
function partnerTrack(d: Draft, facts: FactsOf, x: EditClip, at: number, skip: ReadonlySet<string>): number | null {
  const picture = facts(x.id)?.picture;
  for (const t of d.tracks) {
    for (const c of t.clips) {
      if (skip.has(c.id) || c.id === x.id || facts(c.id)?.picture !== picture) continue;
      if (Math.abs(c.endMs - at) <= EPS) return t.index;
    }
  }
  return null;
}

/** Add a transition at a cut. */
export function planTransition(model: EditModel, facts: FactsOf, kind: TransitionKind, cut: CutRef, durationMs: number, opts: TransitionOpts): TransitionPlan {
  const d = draftOf(model);
  const fades: Fades = new Map();
  const a = cut.a ? findInDraft(d, cut.a) : null;
  const b = cut.b ? findInDraft(d, cut.b) : null;
  if (!a && !b) return { error: 'none' };
  const ms = Math.max(1, Math.round(durationMs));

  /* one clip's fade: a fade preset, or a transition on an edge with no clip against it */
  const fadeEdge = (one: { clip: EditClip }, edge: 'in' | 'out', len: number): TransitionPlan => {
    const touched = atEdge(d, model, one.clip.id, edge, opts);
    if (lockedIn(d, touched.map((c) => c.id))) return { error: 'locked' };
    for (const c of touched) setFade(fades, facts, c, edge, len);
    if (kind !== 'dip-white' || !opts.whiteSrc || !facts(one.clip.id)?.picture) return opsOf(d, fades);
    const len2 = Math.min(len, lengthOf(one.clip));
    const span = edge === 'in' ? { startMs: one.clip.startMs, endMs: one.clip.startMs + len2 } : { startMs: one.clip.endMs - len2, endMs: one.clip.endMs };
    return opsOf(d, fades, [whiteInsert(d, opts.whiteSrc, span, findInDraft(d, one.clip.id)!.track.index)]);
  };
  if (kind === 'fade-in') return fadeEdge((b ?? a)!, 'in', ms);
  if (kind === 'fade-out') return fadeEdge((a ?? b)!, 'out', ms);
  if (!a) return fadeEdge(b!, 'in', ms);
  if (!b) return fadeEdge(a, 'out', ms);

  if (kind === 'dip-black' || kind === 'dip-white') {
    /* half each side of the cut, as far as each clip has room */
    const half = Math.min(ms / 2, lengthOf(a.clip), lengthOf(b.clip));
    const touched = [...atEdge(d, model, a.clip.id, 'out', opts), ...atEdge(d, model, b.clip.id, 'in', opts)];
    if (lockedIn(d, touched.map((c) => c.id))) return { error: 'locked' };
    for (const c of atEdge(d, model, a.clip.id, 'out', opts)) setFade(fades, facts, c, 'out', half);
    for (const c of atEdge(d, model, b.clip.id, 'in', opts)) setFade(fades, facts, c, 'in', half);
    if (kind === 'dip-black' || !opts.whiteSrc) return opsOf(d, fades);
    const lowest = Math.max(a.track.index, b.track.index);
    return opsOf(d, fades, [whiteInsert(d, opts.whiteSrc, { startMs: a.clip.endMs - half, endMs: b.clip.startMs + half }, lowest)]);
  }

  /* an overlap: the incoming clip and those linked to it move d earlier */
  const overlap = Math.min(ms, lengthOf(a.clip), lengthOf(b.clip));
  if (overlap < 1) return { error: 'short' };
  const moving = groupOf(model, b.clip.id, opts).map((id) => findInDraft(d, id)).filter((x): x is { track: EditTrack; clip: EditClip } => Boolean(x));
  const outgoing = atEdge(d, model, a.clip.id, 'out', opts);
  if (lockedIn(d, [...moving.map((m) => m.clip.id), ...outgoing.map((c) => c.id)])) return { error: 'locked' };
  const skip = new Set(moving.map((m) => m.clip.id));
  const cutMs = a.clip.endMs;
  /* each one's track before it moves: what follows the cut on it closes up after it */
  const homes = new Set([a.track.index, ...moving.map((m) => m.track.index)]);
  const incoming = atEdge(d, model, b.clip.id, 'in', opts);
  /* the clip each is cut against (its track is where it overlaps from), then taken off while what follows closes up,
     then put down d earlier where there is room (see landing) */
  const against = new Map(moving.map((m) => [m.clip.id, partnerTrack(d, facts, m.clip, m.clip.startMs, skip) ?? m.track.index]));
  for (const m of moving) m.track.clips = m.track.clips.filter((c) => c.id !== m.clip.id);
  if (opts.ripple) rippleAt(d, cutMs, -overlap, reach(d, homes, opts.sync));
  for (const m of moving) {
    m.clip.startMs -= overlap;
    m.clip.endMs -= overlap;
    m.track.clips.push(m.clip);
    m.track.clips.sort((x, y) => x.startMs - y.startMs);
    landing(d, m.clip, facts(m.clip.id)?.picture ?? true, against.get(m.clip.id)!, skip);
  }
  for (const c of outgoing) setFade(fades, facts, c, 'out', holds(d, facts, c.id, b.clip.id) ? 0 : overlap);
  for (const c of incoming) setFade(fades, facts, c, 'in', overlap);
  return opsOf(d, fades);
}

/** Where a clip's track is, top to bottom (a track this edit opens goes in just above the one at its place). */
function rowOf(d: Draft, id: string): number {
  const opened = d.opened.get(id);
  return opened != null ? opened - 0.5 : findInDraft(d, id)?.track.index ?? 0;
}

/** An outgoing picture under the incoming one stays whole while that one fades in over it. */
const holds = (d: Draft, facts: FactsOf, outgoing: string, incoming: string) =>
  Boolean(facts(outgoing)?.picture && facts(incoming)?.picture && rowOf(d, incoming) < rowOf(d, outgoing));

/** The white page cut in under a dip (`span`), on the track below `above` when it has room, else a new one there. */
function whiteInsert(d: Draft, src: string, span: { startMs: number; endMs: number }, above: number): Op {
  const below = trackAt(d, above + 1);
  const track: TrackDest = below && !below.locked && below.role !== 'audio' && free(below, span.startMs, span.endMs, new Set()) ? below.index : { insert: above + 1 };
  const len = secs(span.endMs - span.startMs);
  return { op: 'insert', clip: { src, time: [0, len], ...(span.startMs > 0 ? { at: secs(span.startMs) } : {}) }, track };
}

/** Take a transition away: its fades go, its clips come back against each other, its white page goes. */
export function planRemoveTransition(model: EditModel, facts: FactsOf, tr: FilmTransition, opts: TransitionOpts): TransitionPlan {
  const d = draftOf(model);
  const fades: Fades = new Map();
  const a = findInDraft(d, tr.a), b = findInDraft(d, tr.b);
  if (!a || !b) return { error: 'none' };
  const outgoing = atEdge(d, model, tr.a, 'out', opts);
  const incoming = atEdge(d, model, tr.b, 'in', opts);
  const extra: Op[] = [];
  if (tr.kind === 'dip-black' || tr.kind === 'dip-white') {
    if (lockedIn(d, [...outgoing, ...incoming].map((c) => c.id)) || (tr.white && lockedIn(d, [tr.white]))) return { error: 'locked' };
    if (tr.white) extra.push({ op: 'remove', clip: tr.white });
  } else {
    const moving = groupOf(model, tr.b, opts).map((id) => findInDraft(d, id)).filter((x): x is { track: EditTrack; clip: EditClip } => Boolean(x));
    if (lockedIn(d, [...moving.map((m) => m.clip.id), ...outgoing.map((c) => c.id)])) return { error: 'locked' };
    const skip = new Set(moving.map((m) => m.clip.id));
    const back = a.clip.endMs - b.clip.startMs;
    /* where each goes back to: against the clip it overlaps, on that one's track */
    const homes = moving.map((m) => ({ m, home: partnerTrack(d, facts, m.clip, m.clip.startMs + back, skip) }));
    const reached = new Set([a.track.index, ...homes.flatMap((h) => (h.home != null ? [h.home] : []))]);
    if (opts.ripple) rippleAt(d, a.clip.endMs, back, reach(d, reached, opts.sync), skip);
    for (const { m, home } of homes) {
      m.clip.startMs += back;
      m.clip.endMs += back;
      const here = findInDraft(d, m.clip.id)!;
      const to = home != null ? trackAt(d, home) : undefined;
      if (to && !to.locked && free(to, m.clip.startMs, m.clip.endMs, skip)) moveTo(m.clip, here.track, to);
      else if (!free(here.track, m.clip.startMs, m.clip.endMs, new Set([...skip, m.clip.id]))) {
        /* no room where it was or where it came from: a track of its own, beside its own */
        openTrack(d, m.clip, here.track, facts(m.clip.id)?.picture ? here.track.index : here.track.index + 1);
      }
    }
  }
  for (const c of outgoing) setFade(fades, facts, c, 'out', 0);
  for (const c of incoming) setFade(fades, facts, c, 'in', 0);
  return opsOf(d, fades, extra);
}

/**
 * A transition made `durationMs` long: an overlap's incoming clips move by the difference (what follows with them,
 * with the magnet on), a dip's fades and white page change; each as far as its clips have room.
 */
export function planResizeTransition(model: EditModel, facts: FactsOf, tr: FilmTransition, durationMs: number, opts: TransitionOpts): TransitionPlan {
  const d = draftOf(model);
  const fades: Fades = new Map();
  const a = findInDraft(d, tr.a), b = findInDraft(d, tr.b);
  if (!a || !b) return { error: 'none' };
  const fa = facts(tr.a)?.fade ?? [0, 0], fb = facts(tr.b)?.fade ?? [0, 0];
  const outgoing = atEdge(d, model, tr.a, 'out', opts);
  const incoming = atEdge(d, model, tr.b, 'in', opts);
  if (tr.kind === 'dip-black' || tr.kind === 'dip-white') {
    const half = Math.max(1, Math.min(Math.round(durationMs) / 2, lengthOf(a.clip) - fa[0], lengthOf(b.clip) - fb[1]));
    if (lockedIn(d, [...outgoing, ...incoming].map((c) => c.id)) || (tr.white && lockedIn(d, [tr.white]))) return { error: 'locked' };
    for (const c of outgoing) setFade(fades, facts, c, 'out', half);
    for (const c of incoming) setFade(fades, facts, c, 'in', half);
    const extra: Op[] = [];
    if (tr.white) {
      const startMs = a.clip.endMs - half;
      extra.push({ op: 'props', edits: [{ clip: tr.white, prop: 'at', value: secs(Math.max(0, startMs)) }, { clip: tr.white, prop: 'end', value: secs(2 * half) }] });
    }
    return opsOf(d, fades, extra);
  }
  const moving = groupOf(model, tr.b, opts).map((id) => findInDraft(d, id)).filter((x): x is { track: EditTrack; clip: EditClip } => Boolean(x));
  if (lockedIn(d, [...moving.map((m) => m.clip.id), ...outgoing.map((c) => c.id)])) return { error: 'locked' };
  const skip = new Set(moving.map((m) => m.clip.id));
  const now = a.clip.endMs - b.clip.startMs;
  /* how far the incoming clips can go earlier: up to what is before each on its track, and both clips' lengths */
  let most = Math.min(lengthOf(a.clip) - fa[0], lengthOf(b.clip) - fb[1]);
  for (const m of moving) {
    const before = m.track.clips.filter((c) => !skip.has(c.id) && c.endMs <= m.clip.startMs + EPS).reduce((end, c) => Math.max(end, c.endMs), 0);
    most = Math.min(most, now + (m.clip.startMs - before));
  }
  const want = Math.max(1, Math.min(Math.round(durationMs), most));
  const delta = want - now;
  if (Math.abs(delta) < 0.5) return { ops: [], shortMs: 0 };
  for (const m of moving) { m.clip.startMs -= delta; m.clip.endMs -= delta; }
  if (opts.ripple) rippleAt(d, a.clip.endMs, -delta, reach(d, [a.track.index], opts.sync), skip);
  for (const c of outgoing) setFade(fades, facts, c, 'out', holds(d, facts, c.id, tr.b) ? 0 : want);
  for (const c of incoming) setFade(fades, facts, c, 'in', want);
  return opsOf(d, fades);
}

/** The white page under a dip to white: white, the stage's size, still. */
export const WHITE_PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>White</title>
<style>html, body { margin: 0; height: 100%; background: #fff; }</style>
</head>
<body>
<script>
/* a still white picture, under a dip to white (OpenFilm Studio's Transitions) */
window.film = { frame() {} };
</script>
</body>
</html>
`;
