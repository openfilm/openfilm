/**
 * The edits the timeline and the Inspector write back to film.html: one property of one clip.
 *
 * A whole object is written (or removed), not a dotted path — film.html edits only know a clip's top-level keys.
 * A box goes through stage-clip's compactBox first, so what follows from the picture is not written.
 */
import type { TimelineBlock } from './timeline-layout';

export type ClipEditValue = number | string | boolean | readonly number[] | Record<string, unknown> | null;

export interface ClipEdit {
  loc: string;
  prop: string;
  value: ClipEditValue;
  from?: number;
}

/** film.html's field names that the inspector calls otherwise, at the start of a refusal */
const FIELD_WORDS: Record<string, string> = { at: 'Start' };

/**
 * A refused clip edit, said for a person: film.html's reader words its problems for an agent (`clip "c1" (a.mp4): #t=2,12
 * ends past the file's length of 10 s (#t= is a part of the file, …)`). The clip's address and the asides go, the
 * media fragment is called the trim, and the first sentence stays, starting with a capital.
 */
export function plainClipRefusal(message: string): string {
  const text = message
    .replace(/^[^:\n]*?\btracks\[\d+\](?:\.clips\[\d+\])?(?: "[^"]*")?:?\s*/, '')
    .replace(/^(?:[\w.-]+:\d+:|clip "[^"]*" \([^)]*\):)\s*/, '')
    .replace(/\s*\([^()]*\)/g, '')
    .split(/\s+—\s+|(?<=\.)\s+/)[0]!
    .replace(/^#t=([^,\s]+),([^\s]+)/, 'the trim $1–$2 s')
    .replace(/^its part of the file\b/, 'the trim')
    .trim();
  if (!text) return message;
  const field = /^([a-z]+)\b/.exec(text)?.[1];
  const named = field && FIELD_WORDS[field] ? `${FIELD_WORDS[field]}${text.slice(field.length)}` : text;
  const sentence = named.charAt(0).toUpperCase() + named.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * Clips on one track do not overlap: a new start (the inspector's) that would put a clip over another on its track
 * takes it to a new track just above, as a drag does. Edits that already say where the clip goes are left as they are.
 *
 * Every clip is checked where the whole batch puts it. Checked against where its neighbors were, three clips slid
 * left together came apart: the second landed on the first's old place and went to a new track, the third after it.
 * A trim (`at` with `start` or `end`) keeps its other edge, and the timeline already stops it at its neighbors.
 */
export function apartOnTracks(edits: ClipEdit[], blocks: readonly Pick<TimelineBlock, 'loc' | 'startMs' | 'endMs'>[]): ClipEdit[] {
  const trackOf = (loc?: string) => (loc ? Number(/^film\.html#(\d+)\./.exec(loc)?.[1] ?? NaN) : NaN);
  const atOf = new Map<string, number>();
  const trimmed = new Set<string>();
  const leaving = new Set<string>();
  for (const e of edits) {
    if (e.prop === 'at' && typeof e.value === 'number') atOf.set(e.loc, e.value * 1000);
    if (e.prop === 'start' || e.prop === 'end') trimmed.add(e.loc);
    if (e.prop === 'track') leaving.add(e.loc);
  }
  const landing = (b: Pick<TimelineBlock, 'loc' | 'startMs' | 'endMs'>) => {
    const at = b.loc ? atOf.get(b.loc) : undefined;
    if (at == null) return { startMs: b.startMs, endMs: b.endMs };
    return { startMs: at, endMs: trimmed.has(b.loc!) ? b.endMs : at + (b.endMs - b.startMs) };
  };
  /* times are kept to the millisecond, a start and a length each rounded alone: clips that touch can overlap by one */
  const TOUCH_MS = 1;
  const out = [...edits];
  for (const e of edits) {
    if (e.prop !== 'at' || typeof e.value !== 'number' || leaving.has(e.loc) || trimmed.has(e.loc)) continue;
    const self = blocks.find((b) => b.loc === e.loc);
    const track = trackOf(e.loc);
    if (!self || !Number.isFinite(track)) continue;
    const me = landing(self);
    const over = blocks.some((b) => {
      if (b === self || !b.loc || leaving.has(b.loc) || trackOf(b.loc) !== track) return false;
      const r = landing(b);
      return me.startMs < r.endMs - TOUCH_MS && me.endMs > r.startMs + TOUCH_MS;
    });
    if (over) out.push({ loc: e.loc, prop: 'track', value: { insert: track } });
  }
  return out;
}
