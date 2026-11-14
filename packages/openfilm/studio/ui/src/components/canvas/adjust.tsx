/**
 * A picture's color, adjusted as photo apps do: a look to start from, then light, color, grading and effects, each a
 * slider. The preview is worked from a smaller copy; the result is worked from the picture itself with the same math
 * and kept as a PNG beside it.
 */
import React from 'react';
import { Check, Eye, Loader2, RotateCcw } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

/** the preview copy's long side, and the look thumbnails' */
const PREVIEW = 1400;
const THUMB = 120;

type Key =
  | 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks'
  | 'temperature' | 'tint' | 'vibrance' | 'saturation'
  | 'shadowTone' | 'highlightTone'
  | 'clarity' | 'sharpen' | 'vignette' | 'grain';
type Adjustments = Record<Key, number>;
type Slider = { key: Key; min: number; max: number; step: number; track?: string };

const ZERO: Adjustments = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, vibrance: 0, saturation: 0,
  shadowTone: 0, highlightTone: 0,
  clarity: 0, sharpen: 0, vignette: 0, grain: 0,
};

const both = (key: Key, track?: string): Slider => ({ key, min: -100, max: 100, step: 1, track });
const TEAL_ORANGE = 'linear-gradient(to right, #1f9bb0, #8a8f94, #f08a24)';
const GROUPS: Array<{ id: 'light' | 'color' | 'grading' | 'effects'; sliders: Slider[] }> = [
  { id: 'light', sliders: [{ key: 'exposure', min: -3, max: 3, step: 0.01 }, both('contrast'), both('highlights'), both('shadows'), both('whites'), both('blacks')] },
  { id: 'color', sliders: [
    both('temperature', 'linear-gradient(to right, #3d7bf0, #9a9a9a, #f2b632)'),
    both('tint', 'linear-gradient(to right, #34b25a, #9a9a9a, #d04bd6)'),
    both('vibrance'), both('saturation'),
  ] },
  /* split toning on the teal–orange axis: cool to the left, warm to the right */
  { id: 'grading', sliders: [both('shadowTone', TEAL_ORANGE), both('highlightTone', TEAL_ORANGE)] },
  { id: 'effects', sliders: [both('clarity'), { key: 'sharpen', min: 0, max: 100, step: 1 }, both('vignette'), { key: 'grain', min: 0, max: 100, step: 1 }] },
];

/** the looks: each only sets the sliders, so it can be tuned after */
const LOOKS: Array<{ id: string; set: Partial<Adjustments> }> = [
  { id: 'original', set: {} },
  { id: 'vivid', set: { contrast: 18, highlights: -12, shadows: 10, vibrance: 40, saturation: 8, clarity: 12 } },
  { id: 'warm', set: { temperature: 32, tint: 6, vibrance: 12, highlightTone: 10 } },
  { id: 'cool', set: { temperature: -30, tint: -4, contrast: 6, shadowTone: -10 } },
  { id: 'film', set: { contrast: 12, highlights: -25, shadows: 12, whites: -12, blacks: 18, temperature: 6, saturation: -12, grain: 30, vignette: -15 } },
  { id: 'mono', set: { saturation: -100, contrast: 25, clarity: 15, grain: 12 } },
  { id: 'faded', set: { contrast: -28, blacks: 38, whites: -18, highlights: -10, saturation: -25 } },
  { id: 'tealOrange', set: { contrast: 15, vibrance: 25, temperature: 4, shadowTone: -45, highlightTone: 38 } },
  { id: 'retro', set: { contrast: -12, blacks: 28, whites: -12, temperature: 18, tint: -6, saturation: -18, shadowTone: -18, highlightTone: 25, grain: 28, vignette: -22 } },
  { id: 'airy', set: { exposure: 0.35, contrast: -18, highlights: -22, shadows: 30, whites: 12, temperature: 4, vibrance: 8, saturation: -8, clarity: -12 } },
  { id: 'moody', set: { exposure: -0.25, contrast: 18, highlights: -35, shadows: -8, saturation: -28, shadowTone: -28, clarity: 12, vignette: -28 } },
  { id: 'matte', set: { contrast: 12, shadows: 6, blacks: 32, whites: -8, saturation: -8 } },
];
const KEYS = Object.keys(ZERO) as Key[];
const lookOf = (set: Partial<Adjustments>): Adjustments => ({ ...ZERO, ...set });

