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
import { EASES, EFFECTS, KEYED_PROPS, valueAt, type EffectProp, type Key, type KeyedProp, type Motion } from '../../../../src/clip-motion.mjs';

/** A picked keyframe, `<property>@<seconds>`. */
export const keyId = (prop: KeyedProp, t: number) => `${prop}@${t}`;
export function parseKeyId(id: string): { prop: KeyedProp; t: number } | null {
  const at = id.lastIndexOf('@');
  const prop = id.slice(0, at) as KeyedProp;
  const t = Number(id.slice(at + 1));
  return at > 0 && KEYED_PROPS.includes(prop) && Number.isFinite(t) ? { prop, t } : null;
}

/** How a keyframe goes in or out. */
export type Side = 'linear' | 'ease' | 'hold';

/** A segment's easing as its curve's two handles, x1 y1 x2 y2 (null: held). */
export type Bezier = [number, number, number, number];
const LINEAR: Bezier = [1 / 3, 1 / 3, 2 / 3, 2 / 3];
export function bezierOf(ease: string | undefined): Bezier | null {
  if (ease === 'hold') return null;
  const css = ease && ease in EASES ? EASES[ease as keyof typeof EASES] : ease ?? 'linear';
  const m = /cubic-bezier\(([^)]+)\)/.exec(css);
  const n = m ? m[1]!.split(',').map(Number) : [];
  return n.length === 4 && n.every(Number.isFinite) ? (n as Bezier) : [...LINEAR];
}
/** A curve back to an easing: a name where it is one, no easing where it is a straight line. */
export function easeOfBezier(b: Bezier): string | undefined {
  const r = b.map((n) => Math.round(n * 1000) / 1000) as Bezier;
  if (Math.abs(r[0] - r[1]) < 0.002 && Math.abs(r[2] - r[3]) < 0.002) return undefined;
  const css = `cubic-bezier(${r.join(', ')})`;
  const named = Object.entries(EASES).find(([, v]) => v === css);
  return named ? named[0] : css;
}
/* a segment starts (ends) slow where its curve leaves (reaches) its keyframe flatter than a straight line */
const startsSlow = (ease: string | undefined) => { const b = bezierOf(ease); return Boolean(b && b[0] > 0.01 && b[1] < b[0] - 0.02); };
const endsSlow = (ease: string | undefined) => { const b = bezierOf(ease); return Boolean(b && b[2] < 0.99 && 1 - b[3] < 1 - b[2] - 0.02); };
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

/* the properties that have keyframes: a clip's, or any rows' of the same shape (a mask's: `mask-pos`, …) */
const propsOf = (motion: Motion) => Object.keys(motion) as KeyedProp[];

