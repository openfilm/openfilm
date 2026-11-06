/**
 * Transitions, made of what film.html already says: fades (each clip's own `fade`, see lib/clip-fade) and where clips
 * are. Nothing new is written in the file, so an agent reads a transition as two clips that fade.
 *
 *   Cross dissolve   the two shots stay on their track, the incoming one still against the cut: it (with the clips
 *                    linked to it at that edge) is cut d into it, and that head goes over the outgoing clip's last d
 *                    on a track beside, a picture's above (the one right above when it is free there, else a new
 *                    one just above), a sound's below; the rest stays where it was, d shorter, and head and rest are
 *                    linked, one shot. The head fades in over d while the outgoing picture stays whole under it, so
 *                    the two blend (both fading would dip through the black under them); sounds both fade, out and
 *                    in. Every transition's head goes on that one track beside. With `ripple`, what follows the cut
 *                    closes up by d on the tracks it is on, the next transitions' heads along; without it, a gap of
 *                    d is left after the incoming clip.
 *   Audio crossfade  the same, for two sounds (the head on a sound track below).
 *   Dip to black     no clip moves: the outgoing clip fades out over d/2, the incoming one in over d/2. The picture dips
 *                    to what is under them: the stage's black where nothing is.
 *   Dip to white     the same, over a white page (`transitions/white.html`) cut in under the dip, on the track below.
 *   Fade in / out    one clip's fade.
 *   A move           the overlap of a cross dissolve, with no fade on the pictures: the incoming clip comes in by a
 *                    move of its own over d (a push, a wipe, an iris; its style's `motion-cut-in-<name>`, see
 *                    lib/clip-presets withCutMove) while the outgoing one goes out by its pair; the editor writes
 *                    those two with the plan (its `lapMs`). Their sounds cross-fade as a dissolve's do.
 * Dropped on a clip's edge with no clip against it, a cross dissolve or a dip is that clip's fade (a dip to white
 * with its white page under it).
 *
 * The clips linked to a clip go with it (Linked switch; ⌥ for one): their fades at the same edge too. Nothing on a
 * locked track changes: a transition that would change one is refused.
 *
 * On the timeline a transition is found again from the fades (findTransitions): two clips whose fades meet as one of
 * the above made them. Removed, its fades go and its clips come back as they were cut (the incoming clip back against
 * the outgoing one, on its track when there is room, what follows moving back with `ripple`); resized, the clips
 * move and the fades change by the difference.
 *
 * Pure: every plan is film.html's operations, one write and one undo step.
 */
import type { Op, PropValue } from '../api.ts';
import { filmTrackBadges } from './film.ts';
import {
  TOUCH_MS, draftOf, findInDraft, follow, linkedIds, planOf, rippleAt, trackAt,
  type Draft, type EditClip, type EditModel, type EditTrack, type TrackDest,
} from './timeline-edit.ts';

export type TransitionKind = 'dissolve' | 'crossfade' | 'dip-black' | 'dip-white' | 'fade-in' | 'fade-out' | 'move';
/** The kinds that are found again on the timeline (a fade alone is a fade). */
export type FoundKind = 'dissolve' | 'crossfade' | 'dip-black' | 'dip-white' | 'move';

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
  /** Its file (`src` without its fragment): the head of a shot and its rest are one file. */
  src?: string;
  /** The move it comes in by on a cut (its name, how long, ms): the incoming clip of a move. */
  moveIn?: { slug: string; ms: number };
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
  /** A move's name (its library transition's, `motions/move-<it>`). */
  move?: string;
  /** On one track: the rest of the incoming shot, against the cut (`b` is its head, over the cut). */
  rest?: string;
  /** What it is called, when not its kind's name (a move's). */
  label?: string;
}

/** What the timeline asks of the editor: a transition put on a cut, made longer or shorter, or taken away. */
export type TransitionAsk =
  | { kind: 'add'; type: TransitionKind; cut: CutRef; move?: { in: CutPreset; out?: CutPreset } }
  | { kind: 'resize'; key: string; durationMs: number }
  | { kind: 'remove'; key: string };

