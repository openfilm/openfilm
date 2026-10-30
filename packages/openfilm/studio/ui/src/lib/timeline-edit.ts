/**
 * Edits that change more than one clip: insert and overwrite, ripple, slip, closing gaps, speed, the main track's
 * magnet and linkage, and linked clips. Each works on a plain model of the tracks (film ms, and each clip's own source
 * ms) and comes back as the operations film.html takes (studio/server/ops.mjs), in one batch: one write, one undo step.
 *
 * Rules every edit here keeps:
 *   · a locked track never changes;
 *   · clips on one track never overlap, and nothing put down cuts what is there: where its time is taken a clip goes
 *     to a new track beside (an overwrite, asked for, is the one exception);
 *   · the main track (the lowest picture track) stays closed up with the magnet on: a clip put on it goes in between,
 *     one deleted or taken off it closes up after it, a trim or a new speed there moves what follows on it;
 *   · with linkage, a clip on another track that rides on a main-track clip (ridesOn) keeps the moment of that clip's
 *     footage it starts at wherever the edit takes the footage, and goes with the clip when it is deleted; carried
 *     into another clip on its track, it goes to a free track nearby;
 *   · a ripple (a ripple delete, a closed gap, an insert, a ripple trim) moves what follows on the tracks edited
 *     alone; other tracks follow only by linkage. `shortMs` says how much time could not be closed.
 *
 * Pure: the timeline draws a plan's `placed` while the hand is still on a clip, and sends its `ops` on release.
 */
import type { Op, PropValue } from '../api.ts';
import type { TimelineTrack } from './timeline-layout';
import { MIN_BLOCK_MS, newTrackSide } from './timeline-drag.ts';
import { frameMs } from './timecode.ts';

/** Clips closer than this are touching: film.html rounds each time alone, to the millisecond. */
export const TOUCH_MS = 1;

/** What an overwrite leaves of a clip shorter than this goes with the rest: a sliver of a frame is not a shot. */
const PIECE_MIN_MS = frameMs(1);

/** A clip as an edit sees it. */
export interface EditClip {
  /** Its id in film.html. */
  id: string;
  startMs: number;
  endMs: number;
  /** The source millisecond it starts at (its in point); 0 for a still. */
  inMs: number;
  /** Source ms per film ms (`speed`); 1 without one. */
  speed: number;
  /** How long its source is, in source ms; Infinity when it has no end (a page holds its last frame). */
  sourceMs: number;
  /** A picture: no source to trim into, any length; its in point stays 0. */
  still?: boolean;
  /**
   * A still's moment at its start, in ms into it as it was first placed (0 until an edit moves its head): what a clip
   * riding on it holds on to (linkage). The edit's own; never written.
   */
  vin?: number;
  /** Its `data-link`: clips sharing one move, trim, split and delete together. */
  link?: string;
}

export interface EditTrack {
  /** Its place in film.html; below 0 for a track an edit opens (see openTrack). */
  index: number;
  /** A track an edit opens: what it was opened for. */
  openKey?: string;
  locked?: boolean;
  /** What the timeline calls it by the clips on it; a sound taken off a video goes to an `audio` one. */
  role?: 'mg' | 'video' | 'audio';
  clips: EditClip[];
}

export type EditModel = readonly EditTrack[];

/**
 * The switches an edit is planned by (lib/timeline-prefs): `magnet` keeps the main track closed up, `linkage`
 * carries what rides on main-track clips with them. Both act on the main track alone.
 */
export interface Switches { magnet: boolean; linkage: boolean }
export const NO_SWITCHES: Switches = { magnet: false, linkage: false };

/** The main track: the lowest picture track (V1), film.html's last track that is not a sound track. */
export function mainTrackOf(model: readonly Pick<EditTrack, 'index' | 'role'>[]): number | null {
  const pictures = model.filter((t) => t.index >= 0 && t.role !== 'audio');
  return pictures.length ? Math.max(...pictures.map((t) => t.index)) : null;
}

/** Whether the magnet acts on a track: the main track alone, unlocked, with the magnet on. */
export function magnetOn(model: EditModel, track: number | null | undefined, magnet: boolean): boolean {
  return magnet && track != null && track === mainTrackOf(model) && !model.find((t) => t.index === track)?.locked;
}

/** The main-track clip a clip starts over (none when it starts in a gap of the main track or past its end). */
export function hostOf(main: Pick<EditTrack, 'clips'>, clip: { startMs: number }): EditClip | null {
  return main.clips.find((c) => clip.startMs >= c.startMs - TOUCH_MS && clip.startMs < c.endMs - TOUCH_MS) ?? null;
}

/**
 * Whether a clip rides on the main track with linkage: it starts over a main-track clip (hostOf) and crosses at most
 * one cut of the main track — a title, a sticker, a sound effect, B-roll over a shot or two. A clip crossing more (a
 * music bed under several shots) belongs to the film's time, not to a shot, and stays where it is.
 */
export function ridesOn(main: Pick<EditTrack, 'clips'>, clip: { startMs: number; endMs: number }): boolean {
  if (!hostOf(main, clip)) return false;
  const cuts = new Set(main.clips.flatMap((c) => [c.startMs, c.endMs]));
  let crossed = 0;
  for (const cut of cuts) if (cut > clip.startMs + TOUCH_MS && cut < clip.endMs - TOUCH_MS) crossed += 1;
  return crossed <= 1;
}

/** Where a track goes: one in film.html, or a new one opened at that place. */
export type TrackDest = number | { insert: number };

/** Where a clip the edit touched ends up, for drawing it before it is written; null: it goes. */
export type Placed = { startMs: number; endMs: number; track: TrackDest } | null;

export interface EditPlan {
  ops: Op[];
  /** By clip id; the halves an edit cuts off a clip are `<id>~b`. */
  placed: Map<string, Placed>;
  /** Time a ripple meant to close but could not, because a clip on a track it reaches is in the way (ms). */
  shortMs: number;
}

/* ── the model, from the timeline's rows ── */

/**
 * The model of a timeline: one track per film.html track (rows spread from one track are joined again), the clips
 * that are written in film.html (a drop not written yet is not one). `links`: clip id → its `data-link`.
 */
export function editModelOf(tracks: readonly TimelineTrack[], links?: ReadonlyMap<string, string>): EditTrack[] {
  const byIndex = new Map<number, EditTrack>();
  for (const row of tracks) {
    if (row.docIndex == null) continue;
    let track = byIndex.get(row.docIndex);
    if (!track) {
      track = { index: row.docIndex, role: row.role, clips: [], ...(row.locked ? { locked: true } : {}) };
      byIndex.set(row.docIndex, track);
    }
    if (row.locked) track.locked = true;
    for (const b of row.blocks) {
      if (!b.clipId || !b.loc) continue;
      const speed = b.speed && b.speed > 0 ? b.speed : 1;
      const still = Boolean(b.anchor?.still);
      const inMs = still ? 0 : b.inMs ?? Math.round((b.anchor?.trimFrom ?? 0) * 1000);
      const srcEnd = inMs + (b.endMs - b.startMs) * speed;
      const sourceMs = still ? Infinity
        : b.sourceDurMs != null ? b.sourceDurMs
          : b.room?.tailMs != null ? srcEnd + b.room.tailMs * speed : Infinity;
      const link = links?.get(b.clipId);
      track.clips.push({
        id: b.clipId, startMs: b.startMs, endMs: b.endMs, inMs, speed, sourceMs,
        ...(still ? { still: true } : {}),
        ...(link ? { link } : {}),
      });
    }
  }
  const out = [...byIndex.values()].sort((a, b) => a.index - b.index);
  for (const track of out) track.clips.sort((a, b) => a.startMs - b.startMs);
  return out;
}

