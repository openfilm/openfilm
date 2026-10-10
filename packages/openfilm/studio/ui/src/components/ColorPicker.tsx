/**
 * The color picker a swatch opens, drawn like Figma's: a saturation × brightness square, a hue strip,
 * an opacity strip, the hex and the opacity as numbers, and the colors used lately.
 *
 * Dragging previews (the picture follows the pointer, nothing is written); letting go commits once.
 * A typed hex commits on Enter or blur; a recent color commits on click.
 */
import React from 'react';
import { Pipette, X } from 'lucide-react';
import { useT } from '@/i18n';

type Hsv = { h: number; s: number; v: number; a: number };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function hexToHsv(hex: string): Hsv | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max, a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (k: number) => { const x = (k + h / 60) % 6; return v - v * s * Math.max(0, Math.min(x, 4 - x, 1)); };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255)) as [number, number, number];
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
function hsvToHex(c: Hsv): string {
  const [r, g, b] = hsvToRgb(c);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${c.a < 1 ? hex2(Math.round(c.a * 255)) : ''}`;
}

const RECENT_KEY = 'openfilm.colors.recent';
const STARTERS = ['#ffffff', '#111111', '#e5432d', '#ff7a1a', '#ffd166', '#2f9f64', '#1a93fe', '#7c5cff'];

function readRecent(): string[] {
  try {
    const kept = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    if (Array.isArray(kept) && kept.length) return kept.filter((x) => typeof x === 'string').slice(0, 16);
  } catch { /* private mode: the starters */ }
  return STARTERS;
}

function rememberColor(hex: string) {
  try {
    const next = [hex.toLowerCase(), ...readRecent().filter((x) => x.toLowerCase() !== hex.toLowerCase())].slice(0, 16);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* nothing to keep */ }
}

/** A pointer drag over an element, reported as 0–1 along x and y. */
function useDrag(onMove: (x: number, y: number) => void, onEnd: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const latest = React.useRef({ onMove, onEnd });
  latest.current = { onMove, onEnd };
  const at = (e: React.PointerEvent | PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    latest.current.onMove(clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      latest.current.onEnd();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { ref, onPointerDown };
}

const KNOB = 'pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.18),0_1px_3px_rgba(0,0,0,.3)]';
const CHECKER = { backgroundImage: 'repeating-conic-gradient(#d9d9d9 0 25%, #fff 0 50%)', backgroundSize: '8px 8px' };
const NUMBER = 'h-[26px] min-w-0 rounded-[5px] bg-[var(--fill-tsp)] px-2 text-[11px] text-[var(--text)] outline-none tabular-nums ring-1 ring-inset ring-transparent focus:bg-[var(--bg)] focus:ring-[1.5px] focus:ring-[var(--accent)]';

export function ColorPicker({
  label, value, onPreview, onCommit, onClose,
}: {
  label: string;
  /** `#rrggbb` or `#rrggbbaa` */
  value: string;
  onPreview: (hex: string) => void;
  onCommit: (hex: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [c, setC] = React.useState<Hsv>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 1, a: 1 });
  const [typed, setTyped] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<string[]>(STARTERS);
  React.useEffect(() => { setRecent(readRecent()); }, []);
  const hex = hsvToHex(c);
  const solid = hsvToHex({ ...c, a: 1 });
  const dirty = React.useRef(false);

  const preview = (next: Hsv) => { setC(next); setTyped(null); dirty.current = true; onPreview(hsvToHex(next)); };
  const commit = (h = hex) => { if (!dirty.current && h === value) return; dirty.current = false; rememberColor(h.slice(0, 7)); onCommit(h); };
  const sv = useDrag((x, y) => preview({ ...c, s: x, v: 1 - y }), () => commit());
  const hue = useDrag((x) => preview({ ...c, h: x * 359.9 }), () => commit());
  const alpha = useDrag((x) => preview({ ...c, a: Math.round(x * 100) / 100 }), () => commit());

  const commitTyped = () => {
    if (typed == null) return;
    const next = hexToHsv(`#${typed.replace(/^#/, '')}${c.a < 1 ? hex2(Math.round(c.a * 255)) : ''}`);
    setTyped(null);
    if (!next) return;
    setC(next); dirty.current = true; commit(hsvToHex(next));
  };
  const pick = async () => {
    const Dropper = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!Dropper) return;
    try {
      const { sRGBHex } = await new Dropper().open();
      const next = hexToHsv(sRGBHex);
      if (next) { preview({ ...next, a: c.a }); commit(hsvToHex({ ...next, a: c.a })); }
    } catch { /* cancelled */ }
  };

  return (
    <div
      data-color-picker=""
      className="w-[240px] select-none rounded-[12px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-3 text-[var(--text)] shadow-[0_16px_40px_-8px_rgba(0,0,0,.35),0_4px_12px_rgba(0,0,0,.14)]"
    >
      <div className="mb-2.5 flex h-5 items-center">
        <span className="text-[11px] font-semibold">{label}</span>
        <button type="button" onClick={onClose} aria-label={t('colorPicker.close')} className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <X size={13} />
        </button>
      </div>

      <div
        ref={sv.ref}
        onPointerDown={sv.onPointerDown}
        className="relative h-[156px] w-full cursor-crosshair overflow-hidden rounded-[6px]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${c.h} 100% 50%))` }}
      >
        <span className={KNOB} style={{ left: `${c.s * 100}%`, top: `${(1 - c.v) * 100}%`, background: solid }} />
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <button type="button" onClick={pick} aria-label={t('colorPicker.eyedropper')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <Pipette size={14} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div ref={hue.ref} onPointerDown={hue.onPointerDown} className="relative h-[10px] cursor-pointer rounded-full"
            style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
            <span className={KNOB} style={{ left: `${(c.h / 360) * 100}%`, top: '50%', background: `hsl(${c.h} 100% 50%)` }} />
          </div>
          <div ref={alpha.ref} onPointerDown={alpha.onPointerDown} className="relative h-[10px] cursor-pointer rounded-full" style={CHECKER}>
            <span className="absolute inset-0 rounded-full" style={{ background: `linear-gradient(to right, transparent, ${solid})` }} />
            <span className={KNOB} style={{ left: `${c.a * 100}%`, top: '50%', background: solid }} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-1.5">
        <span className="flex h-[26px] items-center rounded-[5px] px-1.5 text-[10.5px] text-[var(--text-faint)]">{t('colorPicker.hex')}</span>
        <input
          aria-label={`${label} hex`}
          value={typed ?? solid.slice(1).toUpperCase()}
          onChange={(e) => setTyped(e.target.value.replace(/[^0-9a-f#]/gi, '').slice(0, 7))}
          onBlur={commitTyped}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitTyped(); } }}
          className={`${NUMBER} flex-1 font-mono uppercase`}
        />
        <div className="relative w-[58px]">
          <input
            aria-label={`${label} opacity`}
            value={Math.round(c.a * 100)}
            onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); if (Number.isFinite(n)) preview({ ...c, a: clamp(n / 100) }); }}
            onBlur={() => commit()}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
            className={`${NUMBER} w-full pr-5`}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-[var(--text-faint)]">%</span>
        </div>
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-2.5">
        <div className="mb-2 text-[10.5px] text-[var(--text-faint)]">{t('colorPicker.recent')}</div>
        <div className="grid grid-cols-8 gap-[7px]">
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              aria-label={r}
              onClick={() => { const next = hexToHsv(r); if (next) { setC(next); dirty.current = true; onPreview(r); commit(r); } }}
              className={`h-5 w-5 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)] transition hover:scale-110 ${r.toLowerCase() === solid ? 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg-surface)]' : ''}`}
              style={{ background: r }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
