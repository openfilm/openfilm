/**
 * The film as Studio has it: film.html, read through Studio's own API (this page is Studio's, so the API is ours too).
 * The chat reads it when a project opens and when a turn starts and settles (lib/film-changes compares the two), and
 * keeps which file each clip is, so a clip an agent names in its reply gets the icon of what it is.
 */
import React from 'react';
import type { FilmDoc } from './film-changes';

/** how long a read may take before the turn's changes are left unsaid */
const READ_WAIT_MS = 4000;

let clipSrc = new Map<string, string>();
const listeners = new Set<() => void>();

/** The project's film as Studio reads it from its folder; null when it cannot say (no film, one with problems, no answer). */
export async function readStudioFilm(projectId: string): Promise<FilmDoc | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), READ_WAIT_MS);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal: stop.signal });
    if (!res.ok) return null;
    const { doc } = await res.json() as { doc?: FilmDoc | null };
    if (!doc || !Array.isArray(doc.tracks)) return null;
    const next = new Map<string, string>();
    for (const track of doc.tracks) for (const clip of track.clips) if (clip?.id && clip.src) next.set(clip.id, clip.src);
    clipSrc = next;
    for (const listener of listeners) listener();
    return doc;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The file of the clip with this id in the film last read; null when that film has no such clip (or none was read). */
export function useClipSrc(id: string | null): string | null {
  return React.useSyncExternalStore(subscribe, () => (id ? clipSrc.get(id) ?? null : null), () => null);
}