/* ── a draft: the model being changed, and what it was ── */

/** A draft of the model, for edits planned elsewhere on the same terms (lib/transitions). */
export interface Draft {
  before: Map<string, { clip: EditClip; track: number }>;
  tracks: EditTrack[];
  /** Clips going to a track opened by this edit, and where it opens. */
  opened: Map<string, number>;
  /** The right half cut off a clip, by the clip's id. */
  cut: Map<string, EditClip>;
  shortMs: number;
}

/**
 * A track this edit opens, at film.html place `insert`, for clips put there: one per `key` (a new track per track the
 * clips came from, say), with an index of its own below 0 so new tracks never share one by accident.
 */
function openTrack(d: Draft, insert: number, key: string, role?: EditTrack['role']): EditTrack {
  const name = `${insert}:${key}`;
  const found = d.tracks.find((t) => t.index < 0 && t.openKey === name);
  if (found) return found;
  const track: EditTrack = { index: Math.min(0, ...d.tracks.map((t) => t.index)) - 1, clips: [], openKey: name, ...(role ? { role } : {}) };
  d.tracks.push(track);
  return track;
}

function draftOf(model: EditModel): Draft {
  const before = new Map<string, { clip: EditClip; track: number }>();
  const tracks = model.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) }));
  for (const t of model) for (const c of t.clips) before.set(c.id, { clip: c, track: t.index });
  return { before, tracks, opened: new Map(), cut: new Map(), shortMs: 0 };
}

const lenOf = (c: EditClip): number => c.endMs - c.startMs;
const srcEndOf = (c: EditClip): number => c.inMs + lenOf(c) * c.speed;
/** How far the head can still be pulled out, in film ms. */
const headRoomOf = (c: EditClip): number => (c.still ? Infinity : Math.max(0, c.inMs / c.speed));
/** How far the tail can still be pulled out, in film ms. */
const tailRoomOf = (c: EditClip): number => (
  c.still || !Number.isFinite(c.sourceMs) ? Infinity : Math.max(0, (c.sourceMs - srcEndOf(c)) / c.speed)
);

/**
 * How much more of its source a clip can show at one edge, in film ms: how far that edge can still be pulled out.
 * Infinity for a still or a source with no end; undefined for a clip not in the model.
 */
export function sourceLeftMs(model: EditModel, id: string, edge: 'start' | 'end'): number | undefined {
  const c = model.flatMap((t) => t.clips).find((x) => x.id === id);
  if (!c) return undefined;
  return edge === 'start' ? headRoomOf(c) : tailRoomOf(c);
}

function trackAt(d: Draft, index: number): EditTrack | undefined {
  return d.tracks.find((t) => t.index === index);
}

function find(d: Draft, id: string): { track: EditTrack; clip: EditClip } | null {
  for (const track of d.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

/** The head moved to `ms`: the in point follows (a still keeps 0, its moment moves: `vin`). */
function setStart(c: EditClip, ms: number): void {
  if (!c.still) c.inMs = Math.max(0, c.inMs + (ms - c.startMs) * c.speed);
  else c.vin = (c.vin ?? 0) + (ms - c.startMs);
  c.startMs = ms;
}

function shiftClip(c: EditClip, ms: number): void {
  c.startMs += ms;
  c.endMs += ms;
}

/**
 * The tracks a ripple moves and those whose room limits it: the unlocked tracks edited, both (other tracks follow
 * only by linkage, see carry).
 */
function follow(d: Draft, edited: Iterable<number>): { tracks: number[]; bound: number[] } {
  const own = new Set(edited);
  const tracks = d.tracks.filter((t) => !t.locked && own.has(t.index)).map((t) => t.index);
  return { tracks, bound: tracks };
}

/**
 * How far left what starts at or after `point` on a track can go before it meets what stays (what starts before it).
 * Infinity when nothing starts after it.
 */
function roomBefore(track: EditTrack, point: number, skip?: ReadonlySet<string>): number {
  let floor = 0;
  let first = Infinity;
  for (const c of track.clips) {
    if (skip?.has(c.id)) continue;
    if (c.startMs >= point - TOUCH_MS) first = Math.min(first, c.startMs);
    else floor = Math.max(floor, c.endMs);
  }
  return Number.isFinite(first) ? Math.max(0, first - floor) : Infinity;
}

/**
 * Move what starts at or after `point` by `deltaMs` on these tracks. Leftwards, the tracks in `bound` (those edited)
 * go only as far as every one of them has room, and the time that could not be closed is added to `shortMs`; each
 * other track goes as far as that, or as far as its own room allows. Returns the shift made on the bound tracks;
 * `moved`, when given, gets each track's.
 */
function rippleAt(
  d: Draft,
  point: number,
  deltaMs: number,
  tracks: readonly number[],
  skip?: ReadonlySet<string>,
  bound: readonly number[] = tracks,
  moved?: Map<number, number>,
): number {
  const rows = tracks.map((i) => trackAt(d, i)).filter((t): t is EditTrack => Boolean(t && !t.locked));
  const limits = rows.filter((t) => bound.includes(t.index));
  let amount = deltaMs;
  if (amount < 0) {
    /* nothing edited to close: nothing moves */
    if (!limits.length) return 0;
    const room = Math.min(...limits.map((t) => roomBefore(t, point, skip)));
    if (-amount > room) {
      d.shortMs += -amount - room;
      amount = -room;
    }
  }
  if (!amount) return 0;
  for (const t of rows) {
    const by = amount < 0 && !limits.includes(t) ? Math.max(amount, -roomBefore(t, point, skip)) : amount;
    if (!by) continue;
    moved?.set(t.index, by);
    for (const c of t.clips) {
      if (!skip?.has(c.id) && c.startMs >= point - TOUCH_MS) shiftClip(c, by);
    }
  }
  return amount;
}

/**
 * Close spans of time taken off tracks (`byTrack`): each track its own, from its last span back, so closing one does
 * not move the ones before it. Returns the shifts made, for mapping a time from before to after (see mapThrough).
 */
interface Shift { point: number; byTrack: ReadonlyMap<number, number> }
function closeSpans(d: Draft, byTrack: ReadonlyMap<number, { startMs: number; endMs: number }[]>): Shift[] {
  const shifts: Shift[] = [];
  for (const [track, spans] of byTrack) {
    if (!trackAt(d, track) || trackAt(d, track)!.locked) continue;
    for (const span of mergeSpans(spans).reverse()) {
      const moved = new Map<number, number>();
      rippleAt(d, span.endMs, -(span.endMs - span.startMs), [track], undefined, [track], moved);
      if (moved.size) shifts.push({ point: span.endMs, byTrack: moved });
    }
  }
  return shifts;
}

function mergeSpans(spans: readonly { startMs: number; endMs: number }[]): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.startMs - b.startMs)) {
    const last = out.at(-1);
    if (last && s.startMs <= last.endMs + TOUCH_MS) last.endMs = Math.max(last.endMs, s.endMs);
    else if (s.endMs > s.startMs) out.push({ ...s });
  }
  return out;
}