/** Where a transition is drawn when it is `durationMs` long: a dip around its cut, an overlap ending where it ends. */
export function transitionSpan(tr: FilmTransition, durationMs: number): { startMs: number; endMs: number } {
  if (tr.kind === 'dip-black' || tr.kind === 'dip-white') return { startMs: tr.cutMs - durationMs / 2, endMs: tr.cutMs + durationMs / 2 };
  return { startMs: tr.endMs - durationMs, endMs: tr.endMs };
}

export interface TransitionOpts {
  /** An overlap closes up what follows on its tracks (the main track's magnet), removing one opens it again. */
  ripple: boolean;
  /** Linked clips go with each other (the Linked switch, unless ⌥). */
  linked: boolean;
  /** The white page's path (dip to white). */
  whiteSrc?: string;
}

/** A move's two halves as the library has them (its keyframes' name and body, how long, its easing). */
export interface CutPreset { name: string; body: string; secs: number; ease: string }

/**
 * `lapMs`: how long an overlap's clips overlap now (a move's two halves are as long); `pieces`: each incoming clip cut
 * for it, its head (the clip's own id, over the cut) and its rest (a new id, on its track).
 */
export type TransitionPlan = {
  ops: Op[]; shortMs: number; lapMs?: number; pieces?: { head: string; rest: string }[];
  /** the transition that was on the cut, taken off or made this one (its clips' moves are the editor's to take off) */
  replaced?: { a: string; b: string };
} | { error: 'locked' | 'none' | 'short' };

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
      if (!fb || b.id === a.id || fb.white || fb.picture !== fa.picture || (!(fb.fade[0] > 0) && !fb.moveIn) || used.has(`b:${b.id}`)) continue;
      /* an overlap the incoming clip fades in over: the outgoing one fades out with it, or (a picture under it) stays whole */
      const lap = a.endMs - b.startMs;
      /* or one it comes in over by a move of its own, above the outgoing one */
      const moved = Boolean(fa.picture && fb.moveIn && lap > EPS && tb.index < ta.index && Math.abs(fb.moveIn.ms - lap) <= EPS);
      const overlap = moved || (lap > EPS && tb.index !== ta.index && Math.abs(fb.fade[0] - lap) <= EPS
        && (Math.abs(fa.fade[1] - lap) <= EPS || (fa.picture && fa.fade[1] <= EPS && tb.index < ta.index)));
      const touch = fa.fade[1] > 0 && Math.abs(b.startMs - a.endMs) <= EPS && tb.index === ta.index;
      if (!overlap && !touch) continue;
      let kind: FoundKind = moved ? 'move' : overlap ? (fa.picture ? 'dissolve' : 'crossfade') : 'dip-black';
      const startMs = overlap ? b.startMs : a.endMs - fa.fade[1];
      const endMs = overlap ? a.endMs : b.startMs + fb.fade[0];
      let white: string | undefined;
      if (touch && fa.picture) {
        white = whites.find(({ clip: w }) => Math.abs(w.startMs - startMs) <= EPS && Math.abs(w.endMs - endMs) <= EPS)?.clip.id;
        if (white) kind = 'dip-white';
      }
      used.add(`a:${a.id}`);
      used.add(`b:${b.id}`);
      /* on one track: the incoming shot's rest against the cut, the mark drawn on the outgoing clip's track */
      const rest = overlap ? restOf(model, facts, b)?.clip.id : undefined;
      out.push({
        key: `${a.id}|${b.id}`, kind, a: a.id, b: b.id, startMs, endMs, on: rest ? a.id : overlap ? b.id : a.id, cutMs: a.endMs,
        ...(white ? { white } : {}), ...(moved ? { move: fb.moveIn!.slug } : {}), ...(rest ? { rest } : {}),
      });
      break;
    }
  }
  /* a picture's transition takes the sounds linked to it along: theirs is part of it, not one of its own */
  const linkOf = new Map(clips.map(({ clip }) => [clip.id, clip.link]));
  const pictures = out.filter((x) => facts(x.a)?.picture);
  return out.filter((x) => facts(x.a)?.picture || !pictures.some((p) => linkOf.get(p.a) && linkOf.get(p.a) === linkOf.get(x.a) && linkOf.get(p.b) && linkOf.get(p.b) === linkOf.get(x.b)));
}

/**
 * The clip on another track of the same kind (pictures, sounds) against a clip's edge: one ending where `c` starts
 * (`edge` 'in'), or starting where it ends ('out'). After a transition moved a clip to the track above, its cut with
 * the next one is across two tracks.
 */
