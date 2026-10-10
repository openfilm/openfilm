/**
 * A family's weights and italics, as the inspector's weight menu offers them (Figma's: "Light", "Bold Italic"), and
 * a CSS `font-family` stack's first family, as the font field shows and changes it.
 *
 * What a family has comes from its faces: an installed font's OS/2 weight classes and italic bits (GET /api/fonts),
 * a project font's `@font-face` weights and styles (GET /api/projects/:id/fonts). A variable font has every weight
 * of its range; the menu offers the named ones in it.
 */

/** What a family has. `italics`: the weights it has an italic of; `variable`: its weight range. */
export interface FontStyles {
  weights: readonly number[];
  italics?: readonly number[];
  variable?: readonly [number, number];
}

/** One choice of the weight menu. */
export interface FontStyle {
  weight: number;
  italic: boolean;
}

/** The names CSS gives weights, as the menu says them (i18n `inspector.weights.w<key>`). */
export const NAMED_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** The named weight `w` is called by: the nearest (Avenir's 275 is Light), a tie the lighter. */
export function weightKey(w: number): (typeof NAMED_WEIGHTS)[number] {
  let best: (typeof NAMED_WEIGHTS)[number] = 400;
  for (const named of NAMED_WEIGHTS) if (Math.abs(named - w) < Math.abs(best - w)) best = named;
  return best;
}

/** `normal` / `bold` / `700` as a number; null when it is none (`bolder`, a variable). */
export function weightNumber(v: string | number | undefined | null): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v ?? '').trim().toLowerCase();
  if (raw === 'normal') return 400;
  if (raw === 'bold') return 700;
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n >= 1 && n <= 1000 ? n : null;
}

/** Whether a `font-style` is a slanted one. */
export const isItalic = (v: string | undefined | null) => /^(italic|oblique)\b/i.test(String(v ?? '').trim());

/**
 * The weight of `available` the browser draws `want` with, as CSS font matching picks it: 400–500 look up to 500
 * first, then down, then up; lighter look down first; heavier look up first. A variable range has `want` itself.
 */
export function nearestWeight(available: readonly number[], want: number, variable?: readonly [number, number]): number {
  if (variable && want >= variable[0] && want <= variable[1]) return want;
  const list = [...new Set(variable ? [...available, variable[0], variable[1]] : available)].sort((a, b) => a - b);
  if (!list.length) return want;
  if (list.includes(want)) return want;
  const below = list.filter((w) => w < want);
  const above = list.filter((w) => w > want);
  const down = () => below[below.length - 1];
  const up = () => above[0];
  if (want >= 400 && want <= 500) {
    const toFive = above.find((w) => w <= 500);
    return toFive ?? down() ?? up()!;
  }
  return want < 400 ? down() ?? up()! : up() ?? down()!;
}

/** The menu's choices for a family, lightest first, each upright then its italic. */
export function styleOptions(styles: FontStyles): FontStyle[] {
  const named = (list: readonly number[]) => {
    const range = styles.variable;
    /* a variable font: the named weights in its range (and any it says it has) */
    const all = range && list.length ? [...list, ...NAMED_WEIGHTS.filter((w) => w >= range[0] && w <= range[1])] : list;
    return [...new Set(all)].sort((a, b) => a - b);
  };
  const italics = new Set(named(styles.italics ?? []));
  const out: FontStyle[] = [];
  for (const weight of named(styles.weights)) {
    out.push({ weight, italic: false });
    if (italics.has(weight)) { out.push({ weight, italic: true }); italics.delete(weight); }
  }
  for (const weight of italics) out.push({ weight, italic: true });
  return out.sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));
}

/** The choice that stands for a weight and slant in the menu's value (`700`, `700 italic`). */
export const styleValue = (s: FontStyle) => (s.italic ? `${s.weight} italic` : String(s.weight));
export function parseStyleValue(v: string): FontStyle | null {
  const m = /^(\d+)( italic)?$/.exec(v.trim());
  return m ? { weight: Number(m[1]), italic: Boolean(m[2]) } : null;
}

/**
 * What a family draws `want` as: its nearest weight, and italic only when it has one (else upright: an italic it
 * does not have would be slanted by the browser, which no one picks).
 */
export function snapStyle(styles: FontStyles, want: FontStyle): FontStyle {
  const italics = styles.italics ?? [];
  const italic = want.italic && italics.length > 0;
  const list = italic ? italics : styles.weights.length ? styles.weights : italics;
  return { weight: nearestWeight(list, want.weight, styles.variable), italic };
}

/* ── a font-family stack ── */

/**
 * The font field shows the first family only (as Figma does); the fallbacks after it stay as written — changing the
 * main font must not replace `Inter, "PingFang SC", sans-serif` with one name.
 */
export function splitFontFamily(stack: string): [string, string] {
  const comma = stack.search(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/);
  const head = (comma < 0 ? stack : stack.slice(0, comma)).trim().replace(/^["']|["']$/g, '');
  return [head, comma < 0 ? '' : stack.slice(comma + 1).trim()];
}

/** A family as CSS writes it: quoted unless it is plain words (a generic name, `Geist`). */
export function cssFamily(name: string): string {
  const n = name.trim();
  if (/^["']/.test(n)) return n;
  return /^-?[A-Za-z_][\w-]*$/.test(n) ? n : `"${n.replace(/["\\]/g, '\\$&')}"`;
}

/** `primary` before the fallbacks `rest`, the fallbacks kept, `primary` not again among them. */
export function joinFontFamily(primary: string, rest: string): string {
  const name = cssFamily(primary);
  const plain = primary.trim().replace(/^["']|["']$/g, '').toLowerCase();
  /* the fallbacks as written (a `var()` stays one), but for the new font itself */
  const others = rest.split(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/).map((s) => s.trim())
    .filter((s) => s && s.replace(/^["']|["']$/g, '').trim().toLowerCase() !== plain);
  return [name, ...others].join(', ');
}