/** A time from before some shifts, after them, on one track: inside a closed span it lands where the span closed to. */
function mapThrough(ms: number, track: number, shifts: readonly Shift[]): number {
  let at = ms;
  for (const s of shifts) {
    const amount = s.byTrack.get(track);
    if (!amount) continue;
    if (at >= s.point - TOUCH_MS) at += amount;
    else if (amount < 0 && at > s.point + amount) at = s.point + amount;
  }
  return at;
}

/** Cut a clip in two at `ms`: the right half is a new clip (`<id>~b`) right after it. */
function cutAt(d: Draft, track: EditTrack, c: EditClip, ms: number): EditClip | null {
  if (!(ms > c.startMs + TOUCH_MS && ms < c.endMs - TOUCH_MS) || d.cut.has(c.id)) return null;
  const right: EditClip = { ...c, id: `${c.id}~b` };
  setStart(right, ms);
  c.endMs = ms;
  track.clips.push(right);
  d.cut.set(c.id, right);
  return right;
}

/**
 * Take [a, b) off a track: what lies inside goes, what reaches into it is trimmed back, what spans it is cut in two.
 * A piece shorter than a frame goes too. With `only`, just those clips (the rest of the track stays as it is).
 */
function clearRange(d: Draft, track: EditTrack, a: number, b: number, skip?: ReadonlySet<string>, only?: ReadonlySet<string>): void {
  for (const c of [...track.clips]) {
    if (skip?.has(c.id) || (only && !only.has(c.id)) || c.endMs <= a + TOUCH_MS || c.startMs >= b - TOUCH_MS) continue;
    if (c.startMs < a && c.endMs > b) {
      /* spanning it: cut in two, unless one side would be a sliver (then that side goes) */
      const keepLeft = a - c.startMs >= PIECE_MIN_MS;
      const keepRight = c.endMs - b >= PIECE_MIN_MS;
      if (keepLeft && keepRight) cutAt(d, track, c, b);
      if (keepLeft) c.endMs = a;
      else if (keepRight) setStart(c, b);
      else c.endMs = c.startMs;
    } else if (c.startMs < a) {
      c.endMs = a;
    } else if (c.endMs > b) {
      setStart(c, b);
    } else {
      c.endMs = c.startMs;
    }
    if (lenOf(c) < PIECE_MIN_MS) track.clips.splice(track.clips.indexOf(c), 1);
  }
}

/**
 * An overwrite of [a, b) on these tracks takes the same time off the clips linked to what it covers there (a video's
 * detached sound), on their own tracks: no sound is left under a picture that is gone. Other clips on those tracks,
 * and locked tracks, stay. Called before the tracks themselves are cleared.
 */
function clearLinked(d: Draft, tracks: readonly number[], a: number, b: number, skip?: ReadonlySet<string>): void {
  const links = new Set<string>();
  for (const t of d.tracks) {
    if (!tracks.includes(t.index)) continue;
    for (const c of t.clips) {
      if (c.link && !skip?.has(c.id) && c.endMs > a + TOUCH_MS && c.startMs < b - TOUCH_MS) links.add(c.link);
    }
  }
  if (!links.size) return;
  for (const t of d.tracks) {
    if (t.locked || tracks.includes(t.index)) continue;
    const only = new Set(t.clips.filter((c) => c.link && links.has(c.link) && !skip?.has(c.id)).map((c) => c.id));
    if (only.size) clearRange(d, t, a, b, skip, only);
  }
}

/**
 * The right halves an edit cut off linked clips: those cut together (a picture and its sound) are linked to each
 * other with a link of their own, as the left halves stay linked; a half cut alone is linked to nothing, or it would
 * pull the clips its left half is linked to along.
 */
function relinkCuts(d: Draft): void {
  const now = new Set(d.tracks.flatMap((t) => t.clips));
  const byLink = new Map<string, EditClip[]>();
  for (const right of d.cut.values()) {
    if (!right.link || !now.has(right)) continue;
    byLink.set(right.link, [...(byLink.get(right.link) ?? []), right]);
  }
  if (!byLink.size) return;
  const taken = new Set([...d.before.values()].flatMap((x) => (x.clip.link ? [x.clip.link] : [])));
  for (const [link, halves] of byLink) {
    let fresh: string | undefined;
    if (halves.length > 1) {
      fresh = `${link}-b`;
      for (let n = 2; taken.has(fresh); n++) fresh = `${link}-b-${n}`;
      taken.add(fresh);
    }
    for (const right of halves) {
      if (fresh) right.link = fresh;
      else delete right.link;
    }
  }
}

/* ── linkage: what rides on the main track ── */

/** A clip's moment of its footage at film ms `ms`: source ms, or for a still ms into it. */
const momentAt = (c: EditClip, ms: number): number => (
  c.still ? (c.vin ?? 0) + (ms - c.startMs) : c.inMs + (ms - c.startMs) * c.speed
);

/** Where on the film a clip shows a moment of its footage now; null when it does not show it (trimmed away). */
function filmAtMoment(c: EditClip, at: number): number | null {
  const ms = c.still ? c.startMs + (at - (c.vin ?? 0)) : c.startMs + (at - c.inMs) / c.speed;
  return ms >= c.startMs - TOUCH_MS && ms < c.endMs - TOUCH_MS ? ms : null;
}

/** A clip riding on a main-track clip: which one, and the moment of its footage the rider starts at. */
export interface Ride { host: string; at: number }

/**
 * The clips riding on the main track as the film was (ridesOn), on unlocked tracks, but those in `skip` (the clips in
 * hand: they go where the hand puts them).
 */
function ridesOf(d: Draft, main: number | null, skip: ReadonlySet<string> = new Set()): Map<string, Ride> {
  const out = new Map<string, Ride>();
  if (main == null || trackAt(d, main)?.locked) return out;
  const was = [...d.before.values()];
  const mainWas = { clips: was.filter((x) => x.track === main).map((x) => x.clip) };
  for (const { clip, track } of was) {
    if (track === main || skip.has(clip.id) || trackAt(d, track)?.locked || !ridesOn(mainWas, clip)) continue;
    const host = hostOf(mainWas, clip)!;
    out.set(clip.id, { host: host.id, at: momentAt(host, clip.startMs) });
  }
  return out;
}

const overlap = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean => (
  a.startMs < b.endMs - TOUCH_MS && a.endMs > b.startMs + TOUCH_MS
);

/**
 * The riders put back on their moments after an edit: each goes where its main-track clip now shows the moment it
 * started at (with the clip, when the clip moved; after a cut, with the half that shows it). One whose clip is gone
 * goes too with `dropWithHost` (a delete), else stays; one whose moment is trimmed away stays. Riders carried into
 * another clip on their track go to a free track nearby (settle).
 */
