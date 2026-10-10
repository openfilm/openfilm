/**
 * Line height and letter spacing as Figma takes them: "Auto", a percentage, px — and for line height a bare number,
 * CSS's multiple of the size. What is written is plain CSS: `normal`, `120%`, `24px`, `1.2` for a line height;
 * `normal`, `2px`, and a percentage of the size as `em` (`5%` → `0.05em`) for letter spacing.
 *
 * The font size menu's common sizes live here too.
 */

export type MetricKind = 'line-height' | 'letter-spacing';
/** A value as the field shows it: auto, or a number in a unit (`''`: a line height's multiple). */
export type Metric = 'auto' | { n: number; unit: '' | 'px' | '%' };

/** The sizes the font size menu offers, as Figma's does. */
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96, 120, 144, 160, 200] as const;

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** What the page's value (a number the stage measured, or CSS) is in the field's terms. */
export function metricOf(kind: MetricKind, v: string | number | undefined | null): Metric | undefined {
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? { n: round(v), unit: kind === 'line-height' ? '' : 'px' } : undefined;
  const s = v.trim().toLowerCase();
  if (s === 'normal' || s === 'auto') return 'auto';
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|%|em)?$/.exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2] ?? '';
  if (unit === 'em') return { n: round(n * 100), unit: '%' };
  if (unit === '') return kind === 'line-height' ? { n, unit: '' } : { n, unit: 'px' };
  return { n, unit: unit as 'px' | '%' };
}

/** The field's text for a value. */
export function showMetric(m: Metric | undefined, auto: string): string {
  if (m == null) return '';
  if (m === 'auto') return auto;
  return `${round(m.n)}${m.unit}`;
}

/**
 * What was typed, as the field's value; null when it does not read. `auto` (or the word in the person's language),
 * `120%`, `24px`, `1.2`; a bare number is a multiple for a line height, px for letter spacing.
 */
export function parseMetric(kind: MetricKind, text: string, autoWord = 'auto'): Metric | null {
  const s = text.trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;
  if (s === 'auto' || s === 'normal' || s === autoWord.trim().toLowerCase()) return 'auto';
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(px|%|em)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? '';
  if (unit === 'em') return { n: round(n * 100), unit: '%' };
  if (unit === '') return { n, unit: kind === 'line-height' ? '' : 'px' };
  if (kind === 'line-height' && n <= 0) return null;
  return { n, unit: unit as 'px' | '%' };
}

/** A value as CSS. */
export function metricCss(kind: MetricKind, m: Metric): string {
  if (m === 'auto') return 'normal';
  if (kind === 'letter-spacing' && m.unit === '%') return `${round(m.n / 100, 4)}em`;
  if (kind === 'letter-spacing' && m.n === 0) return '0px';
  return `${round(m.n)}${m.unit}`;
}

/** How far one step (an arrow, a few px of drag) moves a value in its unit. */
export function metricStep(m: Metric): number {
  if (m === 'auto') return 0;
  return m.unit === '' ? 0.05 : 1;
}

/**
 * `m` moved by `steps`; from auto, from what auto is (1.2 × the size for a line height, 0 for letter spacing). A
 * line height stays above 0.
 */
export function stepMetric(kind: MetricKind, m: Metric | undefined, steps: number): Metric {
  const base: Exclude<Metric, 'auto'> = m == null || m === 'auto'
    ? (kind === 'line-height' ? { n: 1.2, unit: '' } : { n: 0, unit: 'px' })
    : m;
  const next = round(base.n + steps * metricStep(base), base.unit === '' ? 2 : 1);
  return { n: kind === 'line-height' ? Math.max(base.unit === '' ? 0.05 : 1, next) : next, unit: base.unit };
}
