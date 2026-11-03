/**
 * A caption track's edits (SPEC §1 Captions), worked out on its WebVTT as read (src/captions.mjs) and written back
 * whole by the editor (lib/caption-tracks). Times are film seconds. A cue is known by its id: one without gets one
 * (`c1`, `c2`…) as the file is read for editing, so the timeline, the selection and its style rule can name it.
 *
 * Cues on one track never overlap after an edit: a cue moved or stretched into its neighbor cuts that one short, to
 * MIN_CUE_S at least, as the subtitle row's do (lib/subtitle-cues).
 *
 * Its look is the CSS of the file's STYLE: the whole track's in `::cue`, one cue's in `::cue(#id)`.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import { cssRules, cueEscape, cuePlain, vttTime, type Vtt, type VttCue } from '../../../../src/captions.mjs';
import { cutIndex, joinText } from './subtitle-cues.ts';

export type { Vtt, VttCue };

/** The shortest a cue can be made (s). */
export const MIN_CUE_S = 0.1;
/** How long a cue added is, room allowing (s). */
export const NEW_CUE_S = 2;

const round = (s: number) => Math.round(s * 1000) / 1000;
const byStart = (a: VttCue, b: VttCue) => a.start - b.start || a.end - b.end;

/** The file with every cue named (`c<n>`, the lowest free), its cues in time order. */
export function withIds(vtt: Vtt): Vtt {
  const taken = new Set(vtt.cues.map((c) => c.id).filter(Boolean));
  let n = 0;
  const next = () => { do n += 1; while (taken.has(`c${n}`)); taken.add(`c${n}`); return `c${n}`; };
  return { ...vtt, cues: vtt.cues.map((c) => (c.id ? c : { ...c, id: next() })).sort(byStart) };
}

/** An id no cue of the file has. */
export function freshId(vtt: Vtt): string {
  const taken = new Set(vtt.cues.map((c) => c.id));
  let n = vtt.cues.length + 1;
  while (taken.has(`c${n}`)) n += 1;
  return `c${n}`;
}

/** The room a cue has: up to MIN_CUE_S into its neighbors (they are cut short), never before 0. */
function room(cues: readonly VttCue[], i: number, skip: ReadonlySet<string> = new Set()): { lo: number; hi: number } {
  const cue = cues[i]!;
  let lo = 0, hi = Infinity;
  cues.forEach((c, j) => {
    if (j === i || skip.has(c.id)) return;
    if (c.start < cue.start) lo = Math.max(lo, Math.min(c.end, c.start + MIN_CUE_S));
    else hi = Math.min(hi, Math.max(c.start, c.end - MIN_CUE_S));
  });
  return { lo: Math.min(lo, cue.start), hi: Math.max(hi, cue.end) };
}

/** Neighbors a cue now at [start, end) reaches, cut short (the ones in `skip` move with it). */
function cutAround(cues: VttCue[], moved: ReadonlySet<string>): VttCue[] {
  const spans = cues.filter((c) => moved.has(c.id));
  return cues.map((c) => {
    if (moved.has(c.id)) return c;
    let { start, end } = c;
    for (const m of spans) {
      if (end <= m.start || start >= m.end) continue;
      if (start < m.start) end = Math.min(end, m.start);
      else start = Math.max(start, m.end);
    }
    return start === c.start && end === c.end ? c : { ...c, start: round(start), end: round(end) };
  });
}

/** The words' timestamps of a cue, moved with it. */
function shifted(text: string, by: number): string {
  if (!by) return text;
  return text.replace(/<(\d[\d:.]*)>/g, (all, at: string) => {
    const s = timeOf(at);
    return Number.isFinite(s) ? `<${vttTime(Math.max(0, s + by))}>` : all;
  });
}
const timeOf = (text: string) => {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number((m[4] ?? '0').padEnd(3, '0')) / 1000 : NaN;
};

