/**
 * Title length policy for session titles.
 *
 * A title has to fit one line in cards, the project header, share pages and
 * download filenames. Counting characters alone does not describe that budget:
 * a CJK glyph occupies roughly twice the width of a Latin one, so 60 Chinese
 * characters overflow everywhere that 60 Latin characters fit. We therefore
 * budget *display width* — CJK and other full-width glyphs cost 2, everything
 * else costs 1 — which yields the intended "30 Chinese characters or 60 Latin
 * characters" cap from a single rule.
 */
export const TITLE_MAX_WIDTH = 60;

/** Session titles are shorter: about 15 CJK or 30 Latin characters. */
export const SESSION_TITLE_MAX_WIDTH = 30;

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

/** Display width of a title: CJK glyphs count as 2, everything else as 1. */
export function titleWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch.codePointAt(0)!);
  return width;
}

/**
 * Trim a title to the width budget, appending an ellipsis when it was cut.
 * Whitespace is collapsed first so wrapped or multi-line model output does not
 * waste the budget on newlines. Surrogate pairs are never split.
 */
export function clampTitle(raw: string, maxWidth = TITLE_MAX_WIDTH): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (titleWidth(text) <= maxWidth) return text;
  // Leave room for the ellipsis so the result still fits the budget.
  const budget = Math.max(1, maxWidth - 1);
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = charWidth(ch.codePointAt(0)!);
    if (width + w > budget) break;
    width += w;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/** Cuts to the width budget without an ellipsis (for an input while typing). */
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
