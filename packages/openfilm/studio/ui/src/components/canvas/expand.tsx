/**
 * A picture widened: the canvas round it made larger as in a drawing program — its edges and corners dragged out, its
 * size typed in pixels, or a shape picked — the picture moved in it, edges snapping to a grid and the picture's middle
 * to the canvas's when snapping is on; then the canvas round the picture filled by a model that redraws where a mask
 * leaves it clear. A model makes a few shapes only: the canvas is sent grown to the nearest of them (the picture on a
 * soft blur of itself, so the new edges start from its own colors; a mask clear everywhere but the picture), and what
 * comes back is cut to the canvas set, at its size in pixels.
 */
import React from 'react';
import { ArrowUp, Check, ChevronDown, Grid3x3, Link2, Link2Off } from 'lucide-react';
import { ProviderMark } from '../settings/ProviderMark';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

/** the shapes offered; `×1.5` and `×2` grow it round the picture, keeping its own shape */
const FRAMES = ['free', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'x1.5', 'x2'] as const;
type Frame = typeof FRAMES[number];
/** the longest side of what goes to the model */
const LONGEST = 2048;
/** the largest canvas, against the picture */
const GROW_MAX = 4;

/** a canvas, in the picture's pixels: the picture is at 0,0, its own size */
interface Box { x: number; y: number; w: number; h: number }
export interface Expanded {
  /** clear where the model draws, opaque on the picture: at the shape it is made at */
  mask: Blob;
  /** the shape it is made at (one the model makes) */
  ratio: string;
  words: string;
  /** where the picture sits in what is made, as a share of it */
  place: { x: number; y: number; w: number; h: number };
  /** the canvas set, as a share of what is made, and its size in pixels: what is made is cut to it */
  crop: { x: number; y: number; w: number; h: number; width: number; height: number };
}

/** where the picture sits and what is cut, written into the mask's name: a node made again reads them back */
export function expandName(stamp: string, place: Expanded['place'], crop: Expanded['crop']) {
  const n = (r: { x: number; y: number; w: number; h: number }) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 100000)).join('_');
  return `expand-mask-${stamp}-p${n(place)}-c${n(crop)}-${crop.width}x${crop.height}.png`;
}
export function expandPlan(mask: string | undefined): { place: Expanded['place']; crop: Expanded['crop'] } | null {
  const m = mask ? /-p(-?\d+)_(-?\d+)_(\d+)_(\d+)-c(-?\d+)_(-?\d+)_(\d+)_(\d+)-(\d+)x(\d+)\.png$/.exec(mask) : null;
  if (!m) return null;
  const v = m.slice(1).map(Number);
  const k = (i: number) => v[i]! / 100000;
  return { place: { x: k(0), y: k(1), w: k(2), h: k(3) }, crop: { x: k(4), y: k(5), w: k(6), h: k(7), width: v[8]!, height: v[9]! } };
}

/**
 * What the model is given: the picture where it sits in the shape it is made at, on a soft blur of itself (so the new
 * edges start from its own colors), as large as the mask.
 */
export async function framedPicture(picture: string, mask: string, place: Expanded['place']): Promise<Blob> {
  const [img, m] = await Promise.all([loadImage(picture), loadImage(mask)]);
  const W = m.naturalWidth; const H = m.naturalHeight;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.filter = 'blur(48px)';
  ctx.drawImage(img, 0, 0, W, H);
  ctx.filter = 'none';
  ctx.drawImage(img, place.x * W, place.y * H, place.w * W, place.h * H);
  return new Promise<Blob>((done, fail) => out.toBlob((x) => (x ? done(x) : fail(new Error('no picture was made'))), 'image/png'));
}

/** what a widening is asked first, before the person's own words (added when it is made, not kept in its words) */
export const EXPAND_ASK = 'Extend the picture into the empty area around it: continue the scene naturally beyond its edges with the same style, light, perspective and detail, so it reads as one seamless picture; keep the original area exactly as it is.';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((done, fail) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => done(img);
    img.onerror = () => fail(new Error('the picture did not load'));
    img.src = src;
  });
}
const ratioValue = (r: string) => { const [a, b] = r.split(':').map(Number); return a && b ? a / b : 1; };
/** the shape among `ratios` nearest to `r` */
const nearest = (r: number, ratios: readonly string[]) => ratios.reduce((best, x) => (Math.abs(Math.log(ratioValue(x) / r)) < Math.abs(Math.log(ratioValue(best) / r)) ? x : best), ratios[0] ?? '1:1');

