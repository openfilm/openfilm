/**
 * An element's words animated part by part (an override's `split`, SPEC): a preset of how each part comes in, the
 * parts (characters, words, lines), when the first starts, how far apart they start, how long each takes, in which
 * order. Each preset is the film's own `@keyframes motion-text-<preset>` (Studio's cleanup keeps it while it plays).
 *
 * Pure: no React, no DOM.
 */
import type { FilmOverride } from '@/lib/film';

export type TextPreset = 'fade' | 'rise' | 'pop' | 'blur' | 'typewriter' | 'drop';
export const TEXT_PRESETS: readonly TextPreset[] = ['fade', 'rise', 'pop', 'blur', 'typewriter', 'drop'];
/** Each preset's keyframes, and how long a part takes and eases by default. */
const PRESETS: Record<TextPreset, { body: string; secs: number; ease: string }> = {
  fade: { body: '0% { opacity: 0 } 100% { opacity: 1 }', secs: 0.5, ease: 'ease-out' },
  rise: { body: '0% { opacity: 0; translate: 0 0.6em } 100% { opacity: 1; translate: 0 0 }', secs: 0.5, ease: 'ease-out' },
  pop: { body: '0% { opacity: 0; scale: 0.4 } 70% { opacity: 1; scale: 1.12 } 100% { opacity: 1; scale: 1 }', secs: 0.45, ease: 'ease-out' },
  blur: { body: '0% { opacity: 0; filter: blur(12px) } 100% { opacity: 1; filter: blur(0) }', secs: 0.6, ease: 'ease-out' },
  typewriter: { body: '0% { opacity: 0 } 100% { opacity: 1 }', secs: 0.01, ease: 'steps(1, end)' },
  drop: { body: '0% { opacity: 0; translate: 0 -0.8em } 100% { opacity: 1; translate: 0 0 }', secs: 0.5, ease: 'ease-out' },
};
export const presetName = (p: TextPreset) => `motion-text-${p}`;

export type Split = NonNullable<FilmOverride['split']>;
/** What the Text group shows and sets. */
export interface TextAnim { preset: TextPreset; by: Split['by']; start: number; stagger: number; secs: number; order: NonNullable<Split['order']>; dir?: 'in' | 'out' }

/** An element's text animation, from its entry's split (none: it has none; null: one Studio did not write). */
export function textAnimOf(entry: FilmOverride | undefined): TextAnim | null | undefined {
  const sp = entry?.split;
  if (!sp) return undefined;
  const [name, dur, ...rest] = sp.animation.trim().split(/\s+/);
  const preset = TEXT_PRESETS.find((p) => presetName(p) === name);
  const secs = Number.parseFloat(dur ?? '');
  if (!preset || !Number.isFinite(secs)) return null;
  /* going out: the preset played backwards, each part from shown to gone */
  return { preset, by: sp.by, start: sp.start ?? 0, stagger: sp.stagger, secs, order: sp.order ?? 'forward', ...(rest.includes('reverse') ? { dir: 'out' as const } : {}) };
}

/** A preset picked first: its own length, a part every few hundredths of a second. */
export function textAnimDefault(preset: TextPreset, was?: TextAnim | null): TextAnim {
  const d = PRESETS[preset];
  return { preset, by: was?.by ?? 'char', start: was?.start ?? 0, stagger: was?.stagger ?? (preset === 'typewriter' ? 0.06 : 0.04), secs: was?.preset === preset ? was.secs : d.secs, order: was?.order ?? 'forward', ...(was?.dir === 'out' ? { dir: 'out' as const } : {}) };
}

/** The entry's split for it (null: none), and the keyframes it plays. */
export function splitFor(anim: TextAnim | null): { split: Split | null; keyframes: Record<string, string> } {
  if (!anim) return { split: null, keyframes: {} };
  const d = PRESETS[anim.preset];
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    split: {
      by: anim.by,
      animation: `${presetName(anim.preset)} ${round(anim.secs)}s ${d.ease}${anim.dir === 'out' ? ' reverse' : ''} both`,
      stagger: round(anim.stagger),
      ...(anim.start ? { start: round(anim.start) } : {}),
      ...(anim.order !== 'forward' ? { order: anim.order } : {}),
    },
    keyframes: { [presetName(anim.preset)]: d.body },
  };
}
