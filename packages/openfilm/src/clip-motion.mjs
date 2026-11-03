// @ts-check
/**
 * A clip's keyframes as Studio writes them (SPEC §1: a clip moves by CSS animation on its own time). Each property
 * that has keyframes is one animation of the clip, by `@keyframes <clip id>--<property>` in the film's <style>, its
 * keyframes at seconds of the clip (a keyframe's easing is how it goes on to the next one), so a property moves on its
 * own as a track of an animation editor does, and trimming the clip's end leaves its keyframes where they are:
 *
 *   @keyframes intro--scale { 0% { scale: 1; animation-timing-function: ease-out } 100% { scale: 1.2 } }
 *   <video id="intro" style="animation: intro--scale 2.5s linear both">
 *
 * Animations of other names (a preset's, an agent's own) are the clip's too, kept as they are. Pure: no DOM, so the
 * server's edits and the editor read and write keyframes alike.
 */
import { declarations } from './film-doc.mjs';

/** What Studio keys, and how a value of each is written. */
export const MOTION_PROPS = /** @type {const} */ (['translate', 'scale', 'rotate', 'opacity']);
/** @typedef {typeof MOTION_PROPS[number]} MotionProp */
/** A value: translate is [x, y] in stage px, scale a factor, rotate degrees, opacity 0–1. */
/** @typedef {number | [number, number]} MotionValue */
/** @typedef {{ t: number, v: MotionValue, ease?: string }} Key */
/** @typedef {Partial<Record<MotionProp, Key[]>>} Motion */

/** The easings a keyframe offers, by name, as CSS. */
export const EASES = {
  linear: 'linear',
  'ease-in': 'cubic-bezier(0.42, 0, 1, 1)',
  'ease-out': 'cubic-bezier(0, 0, 0.58, 1)',
  'ease-in-out': 'cubic-bezier(0.42, 0, 0.58, 1)',
  hold: 'steps(1, end)',
};

/** What each property is when it has no keyframes. */
export const MOTION_REST = { translate: /** @type {[number, number]} */ ([0, 0]), scale: 1, rotate: 0, opacity: 1 };