/** a picture model, whether it fills a canvas round a picture (redraws where a mask is clear), and the shapes it makes */
export interface ExpandModel { key: string; name: string; via: string; mask: boolean; ratios: readonly string[] }

export function ExpandEditor({ src, models, model: firstModel, onClose, onMake }: {
  src: string;
  /** the connected picture models; only one that redraws where a mask is clear can widen a picture */
  models: readonly ExpandModel[];
  /** the one picked first */
  model?: string;
  onClose: () => void;
  onMake: (expanded: Expanded, model: string) => Promise<void>;
}) {
  const t = useT();
  const [modelKey, setModelKey] = React.useState(firstModel ?? models.find((m) => m.mask)?.key);
  const picked = models.find((m) => m.key === modelKey) ?? models.find((m) => m.mask) ?? models[0];
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const ratios = picked?.ratios ?? [];
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = React.useState<Frame>('16:9');
  const [box, setBox] = React.useState<Box | null>(null);
  const [snap, setSnap] = React.useState(true);
  const [lock, setLock] = React.useState(true);
  const [words, setWords] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [guides, setGuides] = React.useState<{ x: number[]; y: number[] }>({ x: [], y: [] });
  const stage = React.useRef<HTMLDivElement>(null);
  const [room, setRoom] = React.useState({ w: 0, h: 0 });
  const drag = React.useRef<{ kind: string; x: number; y: number; from: Box } | null>(null);
  React.useEffect(() => { void loadImage(src).then(setImg, () => {}); }, [src]);
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const seen = new ResizeObserver(([entry]) => { if (entry) setRoom({ w: entry.contentRect.width, h: entry.contentRect.height }); });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const iw = img?.naturalWidth ?? 1;
  const ih = img?.naturalHeight ?? 1;
  /* the grid snapped to, in the picture's pixels: a 64th of its long side, in whole 8s */
  const grid = Math.max(8, Math.round(Math.max(iw, ih) / 64 / 8) * 8);
  /* the canvas a shape asks for: the least of that shape holding the picture (or the picture grown), round it */
  const shaped = (f: Frame): Box => {
    if (f === 'free') return { x: -iw * 0.15, y: -ih * 0.15, w: iw * 1.3, h: ih * 1.3 };
    const grow = f === 'x2' ? 2 : f === 'x1.5' ? 1.5 : 0;
    let w: number; let h: number;
    if (grow) { w = iw * grow; h = ih * grow; } else {
      const r = ratioValue(f);
      w = Math.max(iw, ih * r); h = w / r;
      if (h < ih) { h = ih; w = h * r; }
      /* a shape the picture already has still widens it a little */
      if (Math.abs(w - iw) < 1 && Math.abs(h - ih) < 1) { w *= 1.25; h *= 1.25; }
    }
    return { x: (iw - w) / 2, y: (ih - h) / 2, w, h };
  };
  React.useEffect(() => { if (img) setBox(shaped(frame)); }, [img]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = box ?? shaped(frame);
  const aspect = lock && frame !== 'free' ? (frame.startsWith('x') ? iw / ih : ratioValue(frame)) : null;

  /* the canvas kept round the picture, no larger than GROW_MAX of it */
  const held = (n: Box): Box => {
    let { x, y, w, h } = n;
    w = Math.min(Math.max(w, iw), iw * GROW_MAX); h = Math.min(Math.max(h, ih), ih * GROW_MAX);
    x = Math.min(0, Math.max(x, iw - w)); y = Math.min(0, Math.max(y, ih - h));
    return { x, y, w, h };
  };
  /* snapped: an edge to the grid, or the picture's middle to the canvas's */
  const snapped = (n: Box, moving: string): { box: Box; gx: number[]; gy: number[] } => {
    if (!snap) return { box: n, gx: [], gy: [] };
    const near = Math.max(grid * 0.6, Math.max(iw, ih) * 0.012);
    const gx: number[] = []; const gy: number[] = [];
    let { x, y, w, h } = n;
    const to = (v: number) => Math.round(v / grid) * grid;
    if (moving === 'move') {
      const cx = -x - (w - iw) / 2; const cy = -y - (h - ih) / 2;
      if (Math.abs(cx) < near) { x = -(w - iw) / 2; gx.push(iw / 2); }
      if (Math.abs(cy) < near) { y = -(h - ih) / 2; gy.push(ih / 2); }
    } else {
      if (moving.includes('w')) { const r = x + w; x = to(x); w = r - x; }
      if (moving.includes('e')) w = to(x + w) - x;
      if (moving.includes('n')) { const bt = y + h; y = to(y); h = bt - y; }
      if (moving.includes('s')) h = to(y + h) - y;
    }
    return { box: { x, y, w, h }, gx, gy };
  };

  const view = b.w && room.w ? Math.min((room.w - 80) / b.w, (room.h - 80) / b.h) : 0;
  const ox = room.w / 2 - (b.x + b.w / 2) * view;
  const oy = room.h / 2 - (b.y + b.h / 2) * view;

  const down = (kind: string) => (event: React.PointerEvent) => {
    event.stopPropagation();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = { kind, x: event.clientX, y: event.clientY, from: b };
  };
  const move = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !view) return;
    const dx = (event.clientX - d.x) / view; const dy = (event.clientY - d.y) / view;
    let n = { ...d.from };
    if (d.kind === 'move') { n.x -= dx; n.y -= dy; }
    else {
      if (d.kind.includes('w')) { n.x += dx; n.w -= dx; }
      if (d.kind.includes('e')) n.w += dx;
      if (d.kind.includes('n')) { n.y += dy; n.h -= dy; }
      if (d.kind.includes('s')) n.h += dy;
      if (aspect) {
        /* the shape kept: the side pulled leads, the other follows round the same middle */
        const pullsW = d.kind.includes('w') || d.kind.includes('e');
        const pullsH = d.kind.includes('n') || d.kind.includes('s');
        if (pullsW && (!pullsH || Math.abs(dx) >= Math.abs(dy))) { const h = n.w / aspect; n.y -= (h - n.h) / 2; n.h = h; }
        else { const w = n.h * aspect; n.x -= (w - n.w) / 2; n.w = w; }
      }
    }
    const s = aspect && d.kind !== 'move' ? { box: n, gx: [], gy: [] } : snapped(n, d.kind);
    n = held(s.box);
    setGuides({ x: s.gx, y: s.gy });
    setBox(n);
    if (!aspect && d.kind !== 'move') setFrame('free');
  };
  const up = () => { drag.current = null; setGuides({ x: [], y: [] }); };
  const pick = (f: Frame) => { setFrame(f); setBox(held(shaped(f))); };
  /* a size typed: the canvas grows round its middle, the other side following when the shape is kept */
  const typed = (side: 'w' | 'h', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const n = { ...b };
    if (side === 'w') { n.x -= (value - n.w) / 2; n.w = value; if (aspect) { const h = value / aspect; n.y -= (h - n.h) / 2; n.h = h; } }
    else { n.y -= (value - n.h) / 2; n.h = value; if (aspect) { const w = value * aspect; n.x -= (w - n.w) / 2; n.w = w; } }
    setBox(held(n));
    if (!aspect) setFrame('free');
  };

  const W = Math.round(b.w); const H = Math.round(b.h);
  const made = ratios.length ? nearest(b.w / b.h, ratios) : `${W}:${H}`;

  const make = async () => {
    if (!img || busy || !picked?.mask) return;
    setBusy(true);
    try {
      /* the canvas grown to the shape the model makes, round its middle */
      const r = ratioValue(made);
      let mw = b.w; let mh = b.h;
      if (mw / mh > r) mh = mw / r; else mw = mh * r;
      const mx = b.x - (mw - b.w) / 2; const my = b.y - (mh - b.h) / 2;
      const k = Math.min(1, LONGEST / Math.max(mw, mh));
      const PW = Math.round(mw * k); const PH = Math.round(mh * k);
      const mask = document.createElement('canvas');
      mask.width = PW; mask.height = PH;
      const m = mask.getContext('2d')!;
      /* clear (redrawn) all round; the picture opaque (kept), a hair inside its edge so the seam is redrawn too */
      m.fillStyle = '#000';
      const inset = Math.max(2, Math.round(Math.min(iw, ih) * k * 0.01));
      m.fillRect(-mx * k + inset, -my * k + inset, iw * k - 2 * inset, ih * k - 2 * inset);
      const blob = await new Promise<Blob>((done, fail) => mask.toBlob((x) => (x ? done(x) : fail(new Error('no mask was made'))), 'image/png'));
      await onMake({
        mask: blob, ratio: made, words: words.trim(),
        place: { x: -mx / mw, y: -my / mh, w: iw / mw, h: ih / mh },
        crop: { x: (b.x - mx) / mw, y: (b.y - my) / mh, w: b.w / mw, h: b.h / mh, width: W, height: H },
      }, picked.key);
    } finally { setBusy(false); }
  };

  const seg = (on: boolean) => `h-7 rounded-[8px] px-2.5 text-[12.5px] tabular-nums transition ${on ? 'bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`;
  const toggle = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] transition ${on ? 'bg-[color-mix(in_srgb,var(--cv-edge-lit)_18%,transparent)] text-[var(--cv-ink)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-edge-lit)_45%,transparent)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const number = 'h-8 w-[76px] rounded-[9px] bg-[var(--cv-chip)] px-2 text-center text-[12.5px] tabular-nums text-[var(--cv-ink)] outline-none ring-1 ring-inset ring-transparent focus:ring-[var(--cv-ring)]';
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const handleAt = (k: string): React.CSSProperties => ({
    left: k.includes('w') ? 0 : k.includes('e') ? '100%' : '50%', top: k.includes('n') ? 0 : k.includes('s') ? '100%' : '50%',
    cursor: `${k}-resize`,
  });
  return (
    <CanvasModal label={t('canvas.expand.title')} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-1 text-[14px] font-semibold">{t('canvas.expand.title')}</span>
        <div className="flex flex-wrap items-center gap-0.5 rounded-[11px] bg-[var(--cv-chip)] p-[3px]">
          {FRAMES.map((f) => <button key={f} type="button" className={seg(f === frame)} onClick={() => pick(f)}>{f === 'free' ? t('canvas.expand.free') : f.startsWith('x') ? `×${f.slice(1)}` : f}</button>)}
        </div>
      </div>
      {/* the canvas: the picture in it, dragged; its edges and corners dragged out */}
      <div ref={stage} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        className="relative mx-4 mt-3 min-h-0 flex-1 touch-none select-none overflow-hidden rounded-[16px] bg-[var(--cv-card-2)]"
        style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--cv-ink) 9%, transparent) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }}>
        {img && view ? (
          <div className="absolute" style={{ left: ox + b.x * view, top: oy + b.y * view, width: b.w * view, height: b.h * view }}>
            {/* what will be made: checkered */}
            <div className="absolute inset-0 rounded-[4px]" style={{ backgroundImage: 'repeating-conic-gradient(color-mix(in srgb, var(--cv-ink) 12%, transparent) 0 25%, color-mix(in srgb, var(--cv-ink) 4%, transparent) 0 50%)', backgroundSize: '18px 18px' }} />
            {snap ? (
              <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right, color-mix(in srgb, var(--cv-edge-lit) 22%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--cv-edge-lit) 22%, transparent) 1px, transparent 1px)', backgroundSize: `${grid * view}px ${grid * view}px`, backgroundPosition: `${(((-b.x % grid) + grid) % grid) * view}px ${(((-b.y % grid) + grid) % grid) * view}px` }} />
            ) : null}
            <div onPointerDown={down('move')} className="absolute cursor-grab shadow-[0_0_0_1px_rgba(255,255,255,0.7),0_10px_30px_rgba(0,0,0,0.35)] active:cursor-grabbing"
              style={{ left: -b.x * view, top: -b.y * view, width: iw * view, height: ih * view }}>
              <img src={src} alt="" draggable={false} className="h-full w-full select-none" />
            </div>
            {guides.x.map((g) => <div key={`x${g}`} className="pointer-events-none absolute top-0 h-full w-px bg-[#ff4fd8]" style={{ left: (g - b.x) * view }} />)}
            {guides.y.map((g) => <div key={`y${g}`} className="pointer-events-none absolute left-0 h-px w-full bg-[#ff4fd8]" style={{ top: (g - b.y) * view }} />)}
            <div className="pointer-events-none absolute inset-0 rounded-[4px] ring-1 ring-[var(--cv-edge-lit)]" />
            {handles.map((k) => (
              <div key={k} onPointerDown={down(k)} className="absolute z-10 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center" style={handleAt(k)}>
                <span className={`block rounded-[3px] border border-[var(--cv-edge-lit)] bg-white shadow ${k.length === 2 ? 'h-3 w-3' : k === 'n' || k === 's' ? 'h-2 w-5' : 'h-5 w-2'}`} />
              </div>
            ))}
            <div className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-[var(--cv-float)] px-2 py-0.5 text-[11.5px] tabular-nums text-[var(--cv-ink-2)] shadow-[var(--cv-float-shadow)]">{W} × {H}</div>
          </div>
        ) : null}
      </div>
      {/* its size in pixels, the shape kept or not, snapping, and what the model makes */}
      <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--cv-ink-3)]">W<input key={`w${W}`} defaultValue={W} inputMode="numeric" className={number}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} onBlur={(event) => typed('w', Number(event.target.value))} /></label>
        <button type="button" title={t(lock ? 'canvas.expand.unlock' : 'canvas.expand.lock')} aria-pressed={lock} onClick={() => setLock((v) => !v)}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{lock ? <Link2 size={15} /> : <Link2Off size={15} />}</button>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--cv-ink-3)]">H<input key={`h${H}`} defaultValue={H} inputMode="numeric" className={number}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} onBlur={(event) => typed('h', Number(event.target.value))} /></label>
        <span className="mx-1 h-5 w-px bg-[var(--cv-float-line)]" />
        <button type="button" aria-pressed={snap} onClick={() => setSnap((v) => !v)} className={toggle(snap)}><Grid3x3 size={14} />{t('canvas.expand.snap')}</button>
        <button type="button" onClick={() => setBox(held({ ...b, x: -(b.w - iw) / 2, y: -(b.h - ih) / 2 }))}
          className="flex h-8 items-center rounded-[9px] px-2.5 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{t('canvas.expand.center')}</button>
        <span className={`ml-auto truncate text-[11.5px] ${picked?.mask ? 'text-[var(--cv-ink-3)]' : 'text-amber-400'}`}>{picked?.mask ? t('canvas.expand.made').replace('{ratio}', made).replace('{size}', `${W} × ${H}`) : t(picked ? 'canvas.expand.cannotPicked' : 'canvas.redraw.noModel')}</span>
      </div>
      <div className="px-4 pb-4 pt-2.5">
        <div className="flex items-end gap-3 rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] py-3 pl-4 pr-3 shadow-[var(--cv-float-shadow)] transition focus-within:!border-[var(--cv-ring)]">
          <textarea value={words} rows={2} onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
            placeholder={t('canvas.expand.hint')}
            className="min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
          {/* the model that fills it: one that cannot is said so, and nothing is sent */}
          {picked ? (
            <div className="relative shrink-0 self-end">
              <button type="button" onClick={() => setModelsOpen((v) => !v)}
                className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                <ProviderMark id={picked.via} size={15} /><span className="max-w-[180px] truncate">{picked.name}</span><ChevronDown size={13} />
              </button>
              {modelsOpen ? (
                <div className="cv-bar-up absolute bottom-full right-0 z-20 mb-2 w-[280px] rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                  {models.map((m) => (
                    <button key={m.key} type="button" onClick={() => { setModelKey(m.key); setModelsOpen(false); }}
                      className="flex h-10 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                      <ProviderMark id={m.via} size={15} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate leading-4">{m.name}</span>
                        {!m.mask ? <span className="block truncate text-[11px] leading-4 text-[var(--cv-ink-3)]">{t('canvas.expand.cannot')}</span> : null}
                      </span>
                      {m.key === picked.key ? <Check size={14} className="text-[var(--cv-ink-2)]" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" aria-label={t('canvas.expand.make')} disabled={!img || busy || !picked?.mask} onClick={() => { void make(); }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
            {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>
    </CanvasModal>
  );
}
