/**
 * A caption's look as the library text's variables (lib/text-look): what the caption renderer styles a cue's words by
 * (src/captions.mjs CAPTION_BASE_CSS), read from a STYLE rule's own variables, else from its plain CSS (a look from
 * before: `font`, `color`…), which is given up for them once the look is changed.
 *
 * Plain TypeScript, no React: the editor's tests import it as it is.
 */
import { LOOK_VARS, TEXT_DEFAULTS } from './text-look.ts';
import { cueRule } from './caption-edits.ts';
import { readVtt } from '../../../../src/captions.mjs';

/** A caption as the renderer draws it with nothing said (CAPTION_BASE_CSS), in the text's variables. */
export const CAPTION_DEFAULTS: Record<string, string> = {
  ...TEXT_DEFAULTS,
  '--font': 'sans-serif', '--size': '5cqmin', '--weight': '400', '--color': '#ffffff', '--box': 'rgba(0, 0, 0, 0.8)', '--box-pad': '0 0.25em',
  '--spacing': 'normal', '--in': 'none', '--in-time': '0.5s', '--loop': 'none', '--out': 'none',
};
/** The plain CSS a look from before may say, given up for the variables once the look is changed. */
export const PLAIN = ['font', 'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'background', 'background-color', '-webkit-text-stroke',
  'paint-order', 'text-shadow', 'letter-spacing', 'padding', 'border-radius', 'filter', 'animation', 'display'];

/** A rule's look as the text's variables: its own, else read from its plain CSS. */
export function varsOf(rule: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const font = rule.font ?? '';
  const size = rule['font-size'] ?? /([\d.]+cqmin|[\d.]+cqh)/.exec(font)?.[1];
  const weight = rule['font-weight'] ?? /^(?:italic\s+)?(\d{3}|bold)\b/.exec(font)?.[1];
  const family = rule['font-family'] ?? /(?:cqmin|cqh|px|em)(?:\/[\d.]+)?\s+(.+)$/.exec(font)?.[1];
  const stroke = /^([\d.]+em)\s+(.+)$/.exec(rule['-webkit-text-stroke'] ?? '');
  const bg = rule.background ?? rule['background-color'];
  if (size) out['--size'] = size;
  if (weight) out['--weight'] = weight === 'bold' ? '700' : weight;
  if (family) out['--font'] = family;
  if (rule.color) out['--color'] = rule.color;
  if (stroke) { out['--stroke'] = stroke[1]!; out['--stroke-color'] = stroke[2]!; }
  if (rule['text-shadow']) out['--shadow'] = rule['text-shadow'];
  if (bg) out['--box'] = bg === 'none' ? 'transparent' : bg;
  if (rule.padding) out['--box-pad'] = rule.padding;
  if (rule['border-radius']) out['--box-radius'] = rule['border-radius'];
  if (rule['letter-spacing']) out['--spacing'] = rule['letter-spacing'];
  for (const [k, v] of Object.entries(rule)) if (k.startsWith('--')) out[k] = v;
  return out;
}
/* the inspector's size (a % of a text's box: `62vh`) and a caption's (a share of the frame's short side) */
export const toInspector = (size: string) => { const n = Number.parseFloat(size); return Number.isFinite(n) ? `${Math.round(n * 100) / 10}vh` : size; };
export const fromInspector = (size: string) => { const n = Number.parseFloat(size); return Number.isFinite(n) ? `${Math.round(n * 10) / 100}cqmin` : size; };


/** A caption's size, a share of the frame's short side (cqmin), as a rule says it (null: it says none). */
export function sizeOf(rule: Record<string, string>): number | null {
  const n = Number.parseFloat(varsOf(rule)['--size'] ?? '');
  return Number.isFinite(n) ? n : null;
}

/** The declarations that set `set` on a rule as the variables, its look so far kept as them and its plain CSS taken away. */
export function lookDecls(rule: Record<string, string>, set: Record<string, string>): Record<string, string | null> {
  const out: Record<string, string | null> = { ...varsOf(rule), ...set };
  for (const p of PLAIN) out[p] = null;
  return out;
}

/** A caption look's `::cue` rule (plain CSS, as film-subtitle's looks are written) as the text's variables. */
export function lookVars(css: string): Record<string, string> {
  return varsOf(cueRule(readVtt(`WEBVTT\n\nSTYLE\n${css}\n`), '::cue'));
}

/** What a look sets on a caption: each of a look's variables, a caption's own default where it says none (its size not). */
export function captionLookSet(vars: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(LOOK_VARS.map((k) => [k, vars[k] ?? CAPTION_DEFAULTS[k] ?? TEXT_DEFAULTS[k]!]));
}