function across(model: EditModel, track: EditTrack, c: EditClip, edge: 'in' | 'out'): EditClip | undefined {
  const sound = track.role === 'audio';
  /* not one linked to it: a shot's head over a cut and its rest are one shot */
  return model.filter((t) => t.index !== track.index && !t.locked && (t.role === 'audio') === sound).flatMap((t) => t.clips)
    .find((x) => !(c.link && x.link === c.link) && (edge === 'in' ? Math.abs(x.endMs - c.startMs) : Math.abs(x.startMs - c.endMs)) <= TOUCH_MS);
}

/** The least of an incoming clip left against the cut when its head goes over it (ms): a sliver is no shot. */
const REST_MIN_MS = 40;

/**
 * The clip that carries on from `h` where it ends, cut from the same shot: on another track, starting where `h` ends,
 * of its kind and file, linked to it, its source going on from `h`'s (a still: any). The rest of a one-track
 * transition's incoming clip, `h` its head.
 */
function restOf(model: EditModel, facts: FactsOf, h: EditClip): { clip: EditClip; track: EditTrack } | undefined {
  const fh = facts(h.id);
  if (!fh || !h.link) return undefined;
  const home = model.find((t) => t.clips.some((c) => c.id === h.id))?.index;
  return allClips(model).find(({ clip: r, track }) => {
    if (r.id === h.id || track.index === home || r.link !== h.link || Math.abs(r.startMs - h.endMs) > EPS) return false;
    const fr = facts(r.id);
    if (!fr || fr.picture !== fh.picture || (fh.src != null && fr.src !== fh.src)) return false;
    if (h.still || r.still) return Boolean(h.still && r.still);
    return r.speed === h.speed && Math.abs(r.inMs - (h.inMs + (h.endMs - h.startMs) * h.speed)) <= EPS * Math.max(1, h.speed);
  });
}

/**
 * The heads of the transitions on one track, and the clips going with each at that edge (their sounds' heads): what
 * the timeline folds away (foldHeads).
 */
export function headsOf(model: EditModel, transitions: readonly FilmTransition[]): Set<string> {
  const clips = allClips(model).map(({ clip }) => clip);
  const out = new Set<string>();
  for (const tr of transitions) {
    if (!tr.rest) continue;
    out.add(tr.b);
    const link = clips.find((c) => c.id === tr.b)?.link;
    if (link) for (const c of clips) if (c.link === link && Math.abs(c.startMs - tr.startMs) <= EPS) out.add(c.id);
  }
  return out;
}

/**
 * The timeline's rows with the heads of the transitions on one track folded away: a row holding nothing but heads is
 * drawn as none (each transition shown by its mark on the track it comes in over), the rows numbered as if it were
 * not there.
 */
export function foldHeads<T extends { role: string; captions?: unknown; badge?: string; blocks: readonly { clipId?: string | undefined }[] }>(
  rows: readonly T[], heads: ReadonlySet<string>,
): (T & { folded?: boolean })[] {
  const folded = rows.map((r) => heads.size > 0 && r.blocks.length > 0 && r.blocks.every((b) => b.clipId != null && heads.has(b.clipId)));
  if (!folded.some(Boolean)) return rows as (T & { folded?: boolean })[];
  const badges = filmTrackBadges(rows.filter((_, i) => !folded[i]).map((r) => ({ kind: r.captions ? 'video' : r.role })));
  let k = 0;
  return rows.map((r, i) => (folded[i] ? { ...r, folded: true } : { ...r, badge: badges[k++]! }));
}

/** The cut on track `track` at `ms` (within `tolMs`): the clip ending there and the one starting there (on this track,
    else across tracks), either alone. */
