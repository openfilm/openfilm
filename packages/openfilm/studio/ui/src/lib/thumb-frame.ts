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

/**
 * A page clip's thumbnails are drawn with its overrides (SPEC §1), the changes made inside it in Studio: as a short
 * token for a frame's address and key, '' when it has none of a layer's (its fades alone change no picture). Another
 * change, another token: the timeline asks for the clip's pictures again.
 */
export function overridesToken(overrides: readonly unknown[] | undefined): string {
  if (!overrides?.some((o) => typeof o === 'object' && o !== null && 'at' in o)) return '';
  return hashToken(JSON.stringify(overrides));
}
/**
 * A page clip's own look for its thumbnails: its overrides (overridesToken) and the query its page is asked with
 * (SPEC §1), which the page draws by. '' when it has neither: its pictures are its file's.
 */
export function pageClipToken(clip: { overrides?: readonly unknown[]; query?: string }): string {
  const tweaks = overridesToken(clip.overrides);
  return clip.query ? hashToken(`${tweaks}?${clip.query}`) : tweaks;
}
function hashToken(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
