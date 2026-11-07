/**
 * A picture changed in part, as the models that redraw make it: brushed over where it is to be redrawn (a mask, clear
 * where brushed), or with the changes drawn on it (a markup, the strokes on a clear picture its size); then what it
 * should become, in words. What is drawn is kept as a PNG of the picture's own size; the change is a new picture, made
 * from this one, beside it.
 */
import React from 'react';
import { Brush, Eraser, PenLine, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

export type RedrawWay = 'mask' | 'markup';
type Stroke = { erase: boolean; width: number; color: string; points: Array<[number, number]> };

/** a brush's colors: the mask shown as a light wash; the markup in a plain color the model reads as marks, one that
    stands out on the picture */
const MASK_SHOWN = 'rgb(0, 193, 205)';
const MARKS = ['#ff3b30', '#ffffff', '#2f7bff', '#ffd60a'];
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';

function trace(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (s.points.length === 1) ctx.lineTo(s.points[0]![0] + 0.01, s.points[0]![1]);
  ctx.stroke();
}

/**
 * What was drawn, at the picture's size: shown (`look`) over it, or as the file a model takes — a mask opaque but where
 * brushed, a markup clear but for its strokes.
 */
function paint(ctx: CanvasRenderingContext2D, way: RedrawWay, strokes: readonly Stroke[], look: boolean) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  if (way === 'mask' && !look) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); }
  for (const s of strokes) {
    if (way === 'mask' && !look) { ctx.globalCompositeOperation = s.erase ? 'source-over' : 'destination-out'; ctx.strokeStyle = '#000'; }
    else { ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'; ctx.strokeStyle = way === 'mask' ? MASK_SHOWN : s.color; }
    trace(ctx, s);
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function RedrawEditor({ src, onClose, onMake }: {
  src: string;
  onClose: () => void;
  /** what was drawn (the PNG a model takes) and what it should become: made beside the picture */
  onMake: (way: RedrawWay, drawn: Blob, prompt: string) => Promise<void>;
}) {
  const t = useT();
  const [way, setWay] = React.useState<RedrawWay>('mask');
  const [erase, setErase] = React.useState(false);
  const [size, setSize] = React.useState(5);
  const [color, setColor] = React.useState(MARKS[0]!);
  const [strokes, setStrokes] = React.useState<Stroke[]>([]);
  /* what was undone, to redo; drawing anew forgets it */
  const [undone, setUndone] = React.useState<Stroke[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef<Stroke | null>(null);

  React.useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    paint(ctx, way, drawing.current ? [...strokes, drawing.current] : strokes, true);
  }, [strokes, way, natural]);

  /* where the pointer is on the picture, in its own pixels */
  const at = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - box.left) * (event.currentTarget.width / box.width), (event.clientY - box.top) * (event.currentTarget.height / box.height)];
  };
  const brush = natural ? Math.round((Math.min(natural.w, natural.h) * size) / 100) : 20;
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = { erase, color, width: way === 'markup' && !erase ? Math.max(2, brush / 3) : brush, points: [at(event)] };
    setStrokes((s) => [...s]);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current.points.push(at(event));
    const ctx = canvas.current?.getContext('2d');
    if (ctx) paint(ctx, way, [...strokes, drawing.current], true);
  };
  const up = () => {
    const done = drawing.current;
    drawing.current = null;
    if (done) { setStrokes((s) => [...s, done]); setUndone([]); }
  };
  const undo = () => { if (!strokes.length) return; setUndone((u) => [...u, strokes.at(-1)!]); setStrokes((s) => s.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setStrokes((s) => [...s, undone.at(-1)!]); setUndone((u) => u.slice(0, -1)); };
  const keys = React.useRef<(event: KeyboardEvent) => void>(() => {});
  /* the dialog's own keys, not the board's under it: ⌘Z / ⇧⌘Z undo and redo a stroke, [ ] the brush smaller and
     larger, E the eraser, B the brush; in the words box, the box's own */
  keys.current = (event) => {
    if ((event.target as HTMLElement).closest?.('textarea, input') || event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
    if (mod && key === 'z') take(event.shiftKey ? redo : undo);
    else if (mod && key === 'y') take(redo);
    else if (!mod && key === '[') take(() => setSize((v) => Math.max(1, v - 1)));
    else if (!mod && key === ']') take(() => setSize((v) => Math.min(15, v + 1)));
    else if (!mod && key === 'e') take(() => setErase(true));
    else if (!mod && key === 'b') take(() => setErase(false));
  };
  React.useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);
  const make = async () => {
    if (!natural || busy) return;
    const out = document.createElement('canvas');
    out.width = natural.w;
    out.height = natural.h;
    paint(out.getContext('2d')!, way, strokes, false);
    const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'));
    if (!blob) return;
    setBusy(true);
    try { await onMake(way, blob, prompt.trim()); } finally { setBusy(false); }
  };
  const drawn = strokes.some((s) => !s.erase);
  const tool = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] transition ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  return (
    <CanvasModal label={t('canvas.redraw.title')} onClose={onClose}>
      <div className="flex items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-2 text-[14px] font-medium">{t('canvas.redraw.title')}</span>
        {/* two ways to say what changes: where (brushed, redrawn), or how (drawn on it) */}
        <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
          <button type="button" className={tool(way === 'mask')} onClick={() => { setWay('mask'); setStrokes([]); setUndone([]); setErase(false); }}><Brush size={14} />{t('canvas.redraw.mask')}</button>
          <button type="button" className={tool(way === 'markup')} onClick={() => { setWay('markup'); setStrokes([]); setUndone([]); setErase(false); }}><PenLine size={14} />{t('canvas.redraw.markup')}</button>
        </div>
        <span className="mx-1 h-4 w-px bg-[var(--cv-float-line)]" />
        {way === 'markup' ? (
          <span className="flex items-center gap-1 px-1">
            {MARKS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => { setColor(c); setErase(false); }}
                className={`h-5 w-5 rounded-full border transition ${c === color && !erase ? 'border-[var(--cv-ink)] scale-110' : 'border-white/20'}`} style={{ background: c }} />
            ))}
          </span>
        ) : null}
        <button type="button" title="E" className={tool(erase)} onClick={() => setErase((v) => !v)}><Eraser size={14} />{t('canvas.redraw.erase')}</button>
        <label title="[ ]" className="flex items-center gap-2 px-1 text-[12px] text-[var(--cv-ink-3)]">
          {t('canvas.redraw.size')}
          <input type="range" min={1} max={15} value={size} onChange={(event) => setSize(Number(event.target.value))} className="h-1 w-24 cursor-pointer accent-[var(--cv-ink)]" />
        </label>
        <button type="button" title={`${MOD}Z`} className={tool(false)} disabled={!strokes.length} onClick={undo}><Undo2 size={14} />{t('canvas.redraw.undo')}</button>
        <button type="button" className={tool(false)} disabled={!strokes.length} onClick={() => { setUndone([]); setStrokes([]); }}><Trash2 size={14} />{t('canvas.redraw.clear')}</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div className="relative inline-block">
          <img src={src} alt="" draggable={false} onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            className="block max-h-[min(560px,calc(100vh-260px))] max-w-full select-none rounded-[10px]" />
          {natural ? (
            <canvas ref={canvas} width={natural.w} height={natural.h} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              className={`absolute inset-0 h-full w-full cursor-crosshair touch-none rounded-[10px] ${way === 'mask' ? 'opacity-[0.45]' : ''}`} />
          ) : null}
        </div>
      </div>
      <div className="flex items-end gap-3 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <textarea value={prompt} rows={2} onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
          placeholder={t(way === 'mask' ? 'canvas.redraw.maskHint' : 'canvas.redraw.markupHint')}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
        <button type="button" disabled={!drawn || !prompt.trim() || busy} onClick={() => { void make(); }}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-35">
          <Sparkles size={13} />{t('canvas.redraw.make')}
        </button>
      </div>
    </CanvasModal>
  );
}