/** One edge of a cue dragged to `at` (s): kept inside its room and at least MIN_CUE_S long; neighbors reached cut short. */
export function retimeCue(vtt: Vtt, id: string, edge: 'start' | 'end', at: number): Vtt {
  const cues = [...vtt.cues].sort(byStart);
  const i = cues.findIndex((c) => c.id === id);
  if (i < 0) return vtt;
  const cue = cues[i]!;
  const { lo, hi } = room(cues, i);
  const next = edge === 'start'
    ? { ...cue, start: round(Math.min(Math.max(at, lo), Math.max(lo, cue.end - MIN_CUE_S))) }
    : { ...cue, end: round(Math.max(Math.min(at, hi), Math.min(hi, cue.start + MIN_CUE_S))) };
  cues[i] = next;
  return { ...vtt, cues: cutAround(cues, new Set([id])).sort(byStart) };
}

/**
 * The cues `ids` moved together by `by` seconds: none before 0, none past what keeps a neighbor MIN_CUE_S long (the
 * whole group stops there); neighbors reached cut short, words moved with their cues.
 */
export function moveCues(vtt: Vtt, ids: ReadonlySet<string>, by: number): Vtt {
  const cues = [...vtt.cues].sort(byStart);
  const moving = cues.filter((c) => ids.has(c.id));
  if (!moving.length || !by) return vtt;
  let lo = -Infinity, hi = Infinity;
  for (const c of moving) {
    const r = room(cues, cues.indexOf(c), ids);
    lo = Math.max(lo, r.lo - c.start);
    hi = Math.min(hi, r.hi - c.end);
  }
  const d = round(Math.min(Math.max(by, lo), hi));
  if (!d) return vtt;
  const moved = cues.map((c) => (ids.has(c.id) ? { ...c, start: round(c.start + d), end: round(c.end + d), text: shifted(c.text, d) } : c));
  return { ...vtt, cues: cutAround(moved, ids).sort(byStart) };
}

/** Where a cue split at `at` would be (inside it, MIN_CUE_S each side). */
export const canSplit = (cue: VttCue, at: number) => at - cue.start >= MIN_CUE_S && cue.end - at >= MIN_CUE_S;

/**
 * A cue cut in two at `at` (s): with timed words, the words said before it on the first; else its text cut where the
 * time is through it (a tagged text loses its tags then). The second half is a new cue, with the first one's settings.
 */
export function splitCue(vtt: Vtt, id: string, at: number): { vtt: Vtt; id: string | null } {
  const cue = vtt.cues.find((c) => c.id === id);
  if (!cue || !canSplit(cue, at)) return { vtt, id: null };
  const stamps = [...cue.text.matchAll(/<(\d[\d:.]*)>/g)].map((m) => ({ index: m.index!, at: timeOf(m[1]!) })).filter((s) => Number.isFinite(s.at));
  const cut = stamps.find((s) => s.at >= at);
  let left: string, right: string;
  if (cut && cut.index > 0) {
    left = cue.text.slice(0, cut.index).trimEnd();
    right = cue.text.slice(cut.index);
  } else {
    const plain = cuePlain(cue.text);
    const k = cutIndex(plain, (at - cue.start) / (cue.end - cue.start)) || Math.ceil(plain.length / 2);
    left = cueEscape(plain.slice(0, k).trim());
    right = cueEscape(plain.slice(k).trim());
  }
  const nid = freshId(vtt);
  const cues = vtt.cues.flatMap((c) => (c.id === id
    ? [{ ...c, end: round(at), text: left || ' ' }, { ...c, id: nid, start: round(at), text: right || ' ' }]
    : [c]));
  return { vtt: { ...vtt, cues: cues.sort(byStart) }, id: nid };
}

/** Two cues as one: from the first's start to the second's end, their words joined. */
export function mergeCues(vtt: Vtt, a: string, b: string): Vtt {
  const one = vtt.cues.find((c) => c.id === a), two = vtt.cues.find((c) => c.id === b);
  if (!one || !two || one === two) return vtt;
  const [first, second] = one.start <= two.start ? [one, two] : [two, one];
  const merged = { ...first, start: Math.min(first.start, second.start), end: Math.max(first.end, second.end), text: joinText(first.text, second.text) };
  return { ...vtt, cues: vtt.cues.filter((c) => c !== second).map((c) => (c === first ? merged : c)) };
}

/** The cues `ids` taken out, and their own style rules with them. */
export function removeCues(vtt: Vtt, ids: ReadonlySet<string>): Vtt {
  let out: Vtt = { ...vtt, cues: vtt.cues.filter((c) => !ids.has(c.id)) };
  for (const id of ids) out = setCueRule(out, `::cue(#${id})`, null);
  return out;
}

