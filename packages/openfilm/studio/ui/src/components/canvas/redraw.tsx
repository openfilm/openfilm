/**
 * A picture changed in part, as the models that redraw make it: brushed over where it is to be redrawn (a mask, clear
 * where brushed), brushed over what is to go (the same mask, with words that say to take it out and fill the place in),
 * or with the changes drawn on it (a markup: strokes, arrows, words and numbered pins on a clear picture its size, the
 * words below then able to say "1: …, 2: …"); then what it should become, in words. What is drawn is kept as a PNG of
 * the picture's own size; the change is a new picture, made from this one, beside it.
 */
import React from 'react';
import { ArrowUpRight, Brush, Eraser, MapPin, PenLine, Redo2, Sparkles, Trash2, Type as TypeIcon, Undo2, Wand2 } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

export type RedrawWay = 'mask' | 'markup';
/** how the editor is opened: brushing what to redraw, brushing what to take out, or drawing the change */
export type RedrawStart = 'mask' | 'remove' | 'markup';
/** something drawn: a brush stroke (or an eraser's), an arrow, words, or a numbered pin */
type Mark =
  | { kind: 'stroke'; erase: boolean; width: number; color: string; points: Array<[number, number]> }
  | { kind: 'arrow'; width: number; color: string; from: [number, number]; to: [number, number] }
  | { kind: 'text'; size: number; color: string; at: [number, number]; text: string }
  | { kind: 'pin'; size: number; color: string; at: [number, number]; n: number };
type MarkTool = 'pen' | 'arrow' | 'text' | 'pin';

/** a brush's colors: the mask shown as a light wash; the markup in a plain color the model reads as marks, one that
    stands out on the picture */
const MASK_SHOWN = 'rgb(0, 193, 205)';
const MARKS = ['#ff3b30', '#ffffff', '#2f7bff', '#ffd60a'];
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** the words that ask for what was brushed to be taken out */
const REMOVE_WORDS = 'Remove what is in the brushed area completely and fill the place in naturally, continuing the surroundings, their texture, light and perspective, with no trace of what was there.';