function carry(d: Draft, rides: ReadonlyMap<string, Ride>, dropWithHost = false): void {
  if (!rides.size) return;
  const live = (c: EditClip | undefined): c is EditClip => Boolean(c && d.tracks.some((t) => t.clips.includes(c)));
  const moved = new Set<EditClip>();
  for (const [id, ride] of rides) {
    const at = find(d, id);
    if (!at || at.track.locked) continue;
    const pieces = [find(d, ride.host)?.clip, d.cut.get(ride.host)].filter(live);
    if (!pieces.length) {
      if (dropWithHost) at.track.clips.splice(at.track.clips.indexOf(at.clip), 1);
      continue;
    }
    let to: number | null = null;
    for (const p of pieces) if (to == null) to = filmAtMoment(p, ride.at);
    if (to == null || Math.abs(Math.max(0, to) - at.clip.startMs) < 0.5) continue;
    shiftClip(at.clip, Math.max(0, to) - at.clip.startMs);
    moved.add(at.clip);
  }
  if (moved.size) settle(d, moved);
}

/**
 * Clips an edit carried into another clip on their track (linkage) go to another track: the one carried goes, the
 * one that stayed stays. Where: the nearest unlocked track of their kind (picture or sound) with room, not the main
 * track; else a new track beside theirs (newTrackSide).
 */
function settle(d: Draft, moved: ReadonlySet<EditClip>): void {
  const main = mainTrackOf(d.tracks);
  for (const t of [...d.tracks]) {
    if (t.index < 0 || t.locked || t.index === main) continue;
    const kept: EditClip[] = [];
    for (const c of [...t.clips].sort((a, b) => a.startMs - b.startMs)) {
      const hits = kept.filter((k) => overlap(k, c));
      const going = moved.has(c) ? (hits.length ? [c] : []) : hits.filter((h) => moved.has(h));
      for (const x of going) {
        t.clips.splice(t.clips.indexOf(x), 1);
        if (kept.includes(x)) kept.splice(kept.indexOf(x), 1);
        relocate(d, t, x, main);
      }
      if (!going.includes(c)) kept.push(c);
    }
  }
}

function relocate(d: Draft, from: EditTrack, c: EditClip, main: number | null): void {
  const sound = (t: EditTrack) => t.role === 'audio';
  const free = d.tracks
    .filter((t) => t !== from && t.index >= 0 && t.index !== main && !t.locked && sound(t) === sound(from))
    .filter((t) => !t.clips.some((x) => overlap(x, c)))
    .sort((a, b) => {
      const away = Math.abs(a.index - from.index) - Math.abs(b.index - from.index);
      return away || (sound(from) ? b.index - a.index : a.index - b.index);
    })[0];
  if (free) {
    free.clips.push(c);
    return;
  }
  const insert = newTrackSide(from.index, from.role);
  d.opened.set(c.id, insert);
  let n = 0;
  let opened = openTrack(d, insert, `settle-${from.index}-${n}`, from.role);
  while (opened.clips.some((x) => overlap(x, c))) opened = openTrack(d, insert, `settle-${from.index}-${++n}`, from.role);
  opened.clips.push(c);
}

/* ── the plan: what changed, as film.html's operations ── */

const sec = (ms: number): number => Math.round(ms) / 1000;

/** The source end film.html writes (`#t=in,end`); a still's is its length. */
const writtenEnd = (c: EditClip): number => (c.still ? lenOf(c) : Math.min(srcEndOf(c), c.sourceMs));

/** The fields of a clip that changed from `was` to `now`, as ops.mjs's props take them. */
function changedFields(was: EditClip, now: EditClip): Record<string, PropValue> {
  const out: Record<string, PropValue> = {};
  if (Math.abs(now.startMs - was.startMs) >= 0.5) out.at = sec(Math.max(0, now.startMs));
  if (!now.still && Math.abs(now.inMs - was.inMs) >= 0.5) out.start = sec(Math.max(0, now.inMs));
  if (Math.abs(writtenEnd(now) - writtenEnd(was)) >= 0.5) out.end = sec(writtenEnd(now));
  if (now.speed !== was.speed) out.speed = now.speed === 1 ? null : now.speed;
  if ((now.link ?? null) !== (was.link ?? null)) out.link = now.link ?? null;
  return out;
}

function planOf(d: Draft): EditPlan {
  relinkCuts(d);
  const ops: Op[] = [];
  const edits: { clip: string; prop: string; value: PropValue }[] = [];
  const removes: Op[] = [];
  const placed = new Map<string, Placed>();
  const now = new Map<string, { clip: EditClip; track: number }>();
  for (const t of d.tracks) for (const c of t.clips) now.set(c.id, { clip: c, track: t.index });
  const destOf = (id: string, track: number): TrackDest => {
    const opened = d.opened.get(id);
    return opened != null ? { insert: opened } : track;
  };
  /*
   * A new track takes one clip as it opens (film.html opens a track per clip moved to `{ insert }`); the others on it
   * move onto it in a second step, by the place it has once all are open: the new tracks open in order of place, each
   * before the track that was there, so the i-th (in that order) is at `insert + i`.
   */
  const fresh = d.tracks.filter((t) => t.index < 0 && t.clips.length)
    .map((t) => ({ t, insert: d.opened.get(t.clips[0]!.id)! }))
    .sort((a, b) => a.insert - b.insert);
  const opener = new Set<string>();
  const joins = new Map<string, number>();
  fresh.forEach(({ t, insert }, i) => {
    const [first, ...rest] = [...t.clips].sort((a, b) => a.startMs - b.startMs);
    opener.add(first!.id);
    for (const c of rest) joins.set(c.id, insert + i);
  });
  const openEdits: { clip: string; prop: string; value: PropValue }[] = [];
  const joinEdits: { clip: string; prop: string; value: PropValue }[] = [];
  for (const [id, was] of d.before) {
    const cur = now.get(id);
    if (!cur) {
      removes.push({ op: 'remove', clip: id });
      placed.set(id, null);
      continue;
    }
    const fields = changedFields(was.clip, cur.clip);
    const dest = destOf(id, cur.track);
    const right = d.cut.get(id);
    if (right && now.has(right.id)) {
      const rightFields = changedFields(was.clip, right);
      ops.push({ op: 'split', clip: id, left: fields, right: rightFields });
      placed.set(id, { startMs: cur.clip.startMs, endMs: cur.clip.endMs, track: dest });
      placed.set(right.id, { startMs: right.startMs, endMs: right.endMs, track: dest });
      continue;
    }
    const moved = typeof dest === 'object' || dest !== was.track;
    if (!Object.keys(fields).length && !moved) continue;
    for (const [prop, value] of Object.entries(fields)) edits.push({ clip: id, prop, value });
    if (joins.has(id)) joinEdits.push({ clip: id, prop: 'track', value: joins.get(id)! });
    else if (opener.has(id)) openEdits.push({ clip: id, prop: 'track', value: dest });
    else if (moved) edits.push({ clip: id, prop: 'track', value: dest });
    placed.set(id, { startMs: cur.clip.startMs, endMs: cur.clip.endMs, track: dest });
  }
  /* the openers in the order the new tracks open (see above) */
  const openOrder = (clip: string) => fresh.findIndex((f) => f.t.clips.some((c) => c.id === clip));
  openEdits.sort((a, b) => openOrder(a.clip) - openOrder(b.clip));
  if (edits.length || openEdits.length) ops.push({ op: 'props', edits: [...edits, ...openEdits] });
  if (joinEdits.length) ops.push({ op: 'props', edits: joinEdits });
  ops.push(...removes);
  return { ops, placed, shortMs: d.shortMs };
}

