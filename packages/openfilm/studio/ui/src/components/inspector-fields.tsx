/**
 * The inspector's fields, one kind of control per kind of value, the same wherever a value shows: a number (dragged
 * by its mark, stepped by the arrow keys, typed with arithmetic and units — see lib/field-input), a slider beside a
 * number for what is judged by eye, a row of choices, a color, a menu. And the section they sit in: titled, folded
 * away and back (each section remembers it), with an action or two beside its title.
 *
 * Every number field **paints first, then writes**: while it is dragged or typed only the picture changes
 * (`onPreview`); letting go, Enter, Tab or leaving the field commits (`onCommit`); Esc gives up (`onRevert`).
 *
 * A field may stand for several things at once (several clips): it then says "Mixed" when they differ, and what is
 * typed or dragged goes to each — `apply` turns each one's own value into its new one (`+20` moves each by 20).
 */
import * as React from 'react';
import { ChevronRight } from 'lucide-react';

import { useT } from '@/i18n';
import { applyFieldInput, parseFieldInput, type FieldContext } from '@/lib/field-input';
import { scrubFromDrag } from '@/lib/inspect-scrub';
import { metricCss, parseMetric, showMetric, stepMetric, type Metric, type MetricKind } from '@/lib/type-metrics';
import { Tooltip } from './Tooltip';
import { Popover } from './Popover';
import { ColorPicker } from './ColorPicker';

/* ───────────────────────────── skin ───────────────────────────── */

/** A field: light fill, no border; a thin edge on hover, the accent ring on focus. Figma's properties panel look. */
export const FIELD = 'group/field relative flex h-[26px] min-w-0 w-full items-center overflow-hidden rounded-[5px] bg-[var(--fill-tsp)] ring-1 ring-inset ring-transparent transition-[box-shadow,background-color] hover:ring-[var(--border)] focus-within:bg-[var(--bg)] focus-within:ring-[1.5px] focus-within:ring-[var(--accent)]';
export const INPUT = 'h-[26px] min-w-0 flex-1 border-0 bg-transparent pr-2 text-[11px] text-[var(--text)] outline-none tabular-nums placeholder:text-[var(--text-faint)]';
const PREFIX = 'flex h-[26px] w-[22px] shrink-0 select-none items-center justify-center text-[10.5px] text-[var(--text-faint)]';
/** A one-icon button in a header or beside a section title. */
export const HEAD_BTN = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40';
export const ICON = 13;

/** Several things selected that differ in a value. */
export const MIXED: unique symbol = Symbol('mixed');
export type Mixed = typeof MIXED;

/** Turns a thing's own value into its new one (one value typed for all, or a change of each). */
export type FieldApply = (base: number) => number;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/* ───────────────────────────── section ───────────────────────────── */

const CLOSED_KEY = 'openfilm.inspector.closed';
const closedListeners = new Set<() => void>();
let closedCache: Record<string, boolean> | null = null;

function readClosed(): Record<string, boolean> {
  if (closedCache) return closedCache;
  try {
    const raw = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}') as unknown;
    closedCache = raw && typeof raw === 'object' ? raw as Record<string, boolean> : {};
  } catch {
    closedCache = {};
  }
  return closedCache;
}

function writeClosed(id: string, closed: boolean): void {
  closedCache = { ...readClosed(), [id]: closed };
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(closedCache)); } catch { /* private window: this session only */ }
  for (const fn of closedListeners) fn();
}

/** Unfold a section (the selection bar's Mask opens the inspector there); `data-section` finds it to scroll to. */
export function openSection(id: string): void {
  if (readClosed()[id] !== false) writeClosed(id, false);
}

function useSectionClosed(id: string, closedByDefault: boolean): [boolean, (v: boolean) => void] {
  const closed = React.useSyncExternalStore(
    (fn) => { closedListeners.add(fn); return () => { closedListeners.delete(fn); }; },
    () => readClosed()[id] ?? closedByDefault,
    () => closedByDefault,
  );
  return [closed, (v) => writeClosed(id, v)];
}

/**
 * A section: its title folds it away (remembered per section, for every selection alike), `aside` holds its actions
 * (reset, add) and stays while folded.
 */
