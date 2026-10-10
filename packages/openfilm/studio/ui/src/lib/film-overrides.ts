/**
 * A change to one layer inside a page, kept as the clip's film.html `overrides`.
 *
 * film.html takes the whole array (a key is replaced whole), so each change works out the next array from the
 * current one: merge into this layer's entry or append one; an entry that is back to nothing (no offset, no scale,
 * no turn, no style, no text, no lock) is removed — an override that does nothing would tell an agent reading the
 * film that someone changed this.
 */

import type { FilmOverride } from '@/lib/film';

export type OverrideGeometry = Pick<FilmOverride, 't' | 's' | 'r'> & {
  /** Style keys merged in; `null` removes a key. */
  style?: Record<string, string | number | null>;
  /** Lock / unlock (`false` unlocks). */
  lock?: boolean;
  /** Replacement text; `null` goes back to the page's own. */
  text?: string | null;
};

/** Which layer: the CSS selector in the page and which match (none = every match). */
export interface OverrideTarget {
  at: string;
  n?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function tidy(o: FilmOverride): FilmOverride | null {
  const t = o.t && (round2(o.t[0]) !== 0 || round2(o.t[1]) !== 0)
    ? [round2(o.t[0]), round2(o.t[1])] as [number, number]
    : undefined;
  const [sx, sy] = Array.isArray(o.s) ? o.s : [o.s ?? 1, o.s ?? 1];
  const r3 = (n: number) => Math.round(n * 10000) / 10000;
  /* both axes alike collapse to one number; both 1 is no scale */
  const s = Math.abs(sx - 1) <= 0.0005 && Math.abs(sy - 1) <= 0.0005
    ? undefined
    : r3(sx) === r3(sy) ? r3(sx) : [r3(sx), r3(sy)] as [number, number];
  const r = o.r != null && round2(o.r) !== 0 ? round2(o.r) : undefined;
  const style = o.style && Object.keys(o.style).length ? o.style : undefined;
  const lock = o.lock === true;
  const text = typeof o.text === 'string' ? o.text : undefined;
  if (!t && s == null && r == null && !style && !lock && text == null) return null;
  return {
    at: o.at,
    ...(o.n != null ? { n: o.n } : {}),
    ...(t ? { t } : {}),
    ...(s != null ? { s } : {}),
    ...(r != null ? { r } : {}),
    ...(style ? { style } : {}),
    ...(lock ? { lock: true as const } : {}),
    ...(text != null ? { text } : {}),
  };
}

/** Style merges rather than replaces: changing a color must not drop the size overridden last time. `null` deletes. */
function mergeStyle(
  prev: FilmOverride['style'],
  patch: OverrideGeometry['style'],
): FilmOverride['style'] {
  if (patch === undefined) return prev;
  const out: Record<string, string | number> = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === '') delete out[key];
    else out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

const sameTarget = (o: FilmOverride, target: OverrideTarget) => (o.n ?? null) === (target.n ?? null)
  && o.at === target.at;

/** This layer's entry now (null when it has none). */
export function overrideOf(all: readonly FilmOverride[] | undefined, target: OverrideTarget): FilmOverride | null {
  return all?.find((o) => sameTarget(o, target)) ?? null;
}

/**
 * The next `overrides`. `patch` is what this layer becomes (keys not given are kept); `null` removes its entry
 * (reset). Returns null when the clip has no entry left: the caller deletes the key.
 */
export function nextOverrides(
  all: readonly FilmOverride[] | undefined,
  target: OverrideTarget,
  patch: OverrideGeometry | null,
): FilmOverride[] | null {
  const rest = (all ?? []).filter((o) => !sameTarget(o, target));
  if (patch) {
    const prev = overrideOf(all, target);
    const { style: stylePatch, lock: lockPatch, text: textPatch, ...geometry } = patch;
    const merged = tidy({
      ...(prev ?? {}),
      ...(lockPatch === undefined ? {} : lockPatch ? { lock: true } : { lock: undefined }),
      ...(textPatch === undefined ? {} : { text: textPatch ?? undefined }),
      at: target.at,
      ...(target.n != null ? { n: target.n } : {}),
      ...geometry,
      style: mergeStyle(prev?.style, stylePatch),
    } as FilmOverride);
    if (merged) {
      const at = (all ?? []).findIndex((o) => sameTarget(o, target));
      if (at >= 0) rest.splice(Math.min(at, rest.length), 0, merged);
      else rest.push(merged);
    }
  }
  return rest.length ? rest : null;
}