/* the draft's own steps, for edits planned elsewhere (lib/transitions) */
export { carry, draftOf, find as findInDraft, follow, planOf, ridesOf, rippleAt, trackAt };

/** An edit that changes nothing. */
export function emptyPlan(): EditPlan {
  return { ops: [], placed: new Map(), shortMs: 0 };
}

/* ── linked clips ── */

/** These clips and every clip linked to one of them. */
export function linkedIds(model: EditModel, ids: readonly string[]): string[] {
  const clips = model.flatMap((t) => t.clips);
  const links = new Set(clips.filter((c) => ids.includes(c.id) && c.link).map((c) => c.link));
  const out = new Set(ids);
  for (const c of clips) if (c.link && links.has(c.link)) out.add(c.id);
  return [...out];
}

/** A link value no clip has yet, from `base`. */
export function freshLink(model: EditModel, base: string, taken: ReadonlySet<string> = new Set()): string {
  const used = new Set([...taken, ...model.flatMap((t) => t.clips.flatMap((c) => (c.link ? [c.link] : [])))]);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Link clips: they all get one `data-link`, the first's id (or a link one of them has already, so clips linked before
 * stay with them). Fewer than two clips link nothing.
 */
export function planLink(model: EditModel, ids: readonly string[]): Op[] {
  if (ids.length < 2) return [];
  const clips = model.flatMap((t) => t.clips);
  const picked = ids.map((id) => clips.find((c) => c.id === id)).filter((c): c is EditClip => Boolean(c));
  if (picked.length < 2) return [];
  const others = new Set(clips.filter((c) => !ids.includes(c.id) && c.link).map((c) => c.link!));
  const kept = picked.find((c) => c.link)?.link;
  const link = kept ?? freshLink(model, picked[0]!.id, others);
  const edits = picked.filter((c) => c.link !== link).map((c) => ({ clip: c.id, prop: 'link', value: link }));
  return edits.length ? [{ op: 'props', edits }] : [];
}

/** Unlink clips: their `data-link` goes, and so does the last one's left alone with that link. */
export function planUnlink(model: EditModel, ids: readonly string[]): Op[] {
  const clips = model.flatMap((t) => t.clips);
  const gone = new Set(clips.filter((c) => ids.includes(c.id) && c.link).map((c) => c.id));
  for (const link of new Set(clips.filter((c) => gone.has(c.id)).map((c) => c.link))) {
    const left = clips.filter((c) => c.link === link && !gone.has(c.id));
    if (left.length === 1) gone.add(left[0]!.id);
  }
  return gone.size ? [{ op: 'props', edits: [...gone].map((clip) => ({ clip, prop: 'link', value: null })) }] : [];
}

/* ── gaps ── */

/** The empty stretch of a track around `ms`, between two clips or before the first; null on a clip or after the last. */
export function gapAt(model: EditModel, track: number, ms: number): { startMs: number; endMs: number } | null {
  const clips = model.find((t) => t.index === track)?.clips ?? [];
  if (clips.some((c) => ms >= c.startMs && ms < c.endMs)) return null;
  const startMs = Math.max(0, ...clips.filter((c) => c.endMs <= ms).map((c) => c.endMs));
  const after = clips.filter((c) => c.startMs > ms).map((c) => c.startMs);
  if (!after.length) return null;
  const endMs = Math.min(...after);
  return endMs - startMs > TOUCH_MS ? { startMs, endMs } : null;
}

/** Close a gap: what comes after it on its track moves back (a ripple; with linkage, what rides on it along). */
export function planCloseGap(model: EditModel, track: number, gap: { startMs: number; endMs: number }, sw: Switches = NO_SWITCHES): EditPlan {
  const d = draftOf(model);
  if (trackAt(d, track)?.locked) return emptyPlan();
  const rides = sw.linkage ? ridesOf(d, mainTrackOf(model)) : new Map<string, Ride>();
  closeSpans(d, new Map([[track, [gap]]]));
  carry(d, rides);
  return planOf(d);
}

/** The gaps on a track: before its first clip and between clips (not after the last). */
export function gapsOf(model: EditModel, track: number): { startMs: number; endMs: number }[] {
  const spans: { startMs: number; endMs: number }[] = [];
  let end = 0;
  for (const c of [...(model.find((t) => t.index === track)?.clips ?? [])].sort((x, y) => x.startMs - y.startMs)) {
    if (c.startMs - end > TOUCH_MS) spans.push({ startMs: end, endMs: c.startMs });
    end = Math.max(end, c.endMs);
  }
  return spans;
}

/** Every gap on a track closed at once, as closing each does. Nothing on a locked track. */
export function planCloseTrackGaps(model: EditModel, track: number, sw: Switches = NO_SWITCHES): EditPlan {
  const spans = gapsOf(model, track);
  if (!spans.length || model.find((t) => t.index === track)?.locked) return emptyPlan();
  const d = draftOf(model);
  const rides = sw.linkage ? ridesOf(d, mainTrackOf(model)) : new Map<string, Ride>();
  closeSpans(d, new Map([[track, spans]]));
  carry(d, rides);
  return planOf(d);
}

/** The main track closed up, when its magnet is turned on (planCloseTrackGaps on the main track). */
export function planCloseMainGaps(model: EditModel, sw: Switches): EditPlan {
  const main = mainTrackOf(model);
  return main == null ? emptyPlan() : planCloseTrackGaps(model, main, sw);
}

/* ── delete ── */

/**
 * Delete clips. Without `ripple` they leave a gap (a lift), but on the main track with the magnet, which closes up;
 * with it the time they took closes on each of their tracks (a ripple delete). With linkage what rides on a deleted
 * main-track clip goes with it, and what rides on the clips after it moves with them. Clips on locked tracks stay.
 */
export function planRemove(model: EditModel, ids: readonly string[], opts: { ripple: boolean } & Partial<Switches>): EditPlan {
  const d = draftOf(model);
  const main = mainTrackOf(model);
  const rides = opts.linkage ? ridesOf(d, main, new Set(ids)) : new Map<string, Ride>();
  /* what rides on a deleted main-track clip goes with it (it moves and is deleted with the main track) */
  const deleted = new Set(ids);
  for (const [id, ride] of rides) {
    if (!deleted.has(ride.host)) continue;
    deleted.add(id);
    rides.delete(id);
  }
  const spans = new Map<number, { startMs: number; endMs: number }[]>();
  for (const t of d.tracks) {
    if (t.locked) continue;
    const gone = t.clips.filter((c) => deleted.has(c.id));
    if (!gone.length) continue;
    t.clips = t.clips.filter((c) => !deleted.has(c.id));
    if (!opts.ripple && !(opts.magnet && t.index === main)) continue;
    spans.set(t.index, gone.map((c) => ({ startMs: c.startMs, endMs: c.endMs })));
  }
  if (spans.size) closeSpans(d, spans);
  carry(d, rides);
  return planOf(d);
}

/* ── insert and overwrite: room for clips coming in ── */

export type EditMode = 'insert' | 'overwrite';