export const motionName = (/** @type {string} */ clip, /** @type {MotionProp} */ prop) => `${clip}--${prop}`;
const round = (/** @type {number} */ n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** A value as CSS. */
function css(/** @type {MotionProp} */ prop, /** @type {MotionValue} */ v) {
  if (prop === 'translate') { const [x, y] = /** @type {[number, number]} */ (v); return `${round(x, 2)}px ${round(y, 2)}px`; }
  if (prop === 'rotate') return `${round(/** @type {number} */ (v), 3)}deg`;
  return String(round(/** @type {number} */ (v), 4));
}
/** A value read from CSS (null: not one Studio writes). */
function valueOf(/** @type {MotionProp} */ prop, /** @type {string} */ text) {
  const s = text.trim();
  if (prop === 'translate') {
    const m = /^(-?[\d.]+)px(?:\s+(-?[\d.]+)px)?$/.exec(s) ?? (s === '0' || s === 'none' ? ['', '0', '0'] : null);
    return m ? /** @type {[number, number]} */ ([Number(m[1]), Number(m[2] ?? 0)]) : null;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** The top-level parts of a CSS list (commas inside brackets kept). */
export function cssList(/** @type {string} */ text) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A style's declarations, in order. */
const decls = (/** @type {string} */ style) => declarations(style).filter(([, v]) => v !== '');
/** The `animation` of a style, as its entries. */
export function animationsOf(/** @type {string | undefined} */ style) {
  const found = decls(style ?? '').filter(([p]) => p === 'animation').pop();
  return found ? cssList(found[1]) : [];
}
/** A style with its `animation` set to these entries (none: taken out), the rest as it was. */
export function withAnimations(/** @type {string | undefined} */ style, /** @type {string[]} */ entries) {
  const parts = decls(style ?? '').filter(([p]) => p !== 'animation').map(([p, v]) => `${p}: ${v}`);
  if (entries.length) parts.push(`animation: ${entries.join(', ')}`);
  return parts.join('; ');
}

/** A keyframes body's stops: each percentage (`from` 0, `to` 100) with its declarations. */
function stops(/** @type {string} */ body) {
  const out = [];
  for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const at = m[1].split(',').map((s) => s.trim()).map((s) => (s === 'from' ? 0 : s === 'to' ? 100 : Number.parseFloat(s)));
    const d = Object.fromEntries(decls(m[2]));
    for (const pct of at) if (Number.isFinite(pct)) out.push({ pct, d });
  }
  return out.sort((a, b) => a.pct - b.pct);
}

/** The easing Studio names, from CSS (a bezier of its own stays as written). */
const easeName = (/** @type {string | undefined} */ text) => {
  if (!text) return undefined;
  const t = text.trim().replace(/\s+/g, ' ');
  const named = Object.entries(EASES).find(([, v]) => v === t || v.replace(/ /g, '') === t.replace(/ /g, ''));
  return named ? (named[0] === 'linear' ? undefined : named[0]) : t;
};

/**
 * A clip's keyframes, read from its style's animations and the film's `@keyframes` (name → body): every property of
 * MOTION_PROPS it has an animation of, by its own name.
 * @param {{ id: string, style?: string }} clip @param {Record<string, string> | undefined} keyframes @returns {Motion}
 */
export function readMotion(clip, keyframes) {
  /** @type {Motion} */
  const motion = {};
  for (const entry of animationsOf(clip.style)) {
    const [name, dur] = entry.split(/\s+/);
    const prop = MOTION_PROPS.find((p) => name === motionName(clip.id, p));
    const body = prop && keyframes?.[name];
    const d = Number.parseFloat(dur ?? '');
    if (!prop || body == null || !(d > 0)) continue;
    /** @type {Key[]} */
    const keys = [];
    for (const { pct, d: ds } of stops(body)) {
      if (ds[prop] == null) continue;
      const v = valueOf(prop, ds[prop]);
      if (v == null) continue;
      const t = round((pct / 100) * d);
      /* the 0% written to hold the first value before it (writeMotion) is no keyframe of the person's */
      if (keys.length && keys[keys.length - 1].t === t) continue;
      const ease = easeName(ds['animation-timing-function']);
      keys.push({ t, v, ...(ease ? { ease } : {}) });
    }
    if (pct0Only(keys, body)) keys.shift();
    if (keys.length) motion[prop] = keys;
  }
  return motion;
}
/* a 0% that only holds the first keyframe's value (marked so by writeMotion) */
function pct0Only(/** @type {Key[]} */ keys, /** @type {string} */ body) {
  return keys.length > 1 && /\/\*\s*held\s*\*\//.test(body) && keys[0].t === 0;
}

/**
 * The clip's keyframes written: its style (its own animations replaced, others kept, in their order) and the film's
 * `@keyframes` to set (null: to take away) by name.
 * @param {{ id: string, style?: string }} clip @param {Motion} motion
 * @returns {{ style: string, keyframes: Record<string, string | null> }}
 */
export function writeMotion(clip, motion) {
  const own = new Set(MOTION_PROPS.map((p) => motionName(clip.id, p)));
  const others = animationsOf(clip.style).filter((e) => !own.has(e.split(/\s+/)[0]));
  /** @type {Record<string, string | null>} */
  const keyframes = Object.fromEntries([...own].map((n) => [n, null]));
  const entries = [];
  for (const prop of MOTION_PROPS) {
    const keys = [...(motion[prop] ?? [])].sort((a, b) => a.t - b.t);
    if (!keys.length) continue;
    const name = motionName(clip.id, prop);
    const d = Math.max(keys[keys.length - 1].t, 0.001);
    const lines = [];
    if (keys[0].t > 0) lines.push(`/* held */ 0% { ${prop}: ${css(prop, keys[0].v)} }`);
    for (const k of keys) {
      const ease = k.ease && k.ease !== 'linear' ? `; animation-timing-function: ${EASES[/** @type {keyof EASES} */ (k.ease)] ?? k.ease}` : '';
      lines.push(`${round((k.t / d) * 100, 3)}% { ${prop}: ${css(prop, k.v)}${ease} }`);
    }
    keyframes[name] = lines.join(' ');
    entries.push(`${name} ${round(d, 3)}s linear both`);
  }
  return { style: withAnimations(clip.style, [...others, ...entries]), keyframes };
}

/** A cubic bezier easing at x (0–1). */
function bezier(/** @type {number[]} */ [x1, y1, x2, y2], /** @type {number} */ x) {
  const at = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < x) lo = mid; else hi = mid; }
  return at(y1, y2, (lo + hi) / 2);
}
/** How far an easing has gone at x. */
export function eased(/** @type {string | undefined} */ ease, /** @type {number} */ x) {
  const name = ease && ease in EASES ? EASES[/** @type {keyof EASES} */ (ease)] : ease ?? 'linear';
  if (name === 'linear') return x;
  if (name.startsWith('steps')) return x < 1 ? 0 : 1;
  const m = /cubic-bezier\(([^)]+)\)/.exec(name);
  return m ? bezier(m[1].split(',').map(Number), x) : x;
}

