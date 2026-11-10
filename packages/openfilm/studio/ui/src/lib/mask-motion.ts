/**
 * A mask that moves (lib/clip-mask): its position, size, turn, feather and corners keyed at seconds of the clip, as
 * an animation editor keys a mask. A browser does not ease one `mask-image` into another (it switches), so the mask is
 * written at every frame between its first keyframe and its last: `@keyframes <clip>--mask`, a stop a frame, each the
 * mask as lib/clip-mask writes it then. The keyframes themselves head that body as a comment, so they are read back:
 *
 *   @keyframes intro--mask { /* mask-keys pos 0=50,50 2=80,50/ease-out; feather 0=0 2=12 *\/ 0% { mask-image: …; … } … }
 *
 * The mask in the clip's style stays its own (under the keyframes, and what shape it is); the animation shows over it.
 *
 * Pure: no React, no DOM.
 */
import { valueAt, type Key, type MotionValue } from '../../../../src/clip-motion.mjs';
import { clampMask, maskCss, type Mask, type MaskBox } from './clip-mask.ts';

/** What of a mask is keyed: its position and size (% of the box), its turn (°), its feather and corners (%). */
export type MaskParam = 'pos' | 'size' | 'rotate' | 'feather' | 'radius';
export const MASK_PARAMS: readonly MaskParam[] = ['pos', 'size', 'rotate', 'feather', 'radius'];
export type MaskKeys = Partial<Record<MaskParam, Key[]>>;

/** The mask's own value of a parameter. */
export function maskParam(m: Mask, p: MaskParam): MotionValue {
  return p === 'pos' ? [m.x, m.y] : p === 'size' ? [m.w, m.h] : m[p];
}
/** The mask at the clip's second `t`, its keyed parameters where their keyframes have them. */
export function maskAt(base: Mask, keys: MaskKeys, t: number): Mask {
  const m = { ...base };
  for (const p of MASK_PARAMS) {
    const k = keys[p];
    if (!k?.length) continue;
    /* a pair eases as a position does, a number as an opacity: the same arithmetic, whatever it is */
    if (p === 'pos' || p === 'size') {
      const [a, b] = valueAt('translate', k, t) as [number, number];
      if (p === 'pos') { m.x = a; m.y = b; } else { m.w = a; m.h = b; }
    } else m[p] = valueAt('opacity', k, t) as number;
  }
  return m;
}

const num = (n: number) => String(Math.round(n * 1000) / 1000);
/** The keyframes as the comment heading the body: `pos 0=50,50 2=80,50/ease-out; feather 0=0 2=12`. */
function keysText(keys: MaskKeys): string {
  return MASK_PARAMS.filter((p) => keys[p]?.length).map((p) => `${p} ${keys[p]!.map((k) => {
    const v = Array.isArray(k.v) ? k.v.map(num).join(',') : num(k.v as number);
    /* an easing without its spaces (cubic-bezier(0.4,0,0.6,1)): a keyframe is one word */
    return `${num(k.t)}=${v}${k.ease ? `/${k.ease.replace(/\s+/g, '')}` : ''}`;
  }).join(' ')}`).join('; ');
}
/** The keyframes read from a mask's body (none: it has none Studio wrote). */
export function readMaskKeys(body: string | undefined): MaskKeys {
  const m = /\/\*\s*mask-keys\s+([^*]*)\*\//.exec(body ?? '');
  if (!m) return {};
  const out: MaskKeys = {};
  for (const part of m[1]!.split(';')) {
    const [name, ...items] = part.trim().split(/\s+/);
    if (!MASK_PARAMS.includes(name as MaskParam)) continue;
    const keys: Key[] = [];
    for (const item of items) {
      const [, t, v, ease] = /^([\d.]+)=([-\d.,]+)(?:\/(.+))?$/.exec(item) ?? [];
      if (t == null || v == null) continue;
      const nums = v.split(',').map(Number);
      keys.push({ t: Number(t), v: nums.length === 2 ? [nums[0]!, nums[1]!] : nums[0]!, ...(ease ? { ease } : {}) });
    }
    if (keys.length) out[name as MaskParam] = keys;
  }
  return out;
}

