/**
 * How a picture looks, as CSS: what the inspector reads and writes for a whole clip (the `style` of its element in
 * film.html, past its place) and for a layer inside a page (its override's `style`) alike. Each control is one or two
 * standard CSS properties — `object-fit`, `object-position`, `clip-path: inset()`, `border-radius`, `opacity`,
 * `mix-blend-mode`, `filter`, `border`, `mask-image` — and everything else written there is kept as it is.
 *
 * The readers below take back what the controls write (and the usual ways of writing it by hand); a value they do
 * not understand is left to the raw CSS (the inspector's Advanced section), never rewritten.
 */
import { declarations } from '../../../../src/film-doc.mjs';

/** The look the film's CSS gives a picture, as the player measured it (src/timeline.mjs lookOf). */
export type ClipLook = { fit: string; position: string; radius: string; opacity: string; blend: string; clip: string; filter: string };

/** `style` with each of `set` written (a value) or taken out (null), in place where it was, new ones at the end. */
export function withDeclarations(style: string, set: Record<string, string | null>): string {
  const left = { ...set };
  const out: string[] = [];
  for (const [prop, value] of declarations(style)) {
    if (!(prop in left)) { out.push(`${prop}: ${value}`); continue; }
    const next = left[prop];
    delete left[prop];
    if (next != null) out.push(`${prop}: ${next}`);
  }
  for (const [prop, value] of Object.entries(left)) if (value != null) out.push(`${prop}: ${value}`);
  return out.join('; ');
}

/** One property of `style`, or undefined. */
export function declared(style: string, prop: string): string | undefined {
  return declarations(style).find(([k]) => k === prop)?.[1];
}

const round = (n: number, digits = 2) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};

/** A length in px from CSS (`24px`, `0`, a bare number), or undefined. */
export function pxOf(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const m = /^(-?\d+(?:\.\d+)?|-?\.\d+)(px)?$/.exec(String(v).trim());
  return m ? Number(m[1]) : undefined;
}

/* ───────────── crop: clip-path inset ───────────── */

/** A crop: how much of each edge is cut away, in % of the box (top, right, bottom, left). */
export type Crop = [number, number, number, number];

/** The crop of `clip-path: inset(…)` in %, or null for any other clip-path (or none). */
export function cropOf(clipPath: string | undefined): Crop | null {
  const m = /^inset\(\s*([^)]*?)\s*(?:round\s+[^)]*)?\)$/i.exec((clipPath ?? '').trim());
  if (!m) return clipPath && clipPath !== 'none' ? null : [0, 0, 0, 0];
  const parts = m[1]!.split(/\s+/).map((v) => (/^-?\d+(\.\d+)?%$/.test(v) ? Number(v.slice(0, -1)) : v === '0' || v === '0px' ? 0 : NaN));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  const [t = 0, r = t, b = t, l = r] = parts;
  return [t, r, b, l];
}

/** The clip-path of a crop, its corners `radius` px round (a crop cuts the box's own round corners away); null: none. */
export function cropCss(crop: Crop, radius: number): string | null {
  if (crop.every((n) => n === 0)) return null;
  return `inset(${crop.map((n) => `${round(n)}%`).join(' ')}${radius > 0 ? ` round ${round(radius)}px` : ''})`;
}

/** The crop that leaves the largest part of a `w` × `h` box of the proportions `ratio` (width ÷ height), centered. */
export function cropForRatio(w: number, h: number, ratio: number): Crop {
  if (!(w > 0 && h > 0 && ratio > 0)) return [0, 0, 0, 0];
  if (w / h > ratio) {
    const side = round(((1 - (h * ratio) / w) / 2) * 100);
    return [0, side, 0, side];
  }
  const side = round(((1 - w / (h * ratio)) / 2) * 100);
  return [side, 0, side, 0];
}