export function cutNear(model: EditModel, track: number, ms: number, tolMs: number): (CutRef & { atMs: number }) | null {
  const row = model.find((t) => t.index === track);
  const clips = row?.clips ?? [];
  const ends = clips.filter((c) => Math.abs(c.endMs - ms) <= tolMs).sort((x, y) => Math.abs(x.endMs - ms) - Math.abs(y.endMs - ms));
  const starts = clips.filter((c) => Math.abs(c.startMs - ms) <= tolMs).sort((x, y) => Math.abs(x.startMs - ms) - Math.abs(y.startMs - ms));
  const a = ends[0], b = starts[0];
  if (a && b && Math.abs(a.endMs - b.startMs) <= TOUCH_MS) return { a: a.id, b: b.id, atMs: b.startMs };
  if (a && (!b || Math.abs(a.endMs - ms) <= Math.abs(b.startMs - ms))) return { a: a.id, b: (row && across(model, row, a, 'out')?.id) ?? null, atMs: a.endMs };
  if (b) return { a: (row && across(model, row, b, 'in')?.id) ?? null, b: b.id, atMs: b.startMs };
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
      const before = t.clips.find((x) => x.id !== c.id && Math.abs(x.endMs - c.startMs) <= TOUCH_MS) ?? across(model, t, c, 'in');
      const after = t.clips.find((x) => x.id !== c.id && Math.abs(x.startMs - c.endMs) <= TOUCH_MS) ?? across(model, t, c, 'out');
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

/** A ripple from a transition's edit, on the tracks it changes (timeline-edit follow). */
function rippleThrough(
  d: Draft,
  point: number,
  deltaMs: number,
  edited: Iterable<number>,
  skip?: ReadonlySet<string>,
): void {
  const f = follow(d, edited);
  rippleAt(d, point, deltaMs, f.tracks, skip, f.bound);
}

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
function opsOf(d: Draft, fades: Fades, extra: Op[] = [], lapMs?: number): { ops: Op[]; shortMs: number; lapMs?: number } {
  const plan = planOf(d);
  const edits = [...fades].map(([clip, [fin, fout]]) => ({ clip, prop: 'fade', value: [secs(fin), secs(fout)] as PropValue }));
  return { ops: [...plan.ops, ...(edits.length ? [{ op: 'props' as const, edits }] : []), ...extra], shortMs: plan.shortMs, ...(lapMs != null ? { lapMs } : {}) };
}

/** A move fades none of its pictures: only the sounds going with them cross-fade. */
const fadesIn = (kind: TransitionKind | FoundKind, facts: FactsOf, id: string) => kind !== 'move' || !facts(id)?.picture;
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
  /* a cut with a transition on one track already: an overlap made this one in its place (its length and fades), else
     that one taken off first, in the same write */
  const there = cut.a && cut.b ? findTransitions(model, facts).find((x) => x.rest && x.a === cut.a && (x.rest === cut.b || x.b === cut.b)) : undefined;
  if (there && (kind === 'dissolve' || kind === 'move' || kind === 'crossfade')) {
    const plan = resizeOneTrack(model, facts, there, durationMs, opts, kind);
    return 'error' in plan ? plan : { ...plan, pieces: [], replaced: { a: there.a, b: there.b } };
  }
  if (there) {
    const off = takeOff(d, model, facts, there, opts, fades);
    if (off) return off;
    cut = { a: there.a, b: there.b };
  }
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
  /* a move wants two pictures */
  if (kind === 'move' && (!a || !b || !facts(a.clip.id)?.picture || !facts(b.clip.id)?.picture)) return { error: 'none' };
  const said = (plan: TransitionPlan): TransitionPlan => ('error' in plan || !there ? plan : { ...plan, replaced: { a: there.a, b: there.b } });
  if (kind === 'fade-in') return said(fadeEdge((b ?? a)!, 'in', ms));
  if (kind === 'fade-out') return said(fadeEdge((a ?? b)!, 'out', ms));
  if (!a) return said(fadeEdge(b!, 'in', ms));
  if (!b) return said(fadeEdge(a, 'out', ms));

  if (kind === 'dip-black' || kind === 'dip-white') {
    /* half each side of the cut, as far as each clip has room */
    const half = Math.min(ms / 2, lengthOf(a.clip), lengthOf(b.clip));
    const touched = [...atEdge(d, model, a.clip.id, 'out', opts), ...atEdge(d, model, b.clip.id, 'in', opts)];
    if (lockedIn(d, touched.map((c) => c.id))) return { error: 'locked' };
    for (const c of atEdge(d, model, a.clip.id, 'out', opts)) setFade(fades, facts, c, 'out', half);
    for (const c of atEdge(d, model, b.clip.id, 'in', opts)) setFade(fades, facts, c, 'in', half);
    if (kind === 'dip-black' || !opts.whiteSrc) return said(opsOf(d, fades));
    const lowest = Math.max(a.track.index, b.track.index);
    return said(opsOf(d, fades, [whiteInsert(d, opts.whiteSrc, { startMs: a.clip.endMs - half, endMs: b.clip.startMs + half }, lowest)]));
  }

  /* an overlap on one track (see the top): each incoming clip cut d into it, its head over the outgoing one's last d
     on a track beside, its rest against the cut, d shorter; with `ripple`, what follows closes up by d */
  const incoming = atEdge(d, model, b.clip.id, 'in', opts);
  const outgoing = atEdge(d, model, a.clip.id, 'out', opts);
  if (lockedIn(d, [...incoming, ...outgoing].map((c) => c.id))) return { error: 'locked' };
  const cutMs = b.clip.startMs;
  const overlap = Math.min(ms, lengthOf(a.clip), ...incoming.map((c) => lengthOf(c) - REST_MIN_MS));
  if (overlap < 1) return { error: 'short' };
  const ids = new Set(incoming.map((c) => c.id));
  if (opts.ripple) {
    const tracks = [a.track.index, ...incoming.map((c) => findInDraft(d, c.id)!.track.index)];
    closeAfter(d, b.clip.endMs, -overlap, [...tracks, ...chainedTracks(model, facts, ids)], tracks, ids, headsAfter(d, model, facts, ids, opts));
  }
  const taken = new Set(allClips(model).map(({ clip }) => clip.id));
  const splits: Op[] = [];
  const pieces: { head: string; rest: string }[] = [];
  for (const x of incoming) {
    const home = findInDraft(d, x.id)!.track;
    const picture = facts(x.id)?.picture ?? true;
    let n = 2;
    while (taken.has(`${x.id}-${n}`)) n++;
    const restId = `${x.id}-${n}`;
    taken.add(restId);
    /* head and rest one shot: linked (as the clip was, else to each other) */
    const link = x.link ?? x.id;
    const rest: EditClip = { ...x, id: restId, startMs: cutMs, endMs: x.endMs - overlap, link, ...(x.still ? {} : { inMs: x.inMs + overlap * x.speed }) };
    splits.push({
      op: 'split', clip: x.id, left: {}, rightId: restId,
      right: { at: secs(cutMs), ...(x.still ? { end: secs(lengthOf(rest)) } : { start: secs(rest.inMs) }), ...(x.link ? {} : { link }) },
    });
    pieces.push({ head: x.id, rest: restId });
    x.startMs = cutMs - overlap;
    x.endMs = cutMs;
    x.link = link;
    home.clips.push(rest);
    home.clips.sort((p, q) => p.startMs - q.startMs);
    /* the head beside the clip it comes in over: a picture's above it, a sound's below */
    const against = partnerTrack(d, facts, x, cutMs, ids) ?? home.index;
    const side = trackAt(d, picture ? against - 1 : against + 1);
    if (side && side !== home && !side.locked && !side.captions && (picture ? side.role !== 'audio' : side.role === 'audio') && free(side, x.startMs, x.endMs, ids)) moveTo(x, home, side);
    else openTrack(d, x, home, picture ? against : against + 1);
  }
  for (const c of outgoing) if (fadesIn(kind, facts, c.id)) setFade(fades, facts, c, 'out', holds(d, facts, c.id, b.clip.id) ? 0 : overlap);
  for (const c of incoming) if (fadesIn(kind, facts, c.id)) setFade(fades, facts, c, 'in', overlap);
  /* the cuts first (each half a copy of the clip), then the heads moved and what follows closed up */
  const plan = opsOf(d, fades, [], overlap);
  return { ...plan, ops: [...splits, ...plan.ops], pieces };
}

