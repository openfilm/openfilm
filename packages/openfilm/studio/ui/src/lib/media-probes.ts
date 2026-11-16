import type { Listing } from '../api.ts';
import { filmSrcKind } from './film.ts';

/** Probe media the film uses even outside the media pane's assets/ tree. */
export function mediaProbeTargets(listing: Listing | null, sources: readonly string[], changed: number) {
  const wanted = new Map<string, { path: string; page: boolean; version: number }>();
  for (const f of [...(listing?.files ?? []), ...(listing?.pages ?? []).map((p) => ({ ...p, kind: 'page' }))]) {
    if (['video', 'image', 'audio', 'page'].includes(f.kind)) wanted.set(f.path, { path: f.path, page: f.kind === 'page', version: f.mtime });
  }
  for (const src of sources) {
    const path = src.split(/[?#]/)[0]!;
    if (!path || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path) || wanted.has(path)) continue;
    const kind = filmSrcKind(path);
    if (kind) wanted.set(path, { path, page: kind === 'page', version: changed });
  }
  return [...wanted.values()];
}
