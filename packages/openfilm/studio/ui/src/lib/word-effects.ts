/**
 * How a caption's words come as they are said (SPEC §1 Captions): a track's words, each timed (`<00:00:01.200>` in a
 * cue), are past or future at a moment, and the file's STYLE says how each looks then (`::cue(:past)`,
 * `::cue(:future)`), an animation on a word playing from its own time (src/timeline.mjs drawCaptions). Each effect
 * here is that CSS: what a word not said yet is, what one said is, and the keyframes it plays as it is said. The
 * color an effect lights with is `--wfx-color` on the said words. One effect a track, for all its captions.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import { cueRule, setCueBlock, setCueRule, type Vtt } from './caption-edits.ts';

export interface WordEffect {
  id: string;
  /** a word said, and one not said yet */
  past?: Record<string, string>;
  future?: Record<string, string>;
  /** the keyframes it plays, by name (`wfx-<id>`) */
  frames?: string;
  /** it lights with a color of the person's */
  color?: boolean;
}

export const WORD_COLOR = '#ffd400';
const C = 'var(--wfx-color)';
/* a word that moves is a box of its own, its space after it kept */
const BOX = { display: 'inline-block', 'white-space': 'pre' };

export const WORD_EFFECTS: readonly WordEffect[] = [
  { id: 'none' },
  { id: 'color', past: { color: C }, color: true },
  { id: 'reveal', future: { opacity: '0' } },
  { id: 'fade', future: { opacity: '0' }, past: { animation: 'wfx-fade 0.35s ease-out both' }, frames: 'from { opacity: 0 } to { opacity: 1 }' },
  { id: 'rise', future: { opacity: '0' }, past: { ...BOX, animation: 'wfx-rise 0.4s cubic-bezier(.2, .8, .2, 1) both' }, frames: 'from { opacity: 0; transform: translateY(0.5em) } to { opacity: 1; transform: none }' },
  { id: 'pop', future: { opacity: '0' }, past: { ...BOX, animation: 'wfx-pop 0.35s cubic-bezier(.3, 1.7, .5, 1) both' }, frames: 'from { opacity: 0; transform: scale(0.3) } to { opacity: 1; transform: none }' },
  { id: 'blur', future: { opacity: '0' }, past: { animation: 'wfx-blur 0.45s ease-out both' }, frames: 'from { opacity: 0; filter: blur(0.25em) } to { opacity: 1; filter: none }' },
  { id: 'grow', past: { ...BOX, animation: 'wfx-grow 0.5s ease-out both' }, frames: `0% { transform: scale(1.2); color: ${C} } 100% { transform: none }`, color: true },
  { id: 'bump', past: { ...BOX, animation: 'wfx-bump 0.45s ease-out both' }, frames: `0% { transform: none } 35% { transform: translateY(-0.25em) scale(1.12); color: ${C} } 100% { transform: none }`, color: true },
  { id: 'mark', past: { animation: 'wfx-mark 0.6s ease-out both' }, frames: `from { background: ${C}; color: #000 } to { background: transparent }`, color: true },
  { id: 'box', past: { background: C, color: '#000' }, color: true },
  { id: 'underline', past: { 'text-decoration': `underline ${C}`, 'text-decoration-thickness': '0.1em', 'text-underline-offset': '0.15em' }, color: true },
];

const PAST = '::cue(:past)';
const FUTURE = '::cue(:future)';
const frameOf = (id: string) => `@keyframes wfx-${id}`;

/** The effect a track's words have (none when its STYLE says nothing of them; null: one of its own, not these). */
export function wordEffectOf(vtt: Vtt): { id: string | null; color: string } {
  const past = cueRule(vtt, PAST);
  const future = cueRule(vtt, FUTURE);
  const color = past['--wfx-color'] ?? (past.color && !past.color.startsWith('var(') ? past.color : WORD_COLOR);
  const named = /wfx-([\w-]+)/.exec(past.animation ?? '')?.[1];
  if (named) return { id: WORD_EFFECTS.some((e) => e.id === named) ? named : null, color };
  if (past['text-decoration']) return { id: 'underline', color };
  if (past.background) return { id: 'box', color };
  if (past.color) return { id: 'color', color };
  if (future.opacity === '0') return { id: 'reveal', color };
  return { id: Object.keys(past).length || Object.keys(future).length ? null : 'none', color };
}

/** The track's words given an effect (its CSS in place of what they had), lit with `color` where it lights. */
export function withWordEffect(vtt: Vtt, id: string, color = WORD_COLOR): Vtt {
  const fx = WORD_EFFECTS.find((e) => e.id === id) ?? WORD_EFFECTS[0]!;
  let out = setCueRule(setCueRule(vtt, PAST, null), FUTURE, null);
  for (const e of WORD_EFFECTS) if (e.frames) out = setCueBlock(out, frameOf(e.id), null);
  if (fx.past || fx.color) out = setCueRule(out, PAST, { ...(fx.color ? { '--wfx-color': color } : {}), ...fx.past });
  if (fx.future) out = setCueRule(out, FUTURE, fx.future);
  if (fx.frames) out = setCueBlock(out, frameOf(fx.id), fx.frames);
  return out;
}

/** The color an effect lights with, changed. */
export const withWordColor = (vtt: Vtt, color: string): Vtt => setCueRule(vtt, PAST, { '--wfx-color': color });