/* ---------- the math ---------- */

/** sRGB byte → linear light, and back (also past 1, for what exposure pushes over white) */
const TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
const toSrgb = (l: number) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** the tone curve on a gamma value: highlights and shadows, then the white and black points, then contrast */
function tone(p: number, a: Adjustments): number {
  const h = a.highlights / 100, s = a.shadows / 100;
  /* highlights down roll everything above the middle off softly, which also brings back what is past white */
  if (h < 0 && p > 0.5) p = 0.5 + (p - 0.5) / (1 - 1.2 * h * (p - 0.5));
  else if (h > 0 && p > 0.5 && p < 1) {
    const w = 2 * (1 - p);
    p = 1 - (w + (w ** (1 + h) - w) * (1 - w)) / 2;
  }
  /* shadows bend the lower half by a gamma that fades out toward the middle, so the curve stays smooth */
  if (s !== 0 && p < 0.5) {
    const u = 2 * p;
    p = (u + (u ** (2 ** -s) - u) * (1 - u)) / 2;
  }
  const white = 1 - 0.25 * (a.whites / 100), black = -0.2 * (a.blacks / 100);
  let x = clamp01((p - black) / (white - black));
  /* an S around the middle that keeps black and white where they are */
  x += (a.contrast / 100) * x * (1 - x) * (2 * x - 1);
  return clamp01(x);
}

/** each channel's curve from its byte: exposure and white balance as gains in linear light, then the tone curve */
function curves(a: Adjustments): [Float32Array, Float32Array, Float32Array] {
  const t = a.temperature / 100, m = a.tint / 100;
  const gain = [Math.exp(0.4 * t + 0.1 * m), Math.exp(-0.3 * m), Math.exp(-0.4 * t + 0.1 * m)];
  /* white balance keeps the brightness */
  const keep = 2 ** a.exposure / (0.2126 * gain[0]! + 0.7152 * gain[1]! + 0.0722 * gain[2]!);
  return gain.map((g) => Float32Array.from(TO_LINEAR, (l) => tone(toSrgb(l * g * keep), a))) as [Float32Array, Float32Array, Float32Array];
}

/** a box blur run three times (close to a Gaussian), in place on one channel */
function blur(a: Float32Array, tmp: Float32Array, w: number, h: number, r: number) {
  const n = 2 * r + 1;
  const sums = new Float32Array(w);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = a[row]! * (r + 1);
      for (let i = 1; i <= r; i++) sum += a[row + Math.min(i, w - 1)]!;
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / n;
        sum += a[row + Math.min(x + r + 1, w - 1)]! - a[row + Math.max(x - r, 0)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = tmp[x]! * (r + 1);
      for (let i = 1; i <= r; i++) sum += tmp[Math.min(i, h - 1) * w + x]!;
      sums[x] = sum;
    }
    for (let y = 0; y < h; y++) {
      const add = Math.min(y + r + 1, h - 1) * w, drop = Math.max(y - r, 0) * w;
      for (let x = 0; x < w; x++) {
        a[y * w + x] = sums[x]! / n;
        sums[x] = sums[x]! + tmp[add + x]! - tmp[drop + x]!;
      }
    }
  }
}

/** a fixed random value in [-1, 1] for a lattice point, so grain never flickers */
function hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) & 0xffff) / 32767.5 - 1;
}
/** grain between lattice points, so it has the same size at any resolution */
function noise(u: number, v: number) {
  const x = Math.floor(u), y = Math.floor(v), fx = u - x, fy = v - y;
  const a = hash(x, y), b = hash(x + 1, y), c = hash(x, y + 1), d = hash(x + 1, y + 1);
  return a + (b - a) * fx + (c - a + (d - c - b + a) * fx) * fy;
}

/** the luminance of a picture's bytes, 0–1 */
function lumaOf(d: Uint8ClampedArray, size: number) {
  const out = new Float32Array(size);
  for (let i = 0, o = 0; i < size; i++, o += 4) out[i] = (0.2126 * d[o]! + 0.7152 * d[o + 1]! + 0.0722 * d[o + 2]!) / 255;
  return out;
}

