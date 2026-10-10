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
function trackNow(before: Film, after: Film, track: number, moved: Set<string>): { track: number } | { newTrack: number } {
  /** a track known by a clip it kept (one the edit did not touch) */
  const anchored = (t: number) => {
    const anchors = (before.tracks[t]?.clips.map((c) => c.id) ?? []).filter((id) => !moved.has(id));
    if (!anchors.length) return null;
    const i = after.tracks.findIndex((tr) => tr.clips.some((c) => anchors.includes(c.id)));
    return i < 0 ? null : i;
  };
  const findBy = (t: number) => {
    if ((before.tracks[t]?.clips ?? []).some((c) => !moved.has(c.id))) return anchored(t);
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
  /* it went: a new one just below the nearest track above it that is still there */
  for (let t = track - 1; t >= 0; t--) { const i = findBy(t); if (i != null) return { newTrack: i + 1 }; }
  return { newTrack: 0 };
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
  for (const op of ops) {
    if (op.op === 'track') { undo.push({ op: 'track', track: op.track, field: op.field, value: Boolean(before.tracks[op.track]?.[op.field]) }); continue; }
    if (op.op === 'reorder') { undo.push({ op: 'reorder', from: op.to, to: op.from }); continue; }
    if (op.op === 'stage') { const { w, h } = before.stage ?? DEFAULT_STAGE; undo.push({ op: 'stage', w, h }); continue; }
    if (op.op === 'insert') { for (const [id] of now) if (!was.has(id)) ids.add(id); continue; }
    if (op.op === 'props') {
      for (const e of op.edits) {
        if (e.prop === 'trackOrder') {
          const { from, to } = e.value as { from: number; to: number };
          undo.push({ op: 'reorder', from: Math.max(0, Math.min(after.tracks.length - 1, to)), to: from });
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
  /* a track the edit left empty went with its flags; made again, it gets them back (or a muted track would come back
     sounding). Pushed before the op that makes it: the list is reversed below, so they apply right after it */
  const flagsBack = (home: ReturnType<typeof trackNow>, track: number) => {
    if (!('newTrack' in home)) return;
    for (const field of ['locked', 'hidden', 'muted'] as const) {
      if (before.tracks[track]?.[field]) undo.push({ op: 'track', track: home.newTrack, field, value: true });
    }
  };
  for (const id of ids) {
    const old = was.get(id);
    const cur = now.get(id);
    if (!old && cur) { undo.push({ op: 'remove', clip: id }); continue; }
    if (!old) continue;
    const home = trackNow(before, after, old.track, ids);
    if (!cur) { flagsBack(home, old.track); undo.push({ op: 'insert', clip: copy(old.row), ...home }); continue; }
    if (!('track' in home && home.track === cur.track) || (old.row.at ?? 0) !== (cur.row.at ?? 0)) {
      flagsBack(home, old.track);
      undo.push({ op: 'move', clip: id, at: old.row.at ?? 0, ...home });
    }
    const then = old.row as Record<string, unknown>;
    const nowRow = cur.row as Record<string, unknown>;
    const changed = [...new Set([...fieldsOf(old.row), ...fieldsOf(cur.row)])].filter((field) => JSON.stringify(then[field]) !== JSON.stringify(nowRow[field]));
    if (changed.length) undo.push({ op: 'fields', clip: id, fields: Object.fromEntries(changed.map((field) => [field, field in then ? copy(then[field]) : null])) });
  }
  return undo.reverse();
}