export function Section({
  id, title, aside, closedByDefault = false, children,
}: {
  /** Which section, for remembering it folded: the same id for a clip's and a layer's. */
  id: string;
  title: string;
  aside?: React.ReactNode;
  closedByDefault?: boolean;
  children: React.ReactNode;
}) {
  const [closed, setClosed] = useSectionClosed(id, closedByDefault);
  return (
    <section data-section={id} className="border-t border-[var(--border)] px-3 py-2">
      <div className="flex h-6 items-center gap-1">
        <button
          type="button"
          aria-expanded={!closed}
          onClick={() => setClosed(!closed)}
          className={`-ml-1 flex h-6 min-w-0 flex-1 items-center gap-0.5 rounded-[4px] pl-0.5 text-left text-[11px] font-semibold transition hover:text-[var(--text)] ${closed ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}
        >
          <ChevronRight size={11} className={`shrink-0 text-[var(--text-faint)] transition-transform ${closed ? '' : 'rotate-90'}`} />
          <span className="truncate">{title}</span>
        </button>
        {aside ? <div className="flex shrink-0 items-center gap-0.5">{aside}</div> : null}
      </div>
      {closed ? null : <div className="mt-1.5 flex flex-col gap-1.5 pb-1">{children}</div>}
    </section>
  );
}

/** The small button beside a section title (reset, add, and the like). */
export function SectionAction({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className={`${HEAD_BTN} h-5 w-5`}>
        {children}
      </button>
    </Tooltip>
  );
}

/** Fields side by side (two by default). */
export function Row({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  const grid = cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return <div className={`grid ${grid} gap-1.5`}>{children}</div>;
}

/** A small heading inside a section, over the fields it names, with its own actions on the right. */
export function SubLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex h-5 items-center justify-between gap-2 text-[10.5px] text-[var(--text-muted)]">
      <span className="truncate">{children}</span>
      {aside ? <span className="flex shrink-0 items-center gap-0.5">{aside}</span> : null}
    </div>
  );
}

/* ───────────────────────────── number ───────────────────────────── */

/** The unit marks a field takes when typed, by the unit it shows. */
function unitMarks(unit: string | undefined): string[] {
  if (unit === '°') return ['°', 'deg'];
  if (unit === '×') return ['×', 'x'];
  return [];
}

/** The fields in the panel a Tab goes between, in order. */
function stepFocus(from: HTMLInputElement, back: boolean): void {
  const panel = from.closest('[data-film-inspector]');
  if (!panel) return;
  const fields = [...panel.querySelectorAll<HTMLInputElement>('input[data-insp-field]')].filter((el) => !el.disabled);
  const at = fields.indexOf(from);
  const next = fields[at + (back ? -1 : 1)];
  if (next) { next.focus(); next.select(); } else from.blur();
}

/**
 * A number: drag the mark on its left sideways (Shift ten times coarser, Alt ten times finer), click into it to
 * type; ↑↓ a step (Shift ×10, Alt ×0.1); Tab and Shift+Tab to the next and the one before; Enter keeps, Esc gives up.
 * Typed: `1440/2`, `+20`, `-20`, `*2`, `50%` (of `ctx.percent`), `12f`, `2.5s` (a time field), `px` dropped.
 */
export function NumField({
  label, prefix, word, value, onCommit, onPreview, onRevert, step = 1, min, max, unit, placeholder, ctx, format, bare, disabled, trailing,
}: {
  label: string;
  /** The mark at the left, the drag handle: a letter or a small glyph (the label's first letter by default). */
  prefix?: React.ReactNode;
  /** The whole label as the mark, for fields whose first letter says nothing (Start, Duration, In point, Speed). */
  word?: boolean;
  value: number | undefined | Mixed;
  /** `n`: the new value of a field that stands for one thing; `apply`: each thing's, for several. */
  onCommit: (n: number, apply: FieldApply) => void;
  onPreview?: (n: number, apply: FieldApply) => void;
  /**
   * Takes the preview back off the picture. Esc, an interrupted drag and an unreadable entry left behind all come
   * here — or the picture keeps a look the film does not have. Without it, the old value is previewed again.
   */
  onRevert?: () => void;
  step?: number;
  min?: number;
  max?: number;
  /** The gray unit after the number (`%`, `s`, `°`, `px`). Shown only; the value does not include it. */
  unit?: string;
  placeholder?: string;
  /** How what is typed reads (what 100% is, whether it is a time); `%` fields take their own unit anyway. */
  ctx?: FieldContext;
  /** How the value is shown (a timecode); typed back through `ctx`. */
  format?: (n: number) => string;
  /** No mark at the left (the number beside a slider): dragged by the slider instead. */
  bare?: boolean;
  disabled?: boolean;
  /** At the right end, after the unit: a menu of common values (font sizes). */
  trailing?: React.ReactNode;
}) {
  const t = useT();
  const mixed = value === MIXED;
  const num = typeof value === 'number' ? value : undefined;
  const shown = React.useCallback((n: number | undefined) => (n == null ? '' : format ? format(n) : String(round3(n))), [format]);
  const [raw, setRaw] = React.useState(shown(num));
  const [focused, setFocused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const drag = React.useRef<{ x: number; start: number; moved: boolean } | null>(null);
  /* while typing, don't follow the value from outside — a preview's re-render would overwrite the half-typed number;
     while dragging the mark neither: the outside value is this preview measured back, and following it jitters */
  React.useEffect(() => { if (!focused && !dragging) setRaw(shown(num)); }, [num, mixed, focused, dragging, shown]);
  const clamp = (n: number) => round3(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
  const context: FieldContext = { ...(unit === '%' ? { percent: 'self' as const } : {}), ...ctx, units: unitMarks(unit) };
  /** What `text` does to a value, or null when it does not read. */
  const applyOf = (text: string): FieldApply | null => {
    const input = parseFieldInput(text, context);
    return input ? (base) => clamp(applyFieldInput(input, base)) : null;
  };
  const previewed = React.useRef(false);
  /* Esc gives up, and the blur that follows must not commit (it may come before the reverted value has rendered) */
  const cancelled = React.useRef(false);
  const preview = (apply: FieldApply) => {
    previewed.current = true;
    onPreview?.(apply(num ?? 0), apply);
  };
  const revert = () => {
    setRaw(shown(num));
    if (!previewed.current) return;
    previewed.current = false;
    if (onRevert) onRevert();
    else if (num != null) onPreview?.(num, () => num);
  };
  const finish = (apply: FieldApply) => {
    const next = apply(num ?? 0);
    setRaw(mixed ? '' : shown(next));
    /* once previewed, always commit: the preview moved the layer, so the measured value already equals the new one,
       and comparing against it would swallow the change — moved on the picture, never written */
    const wasPreviewed = previewed.current;
    previewed.current = false;
    if (mixed || next !== num || wasPreviewed) onCommit(next, apply);
  };
  const commit = () => {
    /* left as it was shown: nothing typed (a timecode shows frames, and reading it back would move a time to one) */
    if (raw === shown(num) && !previewed.current) return;
    const apply = raw.trim() === '' ? null : applyOf(raw);
    if (!apply) { revert(); return; }
    finish(apply);
  };
  /* a drag or an arrow on several things: a change of each, shown as typed (`+12`) */
  const relText = (d: number) => (d >= 0 ? `+${round3(d)}` : `-${round3(-d)}`);
  const scrubTo = (d: { start: number }, dx: number, mods: { shift: boolean; alt: boolean }): FieldApply => {
    if (mixed) {
      const delta = scrubFromDrag(0, dx, step, mods);
      setRaw(relText(delta));
      return (base) => clamp(base + delta);
    }
    const next = clamp(scrubFromDrag(d.start, dx, step, mods));
    setRaw(shown(next));
    return () => next;
  };
  const scrubProps = {
    onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.button !== 0 || disabled) return;
      e.preventDefault();
      const typed = applyOf(raw);
      drag.current = { x: e.clientX, start: !mixed && typed && raw !== '' ? typed(num ?? 0) : (num ?? 0), moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLSpanElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      if (!d.moved && Math.abs(dx) < 2) return;
      d.moved = true;
      setDragging(true);
      preview(scrubTo(d, dx, { shift: e.shiftKey, alt: e.altKey }));
    },
    onPointerUp: (e: React.PointerEvent<HTMLSpanElement>) => {
      const d = drag.current;
      drag.current = null;
      setDragging(false);
      if (!d) return;
      if (!d.moved) {
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      finish(scrubTo(d, e.clientX - d.x, { shift: e.shiftKey, alt: e.altKey }));
    },
    onPointerCancel: () => {
      drag.current = null;
      setDragging(false);
      revert();
    },
  };
  const mark = prefix ?? (word ? label : label.slice(0, 1));
  return (
    <Tooltip label={label}>
      <div className={`${FIELD} ${dragging ? 'ring-[var(--border-strong)]' : ''} ${disabled ? 'opacity-50' : ''}`}>
        {bare ? <span className="w-2 shrink-0" /> : (
          <span
            {...scrubProps}
            aria-hidden
            className={`${PREFIX} ${word ? '!w-auto whitespace-nowrap pl-2 pr-1.5' : ''} ${disabled ? '' : 'cursor-ew-resize touch-none hover:text-[var(--text)]'}`}
          >
            {mark}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          data-insp-field
          aria-label={label}
          value={raw}
          disabled={disabled}
          placeholder={mixed ? t('inspector.mixed') : placeholder}
          onChange={(e) => {
            cancelled.current = false;
            setRaw(e.target.value);
            const apply = e.target.value.trim() === '' ? null : applyOf(e.target.value);
            /* a change of each (`+20`) shows on each as typed; a value typed for one, as typed */
            if (apply) preview(apply);
          }}
          onFocus={(e) => { cancelled.current = false; setFocused(true); e.currentTarget.select(); }}
          onBlur={() => {
            setFocused(false);
            if (cancelled.current) { cancelled.current = false; return; }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelled.current = true;
              revert();
              requestAnimationFrame(() => inputRef.current?.blur());
            } else if (e.key === 'Tab') {
              /* the next field, not the next button: the blur commits this one */
              e.preventDefault();
              stepFocus(e.currentTarget, e.shiftKey);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const by = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
              if (mixed) {
                const sofar = /^[+-]/.test(raw) ? Number(raw) : 0;
                const delta = round3((Number.isFinite(sofar) ? sofar : 0) + by);
                setRaw(relText(delta));
                preview((base) => clamp(base + delta));
                return;
              }
              const typed = raw.trim() === '' ? null : applyOf(raw);
              const next = clamp((typed ? typed(num ?? 0) : (num ?? 0)) + by);
              setRaw(shown(next));
              preview(() => next);
            }
          }}
          className={`${INPUT} pl-0`}
        />
        {unit && raw !== '' && !/[a-z%°×:]$/i.test(raw) ? (
          <span className={`pointer-events-none ${trailing ? 'pr-0.5' : 'pr-2'} text-[10.5px] text-[var(--text-faint)]`}>{unit}</span>
        ) : null}
        {trailing}
      </div>
    </Tooltip>
  );
}

/**
 * A type measure that is not only a number (line height, letter spacing): "Auto", a percentage, px — and for a line
 * height a bare multiple (see lib/type-metrics). Dragged by its mark and stepped by ↑↓ in its own unit; typed, the
 * picture follows as it reads; Enter or leaving keeps it, Esc gives up. For several things, what is typed goes to each.
 */
export function MetricField({
  label, prefix, kind, value, placeholder, onPreview, onCommit, onRevert,
}: {
  label: string;
  prefix: React.ReactNode;
  kind: MetricKind;
  value: Metric | undefined | Mixed;
  placeholder?: string;
  /** The value as CSS, shown on the picture only. */
  onPreview: (css: string) => void;
  onCommit: (css: string) => void;
  onRevert: () => void;
}) {
  const t = useT();
  const auto = t('inspector.auto');
  const mixed = value === MIXED;
  const metric = mixed ? undefined : value;
  const shown = showMetric(metric, auto);
  const [raw, setRaw] = React.useState(shown);
  const [focused, setFocused] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const drag = React.useRef<{ x: number; start: Metric | undefined; moved: boolean } | null>(null);
  const previewed = React.useRef(false);
  const cancelled = React.useRef(false);
  React.useEffect(() => { if (!focused && !dragging) setRaw(shown); }, [shown, focused, dragging]);
  const preview = (m: Metric) => { previewed.current = true; onPreview(metricCss(kind, m)); };
  const revert = () => {
    setRaw(shown);
    if (!previewed.current) return;
    previewed.current = false;
    onRevert();
  };
  const finish = (m: Metric) => {
    setRaw(showMetric(m, auto));
    const wasPreviewed = previewed.current;
    previewed.current = false;
    if (mixed || wasPreviewed || metricCss(kind, m) !== (metric ? metricCss(kind, metric) : '')) onCommit(metricCss(kind, m));
  };
  const commit = () => {
    if (raw === shown && !previewed.current) return;
    const m = parseMetric(kind, raw, auto);
    if (!m) { revert(); return; }
    finish(m);
  };
  const typedNow = () => parseMetric(kind, raw, auto) ?? metric;
  const scrubbed = (d: { start: Metric | undefined }, dx: number, shift: boolean) => {
    const m = stepMetric(kind, d.start, Math.round(dx / 4) * (shift ? 10 : 1));
    setRaw(showMetric(m, auto));
    return m;
  };
  return (
    <Tooltip label={label}>
      <div className={`${FIELD} ${dragging ? 'ring-[var(--border-strong)]' : ''}`}>
        <span
          aria-hidden
          className={`${PREFIX} cursor-ew-resize touch-none hover:text-[var(--text)]`}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            drag.current = { x: e.clientX, start: typedNow(), moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const dx = e.clientX - d.x;
            if (!d.moved && Math.abs(dx) < 2) return;
            d.moved = true;
            setDragging(true);
            preview(scrubbed(d, dx, e.shiftKey));
          }}
          onPointerUp={(e) => {
            const d = drag.current;
            drag.current = null;
            setDragging(false);
            if (!d) return;
            if (!d.moved) { inputRef.current?.focus(); inputRef.current?.select(); return; }
            finish(scrubbed(d, e.clientX - d.x, e.shiftKey));
          }}
          onPointerCancel={() => { drag.current = null; setDragging(false); revert(); }}
        >
          {prefix}
        </span>
        <input
          ref={inputRef}
          type="text"
          data-insp-field
          aria-label={label}
          value={raw}
          placeholder={mixed ? t('inspector.mixed') : placeholder}
          onChange={(e) => {
            cancelled.current = false;
            setRaw(e.target.value);
            const m = parseMetric(kind, e.target.value, auto);
            if (m) preview(m);
          }}
          onFocus={(e) => { cancelled.current = false; setFocused(true); e.currentTarget.select(); }}
          onBlur={() => {
            setFocused(false);
            if (cancelled.current) { cancelled.current = false; return; }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelled.current = true;
              revert();
              requestAnimationFrame(() => inputRef.current?.blur());
            } else if (e.key === 'Tab') {
              e.preventDefault();
              stepFocus(e.currentTarget, e.shiftKey);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const m = stepMetric(kind, typedNow(), (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
              setRaw(showMetric(m, auto));
              preview(m);
            }
          }}
          className={`${INPUT} pl-0`}
        />
      </div>
    </Tooltip>
  );
}

/* ───────────────────────────── slider ───────────────────────────── */

/**
 * A value judged by eye: its name, a slider and the number. A slider whose neutral value is in its middle (brightness,
 * hue) is filled from the middle out and marked there. Dragged, the picture follows; let go, it is written; a
 * double-click puts it back to neutral. The number beside it takes everything a number field takes.
 */
export function SliderField({
  label, value, min, max, neutral = min, step = 1, unit, fieldMin, fieldMax, onPreview, onCommit, onRevert, disabled, placeholder,
}: {
  label: string;
  value: number | undefined | Mixed;
  /** The slider's range; the number may go further (`fieldMin` / `fieldMax`). */
  min: number;
  max: number;
  /** As is: where a double-click puts it, and where its fill starts. */
  neutral?: number;
  step?: number;
  unit?: string;
  fieldMin?: number;
  fieldMax?: number;
  onPreview?: (n: number, apply: FieldApply) => void;
  onCommit: (n: number, apply: FieldApply) => void;
  onRevert?: () => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const mixed = value === MIXED;
  const num = typeof value === 'number' ? value : undefined;
  const [slide, setSlide] = React.useState<number | null>(null);
  const shown = Math.min(max, Math.max(min, slide ?? num ?? neutral));
  /* arrow keys: a write per press would be a write, a repaint and an undo step each; write 400 ms after the last */
  const keyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = (n: number | null) => {
    if (keyTimer.current) { clearTimeout(keyTimer.current); keyTimer.current = null; }
    if (n != null && (n !== num || mixed)) onCommit(n, () => n);
    setSlide(null);
  };
  React.useEffect(() => () => { if (keyTimer.current) clearTimeout(keyTimer.current); }, []);
  const pct = (n: number) => ((n - min) / (max - min || 1)) * 100;
  const from = Math.min(pct(neutral), pct(shown));
  const to = Math.max(pct(neutral), pct(shown));
  const centred = neutral > min && neutral < max;
  return (
    <div className={`grid grid-cols-[64px_minmax(0,1fr)_56px] items-center gap-2 ${disabled ? 'opacity-50' : ''}`}>
      <span className="truncate text-[11px] text-[var(--text-muted)]" title={label}>{label}</span>
      <div className="relative flex h-[26px] items-center">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--border-strong)]">
          {mixed && slide == null ? null : (
            <div className="absolute inset-y-0 rounded-full bg-[var(--text-muted)]" style={{ left: `${from}%`, width: `${to - from}%` }} />
          )}
          {centred ? <div className="absolute -top-[3px] h-[9px] w-px bg-[var(--text-faint)]" style={{ left: `${pct(neutral)}%` }} /> : null}
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => {
            const n = Number(e.target.value);
            setSlide(n);
            onPreview?.(n, () => n);
          }}
          onPointerUp={() => settle(slide)}
          onKeyUp={() => {
            if (keyTimer.current) clearTimeout(keyTimer.current);
            const n = slide;
            keyTimer.current = setTimeout(() => settle(n), 400);
          }}
          onBlur={() => { if (keyTimer.current) settle(slide); }}
          onDoubleClick={() => { setSlide(null); onCommit(neutral, () => neutral); }}
          className={`relative h-[26px] w-full cursor-pointer appearance-none bg-transparent
            [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:bg-transparent
            [&::-webkit-slider-thumb]:-mt-[4.5px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--bg)] [&::-webkit-slider-thumb]:shadow-[0_0_0_1px_var(--border-strong),0_1px_3px_rgba(0,0,0,0.25)]
            [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:bg-transparent
            [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--bg)] [&::-moz-range-thumb]:shadow-[0_0_0_1px_var(--border-strong),0_1px_3px_rgba(0,0,0,0.25)]`}
        />
      </div>
      <NumField
        bare
        label={label}
        value={slide ?? value}
        unit={unit}
        step={step}
        min={fieldMin ?? min}
        max={fieldMax ?? max}
        disabled={disabled}
        {...(placeholder ? { placeholder } : {})}
        onCommit={onCommit}
        {...(onPreview ? { onPreview } : {})}
        {...(onRevert ? { onRevert } : {})}
      />
    </div>
  );
}

/* ───────────────────────────── choices ───────────────────────────── */

export function Segmented({
  label, value, options, onChange, small,
}: {
  label: string;
  /** MIXED, or a value none of the options has: none is on. */
  value: string | Mixed;
  options: { value: string; label: React.ReactNode; title?: string }[];
  onChange: (next: string) => void;
  small?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-[26px] w-full items-center gap-0.5 rounded-[5px] bg-[var(--fill-tsp)] p-px">
      {options.map((opt) => {
        const on = opt.value === value;
        const button = (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={opt.title}
            onClick={() => { if (!on) onChange(opt.value); }}
            className={`flex h-6 min-w-0 flex-1 items-center justify-center truncate rounded-[4px] px-1 font-medium transition ${small ? 'text-[10.5px]' : 'text-[11px]'} ${
              on
                ? 'bg-[var(--bg)] text-[var(--text)] shadow-[0_0_0_0.5px_var(--border-strong),0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {opt.label}
          </button>
        );
        return opt.title ? <Tooltip key={opt.value} label={opt.title}>{button}</Tooltip> : button;
      })}
    </div>
  );
}

