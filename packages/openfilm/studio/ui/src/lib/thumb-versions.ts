/**
 * A clip's thumbnails across versions of its file. A key (`mtime:clipId@intoMs#v`, see thumb-frame) carries the
 * version: the file written again (its mtime), or a page clip's own changes (a token after it), gives every picture
 * of the clip a new key. The new pictures take a while, a page's most (drawn headless, one at a time); dropping the
 * old ones at once left the clip empty meanwhile, its color showing, a flash on every edit. So, as an editor does, a
 * clip keeps showing the version it had (`held`) until every picture wanted of the new one has loaded (or failed),
 * and then the new one takes its place whole: never a gap, never old and new mixed.
 */

export type ThumbVersions = {
  /** Pictures loaded, key → address: of the versions wanted now, and of the ones held. */
  loaded: ReadonlyMap<string, string>;
  /** Clip → the version still shown while the one wanted now loads. */
  held: ReadonlyMap<string, string>;
};

export const NO_THUMBS: ThumbVersions = { loaded: new Map(), held: new Map() };

/** `mtime:clipId` of a key (`mtime:clipId@intoMs#v`, see thumb-frame), and the clip id alone. */
export function versionOf(key: string): { version: string; clip: string } | null {
  const at = key.lastIndexOf('@', key.lastIndexOf('#'));
  if (at < 0) return null;
  const version = key.slice(0, at);
  const colon = version.indexOf(':');
  return colon < 0 ? null : { version, clip: version.slice(colon + 1) };
}

/** The version wanted of each clip with pictures wanted. */
function versionsOf(wanted: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of wanted.keys()) { const v = versionOf(key); if (v) out.set(v.clip, v.version); }
  return out;
}

/**
 * A held version lets go once every picture wanted of its clip is in: loaded, or failed (`failed`, by address; it is
 * asked again, and an old picture standing for it would be wrong). A clip with nothing wanted (out of view) keeps it.
 */
function release(state: ThumbVersions, wanted: ReadonlyMap<string, string>, failed: (url: string) => boolean): ThumbVersions {
  if (!state.held.size) return state;
  const waiting = new Set<string>();
  const seen = new Set<string>();
  for (const [key, url] of wanted) {
    const v = versionOf(key);
    if (!v || !state.held.has(v.clip)) continue;
    seen.add(v.clip);
    if (!state.loaded.has(key) && !failed(url)) waiting.add(v.clip);
  }
  const done = [...state.held.keys()].filter((clip) => seen.has(clip) && !waiting.has(clip));
  if (!done.length) return state;
  const held = new Map(state.held);
  const loaded = new Map(state.loaded);
  for (const clip of done) {
    const old = held.get(clip);
    held.delete(clip);
    for (const key of state.loaded.keys()) if (versionOf(key)?.version === old) loaded.delete(key);
  }
  return { loaded, held };
}

/**
 * Other pictures wanted (a zoom, a scroll, an edit). A clip wanted in another version than it shows holds the one it
 * shows; pictures of any other version go (one asked for in between, never shown). A clip wanted again in the version
 * it holds (an undo) holds nothing.
 */
export function wantThumbs(state: ThumbVersions, wanted: ReadonlyMap<string, string>, failed: (url: string) => boolean): ThumbVersions {
  const now = versionsOf(wanted);
  let held: Map<string, string> | null = null;
  let loaded: Map<string, string> | null = null;
  for (const [clip, version] of state.held) if (now.get(clip) === version) (held ??= new Map(state.held)).delete(clip);
  for (const key of state.loaded.keys()) {
    const v = versionOf(key);
    const want = v && now.get(v.clip);
    if (!v || want == null || v.version === want) continue;
    /* what the clip shows: the version it holds, else its only one (pictures come in only for a version wanted) */
    const shown = state.held.get(v.clip) ?? v.version;
    if (v.version === shown) { if ((held ?? state.held).get(v.clip) !== shown) (held ??= new Map(state.held)).set(v.clip, shown); }
    else (loaded ??= new Map(state.loaded)).delete(key);
  }
  const next = held || loaded ? { loaded: loaded ?? state.loaded, held: held ?? state.held } : state;
  return release(next, wanted, failed);
}

/**
 * Pictures that finished loading. One of a version no longer wanted for its clip (asked for before an edit) is left
 * out; one of a clip not wanted now (scrolled away meanwhile) is kept, as a clip's earlier shots are.
 */
export function addThumbs(
  state: ThumbVersions, batch: ReadonlyMap<string, string>, wanted: ReadonlyMap<string, string>, failed: (url: string) => boolean,
): ThumbVersions {
  const now = versionsOf(wanted);
  let loaded: Map<string, string> | null = null;
  for (const [key, url] of batch) {
    const v = versionOf(key);
    const want = v && now.get(v.clip);
    if (v && want != null && v.version !== want) continue;
    if (state.loaded.get(key) !== url) (loaded ??= new Map(state.loaded)).set(key, url);
  }
  return release(loaded ? { ...state, loaded } : state, wanted, failed);
}

/** A picture failed: its clip may be done waiting. */
export function failThumb(state: ThumbVersions, wanted: ReadonlyMap<string, string>, failed: (url: string) => boolean): ThumbVersions {
  return release(state, wanted, failed);
}

/** What the timeline draws: of a clip holding a version, that version's pictures alone. */
export function shownThumbs(state: ThumbVersions): ReadonlyMap<string, string> {
  if (!state.held.size) return state.loaded;
  const out = new Map<string, string>();
  for (const [key, url] of state.loaded) {
    const v = versionOf(key);
    const held = v && state.held.get(v.clip);
    if (held == null || v!.version === held) out.set(key, url);
  }
  return out;
}
