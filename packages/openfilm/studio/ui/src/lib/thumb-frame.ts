/**
 * Thumbnail keys: which clip, and which millisecond within itself, a thumbnail shows.
 *
 * ProjectView builds the keys as `mtime:clipId@intoMs#v` (the source file's mtime, the clip, the in-clip millisecond).
 * Keyed by the clip's own millisecond (counting its trim) rather than film time, moving a clip keeps its pictures;
 * only trimming it or changing its file gives new keys.
 */

/** A thumbnail key back to "which clip, which in-clip millisecond". Null for keys it does not recognize. */
function parseClipFrameKey(key: string): { id: string; intoMs: number } | null {
  const hash = key.lastIndexOf('#');
  const at = key.lastIndexOf('@', hash);
  if (at < 0 || hash <= at) return null;
  const intoMs = Number(key.slice(at + 1, hash));
  if (!Number.isFinite(intoMs)) return null;
  const left = key.slice(0, at);
  const colon = left.lastIndexOf(':');
  if (colon < 0) return null;
  return { id: left.slice(colon + 1), intoMs };
}

/** Which thumbnails belong to a clip on the timeline. */
export function clipThumbId(block: { clipId?: string; loc?: string; id: string }): string {
  return block.clipId || block.loc || block.id;
}

/**
 * The in-clip millisecond at the clip's left edge. A move keeps the left edge's frame; pulling the left edge reaches
 * deeper into the source, as a video seek would.
 */
export function thumbIntoOrigin(opts: {
  committedStart: number;
  committedEnd: number;
  visualStart: number;
  visualEnd: number;
  trimFromMs: number;
  /** source ms per film ms: the keys are the source's, so a left trim of a sped-up clip reaches `speed` times deeper */
  speed?: number;
}): number {
  const visualDur = opts.visualEnd - opts.visualStart;
  const committedDur = opts.committedEnd - opts.committedStart;
  const leftMoved = Math.abs(opts.visualStart - opts.committedStart) > 0.5;
  const durChanged = Math.abs(visualDur - committedDur) > 0.5;
  return opts.trimFromMs + (leftMoved && durChanged ? (opts.visualStart - opts.committedStart) * (opts.speed ?? 1) : 0);
}

/** The thumbnails in memory, per clip: in-clip ms → address. What BlockThumbs draws, detached from film time. */
export function indexClipThumbs(
  thumbs: ReadonlyMap<string, string>,
): Map<string, Map<number, string>> {
  const by = new Map<string, Map<number, string>>();
  for (const [key, url] of thumbs) {
    const parsed = parseClipFrameKey(key);
    if (!parsed) continue;
    let strip = by.get(parsed.id);
    if (!strip) {
      strip = new Map();
      by.set(parsed.id, strip);
    }
    if (!strip.has(parsed.intoMs)) strip.set(parsed.intoMs, url);
  }
  return by;
}
