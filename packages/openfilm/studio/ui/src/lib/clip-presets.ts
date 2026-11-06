/**
 * A clip's animations of the library's (src/clip-motion.mjs withPreset): how it comes in, goes out and moves while it
 * shows, each one of the library's motions (library/catalogs/motions.json) in its slot of the clip's `animation`. What
 * a clip has on, which clips take one, and a motion's keyframes made for a small card in the inspector.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */
import { animationsOf } from '../../../../src/clip-motion.mjs';

export type PresetSlot = 'in' | 'out' | 'loop';
export const PRESET_SLOTS: readonly PresetSlot[] = ['in', 'out', 'loop'];

/** A motion as the library has it in one slot. */
export interface Preset { name: string; body: string; secs: number; ease: string }

/** What the clip's style has in each slot: the motion's keyframes' name and how long it takes (a loop: one round). */
export function presetsOn(style: string | undefined): Partial<Record<PresetSlot, { name: string; secs: number }>> {
  const out: Partial<Record<PresetSlot, { name: string; secs: number }>> = {};
  for (const entry of animationsOf(style)) {
    const [name = '', time = ''] = entry.trim().split(/\s+/);
    const slot = /^motion-(in|out|loop)-/.exec(name)?.[1] as PresetSlot | undefined;
    const secs = /^(\d*\.?\d+)(m?s)$/.exec(time);
    if (slot && secs && !out[slot]) out[slot] = { name, secs: Number(secs[1]) / (secs[2] === 'ms' ? 1000 : 1) };
  }
  return out;
}

/** The library's motions for a clip's slot, as listed: not a cut's (those are transitions). */
export function clipMotions<I extends { kind: string; place?: string | undefined; motion?: Partial<Record<PresetSlot, Preset>> | undefined }>(
  items: readonly I[], slot: PresetSlot,
): I[] {
  return items.filter((i) => i.kind === 'motion' && i.place !== 'cut' && i.motion?.[slot]);
}

/** Whether a motion is a clip's (it shows in the inspector's Animation, not in the library's drawer). */
export const isClipMotion = (item: { kind: string; place?: string | undefined }): boolean => item.kind === 'motion' && item.place !== 'cut';

/**
 * Whether a clip takes an animation: a video, a picture or a page that shows (a sticker, a template's place), not a
 * line of words of the library's (its own motions, the Text inspector's), nor a filter, an effect or a transition of the
 * library's, nor a sound.
 */
export function takesMotion(block: { kind: string; src?: string | undefined }): boolean {
  if (block.kind !== 'video' && block.kind !== 'mg') return false;
  const src = block.src?.split('#')[0] ?? '';
  return !/^saved\/openfilm\/(text-|filters-|effects-|transitions-)/.test(src);
}

/**
 * A motion's keyframes made for a small square card showing the clip: lengths of the stage (`vw`, `vh`) as the card's
 * own (a percentage of the picture moved), and blurs scaled by `blur` (a card is a fraction of the stage, so a
 * stage's blur would hardly show).
 */
export function cardBody(body: string, blur: number): string {
  return body
    .replace(/(-?\d*\.?\d+)v[wh]\b/g, '$1%')
    .replace(/blur\((\d*\.?\d+)px\)/g, (_, n: string) => `blur(${Math.round(Number(n) * blur * 10) / 10}px)`);
}

/** A keyframes body's frames, by where they are (`from` 0, `to` 100; `0%, 100%` one for each), in order. */
function framesOf(body: string): [number, string][] {
  const out: [number, string][] = [];
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const sel of m[1]!.split(',')) {
      const s = sel.trim();
      const at = s === 'from' ? 0 : s === 'to' ? 100 : Number.parseFloat(s);
      if (Number.isFinite(at)) out.push([at, m[2]!.trim()]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const pct = (n: number) => `${Math.round(n * 100) / 100}%`;

/**
 * A cut's camera move on a card showing a picture (a transition of the library's, `place: cut`): the picture going out
 * (the move's `out`) then coming in (its `in`), as one round of keyframes from rest to rest, each part as long as its
 * own and eased its own way, made for the card (cardBody).
 */
export function cutCardKeyframes(out: Preset, into: Preset, blur: number): string {
  const split = (out.secs / (out.secs + into.secs)) * 100;
  const frames: string[] = [`0% { animation-timing-function: ${out.ease} }`];
  for (const [at, decl] of framesOf(cardBody(out.body, blur))) {
    if (at === 0) frames[0] = `0% { ${decl}; animation-timing-function: ${out.ease} }`;
    else frames.push(`${pct(at === 100 ? split - 0.1 : (at * split) / 100)} { ${decl}${at === 100 ? '' : `; animation-timing-function: ${out.ease}`} }`);
  }
  const ins = framesOf(cardBody(into.body, blur));
  if (!ins.length || ins[0]![0] !== 0) frames.push(`${pct(split)} { animation-timing-function: ${into.ease} }`);
  for (const [at, decl] of ins) frames.push(`${pct(split + (at * (100 - split)) / 100)} { ${decl}${at === 100 ? '' : `; animation-timing-function: ${into.ease}`} }`);
  return frames.join(' ');
}
