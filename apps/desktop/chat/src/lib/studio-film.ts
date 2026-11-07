/**
 * The film as Studio has it: film.html, read through Studio's own API (this page is Studio's, so the API is ours too).
 * The chat reads it when a project opens and keeps which file each clip is, so a clip an agent names in its reply gets
 * the icon of what it is.
 */
import React from 'react';
import type { FilmDoc } from 'openfilm/film-doc';

/** how long a read may take before it is given up */
const READ_WAIT_MS = 4000;

let clipSrc = new Map<string, string>();
const listeners = new Set<() => void>();

/** The current project's file-serving URL, passed down by ChatPane after reading Studio's project API. */
export const ProjectFolderContext = React.createContext<string | null>(null);

/** Read the project's clip references and return its file-serving URL, including when film.html is missing. */
export async function readStudioProject(projectId: string): Promise<string | null> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), READ_WAIT_MS);
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, { signal: stop.signal });
    if (!res.ok) return null;
    const { doc, folder } = await res.json() as { doc?: FilmDoc | null; folder?: string };
    const tracks = doc && Array.isArray(doc.tracks) ? doc.tracks : [];
    const next = new Map<string, string>();
    for (const track of tracks) for (const clip of track.clips) if (clip?.id && clip.src) next.set(clip.id, clip.src);
    clipSrc = next;
    for (const listener of listeners) listener();
    return typeof folder === 'string' ? folder : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the person changed in Studio while the agent worked that its writes would have undone, kept by Studio, as a
 * block for the next message to the agent of `conversation` (empty when nothing), and `said`, to call once the agent
 * has the message (its turn started): only then does Studio count it told. Studio gives it once to each agent: to its
 * `openfilm` commands or here, whichever asks first.
 */
export async function keptNote(projectId: string, conversation: string): Promise<{ text: string; said: () => void }> {
  const none = { text: '', said: () => {} };
  try {
    const agent = encodeURIComponent(`app:${conversation}`);
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/kept?agent=${agent}`, { signal: AbortSignal.timeout(READ_WAIT_MS) });
    if (!res.ok) return none;
    const { id, line } = await res.json() as { id?: string; line?: string | null };
    if (!line || !id) return none;
    const said = () => {
      void fetch('/api/kept/said', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {});
    };
    return { text: `\n\n<studio_note>${line}</studio_note>`, said };
  } catch {
    return none;
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