/** The motion with the picked keyframes moved `dt` seconds (kept apart from the others of their property, none before 0). */
export function movedKeys(motion: Motion, picked: ReadonlySet<string>, dt: number): Motion {
  const next: Motion = {};
  for (const prop of propsOf(motion)) {
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
  for (const prop of propsOf(motion)) {
    const keys = (motion[prop] ?? []).filter((k) => !picked.has(keyId(prop, k.t)));
    if (keys.length) next[prop] = keys;
  }
  return next;
}

/** The motion with a command applied to the picked keyframes of every property. */
export function easedMotion(motion: Motion, picked: ReadonlySet<string>, command: EaseCommand): Motion {
  const next: Motion = { ...motion };
  for (const prop of propsOf(motion)) {
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

/**
 * Where a clip's keyframes have moved its picture at a moment: its middle by `dx`, `dy`, its size by `s`, turned by
 * `r`; `ax`, `ay` its anchor point (SPEC §1, from its box's middle), what it turns and sizes about.
 */
export interface ClipPose { dx: number; dy: number; s: number; r: number; ax?: number; ay?: number }
type Placed = { x: number; y: number; scaleX: number; scaleY: number; rotate: number };

/**
 * The pose at the clip's second `t` (`anchor`: its anchor point when not keyed); null when nothing of its place moves
 * and it turns about its middle.
 */
export function poseAt(motion: Motion, t: number, anchor: { ax?: number; ay?: number } = {}): ClipPose | null {
  const ax = motion.ax?.length ? valueAt('ax', motion.ax, t) as number : anchor.ax ?? 0;
  const ay = motion.ay?.length ? valueAt('ay', motion.ay, t) as number : anchor.ay ?? 0;
  if (!motion.translate?.length && !motion.scale?.length && !motion.rotate?.length && !ax && !ay) return null;
  const [dx, dy] = valueAt('translate', motion.translate, t) as [number, number];
  return { dx, dy, s: valueAt('scale', motion.scale, t) as number, r: valueAt('rotate', motion.rotate, t) as number, ...(ax || ay ? { ax, ay } : {}) };
}

/* turned (`deg`, all of its turn) and sized (`s`) about its anchor, not its middle: its middle goes by a − s·R·a */
function anchorShift(pose: ClipPose, deg: number): [number, number] {
  const ax = pose.ax ?? 0, ay = pose.ay ?? 0;
  if (!ax && !ay) return [0, 0];
  const r = (deg * Math.PI) / 180, c = Math.cos(r), n = Math.sin(r);
  return [ax - pose.s * (c * ax - n * ay), ay - pose.s * (n * ax + c * ay)];
}

/** A picture placed at `p` (its top left, its scale of its own size `own`, its turn) as its pose shows it. */
export function posed(p: Placed, own: { w: number; h: number }, pose: ClipPose | null): Placed {
  if (!pose) return p;
  const w = own.w * p.scaleX, h = own.h * p.scaleY;
  const [sx, sy] = anchorShift(pose, p.rotate + pose.r);
  return {
    x: p.x + pose.dx + (w * (1 - pose.s)) / 2 + sx, y: p.y + pose.dy + (h * (1 - pose.s)) / 2 + sy,
    scaleX: p.scaleX * pose.s, scaleY: p.scaleY * pose.s, rotate: p.rotate + pose.r,
  };
}

/** Back from where the pose shows a picture to its own place (a pose that sizes it to nothing is taken as none). */
export function unposed(p: Placed, own: { w: number; h: number }, pose: ClipPose | null): Placed {
  if (!pose) return p;
  const s = Math.abs(pose.s) > 1e-6 ? pose.s : 1;
  const w = (own.w * p.scaleX) / s, h = (own.h * p.scaleY) / s;
  const [sx, sy] = anchorShift({ ...pose, s }, p.rotate);
  return {
    x: p.x - pose.dx - (w * (1 - s)) / 2 - sx, y: p.y - pose.dy - (h * (1 - s)) / 2 - sy,
    scaleX: p.scaleX / s, scaleY: p.scaleY / s, rotate: p.rotate - pose.r,
  };
}

/** Keyframes copied: each property's, their times from the earliest of them all. */
export type CopiedKeys = Partial<Record<KeyedProp, Key[]>>;

/** The picked keyframes, copied. */
export function copiedKeys(motion: Motion, picked: ReadonlySet<string>): CopiedKeys | null {
  const out: CopiedKeys = {};
  let first = Infinity;
  for (const prop of KEYED_PROPS) {
    const keys = (motion[prop] ?? []).filter((k) => picked.has(keyId(prop, k.t)));
    if (!keys.length) continue;
    out[prop] = keys.map((k) => ({ ...k }));
    first = Math.min(first, keys[0]!.t);
  }
  if (!Number.isFinite(first)) return null;
  for (const prop of KEYED_PROPS) out[prop]?.forEach((k) => { k.t = Math.round((k.t - first) * 1000) / 1000; });
  return out;
}

/**
 * Copied keyframes pasted with the earliest at `t` (the clip's second), each property's into its own; one already
 * within half a frame of a pasted one is replaced. `picked`: the pasted ones, as they are picked after.
 */
export function pastedKeys(motion: Motion, copied: CopiedKeys, t: number, frame: number): { motion: Motion; picked: Set<string> } {
  const next: Motion = { ...motion };
  const picked = new Set<string>();
  for (const prop of KEYED_PROPS) {
    const add = copied[prop];
    if (!add?.length) continue;
    let keys = [...(motion[prop] ?? [])];
    for (const k of add) {
      const at = Math.round((t + k.t) * 1000) / 1000;
      keys = keys.filter((o) => Math.abs(o.t - at) >= frame / 2);
      keys.push({ ...k, t: at });
      picked.add(keyId(prop, at));
    }
    next[prop] = keys.sort((a, b) => a.t - b.t);
  }
  return { motion: next, picked };
}

/** The motion with a property's keyframe at `t` set (`v`), or taken away (null); one within half a frame is replaced. */
export function withKeyAt(motion: Motion, prop: KeyedProp, t: number, v: Key['v'] | null, frame: number): Motion {
  const was = (motion[prop] ?? []).find((k) => Math.abs(k.t - t) < frame / 2);
  const keys = (motion[prop] ?? []).filter((k) => k !== was);
  if (v != null) keys.push({ t: Math.round(t * 1000) / 1000, v, ...(was?.ease ? { ease: was.ease } : {}) });
  keys.sort((a, b) => a.t - b.t);
  const next = { ...motion };
  if (keys.length) next[prop] = keys; else delete next[prop];
  return next;
}

/**
 * A layer's effects as numbers (the motion timeline's Effects group): which are on, each one's value at the second
 * `at` (its keyframes', else its own), and the change a value typed, a stopwatch, a navigator's middle, an effect
 * added or taken away makes: its keyframes, and its own values and which are on (`fx`) when those change.
 */
export interface EffectsChange { motion: Motion; fx?: { on: EffectProp[]; values: Partial<Record<EffectProp, number>> } }
export function effectsModel(motion: Motion, on: readonly EffectProp[], values: Partial<Record<EffectProp, number>>, at: number, inClip: boolean, frame: number) {
  const now = (p: EffectProp) => (motion[p]?.length ? valueAt(p, motion[p], at) as number : values[p] ?? EFFECTS[p].rest);
  const fx = (nextOn: readonly EffectProp[], nextValues: Partial<Record<EffectProp, number>>) => ({ on: [...nextOn], values: nextValues });
  return {
    on,
    now,
    set: (p: EffectProp, n: number): EffectsChange | null => (motion[p]?.length
      ? (inClip ? { motion: withKeyAt(motion, p, at, n, frame) } : null)
      : { motion, fx: fx(on, { ...values, [p]: n }) }),
    stopwatch: (p: EffectProp): EffectsChange | null => {
      if (motion[p]?.length) {
        const next = { ...motion };
        delete next[p];
        return { motion: next, fx: fx(on, { ...values, [p]: now(p) }) };
      }
      return inClip ? { motion: withKeyAt(motion, p, at, now(p), frame) } : null;
    },
    toggleHere: (p: EffectProp): EffectsChange | null => {
      if (!inClip) return null;
      const has = (motion[p] ?? []).some((k) => Math.abs(k.t - at) < frame / 2);
      return { motion: withKeyAt(motion, p, at, has ? null : now(p), frame) };
    },
    add: (p: EffectProp): EffectsChange => ({ motion, fx: fx([...on, p], values) }),
    remove: (p: EffectProp): EffectsChange => {
      const next = { ...motion };
      delete next[p];
      const { [p]: _gone, ...rest } = values;
      return { motion: next, fx: fx(on.filter((x) => x !== p), rest) };
    },
  };
}
