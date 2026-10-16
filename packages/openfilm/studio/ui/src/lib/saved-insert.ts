/**
 * A saved group of clips put on the timeline (lib/saved, studio/server/saved.mjs): each of its tracks a new track,
 * the top one at `insertAt` and the others under it in their order, each clip at `atSec` plus its time in the group.
 * Clips linked in the group are linked anew there (a link of their own, not one a clip of the film has).
 *
 * Pure: no React, so `node --test` runs it (lib/saved-insert.test.ts).
 */
import type { Op, SavedGroupClip } from '../api.ts';
import { freshLink, type EditModel } from './timeline-edit.ts';

export function groupInsertOps(clips: readonly SavedGroupClip[], atSec: number, insertAt: number, model: EditModel): Op[] {
  const links = new Map<string, string>();
  const taken = new Set<string>();
  const linkOf = (clip: SavedGroupClip['clip']): string | null => {
    const was = (clip.attrs as Record<string, string> | undefined)?.['data-link'];
    if (!was) return null;
    if (!links.has(was)) { const made = freshLink(model, `saved-${was}`, taken); taken.add(made); links.set(was, made); }
    return links.get(was)!;
  };
  const opened = new Set<number>();
  return [...clips]
    .sort((a, b) => a.track - b.track || a.at - b.at)
    .map(({ track, at, clip }) => {
      const link = linkOf(clip);
      const first = !opened.has(track);
      opened.add(track);
      return {
        op: 'insert' as const,
        clip: clip as never,
        at: Math.round((Math.max(0, atSec) + at) * 1000) / 1000,
        track: first ? { insert: insertAt + track } : insertAt + track,
        ...(link ? { link } : {}),
      };
    });
}

/** Where a group's top track goes for a drop: a new track asked for, above the track dropped on, else on top. */
export function groupInsertAt(track: number | { insert: number } | undefined): number {
  return typeof track === 'object' ? track.insert : typeof track === 'number' ? track : 0;
}
