/**
 * The keyframes of an element of a page, kept in its clip's overrides (SPEC: an override's `animation` plays the
 * film's own @keyframes inside the page): the element's entry (`at`, `n`) says `animation: <clip>--e<hash>--<prop> …`,
 * the film's head holds the bodies. Times are the page's own seconds. Unlike a clip's (on top of its box), an
 * element's keyframes are its translate, scale, rotate and opacity themselves: while one moves, its tweak's static
 * value (`t`, `s`, `r`, its style's opacity) stands under it, unused.
 *
 * Pure: no React, no DOM.
 */
import { readMotion, valueAt, writeMotion, type Motion, type MotionProp, type MotionValue } from '../../../../src/clip-motion.mjs';
import type { FilmOverride } from '@/lib/film';

/** An element's entry among a clip's overrides, by its selector and which match. */
export const sameElement = (o: FilmOverride, at: string, n?: number) => o.at === at && (o.n ?? undefined) === (n ?? undefined);

/** The name an element's keyframes go by: its clip's id, then a short mark of where it is (`slot--e4k2j`). */
export function elementSubject(clipId: string, at: string, n?: number): string {
  let h = 0x811c9dc5;
  for (const ch of `${at}#${n ?? ''}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${clipId}--e${h.toString(36)}`;
}

/** The element's keyframes, from its entry's animation and the film's @keyframes. */
export function readElementMotion(entry: FilmOverride | undefined, keyframes: Record<string, string> | undefined, subject: string): Motion {
  const anim = entry?.style?.animation;
  return typeof anim === 'string' ? readMotion({ id: subject, style: `animation: ${anim}` }, keyframes) : {};
}

/**
 * The clip's overrides with the element's keyframes written (and its static tweak changed by `stat`, when given), and
 * the film's @keyframes to set (null: to take away).
 */
export function writeElementMotion(
  list: readonly FilmOverride[], at: string, n: number | undefined, subject: string, motion: Motion,
  stat?: { t?: [number, number]; s?: number; r?: number; opacity?: number },
): { overrides: FilmOverride[]; keyframes: Record<string, string | null> } {
  const entry = list.find((o) => sameElement(o, at, n));
  const was = typeof entry?.style?.animation === 'string' ? `animation: ${entry.style.animation}` : '';
  /* the element's other animations (none Studio's) stay as they are, its own after them */
  const written = writeMotion({ id: subject, style: was }, motion);
  const anim = /animation:\s*([^;]+)/.exec(written.style)?.[1]?.trim();
  const next: FilmOverride = { ...(entry ?? { at, ...(n ? { n } : {}) }), style: { ...(entry?.style ?? {}) } };
  if (anim) next.style!.animation = anim; else delete next.style!.animation;
  if (stat?.t) next.t = stat.t;
  if (stat?.s != null) { if (stat.s === 1) delete next.s; else next.s = stat.s; }
  if (stat?.r != null) { if (stat.r === 0) delete next.r; else next.r = stat.r; }
  if (stat?.opacity != null) { if (stat.opacity >= 1) delete next.style!.opacity; else next.style!.opacity = stat.opacity; }
  if (next.t && next.t[0] === 0 && next.t[1] === 0) delete next.t;
  /* a tweak's style is applied with priority, over any animation: what moves has no static value of its own there */
  for (const prop of Object.keys(motion) as (keyof Motion)[]) {
    if (!motion[prop]?.length) continue;
    if (prop === 'opacity') delete next.style!.opacity;
    else if (prop !== 'translate' && prop !== 'scale' && prop !== 'rotate') delete next.style![`--fx-${prop}`];
  }
  if (!Object.keys(next.style!).length) delete next.style;
  const keep = Object.keys(next).some((k) => k !== 'at' && k !== 'n');
  const overrides = entry
    ? list.flatMap((o) => (o === entry ? (keep ? [next] : []) : [o]))
    : keep ? [...list, next] : [...list];
  return { overrides, keyframes: written.keyframes };
}

/** An element's own transform, as its tweak has it: where it moved, its scale, its turn, its opacity. */
export interface ElementStatic { t: [number, number]; s: number; r: number; opacity: number }
export function elementStatic(entry: FilmOverride | undefined): ElementStatic {
  const s = Array.isArray(entry?.s) ? entry!.s[0] : entry?.s;
  const opacity = Number(entry?.style?.opacity ?? 1);
  return { t: entry?.t ?? [0, 0], s: typeof s === 'number' ? s : 1, r: entry?.r ?? 0, opacity: Number.isFinite(opacity) ? opacity : 1 };
}

/** A change of an element's Transform: its keyframes, and its static tweak when that changes too. */
export interface ElementCommit { motion: Motion; stat?: Partial<{ t: [number, number]; s: number; r: number; opacity: number }> }

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
function withKey(motion: Motion, prop: MotionProp, t: number, v: MotionValue | null, frame: number): Motion {
  const was = (motion[prop] ?? []).find((k) => near(k.t, t, frame));
  const keys = (motion[prop] ?? []).filter((k) => k !== was);
  if (v != null) keys.push({ t: round(t), v, ...(was?.ease ? { ease: was.ease } : {}) });
  keys.sort((a, b) => a.t - b.t);
  const next = { ...motion };
  if (keys.length) next[prop] = keys; else delete next[prop];
  return next;
}

/**
 * An element's Transform as numbers (the motion timeline's rows): each property's value at the page's second `at`
 * (px, %, °, %), and what a value typed, a stopwatch or a navigator's middle makes of it. `on`: the playhead is in
 * the clip, where keyframes can be set.
 */
export function elementModel(motion: Motion, stat: ElementStatic, at: number, on: boolean, frame: number) {
  const shown = (prop: MotionProp, v: MotionValue): number | [number, number] =>
    prop === 'translate' ? (v as [number, number]) : prop === 'scale' || prop === 'opacity' ? (v as number) * 100 : (v as number);
  const keyed = (prop: MotionProp, n: number | [number, number]): MotionValue =>
    prop === 'translate' ? [round((n as [number, number])[0], 2), round((n as [number, number])[1], 2)]
      : prop === 'scale' ? round((n as number) / 100, 4) : prop === 'opacity' ? round(Math.min(1, Math.max(0, (n as number) / 100)), 4) : round(n as number, 3);
  const own: Record<MotionProp, MotionValue> = { translate: stat.t, scale: stat.s, rotate: stat.r, opacity: stat.opacity };
  const statOf = (prop: MotionProp, v: MotionValue): ElementCommit['stat'] =>
    prop === 'translate' ? { t: v as [number, number] } : prop === 'scale' ? { s: v as number } : prop === 'rotate' ? { r: v as number } : { opacity: v as number };
  const now = (prop: MotionProp) => shown(prop, motion[prop]?.length ? valueAt(prop, motion[prop], at) : own[prop]);
  const set = (prop: MotionProp, n: number | [number, number]): ElementCommit | null => {
    if (motion[prop]?.length) return on ? { motion: withKey(motion, prop, at, keyed(prop, n), frame) } : null;
    return { motion, stat: statOf(prop, keyed(prop, n)) };
  };
  const stopwatch = (prop: MotionProp): ElementCommit | null => {
    if (motion[prop]?.length) {
      const next = { ...motion };
      delete next[prop];
      return { motion: next, stat: statOf(prop, valueAt(prop, motion[prop], at)) };
    }
    return on ? { motion: withKey(motion, prop, at, own[prop], frame) } : null;
  };
  const toggleHere = (prop: MotionProp): ElementCommit | null => {
    if (!on) return null;
    const has = (motion[prop] ?? []).some((k) => near(k.t, at, frame));
    return { motion: withKey(motion, prop, at, has ? null : (motion[prop]?.length ? valueAt(prop, motion[prop], at) : own[prop]), frame) };
  };
  return { on, at, now, set, stopwatch, toggleHere };
}