function draw(ctx: CanvasRenderingContext2D, m: Mark) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (m.kind === 'stroke') {
    ctx.lineWidth = m.width;
    ctx.beginPath();
    m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (m.points.length === 1) ctx.lineTo(m.points[0]![0] + 0.01, m.points[0]![1]);
    ctx.stroke();
  } else if (m.kind === 'arrow') {
    const [x0, y0] = m.from; const [x1, y1] = m.to;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = m.width * 4;
    ctx.lineWidth = m.width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(angle - 0.45), y1 - head * Math.sin(angle - 0.45));
    ctx.lineTo(x1 - head * Math.cos(angle + 0.45), y1 - head * Math.sin(angle + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (m.kind === 'text') {
    ctx.font = `600 ${m.size}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, m.size / 6);
    const fill = ctx.fillStyle;
    ctx.strokeStyle = m.color === '#ffffff' || m.color === '#ffd60a' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
    ctx.strokeText(m.text, m.at[0], m.at[1]);
    ctx.fillStyle = fill;
    ctx.fillText(m.text, m.at[0], m.at[1]);
  } else {
    const r = m.size / 2;
    ctx.beginPath(); ctx.arc(m.at[0], m.at[1], r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(2, r / 5);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = m.color === '#ffffff' || m.color === '#ffd60a' ? '#000' : '#fff';
    ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(m.n), m.at[0], m.at[1] + r * 0.05);
    ctx.textAlign = 'start';
  }
}

/**
 * What was drawn, at the picture's size: shown (`look`) over it, or as the file a model takes — a mask opaque but where
 * brushed, a markup clear but for its marks.
 */
function paint(ctx: CanvasRenderingContext2D, way: RedrawWay, marks: readonly Mark[], look: boolean) {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  if (way === 'mask' && !look) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); }
  for (const m of marks) {
    const erase = m.kind === 'stroke' && m.erase;
    if (way === 'mask' && !look) { ctx.globalCompositeOperation = erase ? 'source-over' : 'destination-out'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; }
    else {
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      const color = way === 'mask' ? MASK_SHOWN : m.color;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }
    draw(ctx, m);
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function RedrawEditor({ src, start = 'mask', can, onClose, onMake }: {
  src: string;
  start?: RedrawStart;
  /** what the connected models redraw by: a mask (brushed, and removing), drawn changes (mark-up); only those are offered */
  can: { mask: boolean; markup: boolean };
  onClose: () => void;
  /** what was drawn (the PNG a model takes) and what it should become: made beside the picture */
  onMake: (way: RedrawWay, drawn: Blob, prompt: string) => Promise<void>;
}) {
  const t = useT();
  const [mode, setMode] = React.useState<RedrawStart>(() => (start === 'markup' ? (can.markup ? 'markup' : 'mask') : can.mask ? start : 'markup'));
  const way: RedrawWay = mode === 'markup' ? 'markup' : 'mask';
  const [erase, setErase] = React.useState(false);
  const [tool, setTool] = React.useState<MarkTool>('pen');
  const [size, setSize] = React.useState(5);
  const [color, setColor] = React.useState(MARKS[0]!);
  const [marks, setMarks] = React.useState<Mark[]>([]);
  /* what was undone, to redo; drawing anew forgets it */
  const [undone, setUndone] = React.useState<Mark[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  /* words being written where the picture was pressed, in its own pixels and on the screen */
  const [typing, setTyping] = React.useState<{ at: [number, number]; left: number; top: number; text: string } | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const drawing = React.useRef<Mark | null>(null);

  React.useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    paint(ctx, way, drawing.current ? [...marks, drawing.current] : marks, true);
  }, [marks, way, natural]);

  /* where the pointer is on the picture, in its own pixels */
  const at = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - box.left) * (event.currentTarget.width / box.width), (event.clientY - box.top) * (event.currentTarget.height / box.height)];
  };
  const brush = natural ? Math.round((Math.min(natural.w, natural.h) * size) / 100) : 20;
  const line = Math.max(2, brush / 3);
  const pins = marks.filter((m) => m.kind === 'pin').length;
  const commit = (m: Mark) => { setMarks((list) => [...list, m]); setUndone([]); };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const p = at(event);
    if (way === 'markup' && !erase && tool === 'text') {
      const box = event.currentTarget.getBoundingClientRect();
      if (typing?.text.trim()) commit({ kind: 'text', size: Math.max(14, brush * 1.2), color, at: typing.at, text: typing.text.trim() });
      setTyping({ at: p, left: event.clientX - box.left, top: event.clientY - box.top, text: '' });
      return;
    }
    if (way === 'markup' && !erase && tool === 'pin') { commit({ kind: 'pin', size: Math.max(22, brush * 1.6), color, at: p, n: pins + 1 }); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = way === 'markup' && !erase && tool === 'arrow'
      ? { kind: 'arrow', width: line, color, from: p, to: p }
      : { kind: 'stroke', erase, color, width: way === 'markup' && !erase ? line : brush, points: [p] };
    setMarks((list) => [...list]);
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const m = drawing.current;
    if (!m) return;
    if (m.kind === 'stroke') m.points.push(at(event));
    else if (m.kind === 'arrow') m.to = at(event);
    const ctx = canvas.current?.getContext('2d');
    if (ctx) paint(ctx, way, [...marks, m], true);
  };
  const up = () => {
    const done = drawing.current;
    drawing.current = null;
    if (done && !(done.kind === 'arrow' && Math.hypot(done.to[0] - done.from[0], done.to[1] - done.from[1]) < 4)) commit(done);
    else setMarks((list) => [...list]);
  };
  const undo = () => { if (!marks.length) return; setUndone((u) => [...u, marks.at(-1)!]); setMarks((list) => list.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setMarks((list) => [...list, undone.at(-1)!]); setUndone((u) => u.slice(0, -1)); };
  const switchTo = (next: RedrawStart) => {
    if ((next === 'markup') !== (way === 'markup')) { setMarks([]); setUndone([]); }
    setMode(next); setErase(false); setTyping(null);
  };
  const keys = React.useRef<(event: KeyboardEvent) => void>(() => {});
  /* the dialog's own keys, not the board's under it: ⌘Z / ⇧⌘Z undo and redo, [ ] the brush smaller and larger, E the
     eraser, B the brush, A an arrow, T words, P a pin; in a words box, the box's own */
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
    else if (!mod && key === 'b') take(() => { setErase(false); setTool('pen'); });
    else if (!mod && way === 'markup' && key === 'a') take(() => { setErase(false); setTool('arrow'); });
    else if (!mod && way === 'markup' && key === 't') take(() => { setErase(false); setTool('text'); });
    else if (!mod && way === 'markup' && key === 'p') take(() => { setErase(false); setTool('pin'); });
  };
  React.useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);
  const make = async () => {
    if (!natural || busy) return;
    const all = typing?.text.trim() ? [...marks, { kind: 'text' as const, size: Math.max(14, brush * 1.2), color, at: typing.at, text: typing.text.trim() }] : marks;
    const out = document.createElement('canvas');
    out.width = natural.w;
    out.height = natural.h;
    paint(out.getContext('2d')!, way, all, false);
    const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'));
    if (!blob) return;
    setBusy(true);
    const words = mode === 'remove' ? [REMOVE_WORDS, prompt.trim()].filter(Boolean).join('\n\n') : prompt.trim();
    try { await onMake(way, blob, words); } finally { setBusy(false); }
  };
  const drawn = marks.some((m) => !(m.kind === 'stroke' && m.erase)) || Boolean(typing?.text.trim());
  const pill = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] transition disabled:opacity-35 ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const markTools: Array<[MarkTool, React.ComponentType<{ size?: number }>, string, string]> = [
    ['pen', PenLine, 'canvas.redraw.pen', 'B'], ['arrow', ArrowUpRight, 'canvas.redraw.arrow', 'A'], ['text', TypeIcon, 'canvas.redraw.text', 'T'], ['pin', MapPin, 'canvas.redraw.pin', 'P'],
  ];
  return (
    <CanvasModal label={t('canvas.redraw.title')} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-2 text-[14px] font-medium">{t('canvas.redraw.title')}</span>
        {/* three ways to say what changes: where (brushed, redrawn), what goes (brushed, taken out), or how (drawn on it) */}
        <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
          {can.mask ? <button type="button" className={pill(mode === 'mask')} onClick={() => switchTo('mask')}><Brush size={14} />{t('canvas.redraw.mask')}</button> : null}
          {can.mask ? <button type="button" className={pill(mode === 'remove')} onClick={() => switchTo('remove')}><Wand2 size={14} />{t('canvas.redraw.removeWay')}</button> : null}
          {can.markup ? <button type="button" className={pill(mode === 'markup')} onClick={() => switchTo('markup')}><PenLine size={14} />{t('canvas.redraw.markup')}</button> : null}
        </div>
        <span className="mx-1 h-4 w-px bg-[var(--cv-float-line)]" />
        {way === 'markup' ? (
          <>
            {markTools.map(([k, Icon, label, key]) => (
              <button key={k} type="button" title={`${t(label)} · ${key}`} aria-label={t(label)} className={pill(tool === k && !erase)} onClick={() => { setTool(k); setErase(false); }}><Icon size={14} /></button>
            ))}
            <span className="flex items-center gap-1 px-1">
              {MARKS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)}
                  className={`h-5 w-5 rounded-full border transition ${c === color ? 'border-[var(--cv-ink)] scale-110' : 'border-white/20'}`} style={{ background: c }} />
              ))}
            </span>
          </>
        ) : null}
        <button type="button" title="E" className={pill(erase)} onClick={() => setErase((v) => !v)}><Eraser size={14} />{t('canvas.redraw.erase')}</button>
        <label title="[ ]" className="flex items-center gap-2 px-1 text-[12px] text-[var(--cv-ink-3)]">
          {t('canvas.redraw.size')}
          <input type="range" min={1} max={15} value={size} onChange={(event) => setSize(Number(event.target.value))} className="h-1 w-24 cursor-pointer accent-[var(--cv-ink)]" />
        </label>
        <button type="button" title={`${MOD}Z`} aria-label={t('canvas.redraw.undo')} className={pill(false)} disabled={!marks.length} onClick={undo}><Undo2 size={14} /></button>
        <button type="button" title={`⇧${MOD}Z`} aria-label={t('canvas.redraw.redo')} className={pill(false)} disabled={!undone.length} onClick={redo}><Redo2 size={14} /></button>
        <button type="button" className={pill(false)} disabled={!marks.length} onClick={() => { setUndone([]); setMarks([]); setTyping(null); }}><Trash2 size={14} />{t('canvas.redraw.clear')}</button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div className="relative inline-block">
          <img src={src} alt="" draggable={false} onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            className="block max-h-[min(560px,calc(100vh-260px))] max-w-full select-none rounded-[10px]" />
          {natural ? (
            <canvas ref={canvas} width={natural.w} height={natural.h} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              className={`absolute inset-0 h-full w-full touch-none rounded-[10px] ${way === 'mask' ? 'opacity-[0.45]' : ''} ${way === 'markup' && !erase && tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`} />
          ) : null}
          {typing ? (
            <input autoFocus value={typing.text} onChange={(event) => setTyping({ ...typing, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); if (typing.text.trim()) commit({ kind: 'text', size: Math.max(14, brush * 1.2), color, at: typing.at, text: typing.text.trim() }); setTyping(null); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTyping(null); }
              }}
              style={{ left: typing.left, top: typing.top - 14, color }}
              className="absolute z-10 h-7 min-w-[120px] rounded-[6px] border border-white/40 bg-black/50 px-1.5 text-[14px] font-semibold outline-none backdrop-blur-sm" />
          ) : null}
        </div>
      </div>
      <div className="flex items-end gap-3 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <textarea value={prompt} rows={2} onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
          placeholder={t(mode === 'mask' ? 'canvas.redraw.maskHint' : mode === 'remove' ? 'canvas.redraw.removeHint' : pins ? 'canvas.redraw.pinHint' : 'canvas.redraw.markupHint')}
          className="min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
        <button type="button" disabled={!drawn || (mode !== 'remove' && !prompt.trim()) || busy} onClick={() => { void make(); }}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-35">
          <Sparkles size={13} />{t(mode === 'remove' ? 'canvas.redraw.removeMake' : 'canvas.redraw.make')}
        </button>
      </div>
    </CanvasModal>
  );
}