/** A menu of named choices, as a field. */
export function SelectField({
  label, value, options, onCommit, prefix,
}: {
  label: string;
  value: string | Mixed;
  options: { value: string; label: string }[];
  onCommit: (next: string) => void;
  /** A word before the menu (Blend), as the other fields have their mark. */
  prefix?: string;
}) {
  const t = useT();
  const current = value === MIXED ? '' : value;
  return (
    <Tooltip label={label}>
      <div className={FIELD}>
        {prefix ? <span className="shrink-0 whitespace-nowrap pl-2 pr-1 text-[10.5px] text-[var(--text-faint)]">{prefix}</span> : null}
        <select
          aria-label={label}
          value={current}
          onChange={(e) => {
            if (e.target.value === '' || e.target.value === current) return;
            onCommit(e.target.value);
            /* hand focus back once picked: a focused select takes Space, ⌘Z and Delete as typing */
            e.currentTarget.blur();
          }}
          className={`${INPUT} cursor-pointer appearance-none bg-[length:9px] bg-[right_8px_center] bg-no-repeat ${prefix ? 'pl-0' : 'pl-2'} pr-6`}
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M1 1l4 4 4-4\' fill=\'none\' stroke=\'%23999\' stroke-width=\'1.4\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E")',
          }}
        >
          {!options.some((opt) => opt.value === current) ? (
            <option value={current}>{value === MIXED ? t('inspector.mixed') : current === '' ? '—' : current}</option>
          ) : null}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </Tooltip>
  );
}

