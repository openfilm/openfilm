'use client';

/**
 * Merging the lists of turns on the client.
 *
 * A server snapshot and local optimistic entries live side by side; every view must merge them the same way, or
 * a just-created item shows in one place and vanishes in another.
 */
import type { Turn } from '@openfilm/shared';
import { shareListById } from '@/lib/structural-share';

/** Merges the server list with optimistic local entries, so a refresh doesn't wipe a just-created turn. */
export function mergeAssetLists(server: Turn[], local: Turn[]): Turn[] {
  const map = new Map<string, Turn>();
  for (const a of local) map.set(a.id, a);
  for (const a of server) {
    const prev = map.get(a.id);
    map.set(
      a.id,
      prev
        ? {
            ...prev,
            ...a,
            title: a.title || prev.title,
            sessionTitle: a.sessionTitle || prev.sessionTitle,
            prompt: a.prompt || prev.prompt,
          }
        : a,
    );
  }
  /* Unchanged entries keep their reference, and an unchanged list returns `local`, so polling doesn't re-render it. */
  return shareListById(local, [...map.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  ));
}

export function makePlaceholder(
  assetId: string,
  modality: Turn['modality'],
  prompt?: string,
  ids?: { projectId: string; sessionId: string },
): Turn {
  const now = new Date().toISOString();
  return {
    id: assetId,
    ownerId: '',
    projectId: ids?.projectId ?? assetId,
    sessionId: ids?.sessionId ?? assetId,
    sessionTitle: '',
    baseVideoId: null,
    modality,
    title: '',
    status: 'generating',
    prompt: prompt?.trim() ?? '',
    result: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * A turn that has no real id yet.
 *
 * Between Send and the server's answer there is a real wait. Showing nothing reads as "nothing happened", and
 * the person clicks again. So a client-only entry goes up at once, is swapped for the real id when the answer
 * comes, and is removed on failure.
 *
 * The prefix must be recognizable: the entry doesn't exist on the server, so anything that asks the server by id
 * (the progress stream) must skip it, or every send starts with a 404.
 */
const PENDING_ASSET_PREFIX = 'pending:';

export function isPendingAssetId(id: string): boolean {
  return id.startsWith(PENDING_ASSET_PREFIX);
}