/**
 * Where an insert goes on a track: over a clip, before it when over its first half and
 * after it over the second; in a gap, where it was put (`atMs`, kept inside the gap); past the last clip, right after
 * it (so a first clip on an empty track starts at 0). `pointerMs` is where the hand is.
 */
export function insertPointOn(model: EditModel, track: number, pointerMs: number, atMs: number, skip?: ReadonlySet<string>): number {
  const clips = (model.find((t) => t.index === track)?.clips ?? []).filter((c) => !skip?.has(c.id));
  const over = clips.find((c) => pointerMs >= c.startMs && pointerMs < c.endMs);
  if (over) return pointerMs < (over.startMs + over.endMs) / 2 ? over.startMs : over.endMs;
  const lastEnd = Math.max(0, ...clips.map((c) => c.endMs));
  if (pointerMs >= lastEnd) return lastEnd;
  const gapStart = Math.max(0, ...clips.filter((c) => c.endMs <= pointerMs).map((c) => c.endMs));
  const gapEnd = Math.min(...clips.filter((c) => c.startMs > pointerMs).map((c) => c.startMs));
  return Math.min(Math.max(atMs, gapStart), gapEnd);
}

/**
 * Room for clips coming in, `durMs` long from `atMs`, on these tracks: an insert pushes what starts there on, on them
 * (a clip on them that `atMs` falls inside is cut there first, and its rest goes on with them; with linkage, what
 * rides on the main track goes along); an overwrite takes that time off them. The clips themselves are the caller's
 * (insert ops after these).
 */
export function planRoom(
  model: EditModel,
  spans: readonly { track: number; startMs: number; endMs: number }[],
  opts: { mode: EditMode } & Partial<Switches>,
): EditPlan {
  const d = draftOf(model);
  if (spans.some((s) => trackAt(d, s.track)?.locked)) return emptyPlan();
  const rides = opts.linkage ? ridesOf(d, mainTrackOf(model)) : new Map<string, Ride>();
  if (opts.mode === 'overwrite') {
    const dests = spans.map((s) => s.track);
    for (const s of spans) clearLinked(d, dests, s.startMs, s.endMs);
    for (const s of spans) {
      const track = trackAt(d, s.track);
      if (track) clearRange(d, track, s.startMs, s.endMs);
    }
    carry(d, rides);
    return planOf(d);
  }
  if (!spans.length) return planOf(d);
  const at = Math.min(...spans.map((s) => s.startMs));
  const durMs = Math.max(...spans.map((s) => s.endMs)) - at;
  const dests = [...new Set(spans.map((s) => s.track))];
  for (const index of dests) {
    const track = trackAt(d, index)!;
    if (!track) continue;
    for (const c of [...track.clips]) cutAt(d, track, c, at);
  }
  const f = follow(d, dests);
  rippleAt(d, at, durMs, f.tracks, undefined, f.bound);
  carry(d, rides);
  return planOf(d);
}

/* ── moving clips ── */

/** How moved clips go down: `place` never touches what is there (a taken spot opens a track); see planMove. */
export type MoveMode = EditMode | 'place';

export interface MoveSpec extends Partial<Switches> {
  /** The clips in hand, the one grabbed first. */
  ids: readonly string[];
  /** How far they move in time (where they land, after snapping). */
  deltaMs: number;
  /** Where the hand is (film ms, before the move): an insert goes before or after the clip under it. */
  pointerMs: number;
  /** Clips going to another track (an index), or to a new one (`{ insert }`). The rest stay on theirs. */
  to?: ReadonlyMap<string, TrackDest>;
  mode: MoveMode;
}

/**
 * Clips moved. Place: they land where they were let go; on a track where that time is taken they go instead to a new
 * track opened beside it (newTrackSide), so nothing there is cut or moved. Overwrite: they land where they were let go
 * and take that time off the tracks they land on. Insert (⌥): they are lifted out (the time they took closes on their
 * tracks) and go in at the insert point of the track the grabbed one lands on, pushing what comes after on.
 *
 * With the magnet, the main track stays closed up: the time clips leave on it closes, and clips the
 * grabbed one takes onto it go in end to end at the insert point there (a move along it reorders). With linkage what
 * rides on main-track clips stays on their footage (carry). A new track takes clips as they are. Null when a track it
 * would change is locked.
 */
export function planMove(model: EditModel, spec: MoveSpec): (EditPlan & { landMs: number }) | null {
  const d = draftOf(model);
  const ids = spec.ids.filter((id) => d.before.has(id));
  const lead = ids[0];
  if (!lead) return null;
  const hand = new Set(ids);
  const destOf = (id: string): TrackDest => spec.to?.get(id) ?? d.before.get(id)!.track;
  for (const id of ids) {
    const dest = destOf(id);
    if (trackAt(d, d.before.get(id)!.track)?.locked) return null;
    if (typeof dest === 'number' && (!trackAt(d, dest) || trackAt(d, dest)!.locked)) return null;
  }
  const main = mainTrackOf(model);
  const magnet = Boolean(spec.magnet) && magnetOn(model, main, true);
  const rides = spec.linkage ? ridesOf(d, main, hand) : new Map<string, Ride>();
  /* take them off their tracks */
  const lifted = new Map<string, EditClip>();
  const spans = new Map<number, { startMs: number; endMs: number }[]>();
  for (const t of d.tracks) {
    for (const c of t.clips.filter((x) => hand.has(x.id))) {
      lifted.set(c.id, c);
      spans.set(t.index, [...(spans.get(t.index) ?? []), { startMs: c.startMs, endMs: c.endMs }]);
    }
    t.clips = t.clips.filter((c) => !hand.has(c.id));
  }
  const leadWas = d.before.get(lead)!.clip;
  const leadDest = destOf(lead);
  let landMs = Math.max(0, leadWas.startMs + spec.deltaMs);
  /* the group keeps its shape; none goes before 0 */
  const offset = (c: EditClip) => c.startMs - leadWas.startMs;
  const minOffset = Math.min(...[...lifted.values()].map(offset));
  landMs = Math.max(landMs, -minOffset);

  /* the time they leave closes: with ⌥ on every track they left, with the magnet on the main track */
  const closing = spec.mode === 'insert' ? spans
    : magnet && spans.has(main!) ? new Map([[main!, spans.get(main!)!]]) : null;
  const shifts = closing ? closeSpans(d, closing) : [];
  /* they go in between, what follows moving on: with ⌥, or onto the main track with the magnet */
  const insertOn = typeof leadDest === 'number' && (spec.mode === 'insert' || (magnet && leadDest === main)) ? leadDest : null;
  /* onto the main track with the magnet, the clips going there go in end to end (it stays closed up) */
  const packed = insertOn != null && magnet && insertOn === main
    ? [...lifted.values()].filter((c) => destOf(c.id) === main).sort((a, b) => a.startMs - b.startMs)
    : [];
  const startOf = new Map<string, number>();
  const inserted = new Set<string>();
  if (insertOn != null) {
    /* the insert point, worked out on the track as it was (where the hand is), then carried through the lift */
    const point = insertPointOn(model, insertOn, spec.pointerMs, landMs + minOffset, hand);
    const at = Math.max(0, mapThrough(point, insertOn, shifts));
    if (packed.length) {
      let t = at;
      for (const c of packed) {
        startOf.set(c.id, t);
        inserted.add(c.id);
        t += lenOf(c);
      }
      landMs = startOf.get(lead)!;
    } else {
      landMs = Math.max(-minOffset, at - minOffset);
      for (const [id] of lifted) if (typeof destOf(id) === 'number') inserted.add(id);
    }
    const going = [...lifted.values()].filter((c) => inserted.has(c.id));
    const startsIn = going.map((c) => startOf.get(c.id) ?? landMs + offset(c));
    const roomAt = Math.min(...startsIn);
    const durMs = Math.max(...going.map((c, i) => startsIn[i]! + lenOf(c))) - roomAt;
    const dests = packed.length ? [main!] : [...new Set(going.map((c) => destOf(c.id) as number))];
    for (const index of dests) {
      const track = trackAt(d, index);
      if (track) for (const c of [...track.clips]) cutAt(d, track, c, roomAt);
    }
    const f = follow(d, dests);
    rippleAt(d, roomAt, durMs, f.tracks, undefined, f.bound);
  }

  /* put them down */
  for (const c of lifted.values()) {
    const startMs = startOf.get(c.id) ?? landMs + offset(c);
    c.endMs = startMs + lenOf(c);
    c.startMs = startMs;
  }
  /* placing: a track where any of them would overlap a clip left there takes none of them; a new track beside it takes
     them all (they never overlap each other there: the group keeps its shape, one track per track) */
  const taken = new Set<number>();
  if (spec.mode === 'place') {
    for (const [id, c] of lifted) {
      const dest = destOf(id);
      if (typeof dest !== 'number' || inserted.has(id)) continue;
      if ((trackAt(d, dest)?.clips ?? []).some((x) => overlap(x, c))) taken.add(dest);
    }
  }
  for (const [id, c] of lifted) {
    const dest = destOf(id);
    if (typeof dest === 'number' && taken.has(dest)) {
      const side = newTrackSide(dest, trackAt(d, dest)?.role);
      d.opened.set(id, side);
      openTrack(d, side, `beside-${dest}`).clips.push(c);
      continue;
    }
    if (typeof dest === 'object') {
      /* a new track for each track the clips came from: a group keeps its rows */
      d.opened.set(id, dest.insert);
      openTrack(d, dest.insert, `from-${d.before.get(id)!.track}`).clips.push(c);
      continue;
    }
    const track = trackAt(d, dest)!;
    if (spec.mode === 'overwrite' && !inserted.has(id)) {
      clearLinked(d, [dest], c.startMs, c.endMs, hand);
      clearRange(d, track, c.startMs, c.endMs, hand);
    }
    track.clips.push(c);
  }
  carry(d, rides);
  const plan = planOf(d);
  return { ...plan, landMs };
}

