/**
 * What a person types into a number field of the inspector, read as Figma and the editors read it: arithmetic
 * (`1440/2`), a change of the value there (`+20`, `-20`, `*2`, `/2`), and units — `px` is dropped, `50%` is half of
 * what the field measures against (the stage, for a place or a size), and a time takes seconds (`2.5s`), frames
 * (`12f`, at the timecode's 30 a second), milliseconds and timecodes (`00:00:02:15`).
 *
 * A leading `-` is a change, like `+`: "20 to the left". A negative value itself is typed in brackets, `(-20)`, or
 * worked out, `0-20`.
 */

/** A value to set, or a change of the value there (each of several selected things changes from its own). */
export type FieldInput = { set: number } | { rel: '+' | '-' | '*' | '/'; by: number };

export interface FieldContext {
  /**
   * What `100%` is: a number (the stage's width for an X), or `'self'` when the field is a percentage itself (an
   * opacity, a crop). Without it, `%` is not understood.
   */
  percent?: number | 'self';
  /** A time in seconds: `s`, `ms`, `f` and timecodes are understood (a bare number is seconds). */
  time?: boolean;
  /** Frames a second for `f` and timecodes. */
  fps?: number;
  /** The field's own unit marks, dropped when typed (`°`, `deg`, `×`, `x`). */
  units?: readonly string[];
}

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' };

const DEFAULT_FPS = 30;

/** The tokens of `raw`, units already applied to their numbers; null when something is not understood. */
function tokenize(raw: string, ctx: FieldContext, inScale: boolean): Token[] | null {
  const fps = ctx.fps ?? DEFAULT_FPS;
  const units = [...(ctx.units ?? [])].sort((a, b) => b.length - a.length);
  const out: Token[] = [];
  let i = 0;
  const s = raw.replace(/[−–]/g, '-').replace(/,/g, '.');
  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) { i += 1; continue; }
    if ('+-*/()'.includes(ch)) { out.push({ kind: 'op', value: ch as '+' }); i += 1; continue; }
    const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?::\d+(?:\.\d*)?)*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const rest = s.slice(i);
    const unit = /^(px|ms|s|f|%)/i.exec(rest)?.[1]?.toLowerCase() ?? units.find((u) => rest.toLowerCase().startsWith(u.toLowerCase()));
    if (unit) i += unit.length;
    let value: number;
    if (m[0].includes(':')) {
      /* a timecode: SS:FF, MM:SS:FF or HH:MM:SS:FF */
      if (!ctx.time || unit) return null;
      const parts = m[0].split(':').map(Number);
      if (parts.length > 4) return null;
      const frames = parts.pop()!;
      const [sec = 0, min = 0, hour = 0] = parts.reverse();
      value = hour * 3600 + min * 60 + sec + frames / fps;
    } else {
      const n = Number(m[0]);
      if (unit === 'px' || (unit && units.includes(unit))) value = n;
      else if (unit === '%') {
        /* a scale (`*50%`) is a fraction; otherwise a share of what the field measures against */
        if (inScale) value = n / 100;
        else if (ctx.percent === 'self') value = n;
        else if (typeof ctx.percent === 'number') value = (n / 100) * ctx.percent;
        else return null;
      } else if (unit === 's' || unit === 'ms' || unit === 'f') {
        if (!ctx.time) return null;
        value = unit === 's' ? n : unit === 'ms' ? n / 1000 : n / fps;
      } else value = n;
    }
    out.push({ kind: 'num', value });
  }
  return out;
}

/** Arithmetic over the tokens: + − × ÷, brackets, a sign before a number. */
function evaluate(tokens: Token[]): number | null {
  let at = 0;
  const peek = () => tokens[at];
  const isOp = (v: string) => { const t = peek(); return t?.kind === 'op' && t.value === v; };
  const factor = (): number | null => {
    const t = peek();
    if (!t) return null;
    if (t.kind === 'num') { at += 1; return t.value; }
    if (t.value === '-' || t.value === '+') {
      at += 1;
      const v = factor();
      return v == null ? null : t.value === '-' ? -v : v;
    }
    if (t.value === '(') {
      at += 1;
      const v = expr();
      if (v == null || !isOp(')')) return null;
      at += 1;
      return v;
    }
    return null;
  };
  const term = (): number | null => {
    let v = factor();
    while (v != null && (isOp('*') || isOp('/'))) {
      const op = (peek() as { value: string }).value;
      at += 1;
      const r = factor();
      if (r == null) return null;
      v = op === '*' ? v * r : r === 0 ? null : v / r;
    }
    return v;
  };
  const expr = (): number | null => {
    let v = term();
    while (v != null && (isOp('+') || isOp('-'))) {
      const op = (peek() as { value: string }).value;
      at += 1;
      const r = term();
      if (r == null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const v = expr();
  return v != null && at === tokens.length && Number.isFinite(v) ? v : null;
}

/** What was typed, or null when it does not read as a number. */
export function parseFieldInput(raw: string, ctx: FieldContext = {}): FieldInput | null {
  const text = raw.trim().replace(/^[−–]/, '-');
  if (!text) return null;
  const lead = /^[+\-*/]/.exec(text)?.[0] as '+' | '-' | '*' | '/' | undefined;
  if (lead) {
    const tokens = tokenize(text.slice(1), ctx, lead === '*' || lead === '/');
    const by = tokens && tokens.length ? evaluate(tokens) : null;
    if (by == null || (lead === '/' && by === 0)) return null;
    return { rel: lead, by };
  }
  const tokens = tokenize(text, ctx, false);
  const value = tokens ? evaluate(tokens) : null;
  return value == null ? null : { set: value };
}

/** The value `input` makes of `base`. */
export function applyFieldInput(input: FieldInput, base: number): number {
  if ('set' in input) return input.set;
  switch (input.rel) {
    case '+': return base + input.by;
    case '-': return base - input.by;
    case '*': return base * input.by;
    default: return base / input.by;
  }
}
