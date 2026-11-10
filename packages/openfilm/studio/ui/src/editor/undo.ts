/**
 * Undo by clip id: the edit that takes the film after an edit back to the film before it, for what that edit touched.
 * Worked out from the two films, not by remembering the files, so undoing puts back one clip without putting back
 * what the agent changed meanwhile.
 */
import type { Clip, Film, Op } from '../api';
import { DEFAULT_STAGE } from '../../../../src/film-doc.mjs';

/** Deep copy of plain JSON. */
const copy = <T,>(v: T): T => structuredClone(v);

/** Where each clip is: its track and its row. */
function index(film: Film) {
  const at = new Map<string, { track: number; row: Clip }>();
  film.tracks.forEach((track, t) => track.clips.forEach((row) => at.set(row.id, { track: t, row })));
  return at;
}

/**
 * Where a track that was at `track` in `before` is in `after`. Tracks have no names: a track is known by the clips it
 * kept. `moved` are the clips the edit touched (they do not say where their track went). Returns its index, or where a
 * new one should go when the edit left it empty and it went.
 */
function trackNow(
  before: Film, after: Film, track: number, moved: Set<string>, destinations: ReadonlyMap<number, number>,
): { track: number } | { newTrack: number; newTrackAttrs?: Record<string, string> } {
  /** A caption file, a known destination, or a clip the track kept identifies it. */
  const anchored = (t: number) => {
    if (destinations.has(t)) return destinations.get(t)!;
    const src = before.tracks[t]?.captions?.src;
    const anchors = (before.tracks[t]?.clips.map((c) => c.id) ?? []).filter((id) => !moved.has(id));
    if (!src && !anchors.length) return null;
    const i = after.tracks.findIndex((tr) => src ? tr.captions?.src === src : tr.clips.some((c) => anchors.includes(c.id)));
    return i < 0 ? null : i;
  };
  const findBy = (t: number) => {
    const fixed = anchored(t);
    if (fixed != null) return fixed;
    /* every clip of it was touched: it is a track holding only its clips (no other track's joined them there), still
       between the same tracks; of several, the one holding most of them (else it went, and any of those is new) */
    const own = before.tracks[t]?.clips.map((c) => c.id) ?? [];
    const others = new Set(before.tracks.flatMap((tr, k) => (k === t ? [] : tr.clips.map((c) => c.id))));
    const fits = (i: number) => {
      if (after.tracks[i].clips.some((c) => others.has(c.id))) return false;
      for (let k = 0; k < before.tracks.length; k++) {
        const j = k === t ? null : anchored(k);
        if (j != null && (k < t ? j >= i : j <= i)) return false;
      }
      return true;
    };
    const homes = after.tracks
      .map((tr, i) => ({ i, mine: tr.clips.filter((c) => own.includes(c.id)).length }))
      .filter((h) => h.mine > 0 && fits(h.i))
      .sort((a, b) => b.mine - a.mine || a.i - b.i);
    return homes.length ? homes[0].i : null;
  };
  const same = findBy(track);
  if (same != null) return { track: same };
  const attrs = before.tracks[track]?.attrs;
  const reopen = (newTrack: number) => ({ newTrack, ...(attrs ? { newTrackAttrs: copy(attrs) } : {}) });
  /* it went: a new one just below the nearest track above it that is still there */
  for (let t = track - 1; t >= 0; t--) { const i = findBy(t); if (i != null) return reopen(i + 1); }
  return reopen(0);
}

/**
 * A track moved back to where it was at `from` in `before`, named by clips (the agent may add or move tracks before
 * the undo): the track by one of its clips, its place by a clip of the track that was right over it (or under it, at
 * the top). Indexes stand in for a track with no clips.
 */
function trackBack(before: Film, from: number): { clip?: string; below?: string; above?: string } {
  const own = before.tracks[from]?.clips[0]?.id;
  const over = before.tracks[from - 1]?.clips[0]?.id;
  const under = from === 0 ? before.tracks[1]?.clips[0]?.id : undefined;
  return { ...(own ? { clip: own } : {}), ...(over ? { below: over } : {}), ...(under ? { above: under } : {}) };
}

