/**
 * A clip's keyframes as an animation editor handles them (src/clip-motion.mjs keeps them): which are picked, how each
 * looks (its way in and out: linear, eased, held), and what Easy Ease, Ease In, Ease Out, Hold and moving them in time
 * make of them.
 *
 * A keyframe's easing in the film is how the segment after it goes (a CSS timing function); an editor speaks of each
 * keyframe's way in and out instead. A segment starts slow when its first keyframe eases out, ends slow when its
 * second eases in: ease-in (slow start), ease-out (slow end), ease-in-out (both), linear (neither), hold.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */
import { MOTION_PROPS, valueAt, type Key, type Motion, type MotionProp } from '../../../../src/clip-motion.mjs';

/** A picked keyframe, `<property>@<seconds>`. */
export const keyId = (prop: MotionProp, t: number) => `${prop}@${t}`;
export function parseKeyId(id: string): { prop: MotionProp; t: number } | null {
  const at = id.lastIndexOf('@');
  const prop = id.slice(0, at) as MotionProp;
  const t = Number(id.slice(at + 1));
  return at > 0 && MOTION_PROPS.includes(prop) && Number.isFinite(t) ? { prop, t } : null;
}

/** How a keyframe goes in or out. */
export type Side = 'linear' | 'ease' | 'hold';

const startsSlow = (ease: string | undefined) => ease === 'ease-in' || ease === 'ease-in-out' || ease === 'ease';
const endsSlow = (ease: string | undefined) => ease === 'ease-out' || ease === 'ease-in-out' || ease === 'ease';
const segment = (start: boolean, end: boolean) => (start && end ? 'ease-in-out' : start ? 'ease-in' : end ? 'ease-out' : undefined);

/** Each keyframe's way in (from the one before) and out (to the one after); null where it has no neighbour. */
export function sidesOf(keys: readonly Key[]): { in: Side | null; out: Side | null }[] {
  return keys.map((k, i) => {
    const before = keys[i - 1];
    const into: Side | null = !before ? null : before.ease === 'hold' ? 'hold' : endsSlow(before.ease) ? 'ease' : 'linear';
    const out: Side | null = i === keys.length - 1 ? (k.ease === 'hold' ? 'hold' : null) : k.ease === 'hold' ? 'hold' : startsSlow(k.ease) ? 'ease' : 'linear';
    return { in: into, out };
  });
}

/** What a command does to a picked keyframe's sides. */
export type EaseCommand = 'easy' | 'easy-in' | 'easy-out' | 'linear' | 'hold';

/**
 * The keyframes with a command applied to the picked ones (`picked`: their seconds): Easy Ease slows both sides, Ease
 * In the way in, Ease Out the way out, Linear neither; Hold holds the value until the next keyframe (again: not).
 */
export function withEase(keys: readonly Key[], picked: ReadonlySet<number>, command: EaseCommand): Key[] {
  const out = keys.map((k) => ({ ...k }));
  const holdAll = command === 'hold' && out.filter((k) => picked.has(k.t)).every((k) => k.ease === 'hold');
  out.forEach((k, i) => {
    if (!picked.has(k.t)) return;
    if (command === 'hold') { if (holdAll) delete k.ease; else k.ease = 'hold'; return; }
    const before = out[i - 1];
    const slowIn = command === 'easy' || command === 'easy-in' ? true : command === 'linear' ? false : null;
    const slowOut = command === 'easy' || command === 'easy-out' ? true : command === 'linear' ? false : null;
    /* the way out is this keyframe's segment's start; the way in, the segment before's end */
    /* the last keyframe has no way out: nothing after it to ease into */
    if (slowOut != null && k.ease !== 'hold' && i < out.length - 1) {
      const e = segment(slowOut, endsSlow(k.ease));
      if (e) k.ease = e; else delete k.ease;
    } else if (slowOut != null && k.ease === 'hold' && command === 'linear') delete k.ease;
    if (slowIn != null && before && before.ease !== 'hold') {
      const e = segment(startsSlow(before.ease), slowIn);
      if (e) before.ease = e; else delete before.ease;
    }
  });
  return out;
}

/** The motion with the picked keyframes moved `dt` seconds (kept apart from the others of their property, none before 0). */
export function movedKeys(motion: Motion, picked: ReadonlySet<string>, dt: number): Motion {
  const next: Motion = {};
  for (const prop of MOTION_PROPS) {
    const keys = motion[prop];
    if (!keys?.length) continue;
    const moving = keys.filter((k) => picked.has(keyId(prop, k.t)));
    const staying = keys.filter((k) => !picked.has(keyId(prop, k.t)));
    const lowest = Math.min(...moving.map((k) => k.t), Infinity);
    const shift = Math.max(dt, -lowest);
    const moved = moving.map((k) => ({ ...k, t: Math.round((k.t + shift) * 1000) / 1000 }));
    /* a moved keyframe lands on another: it takes that one's place */
    const landed = new Set(moved.map((k) => k.t));
    next[prop] = [...staying.filter((k) => !landed.has(k.t)), ...moved].sort((a, b) => a.t - b.t);
  }
  return next;
}