/**
 * The adjustments applied to `src`'s pixels into `out` (the same size; may be `src` itself). Every distance — the
 * blurs, the vignette, the grain — is relative to the picture's size, so a small copy looks as the full one will.
 */
function develop(src: ImageData, out: ImageData, a: Adjustments) {
  const { width: w, height: h } = src;
  const size = w * h, s = src.data, d = out.data;
  const [lr, lg, lb] = curves(a);
  const vib = (a.vibrance / 100) * 0.8, sat = 1 + a.saturation / 100;
  const shadowTone = (a.shadowTone / 100) * 0.15, highlightTone = (a.highlightTone / 100) * 0.15;
  for (let o = 0; o < size * 4; o += 4) {
    let r = lr[s[o]!]!, g = lg[s[o + 1]!]!, b = lb[s[o + 2]!]!;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let k = sat;
    /* vibrance lifts muted colors most, saturated ones little, and skin tones less */
    if (vib !== 0) {
      const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b);
      let skin = 0;
      if (vib > 0 && chroma > 0 && r >= g && g >= b) skin = Math.max(0, 1 - Math.abs((60 * (g - b)) / chroma - 25) / 20);
      k *= 1 + vib * (1 - chroma) * (1 - 0.7 * skin);
    }
    r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k;
    /* grading: shadows and highlights pushed along teal–orange, brightness kept */
    if (shadowTone !== 0 || highlightTone !== 0) {
      const t = shadowTone * (1 - y) ** 2 + highlightTone * y * y;
      r += 0.5 * t; g -= 0.05 * t; b -= 0.45 * t;
    }
    d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = s[o + 3]!;
  }

  const clarity = (a.clarity / 100) * 1.2, sharpen = (a.sharpen / 100) * 2, vignette = (a.vignette / 100) * 0.85, grain = (a.grain / 100) * 0.14;
  if (!clarity && !sharpen && !vignette && !grain) return;
  const long = Math.max(w, h);
  /* the blurred luminance local contrast and sharpening are measured against: wide for clarity, fine for sharpen */
  const tmp = clarity || sharpen ? new Float32Array(size) : null;
  const wide = clarity ? lumaOf(d, size) : null;
  if (wide) blur(wide, tmp!, w, h, Math.max(1, Math.round(long / 60)));
  const fine = sharpen ? lumaOf(d, size) : null;
  if (fine) blur(fine, tmp!, w, h, Math.max(1, Math.round(long / PREVIEW)));
  const cx = w / 2, cy = h / 2, cell = PREVIEW / long;
  for (let py = 0, i = 0; py < h; py++) {
    for (let px = 0; px < w; px++, i++) {
      const o = i * 4;
      let r = d[o]! / 255, g = d[o + 1]! / 255, b = d[o + 2]! / 255;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      let add = 0;
      /* clarity works on the midtones, leaving deep shadows and bright highlights alone */
      if (wide) add += clarity * (y - wide[i]!) * (1 - (2 * y - 1) ** 2);
      if (fine) add += sharpen * (y - fine[i]!);
      r += add; g += add; b += add;
      if (vignette) {
        const dx = (px + 0.5 - cx) / cx, dy = (py + 0.5 - cy) / cy;
        const e = clamp01((Math.sqrt((dx * dx + dy * dy) / 2) - 0.3) / 0.7);
        const f = vignette * e * e * (3 - 2 * e);
        if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
        else { r += (1 - r) * f; g += (1 - g) * f; b += (1 - b) * f; }
      }
      /* grain, strongest in the midtones as on film */
      if (grain) {
        const n = grain * noise(px * cell, py * cell) * (0.3 + 2.8 * y * (1 - y));
        r += n; g += n; b += n;
      }
      d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255;
    }
  }
}