/* ── trims ── */

/** One clip's part in a trim: which edge moves (`start` takes the in point along), or the whole clip, or its content. */
export type EdgeKind = 'start' | 'end' | 'shift' | 'slip';
export interface EdgeMove { id: string; kind: EdgeKind }

/**
 * How far an edge can go, both ways: not past its source, not shorter than the shortest clip, not into a neighbor
 * on its track that is not moving along (one that is, the other side of a roll, is not a fence).
 */
function rangeOf(track: EditTrack, c: EditClip, kind: EdgeKind, moving: ReadonlySet<string>): [number, number] {
  let lo = -Infinity;
  let hi = Infinity;
  const others = track.clips.filter((x) => x !== c);
  const prev = others.filter((x) => x.endMs <= c.startMs + TOUCH_MS).sort((a, b) => b.endMs - a.endMs)[0];
  const next = others.filter((x) => x.startMs >= c.endMs - TOUCH_MS).sort((a, b) => a.startMs - b.startMs)[0];
  const fenceStart = prev && !moving.has(`${prev.id}:end`) ? prev.endMs - c.startMs : -c.startMs;
  const fenceEnd = next && !moving.has(`${next.id}:start`) ? next.startMs - c.endMs : Infinity;
  if (kind === 'start') {
    lo = Math.max(-headRoomOf(c), fenceStart);
    hi = Math.max(0, lenOf(c) - MIN_BLOCK_MS);
  } else if (kind === 'end') {
    lo = -Math.max(0, lenOf(c) - MIN_BLOCK_MS);
    hi = Math.min(tailRoomOf(c), fenceEnd);
  } else if (kind === 'shift') {
    lo = fenceStart;
    hi = fenceEnd;
  } else {
    /* the content moves with the hand: dragged right, earlier frames come into the clip */
    if (c.still) return [0, 0];
    lo = Number.isFinite(c.sourceMs) ? -(c.sourceMs - srcEndOf(c)) / c.speed : -Infinity;
    hi = c.inMs / c.speed;
  }
  return [Math.min(lo, 0), Math.max(hi, 0)];
}

function applyEdge(c: EditClip, kind: EdgeKind, ms: number): void {
  if (kind === 'start') setStart(c, c.startMs + ms);
  else if (kind === 'end') c.endMs += ms;
  else if (kind === 'shift') shiftClip(c, ms);
  else c.inMs = Math.max(0, c.inMs - ms * c.speed);
}

/**
 * Edges moved together by one amount, kept to what every one of them allows: a trim (one edge, and the same edge of
 * linked clips), a slip (the content of clips, the inspector's source bar), a shift (clips moved into free time).
 * Moves on locked tracks are left out. With linkage what rides on a main-track clip stays on its footage (a slip moves
 * it, a trim does not).
 */
