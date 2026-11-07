/**
 * Cutting a film by its words (the caption inspector's transcript): a caption track's words, each with its time (a cue
 * timed word by word has one a word, `<00:00:01.200>`; one that is not is a single word, its whole time), picked as
 * a stretch of text, and the film's time they take to cut out of it, picture and sound with them. Words picked one
 * after another are one stretch, the silence between two cues with them.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import { cueNodes } from '../../../../src/captions.mjs';
import type { Vtt } from './caption-edits.ts';

export interface TranscriptWord {
  /** the cue it is in */
  cue: string;
  text: string;
  /** seconds */
  start: number;
  end: number;
}

type Node = { type: 'text'; text: string; t?: number | null } | { type: 'tag'; t?: number | null; children: Node[] };

/** Every word of the track, in order: those of a cue timed word by word apart, a cue not timed as one. */
export function transcriptWords(vtt: Vtt): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const c of [...vtt.cues].sort((a, b) => a.start - b.start)) {
    const parts: { t: number; text: string }[] = [];
    const walk = (nodes: Node[], t: number | null) => {
      for (const n of nodes) {
        const at = n.t ?? t;
        if (n.type === 'tag') { walk(n.children, at); continue; }
        const when = at ?? c.start;
        const last = parts.at(-1);
        if (last && last.t === when) last.text += n.text;
        else parts.push({ t: when, text: n.text });
      }
    };
    walk(cueNodes(c.text) as Node[], null);
    const words = parts.filter((p) => p.text.trim());
    words.forEach((p, i) => out.push({
      cue: c.id, text: p.text, start: Math.max(c.start, Math.min(c.end, p.t)),
      end: i + 1 < words.length ? Math.max(c.start, Math.min(c.end, words[i + 1]!.t)) : c.end,
    }));
  }
  return out;
}

/** The film's stretches (ms) the words picked (their places in `words`) take: one for each run of words in a row. */
export function cutOfWords(words: readonly TranscriptWord[], picked: ReadonlySet<number>): { startMs: number; endMs: number }[] {
  const out: { startMs: number; endMs: number }[] = [];
  let run: { startMs: number; endMs: number } | null = null;
  words.forEach((w, i) => {
    if (!picked.has(i)) { run = null; return; }
    if (run) run.endMs = Math.round(w.end * 1000);
    else { run = { startMs: Math.round(w.start * 1000), endMs: Math.round(w.end * 1000) }; out.push(run); }
  });
  return out.filter((r) => r.endMs > r.startMs);
}