/** a picture drawn to a canvas, no longer than `long` on its long side */
function drawn(img: HTMLImageElement, long = Infinity) {
  const scale = Math.min(1, long / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return ctx;
}
const pixelsOf = (ctx: CanvasRenderingContext2D) => ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

/* ---------- the editor ---------- */

export function AdjustEditor({ src, name, onClose, onDone }: {
  src: string;
  name: string;
  onClose: () => void;
  /** the adjusted picture, a PNG at its full size */
  onDone: (file: File) => Promise<void> | void;
}) {
  const t = useT();
  const [values, setValues] = React.useState<Adjustments>(ZERO);
  const [source, setSource] = React.useState<{ img: HTMLImageElement; preview: ImageData } | null>(null);
  const [thumbs, setThumbs] = React.useState<string[]>([]);
  const [failed, setFailed] = React.useState(false);
  const [comparing, setComparing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const view = React.useRef<HTMLCanvasElement>(null);
  const out = React.useRef<ImageData | null>(null);
  const frame = React.useRef(0);

  /* the picture, its preview copy, and the looks drawn once on a thumbnail copy */
  React.useEffect(() => {
    let live = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!live) return;
      try {
        const preview = pixelsOf(drawn(img, PREVIEW));
        const small = drawn(img, THUMB);
        const base = pixelsOf(small);
        const look = new ImageData(base.width, base.height);
        setThumbs(LOOKS.map((l) => { develop(base, look, lookOf(l.set)); small.putImageData(look, 0, 0); return small.canvas.toDataURL('image/jpeg', 0.85); }));
        out.current = new ImageData(preview.width, preview.height);
        setSource({ img, preview });
      } catch { setFailed(true); }
    };
    img.onerror = () => { if (live) setFailed(true); };
    img.src = src;
    return () => { live = false; };
  }, [src]);

  /* the preview, worked at most once a frame */
  React.useEffect(() => {
    if (!source) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const ctx = view.current?.getContext('2d');
      if (!ctx || !out.current) return;
      if (comparing) ctx.putImageData(source.preview, 0, 0);
      else { develop(source.preview, out.current, values); ctx.putImageData(out.current, 0, 0); }
    });
    return () => cancelAnimationFrame(frame.current);
  }, [source, values, comparing]);

  const apply = async () => {
    if (!source || busy) return;
    setBusy(true);
    try {
      /* let the busy button show before the full picture is worked */
      await new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)));
      const ctx = drawn(source.img);
      const full = pixelsOf(ctx);
      develop(full, full, values);
      ctx.putImageData(full, 0, 0);
      const blob = await new Promise<Blob | null>((done) => ctx.canvas.toBlob(done, 'image/png'));
      if (!blob) return;
      const base = name.replace(/\.[^./]+$/, '') || 'picture';
      await onDone(new File([blob], `${base}-color.png`, { type: 'image/png' }));
    } finally { setBusy(false); }
  };

  const keys = React.useRef<(event: KeyboardEvent) => void>(() => {});
  /* the dialog's own keys, not the board's under it: \ held shows the original, Enter applies; in a text box, the box's own */
  keys.current = (event) => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if ((event.target as HTMLElement).closest?.('textarea, input:not([type=range]), [contenteditable="true"]')) return;
    if (event.key === '\\') { event.preventDefault(); event.stopPropagation(); setComparing(true); }
    else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void apply(); }
  };
  React.useEffect(() => {
    const down = (event: KeyboardEvent) => keys.current(event);
    const up = (event: KeyboardEvent) => { if (event.key === '\\') setComparing(false); };
    const away = () => setComparing(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', away);
    };
  }, []);

  const set = (key: Key, value: number) => setValues((v) => ({ ...v, [key]: value }));
  const changed = KEYS.some((k) => values[k] !== 0);
  const lit = LOOKS.find((l) => { const look = lookOf(l.set); return KEYS.every((k) => look[k] === values[k]); })?.id;
  const tool = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] transition disabled:opacity-35 ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const hold = (on: boolean) => () => setComparing(on);
  return (
    <CanvasModal label={t('canvas.adjust.title')} onClose={onClose}>
      <div className="flex items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-2 text-[14px] font-semibold">{t('canvas.adjust.title')}</span>
        <span className="flex-1" />
        <button type="button" title={`${t('canvas.adjust.compare')} (\\)`} className={tool(comparing)} disabled={!source}
          onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerLeave={hold(false)} onPointerCancel={hold(false)}><Eye size={14} />{t('canvas.adjust.compare')}</button>
        <button type="button" className={tool(false)} disabled={!changed} onClick={() => setValues(ZERO)}><RotateCcw size={14} />{t('canvas.adjust.resetAll')}</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0 flex items-center justify-center px-6 py-4">
            {source ? (
              <canvas ref={view} width={source.preview.width} height={source.preview.height} className="block max-h-full max-w-full rounded-[10px]" />
            ) : failed ? (
              <span className="text-[13px] text-[var(--cv-ink-3)]">{t('canvas.adjust.failed')}</span>
            ) : (
              <Loader2 size={20} className="animate-spin text-[var(--cv-ink-3)]" />
            )}
          </div>
          {comparing ? <span className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] text-white">{t('canvas.adjust.original')}</span> : null}
        </div>
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l !border-[var(--cv-float-line)] px-4 pb-5 pt-3">
          <div className="mb-2 text-[12px] font-medium text-[var(--cv-ink-2)]">{t('canvas.adjust.looks')}</div>
          <div className="grid grid-cols-3 gap-2">
            {LOOKS.map((l, i) => (
              <button key={l.id} type="button" disabled={!source} onClick={() => setValues(lookOf(l.set))} className="group flex min-w-0 flex-col gap-1 text-left">
                <span className={`block aspect-square w-full overflow-hidden rounded-[8px] bg-[var(--cv-chip)] ${lit === l.id ? 'ring-2 ring-[var(--cv-ring)]' : 'ring-1 ring-inset ring-[var(--cv-float-line)]'}`}>
                  {thumbs[i] ? <img src={thumbs[i]} alt="" draggable={false} className="h-full w-full object-cover transition group-hover:scale-[1.04]" /> : null}
                </span>
                <span className={`truncate text-[11.5px] ${lit === l.id ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)]'}`}>{t(`canvas.adjust.look.${l.id}`)}</span>
              </button>
            ))}
          </div>
          {GROUPS.map((group) => {
            const moved = group.sliders.some((s) => values[s.key] !== 0);
            return (
              <section key={group.id} className="mt-5">
                <div className="mb-1 flex h-6 items-center justify-between">
                  <span className="text-[12px] font-medium text-[var(--cv-ink-2)]">{t(`canvas.adjust.group.${group.id}`)}</span>
                  {moved ? (
                    <button type="button" title={t('canvas.adjust.reset')} aria-label={t('canvas.adjust.reset')}
                      onClick={() => setValues((v) => ({ ...v, ...Object.fromEntries(group.sliders.map((s) => [s.key, 0])) }))}
                      className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--cv-ink-3)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><RotateCcw size={12} /></button>
                  ) : null}
                </div>
                {group.sliders.map((s) => <SliderRow key={s.key} slider={s} label={t(`canvas.adjust.slider.${s.key}`)} value={values[s.key]} disabled={!source} onChange={(v) => set(s.key, v)} />)}
              </section>
            );
          })}
        </aside>
      </div>
      <div className="flex items-center gap-3 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--cv-ink-3)]">{name}</span>
        <button type="button" disabled={!source || busy} onClick={() => { void apply(); }}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-35">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}{t('canvas.adjust.apply')}
        </button>
      </div>
    </CanvasModal>
  );
}