/** The motion without the picked keyframes. */
export function withoutKeys(motion: Motion, picked: ReadonlySet<string>): Motion {
  const next: Motion = {};
  for (const prop of MOTION_PROPS) {
    const keys = (motion[prop] ?? []).filter((k) => !picked.has(keyId(prop, k.t)));
    if (keys.length) next[prop] = keys;
  }
  return next;
}

/** The motion with a command applied to the picked keyframes of every property. */
export function easedMotion(motion: Motion, picked: ReadonlySet<string>, command: EaseCommand): Motion {
  const next: Motion = { ...motion };
  for (const prop of MOTION_PROPS) {
    const keys = motion[prop];
    if (!keys?.length) continue;
    const times = new Set(keys.filter((k) => picked.has(keyId(prop, k.t))).map((k) => k.t));
    if (times.size) next[prop] = withEase(keys, times, command);
  }
  return next;
}

type Box = { x?: number; y?: number; w?: number; h?: number; r?: number };
const setAt = (keys: readonly Key[], t: number, v: Key['v'], frame: number): Key[] => {
  const was = keys.find((k) => Math.abs(k.t - t) < frame / 2);
  const rest = keys.filter((k) => k !== was);
  rest.push({ t: Math.round(t * 1000) / 1000, v, ...(was?.ease ? { ease: was.ease } : {}) });
  return rest.sort((a, b) => a.t - b.t);
};

/**
 * A clip's box moved, turned or sized (on the picture, or by its fields) while some of those properties move: what of
 * it is a keyframe at `t` (the clip's second) and what stays its own box, as an animation editor keys a value changed
 * with its stopwatch on. Moved: its middle's move on its position. Turned: on its rotation. Sized: its width's factor on
 * its scale, about its middle. Null: nothing here moves, the box is the box.
 */
export function keyedBox(was: Box, now: Box, own: { w: number; h: number }, motion: Motion, t: number, frame: number): { box: Box; motion: Motion } | null {
  const moving = { translate: Boolean(motion.translate?.length), rotate: Boolean(motion.rotate?.length), scale: Boolean(motion.scale?.length) };
  if (!moving.translate && !moving.rotate && !moving.scale) return null;
  const sizeOf = (b: Box) => {
    const w = b.w ?? (b.h != null ? (b.h * own.w) / own.h : own.w);
    return { w, h: b.h ?? (w * own.h) / own.w };
  };
  const a = sizeOf(was), b = sizeOf(now);
  const dc = [((now.x ?? 0) + b.w / 2) - ((was.x ?? 0) + a.w / 2), ((now.y ?? 0) + b.h / 2) - ((was.y ?? 0) + a.h / 2)] as const;
  const dr = (now.r ?? 0) - (was.r ?? 0);
  const k = a.w ? b.w / a.w : 1;
  const next: Motion = { ...motion };
  const box: Box = { ...now };
  let keyed = false;
  if (moving.scale && Math.abs(k - 1) > 1e-6) {
    next.scale = setAt(motion.scale!, t, Math.round((valueAt('scale', motion.scale, t) as number) * k * 10000) / 10000, frame);
    /* its own size stays; the box keeps its middle where it was sized about */
    box.w = was.w; box.h = was.h;
    if (box.w == null) delete box.w;
    if (box.h == null) delete box.h;
    box.x = (now.x ?? 0) + (b.w - a.w) / 2; box.y = (now.y ?? 0) + (b.h - a.h) / 2;
    keyed = true;
  }
  /* sized while its scale does not move: the box is sized, its own (where it is sized from) */
  const sizedOwn = Math.abs(k - 1) > 1e-6 && !moving.scale;
  if (moving.translate && !sizedOwn && (Math.abs(dc[0]) > 0.01 || Math.abs(dc[1]) > 0.01)) {
    const [x0, y0] = valueAt('translate', motion.translate, t) as [number, number];
    next.translate = setAt(motion.translate!, t, [Math.round((x0 + dc[0]) * 100) / 100, Math.round((y0 + dc[1]) * 100) / 100], frame);
    box.x = was.x; box.y = was.y;
    if (box.x == null) delete box.x;
    if (box.y == null) delete box.y;
    keyed = true;
  }
  if (moving.rotate && Math.abs(dr) > 1e-6) {
    next.rotate = setAt(motion.rotate!, t, Math.round(((valueAt('rotate', motion.rotate, t) as number) + dr) * 1000) / 1000, frame);
    box.r = was.r;
    if (box.r == null) delete box.r;
    keyed = true;
  }
  return keyed ? { box, motion: next } : null;
}
