/**
 * A picture widened: placed in a larger frame of a shape picked (or grown by a factor), moved and sized in it, and
 * the frame around it filled by a model that redraws where a mask leaves it clear. The picture goes to the model on a
 * soft blur of itself (so the new edges start from its own colors), with a mask clear everywhere but the picture: what
 * was there stays exactly as it was.
 */
import React from 'react';
import { Sparkles } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

/** the frame's shapes offered; `×1.5` and `×2` grow it around the picture, keeping its own shape */
const FRAMES = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9', 'x1.5', 'x2'] as const;
type Frame = typeof FRAMES[number];
/** the longest side of what goes to the model */
const LONGEST = 2048;

export interface Expanded { picture: Blob; mask: Blob; ratio: string; words: string }

const ASK = 'Extend the picture into the empty area around it: continue the scene naturally beyond its edges with the same style, light, perspective and detail, so it reads as one seamless picture; keep the original area exactly as it is.';

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((done, fail) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => done(img);
    img.onerror = () => fail(new Error('the picture did not load'));
    img.src = src;
  });
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function ExpandEditor({ src, onClose, onMake }: { src: string; onClose: () => void; onMake: (expanded: Expanded) => Promise<void> }) {
  const t = useT();
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [frame, setFrame] = React.useState<Frame>('16:9');
  /* the picture's size in the frame (1: as large as fits) and its middle, as a share of the frame */
  const [scale, setScale] = React.useState(0.8);
  const [middle, setMiddle] = React.useState<[number, number]>([0.5, 0.5]);
  const [words, setWords] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const stage = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; y: number; from: [number, number] } | null>(null);
  React.useEffect(() => { void loadImage(src).then(setImg, () => {}); }, [src]);

  /* the frame, in the picture's own pixels: its shape, or the picture grown */
  const iw = img?.naturalWidth ?? 1;
  const ih = img?.naturalHeight ?? 1;
  const fr = frame.startsWith('x') ? iw / ih : (([w, h]) => w! / h!)(frame.split(':').map(Number));
  const grow = frame === 'x2' ? 2 : frame === 'x1.5' ? 1.5 : 0;
  /* the frame is at least the picture: as wide or as high as it, grown by the factor */
  let fw = grow ? iw * grow : Math.max(iw, ih * fr);
  let fh = grow ? ih * grow : fw / fr;
  if (!grow && fh < ih) { fh = ih; fw = fh * fr; }
  const fit = Math.min(fw / iw, fh / ih);
  const pw = iw * fit * (grow ? 1 / grow : scale);
  const ph = ih * fit * (grow ? 1 / grow : scale);
  const px = Math.min(Math.max(middle[0] * fw - pw / 2, 0), fw - pw);
  const py = Math.min(Math.max(middle[1] * fh - ph / 2, 0), fh - ph);

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: middle };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const box = stage.current?.getBoundingClientRect();
    if (!d || !box) return;
    setMiddle([d.from[0] + (event.clientX - d.x) / box.width, d.from[1] + (event.clientY - d.y) / box.height]);
  };
  const ratio = (() => {
    if (!frame.startsWith('x')) return frame;
    const w = Math.round(fw); const h = Math.round(fh); const g = gcd(w, h) || 1;
    return `${w / g}:${h / g}`;
  })();

  const make = async () => {
    if (!img || busy) return;
    setBusy(true);
    try {
      const k = Math.min(1, LONGEST / Math.max(fw, fh));
      const W = Math.round(fw * k); const H = Math.round(fh * k);
      const picture = document.createElement('canvas');
      picture.width = W; picture.height = H;
      const ctx = picture.getContext('2d')!;
      /* the frame starts from a soft blur of the picture itself, the picture sharp on it */
      ctx.filter = 'blur(48px)';
      ctx.drawImage(img, 0, 0, W, H);
      ctx.filter = 'none';
      ctx.drawImage(img, px * k, py * k, pw * k, ph * k);
      const mask = document.createElement('canvas');
      mask.width = W; mask.height = H;
      const m = mask.getContext('2d')!;
      /* clear (redrawn) all round; the picture opaque (kept), a hair inside its edge so the seam is redrawn too */
      m.fillStyle = '#000';
      const inset = Math.max(2, Math.round(Math.min(pw, ph) * k * 0.01));
      m.fillRect(px * k + inset, py * k + inset, pw * k - 2 * inset, ph * k - 2 * inset);
      const blob = (c: HTMLCanvasElement) => new Promise<Blob>((done, fail) => c.toBlob((b) => (b ? done(b) : fail(new Error('no picture was made'))), 'image/png'));
      await onMake({ picture: await blob(picture), mask: await blob(mask), ratio, words: [ASK, words.trim()].filter(Boolean).join('\n\n') });
    } finally { setBusy(false); }
  };

  const pill = (on: boolean) => `h-8 rounded-[8px] px-2.5 text-[12.5px] tabular-nums transition ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  /* the frame drawn as large as fits the stage */
  const box = { w: 860, h: 470 };
  const view = Math.min(box.w / fw, box.h / fh);
  return (
    <CanvasModal label={t('canvas.expand.title')} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-2 text-[14px] font-medium">{t('canvas.expand.title')}</span>
        <div className="flex flex-wrap items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
          {FRAMES.map((f) => <button key={f} type="button" className={pill(f === frame)} onClick={() => setFrame(f)}>{f.startsWith('x') ? `×${f.slice(1)}` : f}</button>)}
        </div>
        {!grow ? (
          <label className="ml-2 flex items-center gap-2 text-[12px] text-[var(--cv-ink-3)]">
            {t('canvas.expand.size')}
            <input type="range" min={0.3} max={1} step={0.01} value={scale} onChange={(event) => setScale(Number(event.target.value))} className="h-1 w-28 cursor-pointer accent-[var(--cv-ink)]" />
          </label>
        ) : null}
        <button type="button" className={pill(false)} onClick={() => { setMiddle([0.5, 0.5]); setScale(0.8); }}>{t('canvas.expand.center')}</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        {img ? (
          <div ref={stage} className="relative overflow-hidden rounded-[10px]" style={{ width: fw * view, height: fh * view,
            backgroundImage: 'repeating-conic-gradient(color-mix(in srgb, var(--cv-ink) 10%, transparent) 0 25%, transparent 0 50%)', backgroundSize: '20px 20px' }}>
            <div onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }}
              className="absolute cursor-grab touch-none shadow-[0_0_0_1px_rgba(255,255,255,0.6)] active:cursor-grabbing"
              style={{ left: px * view, top: py * view, width: pw * view, height: ph * view }}>
              <img src={src} alt="" draggable={false} className="h-full w-full select-none" />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-end gap-3 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <textarea value={words} rows={2} onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
          placeholder={t('canvas.expand.hint')}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
        <span className="shrink-0 pb-2 text-[12px] tabular-nums text-[var(--cv-ink-3)]">{ratio} · {Math.round(fw)}×{Math.round(fh)}</span>
        <button type="button" disabled={!img || busy} onClick={() => { void make(); }}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-35">
          <Sparkles size={13} />{t('canvas.expand.make')}
        </button>
      </div>
    </CanvasModal>
  );
}