/** The proportions (width ÷ height) of what a crop leaves of a `w` × `h` box. */
export function cropRatio(crop: Crop, w: number, h: number): number {
  const cw = w * (1 - (crop[1] + crop[3]) / 100);
  const ch = h * (1 - (crop[0] + crop[2]) / 100);
  return cw > 0 && ch > 0 ? cw / ch : 0;
}

/* ───────────── framing: object-position ───────────── */

const POSITION_WORDS: Record<string, number> = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };

/** Where the picture sits in its box, in % across and down (`object-position`); null when written in other units. */
export function framingOf(v: string | undefined): [number, number] | null {
  const parts = (v ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return [50, 50];
  if (parts.length > 2) return null;
  const read = (p: string) => (p in POSITION_WORDS ? POSITION_WORDS[p]! : /^-?\d+(\.\d+)?%$/.test(p) ? Number(p.slice(0, -1)) : p === '0' ? 0 : NaN);
  if (parts.length === 1) {
    const p = parts[0]!;
    const n = read(p);
    if (!Number.isFinite(n)) return null;
    return p === 'top' || p === 'bottom' ? [50, n] : [n, 50];
  }
  /* `top left` names the axes the other way round */
  const [a, b] = /^(top|bottom)$/.test(parts[0]!) || /^(left|right)$/.test(parts[1]!) ? [parts[1]!, parts[0]!] : [parts[0]!, parts[1]!];
  const x = read(a);
  const y = read(b);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** `object-position` for a framing; null: centered, the default. */
export function framingCss([x, y]: [number, number]): string | null {
  return x === 50 && y === 50 ? null : `${round(x)}% ${round(y)}%`;
}

/* ───────────── filter: adjust and shadow ───────────── */

/** The picture adjustments, each 0 when untouched: brightness, contrast, saturation in % off as-is, hue in degrees, blur in px, grayscale in %. */
export type AdjustKey = 'brightness' | 'contrast' | 'saturate' | 'hue' | 'blur' | 'grayscale';
export const ADJUST_KEYS: readonly AdjustKey[] = ['brightness', 'contrast', 'saturate', 'hue', 'blur', 'grayscale'];

/** Each adjustment's CSS filter function. */
const FILTER_FN: Record<AdjustKey, string> = {
  brightness: 'brightness', contrast: 'contrast', saturate: 'saturate', hue: 'hue-rotate', blur: 'blur', grayscale: 'grayscale',
};

/** A filter's functions (`brightness(1.1)`, `drop-shadow(0 8px 24px rgba(0, 0, 0, .45))`), or null when it is not a list of them. */
export function filterParts(v: string | undefined): { name: string; args: string }[] | null {
  const s = (v ?? '').trim();
  if (!s || s === 'none') return [];
  const out: { name: string; args: string }[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i += 1;
    if (i >= s.length) break;
    const m = /^([a-z-]+)\(/i.exec(s.slice(i));
    if (!m) return null;
    let depth = 0;
    let j = i + m[1]!.length;
    for (; j < s.length; j += 1) {
      if (s[j] === '(') depth += 1;
      else if (s[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    if (depth !== 0) return null;
    out.push({ name: m[1]!.toLowerCase(), args: s.slice(i + m[1]!.length + 1, j).trim() });
    i = j + 1;
  }
  return out;
}

const joinFilter = (parts: { name: string; args: string }[]) => (parts.length ? parts.map((p) => `${p.name}(${p.args})`).join(' ') : null);

/** A number or a percentage as a factor (`1.1`, `110%`). */
const factorOf = (args: string) => (/^-?\d*\.?\d+%$/.test(args) ? Number(args.slice(0, -1)) / 100 : /^-?\d*\.?\d+$/.test(args) ? Number(args) : NaN);

/** An angle in degrees (`30deg`, `0.5turn`, `1rad`, `0`). */
const degOf = (args: string) => {
  const m = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(args);
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] === 'turn' ? n * 360 : m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'grad' ? n * 0.9 : m[2] || n === 0 ? n : NaN;
};

/** One adjustment from a filter function's arguments, in the panel's numbers (NaN: not readable). */
function adjustValue(key: AdjustKey, args: string): number {
  switch (key) {
    case 'brightness': case 'contrast': case 'saturate': return round((factorOf(args || '1') - 1) * 100, 1);
    case 'grayscale': return round(factorOf(args || '1') * 100, 1);
    case 'hue': return round(degOf(args || '0'), 1);
    default: return args ? pxOf(args) ?? NaN : 0;
  }
}

/** A filter function's arguments for an adjustment; null at its neutral value (the function goes). */
function adjustArgs(key: AdjustKey, n: number): string | null {
  if (n === 0) return null;
  switch (key) {
    case 'brightness': case 'contrast': case 'saturate': return String(round(1 + n / 100, 3));
    case 'grayscale': return `${round(n, 1)}%`;
    case 'hue': return `${round(n, 1)}deg`;
    default: return `${round(n, 1)}px`;
  }
}

/** The adjustments a filter makes: each 0 when the function is not there, null when it is but cannot be read. */
export function adjustOf(filter: string | undefined): Record<AdjustKey, number | null> {
  const parts = filterParts(filter) ?? [];
  const out = {} as Record<AdjustKey, number | null>;
  for (const key of ADJUST_KEYS) {
    const part = parts.find((p) => p.name === FILTER_FN[key]);
    const n = part ? adjustValue(key, part.args) : 0;
    out[key] = Number.isFinite(n) ? n : null;
  }
  return out;
}

/**
 * The filter with one adjustment set (the function in place where it was, a new one before any shadow so the shadow
 * is not tinted), or taken out at 0. Null: no filter left. Functions the panel has no control for are kept as written.
 */
export function withAdjust(filter: string | undefined, key: AdjustKey, n: number): string | null {
  const parts = filterParts(filter);
  if (!parts) return filter ?? null;
  const name = FILTER_FN[key];
  const args = adjustArgs(key, n);
  const at = parts.findIndex((p) => p.name === name);
  if (at >= 0) {
    if (args == null) parts.splice(at, 1);
    else parts[at] = { name, args };
  } else if (args != null) {
    const shadow = parts.findIndex((p) => p.name === 'drop-shadow');
    parts.splice(shadow < 0 ? parts.length : shadow, 0, { name, args });
  }
  return joinFilter(parts);
}

/** A drop shadow: offset and blur in px, and its color. */
export type Shadow = { x: number; y: number; blur: number; color: string };

export const SHADOW_DEFAULT: Shadow = { x: 0, y: 8, blur: 24, color: '#00000073' };

/** Top-level words of `s` (a color's own brackets kept whole). */
function words(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** A `drop-shadow()`'s arguments read (lengths in px, the color before or after them); null when not readable. */
function shadowArgs(args: string): Shadow | null {
  const lengths: number[] = [];
  const color: string[] = [];
  for (const w of words(args)) {
    const n = pxOf(w);
    if (n != null) lengths.push(n);
    else color.push(w);
  }
  if (lengths.length < 2 || lengths.length > 3 || color.length > 1) return null;
  return { x: lengths[0]!, y: lengths[1]!, blur: lengths[2] ?? 0, color: color[0] ?? 'currentcolor' };
}

/** The filter's drop shadow: undefined when there is none, null when there is one the panel cannot read. */
export function shadowOf(filter: string | undefined): Shadow | null | undefined {
  const part = filterParts(filter)?.find((p) => p.name === 'drop-shadow');
  return part ? shadowArgs(part.args) : undefined;
}

/** The filter with its drop shadow set (last, after the adjustments) or taken out (null). Null: no filter left. */
export function withShadow(filter: string | undefined, shadow: Shadow | null): string | null {
  const parts = filterParts(filter);
  if (!parts) return filter ?? null;
  const at = parts.findIndex((p) => p.name === 'drop-shadow');
  if (at >= 0) parts.splice(at, 1);
  if (shadow) {
    const args = `${round(shadow.x, 1)}px ${round(shadow.y, 1)}px ${round(Math.max(0, shadow.blur), 1)}px ${shadow.color}`;
    parts.splice(at >= 0 ? at : parts.length, 0, { name: 'drop-shadow', args });
  }
  return joinFilter(parts);
}

/** Whether the panel's controls say all of a filter (else it is shown as written in Advanced too). */
function filterOwned(filter: string): boolean {
  const parts = filterParts(filter);
  if (!parts) return false;
  const known = new Set(Object.values(FILTER_FN));
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    if (p.name === 'drop-shadow') { if (!shadowArgs(p.args)) return false; continue; }
    const key = ADJUST_KEYS.find((k) => FILTER_FN[k] === p.name);
    if (!key || !known.has(p.name) || !Number.isFinite(adjustValue(key, p.args))) return false;
  }
  return true;
}

/* ───────────── stroke: border ───────────── */

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type Stroke = { width: number; style: StrokeStyle; color: string };

export const STROKE_DEFAULT: Stroke = { width: 2, style: 'solid', color: '#ffffff' };

/** A `border` shorthand: undefined when there is none, null when the panel cannot read it. */
export function strokeOf(border: string | undefined): Stroke | null | undefined {
  const s = (border ?? '').trim();
  if (!s || s === 'none' || s === '0') return undefined;
  let width: number | undefined;
  let style: string | undefined;
  const color: string[] = [];
  for (const w of words(s)) {
    const n = pxOf(w);
    if (n != null && width == null) width = n;
    else if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(w) && style == null) style = w.toLowerCase();
    else color.push(w);
  }
  /* no style is `none`: nothing is drawn */
  if (style == null || style === 'none' || style === 'hidden' || width === 0) return color.length > 1 ? null : undefined;
  if (color.length > 1 || !/^(solid|dashed|dotted)$/.test(style)) return null;
  /* no width is `medium`, 3px */
  return { width: width ?? 3, style: style as StrokeStyle, color: color[0] ?? 'currentcolor' };
}

export function strokeCss(s: Stroke): string | null {
  return s.width > 0 ? `${round(s.width, 1)}px ${s.style} ${s.color}` : null;
}

/* ───────────── fade edges: mask-image ───────────── */

export type FadeSide = 'top' | 'right' | 'bottom' | 'left';
/** Edges faded out, each over `size` % of the box. */
export type Fade = { sides: Record<FadeSide, boolean>; size: number };

export const FADE_DEFAULT: Fade = { sides: { top: false, right: false, bottom: false, left: true }, size: 15 };

const CLEAR = String.raw`(?:transparent|rgba\(0,\s*0,\s*0,\s*0\))`;
const SOLID = String.raw`(?:#000(?:000)?|black|rgb\(0,\s*0,\s*0\))`;
const PCT = String.raw`(-?\d*\.?\d+)%`;

/** One gradient of a fade: which edges along one axis, over how much. */
function fadeAxis(g: string): { from: FadeSide; to: FadeSide; a: boolean; b: boolean; size: number } | null {
  let m = new RegExp(String.raw`^linear-gradient\(\s*to (right|bottom),\s*${CLEAR}(?: 0%?)?,\s*${SOLID} ${PCT},\s*${SOLID} ${PCT},\s*${CLEAR}(?: 100%)?\s*\)$`, 'i').exec(g);
  if (m) {
    const size = Number(m[2]);
    if (Math.abs(100 - Number(m[3]) - size) > 0.01) return null;
    return m[1] === 'right' ? { from: 'left', to: 'right', a: true, b: true, size } : { from: 'top', to: 'bottom', a: true, b: true, size };
  }
  m = new RegExp(String.raw`^linear-gradient\(\s*to (right|left|bottom|top),\s*${CLEAR}(?: 0%?)?,\s*${SOLID} ${PCT}\s*\)$`, 'i').exec(g);
  if (!m) return null;
  const size = Number(m[2]);
  const dir = m[1]!.toLowerCase();
  /* `to right` fades the left edge in */
  if (dir === 'right') return { from: 'left', to: 'right', a: true, b: false, size };
  if (dir === 'left') return { from: 'left', to: 'right', a: false, b: true, size };
  if (dir === 'bottom') return { from: 'top', to: 'bottom', a: true, b: false, size };
  return { from: 'top', to: 'bottom', a: false, b: true, size };
}

/**
 * The edges a `mask-image` fades out, as fadeCss writes it (one gradient an axis; two intersected by
 * `mask-composite: intersect`): undefined when there is no mask, null when it is another mask.
 */
export function fadeOf(maskImage: string | undefined, maskComposite?: string): Fade | null | undefined {
  const s = (maskImage ?? '').trim();
  if (!s || s === 'none') return undefined;
  const gradients = s.split(/,\s*(?=linear-gradient\()/i);
  if (gradients.length > 2) return null;
  if (gradients.length === 2 && (maskComposite ?? '').trim().toLowerCase() !== 'intersect') return null;
  const sides: Record<FadeSide, boolean> = { top: false, right: false, bottom: false, left: false };
  let size = 0;
  for (const g of gradients) {
    const axis = fadeAxis(g.trim());
    if (!axis || (size && Math.abs(axis.size - size) > 0.01) || sides[axis.from] || sides[axis.to]) return null;
    size = axis.size;
    sides[axis.from] = axis.a;
    sides[axis.to] = axis.b;
  }
  return { sides, size };
}

/** The `mask-image` (and `mask-composite`, with edges on both axes) that fades `fade`'s edges; nulls: none. */
export function fadeCss(fade: Fade | null): { 'mask-image': string | null; 'mask-composite': string | null } {
  const size = fade ? Math.max(0.5, Math.min(50, round(fade.size, 1))) : 0;
  const axis = (a: boolean, b: boolean, toA: string, toB: string) => {
    if (a && b) return `linear-gradient(to ${toB}, transparent, #000 ${size}%, #000 ${round(100 - size, 1)}%, transparent)`;
    if (a) return `linear-gradient(to ${toB}, transparent, #000 ${size}%)`;
    if (b) return `linear-gradient(to ${toA}, transparent, #000 ${size}%)`;
    return null;
  };
  const list = fade ? [
    axis(fade.sides.left, fade.sides.right, 'left', 'right'),
    axis(fade.sides.top, fade.sides.bottom, 'top', 'bottom'),
  ].filter((g): g is string => g != null) : [];
  return {
    'mask-image': list.length ? list.join(', ') : null,
    'mask-composite': list.length > 1 ? 'intersect' : null,
  };
}

/* ───────────── which declarations the controls say ───────────── */

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;

/**
 * Whether the inspector's controls show all of declaration `prop: value` — then the raw CSS (Advanced) need not.
 * Anything they would show only in part, or not understand, stays in Advanced as written.
 */
export function ownedDeclaration(prop: string, value: string, all: (p: string) => string | undefined): boolean {
  const v = value.trim();
  switch (prop) {
    case 'object-fit': return /^(contain|cover|fill)$/.test(v);
    case 'object-position': return framingOf(v) != null;
    case 'clip-path': return cropOf(v) != null;
    case 'border-radius': return pxOf(v) != null;
    case 'opacity': return /^\d*\.?\d+$/.test(v);
    case 'mix-blend-mode': return (BLEND_MODES as readonly string[]).includes(v);
    case 'filter': return filterOwned(v);
    case 'border': return strokeOf(v) !== null;
    case 'mask-image': return fadeOf(v, all('mask-composite')) != null;
    case 'mask-composite': return fadeOf(all('mask-image'), v) != null && v === 'intersect';
    default: return false;
  }
}
