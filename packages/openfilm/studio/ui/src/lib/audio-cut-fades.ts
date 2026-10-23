/** Short fades at selected, touching sound clips. No timing, picture or linked clip changes. */
import type { Op } from '../api.ts';
import type { FadeMs } from './clip-fade.ts';
import type { TimelineBlock, TimelineTrack } from './timeline-layout.ts';

type Clip = Pick<TimelineBlock, 'id' | 'clipId' | 'loc' | 'kind' | 'startMs' | 'endMs' | 'silent' | 'off' | 'volume'>;
type Track = Pick<TimelineTrack, 'docIndex' | 'locked'> & { blocks: readonly Clip[] };

/**
 * Both sides of a cut must be selected, audible, audio-only clips on the same unlocked film track. Existing fades
 * stay as they are. Only bare edges get a ramp, in film milliseconds (not rounded to a video frame); short clips
 * share their remaining length between the new ramps. No edits for gaps, overlaps or a selection's outer edges.
 */
export function audioCutFadeOp(tracks: readonly Track[], selected: readonly string[], fades: ReadonlyMap<string, FadeMs> | undefined, ms: number): Op | null {
  if (!Number.isFinite(ms) || ms < 1) return null;
  const pick = new Set(selected);
  const grouped = new Map<number, { locked: boolean; clips: Clip[] }>();
  for (const row of tracks) {
    if (row.docIndex == null) continue;
    const track = grouped.get(row.docIndex) ?? { locked: false, clips: [] };
    track.locked ||= Boolean(row.locked);
    track.clips.push(...row.blocks);
    grouped.set(row.docIndex, track);
  }
  const edits: { clip: string; prop: 'fade'; value: [number, number] }[] = [];
  const eligible = (c: Clip) => Boolean(c.clipId && c.loc && pick.has(c.id) && !c.silent && !c.off && c.volume !== 0
    && ['voice', 'music', 'sfx'].includes(c.kind) && c.endMs > c.startMs);
  for (const track of grouped.values()) {
    if (track.locked) continue;
    const clips = [...track.clips].sort((a, b) => a.startMs - b.startMs);
    const edges = new Map<Clip, Set<0 | 1>>();
    const add = (c: Clip, edge: 0 | 1) => {
      const set = edges.get(c) ?? new Set<0 | 1>();
      set.add(edge);
      edges.set(c, set);
    };
    let earlierEnd = -Infinity;
    for (let i = 1; i < clips.length; i++) {
      if (i > 1) earlierEnd = Math.max(earlierEnd, clips[i - 2]!.endMs);
      const a = clips[i - 1]!, b = clips[i]!;
      if (!eligible(a) || !eligible(b) || Math.abs(a.endMs - b.startMs) > 1) continue;
      /* A long clip on another displayed row can cross this cut on the same film track. */
      if (earlierEnd > b.startMs) continue;
      add(a, 1);
      add(b, 0);
    }
    for (const [c, sides] of edges) {
      const was = fades?.get(c.clipId!) ?? [0, 0];
      const bare = [...sides].filter((edge) => was[edge] === 0);
      if (!bare.length) continue;
      const room = Math.max(0, c.endMs - c.startMs - was[0] - was[1]);
      const ramp = Math.floor(Math.min(ms, room / bare.length));
      if (ramp < 1) continue;
      const value: [number, number] = [was[0] / 1000, was[1] / 1000];
      for (const edge of bare) value[edge] = ramp / 1000;
      edits.push({ clip: c.clipId!, prop: 'fade', value });
    }
  }
  return edits.length ? { op: 'props', edits } : null;
}