/**
 * The mask's keyframes body (a stop a frame from 0 to its last keyframe, each the mask then) and its length in
 * seconds; null when nothing of it is keyed. `read`: the clip's style (its faded edges, its filter, which the mask's
 * CSS is written over).
 */
export function maskKeyframes(base: Mask, keys: MaskKeys, read: (prop: string) => string | undefined, box: MaskBox | null, fps: number): { body: string; secs: number } | null {
  const times = MASK_PARAMS.flatMap((p) => keys[p]?.map((k) => k.t) ?? []);
  if (!times.length) return null;
  const secs = Math.max(...times, 0.001);
  const step = 1 / Math.max(1, fps);
  const stops: string[] = [];
  const count = Math.max(1, Math.round(secs / step));
  for (let i = 0; i <= count; i++) {
    const t = Math.min(secs, i * step);
    const css: Partial<Record<'mask-image' | 'mask-composite', string | null>> = maskCss(read, clampMask(maskAt(base, keys, t), box), box) ?? {};
    const decl = (['mask-image', 'mask-composite'] as const).map((p) => `${p}: ${css[p] ?? (p === 'mask-image' ? 'none' : 'add')}`).join('; ');
    stops.push(`${num((t / secs) * 100)}% { ${decl} }`);
  }
  return { body: `/* mask-keys ${keysText(keys)} */ ${stops.join(' ')}`, secs };
}

const near = (a: number, b: number, frame: number) => Math.abs(a - b) < frame / 2;
function withKey(keys: MaskKeys, p: MaskParam, t: number, v: MotionValue | null, frame: number): MaskKeys {
  const was = (keys[p] ?? []).find((k) => near(k.t, t, frame));
  const list = (keys[p] ?? []).filter((k) => k !== was);
  if (v != null) list.push({ t: Math.round(t * 1000) / 1000, v, ...(was?.ease ? { ease: was.ease } : {}) });
  list.sort((a, b) => a.t - b.t);
  const next = { ...keys };
  if (list.length) next[p] = list; else delete next[p];
  return next;
}

/** A change of a mask: its keyframes, and its own mask when that changes too. */
export interface MaskChange { keys: MaskKeys; base?: Mask }

/** A mask's numbers at the clip's second `at` (the motion timeline's Masks group), and what each change makes. */
export function maskModel(base: Mask, keys: MaskKeys, at: number, inClip: boolean, frame: number) {
  const now = (p: MaskParam) => maskParam(maskAt(base, keys, at), p);
  const own = (p: MaskParam, v: MotionValue): Mask => (p === 'pos' ? { ...base, x: (v as [number, number])[0], y: (v as [number, number])[1] }
    : p === 'size' ? { ...base, w: (v as [number, number])[0], h: (v as [number, number])[1] } : { ...base, [p]: v as number });
  return {
    now,
    set: (p: MaskParam, v: MotionValue): MaskChange | null => (keys[p]?.length
      ? (inClip ? { keys: withKey(keys, p, at, v, frame) } : null)
      : { keys, base: own(p, v) }),
    stopwatch: (p: MaskParam): MaskChange | null => {
      if (keys[p]?.length) {
        const next = { ...keys };
        delete next[p];
        return { keys: next, base: own(p, now(p)) };
      }
      return inClip ? { keys: withKey(keys, p, at, now(p), frame) } : null;
    },
    toggleHere: (p: MaskParam): MaskChange | null => {
      if (!inClip) return null;
      const has = (keys[p] ?? []).some((k) => near(k.t, at, frame));
      return { keys: withKey(keys, p, at, has ? null : now(p), frame) };
    },
  };
}