/**
 * The heads of the one-track transitions that come in after clips `ids` (each of `ids` their outgoing clip), with the
 * clips going with them at that edge: they lie across those clips' ends, before where a ripple from there starts.
 */
function headsAfter(d: Draft, model: EditModel, facts: FactsOf, ids: ReadonlySet<string>, opts: TransitionOpts): EditClip[] {
  return findTransitions(model, facts).filter((tr) => tr.rest && ids.has(tr.a)).flatMap((tr) => atEdge(d, model, tr.b, 'in', opts));
}

/**
 * What follows `point` closed up (`deltaMs` below 0) or opened (above) on `tracks`, as far as `bound` has room, `skip`
 * staying; the next transitions' heads across the point (`heads`) moved by as much.
 */
function closeAfter(d: Draft, point: number, deltaMs: number, tracks: readonly number[], bound: readonly number[], skip: ReadonlySet<string>, heads: readonly EditClip[]): void {
  const lanes = heads.map((h) => findInDraft(d, h.id)?.track.index).filter((i): i is number => i != null);
  const moved = rippleAt(d, point, deltaMs, [...new Set([...tracks, ...lanes])], new Set([...skip, ...heads.map((h) => h.id)]), bound);
  for (const h of heads) {
    h.startMs += moved;
    h.endMs += moved;
  }
}