const THUMB_CLASS = '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--cv-ink)] [&::-webkit-slider-thumb]:shadow-[0_0_0_2px_var(--cv-modal)] [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[var(--cv-ink)]';

/** one slider: its name and value above, the track filled from zero (or colored for the color ones); a double-click resets it */
function SliderRow({ slider, label, value, disabled, onChange }: {
  slider: Slider;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { min, max, step, track } = slider;
  const at = (v: number) => ((v - min) / (max - min)) * 100;
  const from = Math.min(at(0), at(value)), to = Math.max(at(0), at(value));
  const line = 'color-mix(in srgb, var(--cv-ink) 14%, transparent)';
  const fill = track ?? `linear-gradient(to right, ${line} ${from}%, var(--cv-ink-2) ${from}% ${to}%, ${line} ${to}%)`;
  const shown = `${value > 0 && min < 0 ? '+' : ''}${step < 1 ? value.toFixed(2) : value}`;
  return (
    <label className="block py-1.5" onDoubleClick={() => onChange(0)}>
      <span className="flex items-center justify-between text-[12px]">
        <span className="text-[var(--cv-ink-2)]">{label}</span>
        <span className={`tabular-nums ${value ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>{shown}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}
        style={{ background: fill }}
        className={`mt-1.5 block h-1 w-full cursor-pointer appearance-none rounded-full disabled:cursor-default disabled:opacity-50 ${THUMB_CLASS}`} />
    </label>
  );
}
