/**
 * A filter of the library as a clip wears it: a color grade, written into the clip's CSS `filter` as one SVG filter in
 * a data URL (`url("data:image/svg+xml,…#openfilm-look")`), first in the list so the inspector's adjustments go after
 * it and a mask's stroke stays last. The grade mixes the channels, sets the saturation and bends a tone curve per
 * channel; how strongly is how far each of those goes from leaving the picture as it is. The SVG says which filter it
 * is and how strong (`data-look='filters/teal-orange 0.8'`), so the inspector reads it back.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */
import { filterParts } from './clip-look.ts';

/** A grade, as the library writes it (library/catalogs/filters.json). Tables are tone curves: outputs 0–1 over even inputs. */
export interface Grade {
  /** Channel mix, rows red, green, blue: [r, g, b, offset] each (12 numbers). */
  mix?: number[];
  /** Saturation, 1 as it is. */
  sat?: number;
  /** A curve for every channel, then one per channel after it. */
  all?: number[];
  r?: number[];
  g?: number[];
  b?: number[];
}

/** The SVG filter's id. */
export const LOOK_FILTER_ID = 'openfilm-look';

const SAMPLES = 17;
const IDENTITY_MIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** A curve's value at x (0–1), straight between its points. */
function at(table: readonly number[] | undefined, x: number): number {
  if (!table?.length) return x;
  if (table.length === 1) return table[0]!;
  const p = clamp(x) * (table.length - 1);
  const i = Math.min(table.length - 2, Math.floor(p));
  return lerp(table[i]!, table[i + 1]!, p - i);
}

/** One channel's whole curve (every channel's, then its own), taken `amount` of the way from straight. */
function channel(grade: Grade, own: readonly number[] | undefined, amount: number): number[] {
  return Array.from({ length: SAMPLES }, (_, i) => {
    const x = i / (SAMPLES - 1);
    return round(clamp(lerp(x, at(own, at(grade.all, x)), amount)));
  });
}

const svgData = (svg: string) => `data:image/svg+xml,${svg.replace(/[%#<>"]/g, (c) => encodeURIComponent(c))}`;

/** The filter function a grade is at `amount` (0–1), named by the library's id. */
export function gradeFilter(id: string, grade: Grade, amount = 1): string {
  const k = clamp(amount);
  const parts: string[] = [];
  if (grade.mix?.length === 12) {
    const m = grade.mix.map((v, i) => round(lerp(IDENTITY_MIX[i]!, v, k)));
    const rows = [0, 1, 2].map((r) => `${m.slice(r * 4, r * 4 + 3).join(' ')} 0 ${m[r * 4 + 3]}`);
    parts.push(`<feColorMatrix type='matrix' values='${rows.join(' ')} 0 0 0 1 0'/>`);
  }
  if (grade.sat != null && grade.sat !== 1) parts.push(`<feColorMatrix type='saturate' values='${round(lerp(1, grade.sat, k))}'/>`);
  if (grade.all || grade.r || grade.g || grade.b) {
    const fn = (c: 'R' | 'G' | 'B', own: number[] | undefined) => `<feFunc${c} type='table' tableValues='${channel(grade, own, k).join(' ')}'/>`;
    parts.push(`<feComponentTransfer>${fn('R', grade.r)}${fn('G', grade.g)}${fn('B', grade.b)}</feComponentTransfer>`);
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg'><filter id='${LOOK_FILTER_ID}' x='0' y='0' width='1' height='1' color-interpolation-filters='sRGB' data-look='${id} ${round(k)}'>${parts.join('')}</filter></svg>`;
  return `url("${svgData(svg)}#${LOOK_FILTER_ID}")`;
}

/** Whether a filter function is a library filter's grade. */
export const isLookPart = (p: { name: string; args: string }) => p.name === 'url'
  && /^["']?data:image\/svg\+xml,/.test(p.args) && new RegExp(`#${LOOK_FILTER_ID}["']?$`).test(p.args);

const LOOK_RE = /data-look='([^' ]+) (\d*\.?\d+)'/;

/** Which library filter a clip's `filter` has, and how strong; null: none. */
export function gradeOf(filter: string | undefined): { id: string; amount: number } | null {
  const part = (filterParts(filter) ?? []).find(isLookPart);
  if (!part) return null;
  let svg: string;
  try { svg = decodeURIComponent(part.args.replace(/^["']?data:image\/svg\+xml,/, '')); } catch { return null; }
  const m = LOOK_RE.exec(svg);
  return m ? { id: m[1]!, amount: Number(m[2]) } : null;
}

/**
 * A clip's `filter` with `look` (a grade's filter function) in place of the one it has, first; null `look`: taken off.
 * The adjustments, shadow and stroke are kept as they are. Null: no filter left.
 */
export function withGrade(filter: string | undefined, look: string | null): string | null {
  const parts = filterParts(filter);
  /* a filter written by hand the panel cannot read: the look in its place */
  const kept = parts ? parts.filter((p) => !isLookPart(p)).map((p) => `${p.name}(${p.args})`) : [];
  const out = [...(look ? [look] : []), ...kept].join(' ');
  return out || null;
}