/**
 * A one-track transition taken off in a draft: each head back in its rest's place, as long as both, the rest gone,
 * the fades it made gone; what follows opens up again by its length. Null when done, else why not.
 */
function takeOff(d: Draft, model: EditModel, facts: FactsOf, tr: FilmTransition, opts: TransitionOpts, fades: Fades): { error: 'locked' | 'none' } | null {
  const pairs = piecesOf(d, model, facts, tr, opts);
  const outgoing = atEdge(d, model, tr.a, 'out', opts);
  const a = findInDraft(d, tr.a);
  if (!pairs.length || !a) return { error: 'none' };
  if (lockedIn(d, [...pairs.flatMap(({ h, r }) => [h.id, r.id]), ...outgoing.map((c) => c.id)])) return { error: 'locked' };
  const lap = tr.endMs - tr.startMs;
  const rests = new Set(pairs.map(({ r }) => r.id));
  if (opts.ripple) {
    const tracks = [a.track.index, ...pairs.map(({ r }) => findInDraft(d, r.id)!.track.index)];
    closeAfter(d, Math.max(...pairs.map(({ r }) => r.endMs)), lap, [...tracks, ...chainedTracks(model, facts, rests)], tracks,
      new Set([...rests, ...pairs.map(({ h }) => h.id)]), headsAfter(d, model, facts, rests, opts));
  }
  const links = new Map<string, number>();
  for (const { clip } of allClips(model)) if (clip.link) links.set(clip.link, (links.get(clip.link) ?? 0) + 1);
  for (const { h, r } of pairs) {
    const home = findInDraft(d, r.id)!.track;
    home.clips = home.clips.filter((c) => c.id !== r.id);
    const hl = lengthOf(h);
    h.startMs = r.startMs;
    h.endMs = r.endMs + hl;
    moveTo(h, findInDraft(d, h.id)!.track, home);
    /* linked only to its rest: alone again */
    if (h.link === h.id && (links.get(h.id) ?? 0) <= 2) delete h.link;
    const fh = facts(h.id)?.fade ?? [0, 0];
    fades.set(h.id, [fadesIn(tr.kind, facts, h.id) ? 0 : fh[0], facts(r.id)?.fade[1] ?? 0]);
  }
  for (const c of outgoing) if (fadesIn(tr.kind, facts, c.id)) setFade(fades, facts, c, 'out', 0);
  return null;
}

/** A one-track transition's heads (its incoming clip's and those going with it) and each one's rest. */
function piecesOf(d: Draft, model: EditModel, facts: FactsOf, tr: FilmTransition, opts: TransitionOpts): { h: EditClip; r: EditClip }[] {
  return atEdge(d, model, tr.b, 'in', opts).flatMap((h) => {
    const mh = allClips(model).find(({ clip }) => clip.id === h.id)?.clip;
    const rid = mh ? restOf(model, facts, mh)?.clip.id : undefined;
    const r = rid ? findInDraft(d, rid)?.clip : undefined;
    return r ? [{ h, r }] : [];
  });
}

/**
 * The tracks of the clips that come in over `ids` by transitions of their own, and over those in turn (a chain of
 * transitions, each incoming clip a track above the last): what follows a cut closes up or opens on them too, so the
 * next transition keeps its overlap.
 */
