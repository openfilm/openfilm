/**
 * Animation presets: a layer's Transform keyframes made in one go, as an animation editor's presets make them, put
 * where they go on the layer — what comes in at its start, what goes out at its end, what plays along all of it. Each
 * is keyed from the layer's own transform (its `rest`: where, how big, how turned and how opaque it is when nothing
 * moves it), so it comes in to where it stands and leaves from there.
 *
 * The keyframes a preset makes take the place of the ones its properties had in that stretch; the rest stay.
 *
 * Pure: no React, no DOM.
 */
import type { Key, Motion, MotionProp } from '../../../../src/clip-motion.mjs';

export type AnimPreset = 'fadeIn' | 'riseIn' | 'popIn' | 'slideIn' | 'spinIn' | 'fadeOut' | 'sinkOut' | 'shrinkOut' | 'pushIn' | 'pulse' | 'wiggle' | 'float';
/** Where each goes on the layer: its start, its end, all along it. */
export const ANIM_GROUPS: readonly { id: 'in' | 'out' | 'along'; presets: readonly AnimPreset[] }[] = [
  { id: 'in', presets: ['fadeIn', 'riseIn', 'popIn', 'slideIn', 'spinIn'] },
  { id: 'out', presets: ['fadeOut', 'sinkOut', 'shrinkOut'] },
  { id: 'along', presets: ['pushIn', 'pulse', 'wiggle', 'float'] },
];

/** A layer's transform with nothing moving it, in its keyframes' own terms. */
export interface Rest { translate: [number, number]; scale: number; rotate: number; opacity: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const IN_S = 0.6;
const OUT_S = 0.5;

/**
 * The layer's keyframes with a preset's made: `span` is where the layer shows, in its keyframes' seconds; `stage` its
 * picture's size (how far a slide goes).
 */
export function presetMotion(preset: AnimPreset, motion: Motion, rest: Rest, span: [number, number], stage: { w: number; h: number }): Motion {
  const [from, to] = span;
  const len = Math.max(0.05, to - from);
  const [x, y] = rest.translate;
  const inS = Math.min(IN_S, len / 2);
  const outS = Math.min(OUT_S, len / 2);
  const a = from;
  const b = from + inS;
  const c = to - outS;
  const made: Partial<Record<MotionProp, Key[]>> = {};
  const k = (t: number, v: Key['v'], ease?: string): Key => ({ t: r3(t), v, ...(ease ? { ease } : {}) });
  /* a property played along all the layer: a turn every so many seconds, the last back where it rests */
  const along = (every: number, at: (i: number) => Key['v']) => {
    const n = Math.max(1, Math.round(len / every));
    return Array.from({ length: n * 2 + 1 }, (_, i) => k(from + (len * i) / (n * 2), i % 2 ? at(i) : at(0), 'ease-in-out'));
  };
  switch (preset) {
    case 'fadeIn': made.opacity = [k(a, 0, 'ease-out'), k(b, rest.opacity)]; break;
    case 'riseIn':
      made.translate = [k(a, [x, r3(y + stage.h * 0.08)], 'cubic-bezier(0.2, 0.8, 0.2, 1)'), k(b, [x, y])];
      made.opacity = [k(a, 0, 'ease-out'), k(b, rest.opacity)];
      break;
    case 'popIn':
      made.scale = [k(a, r3(rest.scale * 0.6), 'ease-out'), k(a + inS * 0.7, r3(rest.scale * 1.06), 'ease-in-out'), k(b, rest.scale)];
      made.opacity = [k(a, 0, 'ease-out'), k(a + inS * 0.5, rest.opacity)];
      break;
    case 'slideIn':
      made.translate = [k(a, [r3(x - stage.w * 0.3), y], 'cubic-bezier(0.2, 0.8, 0.2, 1)'), k(b, [x, y])];
      made.opacity = [k(a, 0, 'ease-out'), k(b, rest.opacity)];
      break;
    case 'spinIn':
      made.rotate = [k(a, r3(rest.rotate - 90), 'cubic-bezier(0.2, 0.8, 0.2, 1)'), k(b, rest.rotate)];
      made.scale = [k(a, r3(rest.scale * 0.4), 'cubic-bezier(0.2, 0.8, 0.2, 1)'), k(b, rest.scale)];
      made.opacity = [k(a, 0, 'ease-out'), k(b, rest.opacity)];
      break;
    case 'fadeOut': made.opacity = [k(c, rest.opacity, 'ease-in'), k(to, 0)]; break;
    case 'sinkOut':
      made.translate = [k(c, [x, y], 'ease-in'), k(to, [x, r3(y + stage.h * 0.08)])];
      made.opacity = [k(c, rest.opacity, 'ease-in'), k(to, 0)];
      break;
    case 'shrinkOut':
      made.scale = [k(c, rest.scale, 'ease-in'), k(to, r3(rest.scale * 0.5))];
      made.opacity = [k(c, rest.opacity, 'ease-in'), k(to, 0)];
      break;
    case 'pushIn': made.scale = [k(from, rest.scale, 'ease-in-out'), k(to, r3(rest.scale * 1.15))]; break;
    case 'pulse': made.scale = along(1.2, (i) => (i ? r3(rest.scale * 1.06) : rest.scale)); break;
    case 'wiggle': made.rotate = along(0.8, (i) => r3(rest.rotate + (i ? ((i % 4) === 1 ? 4 : -4) : 0))); break;
    case 'float': made.translate = along(2, (i) => (i ? [x, r3(y - stage.h * 0.02)] : [x, y])); break;
  }
  const next: Motion = { ...motion };
  for (const [prop, keys] of Object.entries(made) as [MotionProp, Key[]][]) {
    const lo = keys[0]!.t;
    const hi = keys[keys.length - 1]!.t;
    /* the property's keyframes outside the stretch stay, with the preset's in it */
    const kept = (motion[prop] ?? []).filter((key) => key.t < lo - 1e-3 || key.t > hi + 1e-3);
    next[prop] = [...kept, ...keys].sort((p, q) => p.t - q.t) as never;
  }
  return next;
}
