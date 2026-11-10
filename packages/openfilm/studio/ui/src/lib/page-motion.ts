/**
 * A page layer's own numbers keyed (its CSS variables: a shape's stroke width, a repeater's copies, how much of a
 * line is drawn), as a clip's Transform is (src/clip-motion.mjs), with no field of their own: the clip's `:root`
 * override plays the film's `@keyframes <clip>--var-<name>` inside the page (SPEC §1, overrides), its keyframes at
 * seconds of the clip (the animation waits for the page's second the clip starts at, its `in`). A keyed variable
 * has no still value there: one set with priority would win over its animation. The page registers the variable
 * (`@property`), or it jumps from one keyframe to the next instead of easing.
 *
 *   @keyframes rect--var-copies { 0% { --copies: 5 } 100% { --copies: 27; } }
 *   overrides='[{"at":":root","style":{"animation":"rect--var-copies 5s linear both"}}]'
 */
import { EASES, cssList, type Key } from '../../../../src/clip-motion.mjs';
import type { FilmOverride } from './film.ts';
import { nextOverrides, overrideOf } from './film-overrides.ts';

/** A variable's keyframes, its numbers in one unit (`px`, `deg`, `%`, or none). */
export interface VarKeys { unit: string; keys: Key[] }
/** A layer's keyed variables, by name (`--copies`). */
export type VarMotion = Record<string, VarKeys>;

const ROOT = { at: ':root' };
export const varMotionName = (clip: string, name: string) => `${clip}--var-${name.replace(/^--/, '')}`;
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** A number with its unit (`12px`, `-3.5`, `40%`), or null. */
export function numberOf(text: string | number | undefined | null): { n: number; unit: string } | null {
  const m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(text ?? ''));
  return m ? { n: Number(m[1]), unit: m[2]!.toLowerCase() } : null;
}

/** The `:root` entry's animations. */
const rootAnimations = (overrides: readonly FilmOverride[] | undefined) => {
  const a = overrideOf(overrides, ROOT)?.style?.animation;
  return typeof a === 'string' ? cssList(a) : [];
};

/** The easing Studio names, from CSS (a bezier of its own stays as written). */
const easeName = (text: string | undefined) => {
  if (!text) return undefined;
  const t = text.trim().replace(/\s+/g, ' ');
  const named = Object.entries(EASES).find(([, v]) => v.replace(/ /g, '') === t.replace(/ /g, ''));
  return named ? (named[0] === 'linear' ? undefined : named[0]) : t;
};

/** A page layer's keyed variables, read from its overrides and the film's `@keyframes` (name → body). */
export function readVarMotion(clip: string, overrides: readonly FilmOverride[] | undefined, keyframes: Record<string, string> | undefined): VarMotion {
  const out: VarMotion = {};
  const prefix = `${clip}--var-`;
  for (const entry of rootAnimations(overrides)) {
    const [name, dur] = entry.split(/\s+/);
    if (!name?.startsWith(prefix)) continue;
    const body = keyframes?.[name];
    const d = Number.parseFloat(dur ?? '');
    if (body == null || !(d > 0)) continue;
    const v = `--${name.slice(prefix.length)}`;
    const keys: Key[] = [];
    let unit = '';
    for (const m of body.matchAll(/([\d.]+)%\s*\{([^{}]*)\}/g)) {
      const decl = Object.fromEntries(m[2]!.split(';').map((s) => s.split(':').map((x) => x.trim())).filter((p) => p.length === 2));
      const num = numberOf(decl[v]);
      if (!num) continue;
      unit = num.unit;
      const t = round((Number(m[1]) / 100) * d);
      /* the 0% written to hold the first value before it is no keyframe of the person's */
      if (/\/\*\s*held\s*\*\/\s*$/.test(body.slice(0, m.index))) continue;
      const ease = easeName(decl['animation-timing-function']);
      keys.push({ t, v: num.n, ...(ease ? { ease } : {}) });
    }
    if (keys.length) out[v] = { unit, keys };
  }
  return out;
}

/**
 * The next overrides and `@keyframes` (null: taken out) for these keyed variables: the clip's other animations at
 * `:root` kept, a keyed variable's still value taken out, `inS` the page's second the clip starts at.
 */
export function writeVarMotion(clip: string, overrides: readonly FilmOverride[] | undefined, motion: VarMotion, inS = 0): { overrides: FilmOverride[] | null; keyframes: Record<string, string | null> } {
  const prefix = `${clip}--var-`;
  const others = rootAnimations(overrides).filter((e) => !e.split(/\s+/)[0]!.startsWith(prefix));
  const keyframes: Record<string, string | null> = {};
  for (const e of rootAnimations(overrides)) { const n = e.split(/\s+/)[0]!; if (n.startsWith(prefix)) keyframes[n] = null; }
  const entries: string[] = [];
  const still: Record<string, null> = {};
  for (const [v, { unit, keys: raw }] of Object.entries(motion)) {
    const keys = [...raw].sort((a, b) => a.t - b.t);
    if (!keys.length) continue;
    const name = varMotionName(clip, v);
    const d = Math.max(keys[keys.length - 1]!.t, 0.001);
    const lines: string[] = [];
    const css = (n: number) => `${round(n, 3)}${unit}`;
    if (keys[0]!.t > 0) lines.push(`/* held */ 0% { ${v}: ${css(keys[0]!.v as number)} }`);
    for (const k of keys) {
      const ease = k.ease && k.ease !== 'linear' ? `; animation-timing-function: ${EASES[k.ease as keyof typeof EASES] ?? k.ease}` : '';
      lines.push(`${round((k.t / d) * 100, 3)}% { ${v}: ${css(k.v as number)}${ease} }`);
    }
    keyframes[name] = lines.join(' ');
    entries.push(`${name} ${round(d, 3)}s linear${inS ? ` ${round(inS, 3)}s` : ''} both`);
    still[v] = null;
  }
  const list = [...others, ...entries];
  const next = nextOverrides(overrides, ROOT, { style: { ...still, animation: list.length ? list.join(', ') : null } });
  return { overrides: next, keyframes };
}