/** A clip's fields other than its identity and its place (those go back by a move). */
const fieldsOf = (row: Clip) => Object.keys(row).filter((k) => k !== 'id' && k !== 'at');

/**
 * The edit that takes `after` back to `before`, for the clips and tracks `ops` touched: fields go back one by one, a
 * moved clip goes back to its track and second, a removed one comes back, an added one goes.
 */
export function inverse(before: Film, after: Film, ops: Op[]): Op[] {
  const was = index(before);
  const now = index(after);
  const ids = new Set<string>();
  const undo: Op[] = [];
  /* In a batch that only moves clips between existing tracks and trims or removes them, a moved clip identifies
     its destination even if the overwrite removed every clip originally on that track. */
  const stableIndexes = ops.every((op) => op.op === 'split' || op.op === 'remove'
    || (op.op === 'props' && op.edits.every((e) => e.prop !== 'trackOrder' && (e.prop !== 'track' || typeof e.value === 'number'))));
  const movedTo = new Map<string, number>();
  for (const op of ops) {
    if (op.op === 'track-layout') {
      undo.push({ ...op, from: op.to, to: op.from });
      continue;
    }
    if (op.op === 'track') { undo.push({ op: 'track', track: op.track, field: op.field, value: Boolean(before.tracks[op.track]?.[op.field]) }); continue; }
    if (op.op === 'reorder') {
      undo.push({ op: 'reorder', from: op.to, to: op.from, ...trackBack(before, op.clip ? (was.get(op.clip)?.track ?? op.from) : op.from) });
      continue;
    }
    if (op.op === 'captions') { undo.push({ op: 'uncaptions', src: op.captions.src }); continue; }
    if (op.op === 'uncaptions') {
      const at = before.tracks.findIndex((t) => t.captions?.src === op.src);
      const track = before.tracks[at];
      if (track?.captions) {
        for (const field of ['hidden', 'locked'] as const) if (track[field]) undo.push({ op: 'track', track: at, field, value: true });
        undo.push({ op: 'captions', at, captions: copy(track.captions) });
      }
      continue;
    }
    if (op.op === 'stage') { const { w, h } = before.stage ?? DEFAULT_STAGE; undo.push({ op: 'stage', w, h }); continue; }
    if (op.op === 'keyframes') continue;
    if (op.op === 'insert') { for (const [id] of now) if (!was.has(id)) ids.add(id); continue; }
    if (op.op === 'props') {
      for (const e of op.edits) {
        if (stableIndexes && e.prop === 'track' && typeof e.value === 'number') movedTo.set(e.clip, e.value);
        if (e.prop === 'trackOrder') {
          const { from, to } = e.value as { from: number; to: number };
          undo.push({ op: 'reorder', from: Math.max(0, Math.min(after.tracks.length - 1, to)), to: from, ...trackBack(before, from) });
        } else if (e.prop === 'locked' || e.prop === 'hidden' || e.prop === 'muted') {
          const home = now.get(e.clip);
          const old = was.get(e.clip);
          if (home && old) undo.push({ op: 'track', track: home.track, field: e.prop, value: Boolean(before.tracks[old.track]?.[e.prop]) });
        } else ids.add(e.clip);
      }
      continue;
    }
    ids.add(op.clip);
    if (op.op === 'split') for (const [id] of now) if (!was.has(id)) ids.add(id);
  }
  const destinations = new Map<number, number>();
  for (const [clip, to] of movedTo) {
    const at = now.get(clip);
    if (at) destinations.set(to, at.track);
  }
  /* a track the edit left empty went with its flags; made again, it gets them back (or a muted track would come back
     sounding). Pushed before the op that makes it: the list is reversed below, so they apply right after it */
  const flagsBack = (home: ReturnType<typeof trackNow>, track: number) => {
    if (!('newTrack' in home)) return;
    for (const field of ['locked', 'hidden', 'muted'] as const) {
      if (before.tracks[track]?.[field]) undo.push(goneTrack({ op: 'track', track: home.newTrack, field, value: true }, track));
    }
  };
  /* the ops that make a track the edit left empty again, by the track it was in `before` */
  const gone = new Map<Op, number>();
  const goneTrack = (op: Op, track: number): Op => { gone.set(op, track); return op; };
  for (const id of ids) {
    const old = was.get(id);
    const cur = now.get(id);
    if (!old && cur) { undo.push({ op: 'remove', clip: id }); continue; }
    if (!old) continue;
    const home = trackNow(before, after, old.track, ids, destinations);
    if (!cur) {
      flagsBack(home, old.track);
      const op: Op = { op: 'insert', clip: copy(old.row), ...home };
      undo.push('newTrack' in home ? goneTrack(op, old.track) : op);
      continue;
    }
    if (!('track' in home && home.track === cur.track) || (old.row.at ?? 0) !== (cur.row.at ?? 0)) {
      flagsBack(home, old.track);
      const op: Op = { op: 'move', clip: id, at: old.row.at ?? 0, ...home };
      undo.push('newTrack' in home ? goneTrack(op, old.track) : op);
    }
    const then = old.row as Record<string, unknown>;
    const nowRow = cur.row as Record<string, unknown>;
    const changed = [...new Set([...fieldsOf(old.row), ...fieldsOf(cur.row)])].filter((field) => JSON.stringify(then[field]) !== JSON.stringify(nowRow[field]));
    if (changed.length) undo.push({ op: 'fields', clip: id, fields: Object.fromEntries(changed.map((field) => [field, field in then ? copy(then[field]) : null])) });
  }
  /* the film's keyframes the edit changed (a clip's own, as its motion was set, cut or copied) back as they were */
  const kfBefore = before.keyframes ?? {}, kfAfter = after.keyframes ?? {};
  const kfBack = Object.fromEntries([...new Set([...Object.keys(kfBefore), ...Object.keys(kfAfter)])]
    .filter((n) => kfBefore[n] !== kfAfter[n]).map((n) => [n, kfBefore[n] ?? null]));
  if (Object.keys(kfBack).length) undo.unshift({ op: 'keyframes', set: kfBack });
  return reopenTracks(undo.reverse(), gone);
}