/**
 * A new cue at `at` (s) for NEW_CUE_S or up to the next cue or `until` (the film's end: a cue past it is never
 * seen); null when one is there or there is no room.
 */
export function addCue(vtt: Vtt, at: number, text: string, until = Infinity): { vtt: Vtt; id: string } | null {
  if (vtt.cues.some((c) => c.start <= at && at < c.end)) return null;
  const next = Math.min(until, ...vtt.cues.filter((c) => c.start > at).map((c) => c.start));
  const end = Math.min(at + NEW_CUE_S, next);
  if (end - at < MIN_CUE_S) return null;
  const id = freshId(vtt);
  /* settings like its neighbor's before it (its region, its place), so it shows where the others do */
  const near = [...vtt.cues].sort(byStart).filter((c) => c.start <= at).at(-1) ?? vtt.cues[0];
  const cue: VttCue = { id, start: round(at), end: round(end), settings: near?.settings ?? '', text: cueEscape(text) };
  return { vtt: { ...vtt, cues: [...vtt.cues, cue].sort(byStart) }, id };
}

/** A cue's words typed again: plain text (a cue's tags and timestamps go when its words change). */
export function setCueText(vtt: Vtt, id: string, text: string): Vtt {
  return { ...vtt, cues: vtt.cues.map((c) => (c.id === id && cuePlain(c.text) !== text ? { ...c, text: cueEscape(text) || ' ' } : c)) };
}

/** A cue's settings changed (a null value takes one out). */
export function setCueSettings(vtt: Vtt, ids: ReadonlySet<string>, settings: (s: string) => string): Vtt {
  return { ...vtt, cues: vtt.cues.map((c) => (ids.has(c.id) ? { ...c, settings: settings(c.settings) } : c)) };
}

/* ── the look: the STYLE's rules ── */

const norm = (prelude: string) => prelude.replace(/\s+/g, ' ').trim();

/** A rule's declarations, in order (`color: #fff; font-weight: 800` → [['color', '#fff'], …]). */
export function declarationsOf(block: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of block.split(';')) {
    const k = part.indexOf(':');
    if (k > 0) out.push([part.slice(0, k).trim().toLowerCase(), part.slice(k + 1).trim()]);
  }
  return out;
}

/** What the rule `prelude` says (its last declaration of each property), or {} when there is none. */
export function cueRule(vtt: Vtt, prelude: string): Record<string, string> {
  const want = norm(prelude);
  const out: Record<string, string> = {};
  for (const r of cssRules(vtt.styles.join('\n'))) if (norm(r.prelude) === want) for (const [k, v] of declarationsOf(r.block)) out[k] = v;
  return out;
}

/**
 * The rule `prelude` with `set` (a null value takes the property out; `null` for `set` takes the whole rule out). The
 * STYLE is written back as one block, a rule a line; a rule left empty goes.
 */
export function setCueRule(vtt: Vtt, prelude: string, set: Record<string, string | null> | null): Vtt {
  const want = norm(prelude);
  const rules = cssRules(vtt.styles.join('\n'));
  const found = rules.filter((r) => norm(r.prelude) === want);
  if (!found.length && (!set || Object.values(set).every((v) => v == null))) return vtt;
  const merged = new Map(found.flatMap((r) => declarationsOf(r.block)));
  if (set) for (const [k, v] of Object.entries(set)) { if (v == null) merged.delete(k); else merged.set(k, v); }
  else merged.clear();
  const block = [...merged].map(([k, v]) => `${k}: ${v}`).join('; ');
  const kept = rules.filter((r) => !found.includes(r));
  const at = found.length ? rules.indexOf(found[0]!) : -1;
  const line = block ? { prelude: want, block: ` ${block}; ` } : null;
  /* `::cue` first, then the rules for single cues, each where it was */
  const list = [...kept];
  if (line) list.splice(at >= 0 ? Math.min(at, list.length) : want === '::cue' ? 0 : list.length, 0, line);
  const css = list.map((r) => `${norm(r.prelude)} {${r.block.includes('\n') ? r.block : r.block.replace(/^\s*/, ' ').replace(/\s*$/, ' ')}}`).join('\n');
  return { ...vtt, styles: css ? [css] : [] };
}