function chainedTracks(model: EditModel, facts: FactsOf, ids: ReadonlySet<string>): number[] {
  const all = findTransitions(model, facts);
  const seen = new Set(ids);
  const out = new Set<number>();
  let frontier = [...ids];
  while (frontier.length) {
    const next = all.filter((tr) => frontier.includes(tr.a) && !seen.has(tr.b)).map((tr) => tr.b);
    for (const id of next) {
      seen.add(id);
      const t = model.find((x) => x.clips.some((c) => c.id === id));
      if (t) out.add(t.index);
    }
    frontier = next;
  }
  return [...out];
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
  if (tr.rest) return takeOff(d, model, facts, tr, opts, fades) ?? opsOf(d, fades);
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
    const reached = new Set([a.track.index, ...homes.flatMap((h) => (h.home != null ? [h.home] : [])), ...chainedTracks(model, facts, skip)]);
    if (opts.ripple) rippleThrough(d, a.clip.endMs, back, reached, skip);
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
  for (const c of outgoing) if (fadesIn(tr.kind, facts, c.id)) setFade(fades, facts, c, 'out', 0);
  for (const c of incoming) if (fadesIn(tr.kind, facts, c.id)) setFade(fades, facts, c, 'in', 0);
  return opsOf(d, fades, extra);
}

/**
 * A one-track transition made `durationMs` long and of `kind`: its heads start earlier (or later) by the difference,
 * their rests that much further into the shot, what follows closes up (or opens) by it; the fades of `kind`.
 */
function resizeOneTrack(model: EditModel, facts: FactsOf, tr: FilmTransition, durationMs: number, opts: TransitionOpts, kind: TransitionKind | FoundKind): TransitionPlan {
  const d = draftOf(model);
  const fades: Fades = new Map();
  const a = findInDraft(d, tr.a);
  const pairs = piecesOf(d, model, facts, tr, opts);
  if (!a || !pairs.length) return { error: 'none' };
  const outgoing = atEdge(d, model, tr.a, 'out', opts);
  if (lockedIn(d, [...pairs.flatMap(({ h, r }) => [h.id, r.id]), ...outgoing.map((c) => c.id)])) return { error: 'locked' };
  const fa = facts(tr.a)?.fade ?? [0, 0];
  const lap = tr.endMs - tr.startMs;
  const most = Math.min(lengthOf(a.clip) - (kind === 'move' ? 0 : fa[0]), ...pairs.map(({ r }) => lap + lengthOf(r) - REST_MIN_MS));
  const want = Math.max(1, Math.min(Math.round(durationMs), most));
  const delta = Math.abs(want - lap) < 0.5 ? 0 : want - lap;
  const rests = new Set(pairs.map(({ r }) => r.id));
  if (delta && opts.ripple) {
    const tracks = [a.track.index, ...pairs.map(({ r }) => findInDraft(d, r.id)!.track.index)];
    closeAfter(d, Math.max(...pairs.map(({ r }) => r.endMs)), -delta, [...tracks, ...chainedTracks(model, facts, rests)], tracks,
      new Set([...rests, ...pairs.map(({ h }) => h.id)]), headsAfter(d, model, facts, rests, opts));
  }
  for (const { h, r } of pairs) {
    h.startMs -= delta;
    r.endMs -= delta;
    if (!r.still) r.inMs += delta * r.speed;
  }
  for (const c of outgoing) if (fadesIn(kind, facts, c.id)) setFade(fades, facts, c, 'out', holds(d, facts, c.id, tr.b) ? 0 : want);
  for (const { h } of pairs) {
    if (fadesIn(kind, facts, h.id)) setFade(fades, facts, h, 'in', want);
    /* a dissolve made a move: its picture no longer fades in */
    else if (tr.kind !== kind) setFade(fades, facts, h, 'in', 0);
  }
  return opsOf(d, fades, [], want);
}

/**
 * A transition made `durationMs` long: an overlap's incoming clips move by the difference (what follows with them,
 * with `ripple`), a dip's fades and white page change; each as far as its clips have room.
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
  if (tr.rest) return resizeOneTrack(model, facts, tr, durationMs, opts, tr.kind);
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
  if (opts.ripple) rippleThrough(d, a.clip.endMs, -delta, [a.track.index, ...chainedTracks(model, facts, skip)], skip);
  for (const c of outgoing) if (fadesIn(tr.kind, facts, c.id)) setFade(fades, facts, c, 'out', holds(d, facts, c.id, tr.b) ? 0 : want);
  for (const c of incoming) if (fadesIn(tr.kind, facts, c.id)) setFade(fades, facts, c, 'in', want);
  return opsOf(d, fades, [], want);
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