export function planEdges(model: EditModel, moves: readonly EdgeMove[], deltaMs: number, sw: Switches = NO_SWITCHES): EditPlan & { deltaMs: number } {
  const d = draftOf(model);
  const rides = sw.linkage ? ridesOf(d, mainTrackOf(model), new Set(moves.map((m) => m.id))) : new Map<string, Ride>();
  const live = moves
    .map((m) => ({ m, at: find(d, m.id) }))
    .filter((x): x is { m: EdgeMove; at: { track: EditTrack; clip: EditClip } } => Boolean(x.at && !x.at.track.locked));
  const moving = new Set(live.flatMap(({ m }) => (m.kind === 'shift' ? [`${m.id}:start`, `${m.id}:end`] : [`${m.id}:${m.kind}`])));
  let lo = -Infinity;
  let hi = Infinity;
  for (const { m, at } of live) {
    const [a, b] = rangeOf(at.track, at.clip, m.kind, moving);
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  /* `+ 0`: no -0 from a fence at 0 */
  const amount = (live.length ? Math.min(Math.max(deltaMs, Math.min(lo, 0)), Math.max(hi, 0)) : 0) + 0;
  if (amount) for (const { m, at } of live) applyEdge(at.clip, m.kind, amount);
  carry(d, rides);
  return { ...planOf(d), deltaMs: amount };
}

/**
 * A ripple trim: one edge of these clips (the first is the one in hand, the rest linked to it) moves by `deltaMs` and
 * what comes after follows on their tracks (with linkage, what rides on the main track along). The start edge trims
 * the head and keeps the clip where it starts: it is the clip that gets shorter, and what follows moves
 * back. Shortening stops where the clips' own tracks have no room.
 */
export function planRippleTrim(
  model: EditModel,
  ids: readonly string[],
  edge: 'start' | 'end',
  deltaMs: number,
  sw: Switches = NO_SWITCHES,
): EditPlan & { deltaMs: number } {
  const d = draftOf(model);
  const rides = sw.linkage ? ridesOf(d, mainTrackOf(model), new Set(ids)) : new Map<string, Ride>();
  const parts = ids.map((id) => find(d, id)).filter((x): x is { track: EditTrack; clip: EditClip } => Boolean(x && !x.track.locked));
  const main = parts[0];
  if (!main) return { ...emptyPlan(), deltaMs: 0 };
  /* how much longer each gets (a head pulled left lengthens too) */
  let grow = edge === 'end' ? deltaMs : -deltaMs;
  for (const { clip } of parts) {
    grow = Math.max(grow, -Math.max(0, lenOf(clip) - MIN_BLOCK_MS));
    grow = Math.min(grow, edge === 'end' ? tailRoomOf(clip) : headRoomOf(clip));
  }
  const point = main.clip.endMs;
  const { tracks, bound } = follow(d, parts.map((p) => p.track.index));
  const skip = new Set(parts.map((p) => p.clip.id));
  if (grow < 0) {
    const room = Math.min(...bound.map((i) => roomBefore(trackAt(d, i)!, point, skip)));
    grow = Math.max(grow, -room);
  }
  if (!grow) return { ...planOf(d), deltaMs: 0 };
  for (const { clip } of parts) {
    if (edge === 'start' && !clip.still) clip.inMs = Math.max(0, clip.inMs - grow * clip.speed);
    else if (edge === 'start') clip.vin = (clip.vin ?? 0) - grow;
    clip.endMs += grow;
  }
  rippleAt(d, point, grow, tracks, skip, bound);
  carry(d, rides);
  return { ...planOf(d), deltaMs: edge === 'end' ? grow : -grow };
}

/**
 * Ripple trim to the playhead (Q and W): `start` takes off the head up to `atMs`, `end` the tail from it, and what
 * comes after closes up. Null when `atMs` is not inside the first clip.
 */
export function planRippleTrimTo(model: EditModel, ids: readonly string[], edge: 'start' | 'end', atMs: number, sw: Switches = NO_SWITCHES): EditPlan | null {
  const lead = model.flatMap((t) => t.clips).find((c) => c.id === ids[0]);
  if (!lead || !(atMs > lead.startMs + TOUCH_MS && atMs < lead.endMs - TOUCH_MS)) return null;
  const plan = planRippleTrim(model, ids, edge, edge === 'start' ? atMs - lead.startMs : atMs - lead.endMs, sw);
  return plan.ops.length ? plan : null;
}

/* ── speed ── */

/**
 * A new speed for clips (the first and those linked to it): each keeps its part of the source, so its length on the
 * film changes. With `ripple` what comes after on their tracks follows; without, a clip that would run into the next
 * one cannot get that slow: `slowest` says how slow it can go, and nothing changes. With linkage what rides on a
 * main-track clip stays on its footage.
 *
 * `edge` is the edge that moves (the timeline's speed handles): the end, or, without `ripple`, the start, each clip
 * keeping its end, and then the clip before it is the limit. Rippling, the start stays: what follows moves instead.
 */
export function planSpeed(
  model: EditModel,
  ids: readonly string[],
  speed: number,
  opts: { ripple: boolean; edge?: 'start' | 'end' } & Partial<Switches>,
): EditPlan & { slowest?: number } {
  const d = draftOf(model);
  const rides = opts.linkage ? ridesOf(d, mainTrackOf(model), new Set(ids)) : new Map<string, Ride>();
  const parts = ids.map((id) => find(d, id)).filter((x): x is { track: EditTrack; clip: EditClip } => Boolean(x && !x.track.locked && !x.clip.still));
  const main = parts[0];
  if (!main || !(speed > 0)) return emptyPlan();
  const grow = (c: EditClip) => (lenOf(c) * c.speed) / speed - lenOf(c);
  if (!opts.ripple) {
    const head = opts.edge === 'start';
    const slowest = slowestOf(parts, head);
    if (speed < slowest - 1e-9) return { ...emptyPlan(), slowest: Math.ceil(slowest * 100) / 100 };
    for (const { clip } of parts) {
      if (head) clip.startMs -= grow(clip);
      else clip.endMs += grow(clip);
      clip.speed = speed;
    }
    carry(d, rides);
    return planOf(d);
  }
  const point = main.clip.endMs;
  const by = grow(main.clip);
  const { tracks, bound } = follow(d, parts.map((p) => p.track.index));
  const skip = new Set(parts.map((p) => p.clip.id));
  for (const { clip } of parts) {
    clip.endMs += grow(clip);
    clip.speed = speed;
  }
  rippleAt(d, point, by, tracks, skip, bound);
  carry(d, rides);
  return planOf(d);
}

/**
 * How slow clips can get without a ripple: each grows only into the free time after it (its head: before it, back to
 * the film's start).
 */
function slowestOf(parts: readonly { track: EditTrack; clip: EditClip }[], head: boolean): number {
  let slowest = 0;
  for (const { track, clip } of parts) {
    let free: number;
    if (head) {
      const prev = track.clips.filter((x) => x !== clip && x.endMs <= clip.startMs + TOUCH_MS);
      free = Math.max(0, clip.startMs - Math.max(0, ...prev.map((x) => x.endMs)));
    } else {
      const next = track.clips.filter((x) => x !== clip && x.startMs >= clip.endMs - TOUCH_MS);
      if (!next.length) continue;
      free = Math.max(0, Math.min(...next.map((x) => x.startMs)) - clip.endMs);
    }
    slowest = Math.max(slowest, (lenOf(clip) * clip.speed) / (lenOf(clip) + free));
  }
  return slowest;
}

/**
 * The slowest speed planSpeed takes without a ripple for clips (the first and those linked to it, set together): on
 * the hundredth, up; 0 when none of them has a clip after it. What the inspector's slider shades as out of reach.
 */
export function slowestSpeed(model: EditModel, ids: readonly string[]): number {
  const parts = ids.flatMap((id) => model.flatMap((track) => {
    const clip = track.clips.find((c) => c.id === id);
    return clip && !track.locked && !clip.still ? [{ track, clip }] : [];
  }));
  return Math.ceil(slowestOf(parts, false) * 100) / 100;
}

/* ── where a sound taken off a video goes ── */

/**
 * The track for a video's sound taken apart from it: the first sound track with room for it over `range` (below the
 * video first), else a new one opened under the last sound track (or at the bottom).
 */
export function soundTrackFor(model: EditModel, range: { startMs: number; endMs: number }, fromTrack: number): TrackDest {
  const free = (t: EditTrack) => t.role === 'audio' && !t.locked
    && !t.clips.some((c) => c.startMs < range.endMs - TOUCH_MS && c.endMs > range.startMs + TOUCH_MS);
  const below = model.filter((t) => t.index > fromTrack).find(free) ?? model.find(free);
  if (below) return below.index;
  const sounds = model.filter((t) => t.role === 'audio');
  const last = Math.max(-1, ...model.map((t) => t.index));
  return { insert: sounds.length ? Math.max(...sounds.map((t) => t.index)) + 1 : last + 1 };
}