/**
 * A track the edit left empty comes back once, with all of its clips: the first of them opens it (`newTrack`), the
 * others go onto it (`track`), or each would open a track of its own (deleting a whole track's clips and undoing put
 * every clip on a new track). These go last, after what works on tracks still there (their indexes are `after`'s, and
 * a track opened before them would shift them), from the top track down: a `newTrack` is a place among `after`'s
 * tracks, and each track reopened above it moves it down one.
 */
function reopenTracks(ops: Op[], gone: ReadonlyMap<Op, number>): Op[] {
  const out: Op[] = ops.filter((op) => !gone.has(op));
  const byTrack = new Map<number, Op[]>();
  for (const op of ops) {
    const was = gone.get(op);
    if (was != null) byTrack.set(was, [...(byTrack.get(was) ?? []), op]);
  }
  let above = 0;
  for (const was of [...byTrack.keys()].sort((a, b) => a - b)) {
    let at: number | null = null;
    for (const op of byTrack.get(was)!) {
      if (op.op === 'track') { if (at != null) out.push({ ...op, track: at }); continue; }
      if (op.op !== 'insert' && op.op !== 'move') continue;
      const { newTrack, newTrackAttrs, ...rest } = op;
      if (at != null) { out.push({ ...rest, track: at }); continue; }
      at = (newTrack ?? 0) + above;
      out.push({ ...rest, newTrack: at, ...(newTrackAttrs ? { newTrackAttrs } : {}) });
    }
    if (at != null) above += 1;
  }
  return out;
}
