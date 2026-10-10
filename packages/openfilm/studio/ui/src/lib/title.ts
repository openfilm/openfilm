/**
 * How long a project name may be. It must fit one line on cards and in the top bar, and characters alone do not
 * measure that: a CJK glyph is about twice as wide as a Latin one. So the budget is display width — full-width
 * glyphs cost 2, everything else 1 — which gives "30 CJK or 60 Latin characters" from one rule.
 */
export const TITLE_MAX_WIDTH = 60;

const FULL_WIDTH_RANGES: readonly [number, number][] = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK radicals, Kangxi, CJK symbols & punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, Hangul compat, CJK compat
  [0x3400, 0x4dbf], // CJK ext A
  [0x4e00, 0x9fff], // CJK unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compat ideographs
  [0xfe30, 0xfe6f], // CJK compat forms
  [0xff00, 0xff60], // Full-width forms
  [0xffe0, 0xffe6],
  [0x20000, 0x2fffd], // CJK ext B+
  [0x30000, 0x3fffd],
];

function charWidth(codePoint: number): number {
  return FULL_WIDTH_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi) ? 2 : 1;
}

/** Cut to the width budget, without an ellipsis (for typing: no "…" after every keystroke). */
export function limitTitleWidth(raw: string, maxWidth = TITLE_MAX_WIDTH): string {
  let width = 0;
  let out = '';
  for (const ch of raw) {
    const w = charWidth(ch.codePointAt(0)!);
    if (width + w > maxWidth) break;
    width += w;
    out += ch;
  }
  return out;
}