/** A property's value at a clip's second `t`, as its keyframes have it (none: its rest). */
export function valueAt(/** @type {MotionProp} */ prop, /** @type {Key[] | undefined} */ keys, /** @type {number} */ t) {
  if (!keys?.length) return MOTION_REST[prop];
  if (t <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t > b.t) continue;
    const k = eased(a.ease, (t - a.t) / (b.t - a.t || 1));
    if (Array.isArray(a.v)) {
      const bv = /** @type {[number, number]} */ (b.v);
      return /** @type {[number, number]} */ ([a.v[0] + (bv[0] - a.v[0]) * k, a.v[1] + (bv[1] - a.v[1]) * k]);
    }
    return /** @type {number} */ (a.v) + (/** @type {number} */ (b.v) - /** @type {number} */ (a.v)) * k;
  }
  return keys[keys.length - 1].v;
}

/** The keyframes moved by `dt` seconds of the clip, those before its start gone (one at its start keeps the value there). */
export function shiftMotion(/** @type {Motion} */ motion, /** @type {number} */ dt) {
  /** @type {Motion} */
  const out = {};
  for (const prop of MOTION_PROPS) {
    const keys = motion[prop];
    if (!keys?.length) continue;
    const moved = keys.map((k) => ({ ...k, t: round(k.t + dt) }));
    const kept = moved.filter((k) => k.t >= 0);
    if (kept.length < moved.length && (kept[0]?.t ?? Infinity) > 0) kept.unshift({ t: 0, v: valueAt(prop, keys, -dt) });
    if (kept.length) out[prop] = kept;
  }
  return out;
}

/** How a clip comes in, goes out or moves while it shows: a preset of the library's (library/catalogs/motions.json). */
/** @typedef {{ name: string, body: string, secs: number, ease: string }} Preset */
/** @typedef {'in' | 'out' | 'loop'} PresetSlot */

/**
 * A style with a preset in its slot, the one there before taken off (null: just taken off). In from the clip's start,
 * filling backwards; out timed from its end (`--clip-length`), filling forwards; a loop over and over. Filling only
 * that way, a preset that changes the clip's filter leaves the clip's own look on it the rest of the time.
 * @param {string | undefined} style @param {PresetSlot} slot @param {Preset | null} preset
 */
export function withPreset(style, slot, preset) {
  const kept = animationsOf(style).filter((e) => !e.split(/\s+/)[0].startsWith(`motion-${slot}-`));
  if (!preset) return withAnimations(style, kept);
  const s = `${round(preset.secs, 3)}s`;
  const entry = slot === 'in' ? `${preset.name} ${s} ${preset.ease} backwards`
    : slot === 'out' ? `${preset.name} ${s} ${preset.ease} calc(var(--clip-length) - ${s}) forwards`
      : `${preset.name} ${s} ${preset.ease} infinite`;
  /* before the clip's own keyframes, so a property it keys itself is the one that shows */
  const own = kept.findIndex((e) => /--(translate|scale|rotate|opacity)$/.test(e.split(/\s+/)[0]));
  kept.splice(own < 0 ? kept.length : own, 0, entry);
  return withAnimations(style, kept);
}