/* ───────────────────────────── color ───────────────────────────── */

/**
 * A color: swatch + hex (with its opacity after it when it has one). The swatch opens our own picker (ColorPicker,
 * like Figma's); the hex can be typed too (`#` optional). Gradients, `url()` and the like show as written, with a
 * checkerboard swatch — that is not one color, and the picker cannot make it.
 */
export function ColorField({
  label, value, onCommit, onPreview,
}: {
  label: string;
  value: string | Mixed;
  onCommit: (next: string) => void;
  /** While picking (the picker dragged): the picture only, nothing written. */
  onPreview?: (next: string) => void;
}) {
  const t = useT();
  const mixed = value === MIXED;
  const own = mixed ? '' : value;
  const hexOf = (v: string) => (/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : /^#[0-9a-fA-F]{3,4}$/.test(v)
    ? `#${v.slice(1).split('').map((c) => c + c).join('')}` : null);
  /* the hex without its alpha: the opacity shows after it, in % */
  const shownOf = (v: string) => (hexOf(v) ? hexOf(v)!.slice(1, 7).toUpperCase() : v);
  const alphaOf = (v: string) => { const h = hexOf(v); return h && h.length === 9 ? Math.round((parseInt(h.slice(7), 16) / 255) * 100) : null; };
  const [raw, setRaw] = React.useState(shownOf(own));
  const [live, setLive] = React.useState<string | null>(null);
  React.useEffect(() => { setRaw(shownOf(own)); setLive(null); }, [own]);
  const [picking, setPicking] = React.useState(false);
  const cancelled = React.useRef(false);
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    const typed = raw.trim();
    /* 3/4/6/8 hex digits; anything else is up to the browser: `red`, `rgb()` are taken, `zzz` reverts */
    let next = /^[0-9a-fA-F]{3,4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(typed) ? `#${typed.toLowerCase()}` : typed;
    /* typed six digits over a color with alpha: the alpha stays */
    const alpha = hexOf(own)?.slice(7) ?? '';
    if (/^#[0-9a-f]{6}$/.test(next) && alpha) next += alpha.toLowerCase();
    const valid = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' ? CSS.supports('color', next) : true;
    if (!next || !valid || next === own) {
      setRaw(shownOf(own));
      return;
    }
    onCommit(next);
  };
  const hex = hexOf(live ?? own);
  const alpha = alphaOf(live ?? own);
  return (
    <Tooltip label={label}>
      <div className={FIELD}>
        <Popover
          open={picking}
          onOpenChange={(open) => { setPicking(open); if (!open) setLive(null); }}
          placement="auto"
          align="end"
          trigger={(
            <button type="button" aria-label={label} className="flex h-[26px] w-[24px] shrink-0 cursor-pointer items-center justify-center">
              <span
                className="block h-3.5 w-3.5 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)]"
                style={hex
                  ? { background: `linear-gradient(${hex}, ${hex}), repeating-conic-gradient(#d5d5d5 0 25%, #fff 0 50%) 0 0 / 6px 6px` }
                  : { backgroundImage: 'repeating-conic-gradient(#d5d5d5 0 25%, #fff 0 50%)', backgroundSize: '6px 6px' }}
              />
            </button>
          )}
        >
          <ColorPicker
            label={label}
            value={hexOf(own) ?? '#ffffff'}
            onPreview={(next) => { setLive(next); setRaw(shownOf(next)); onPreview?.(next); }}
            onCommit={(next) => { setLive(null); if (next !== hexOf(own)) onCommit(next); }}
            onClose={() => { setPicking(false); setLive(null); }}
          />
        </Popover>
        <input
          type="text"
          aria-label={label}
          value={raw}
          placeholder={mixed ? t('inspector.mixed') : undefined}
          onChange={(e) => { cancelled.current = false; setRaw(e.target.value.replace(/^#/, '')); }}
          onFocus={() => { cancelled.current = false; }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              cancelled.current = true;
              setRaw(shownOf(own));
            }
          }}
          className={`${INPUT} font-mono text-[11px] uppercase`}
        />
        {alpha != null ? <span className="pointer-events-none pr-2 text-[10.5px] tabular-nums text-[var(--text-muted)]">{alpha}%</span> : null}
      </div>
    </Tooltip>
  );
}

/* ───────────────────────────── time ───────────────────────────── */

const TIME_KEY = 'openfilm.inspector.time';
type TimeUnit = 'timecode' | 'seconds';
const timeListeners = new Set<() => void>();

function readTimeUnit(): TimeUnit {
  try { return localStorage.getItem(TIME_KEY) === 'seconds' ? 'seconds' : 'timecode'; } catch { return 'timecode'; }
}

/** How times show in the inspector: a timecode (as the player shows it) or seconds; one choice for every field. */
export function useTimeUnit(): [TimeUnit, (next: TimeUnit) => void] {
  const unit = React.useSyncExternalStore(
    (fn) => { timeListeners.add(fn); return () => { timeListeners.delete(fn); }; },
    readTimeUnit,
    () => 'timecode' as const,
  );
  return [unit, (next) => {
    try { localStorage.setItem(TIME_KEY, next); } catch { /* this session only */ }
    for (const fn of timeListeners) fn();
  }];
}

/* ───────────────────────────── glyphs ───────────────────────────── */

/* Figma's little marks that lucide does not have: opacity (half-filled square), radius, angle, type sizes. */
export function OpacityGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <rect x="0.75" y="0.75" width="9.5" height="9.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 9.5L9.5 1.5V8.25A1.25 1.25 0 0 1 8.25 9.5Z" fill="currentColor" />
    </svg>
  );
}

export function RadiusGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <path d="M1 10V5a4 4 0 0 1 4-4h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function RotateGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <path d="M1.5 9.5h8M1.5 9.5L7.5 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5.2 9.5a3.8 3.8 0 0 0-1.1-2.7" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export function FontSizeGlyph() {
  return (
    <svg width="12" height="11" viewBox="0 0 12 11" aria-hidden>
      <path d="M1 3V1.5h6V3M4 1.5v8M2.8 9.5h2.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      <path d="M8 6V5h3.5v1M9.75 5v4.5M9 9.5h1.5" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function LineHeightGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <path d="M1 1h9M1 10h9M3.5 8L5.5 3l2 5M4.2 6.5h2.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LetterSpacingGlyph() {
  return (
    <svg width="12" height="11" viewBox="0 0 12 11" aria-hidden>
      <path d="M1 1v9M11 1v9M4 8l2-5.5L8 8M4.7 6.3h2.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** One edge of a box, darker (crop and fade sides): `side` is the edge drawn. */
export function EdgeGlyph({ side }: { side: 'top' | 'right' | 'bottom' | 'left' }) {
  const edge = { top: 'M1.5 1.5h8', right: 'M9.5 1.5v8', bottom: 'M1.5 9.5h8', left: 'M1.5 1.5v8' }[side];
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
      <rect x="1.5" y="1.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d={edge} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
