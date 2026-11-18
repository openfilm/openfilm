/**
 * A picture changed, said in words, and shown where on it when that helps: an area selected (brushed, boxed, lassoed,
 * its subject found, turned inside out, grown or shrunk) and numbered points put on it, with pictures beside it to take
 * from. What is sent is what the model picked can take: numbered points as a markup (the selection lit among them),
 * the selection as a mask for one that redraws where a mask is clear, else the words alone over the whole picture. The
 * change is a new picture, made from this one, beside it.
 *
 * Laid out as one picture with its tools over it and the words under it: zoomed (a pinch, ⌘ and the wheel) round the
 * pointer, moved (Space or the middle button and a drag, or two fingers), fitted again (⌘0); the brush is a ring the
 * size it paints; the selection is a tinted wash with a lit edge.
 */
import React from 'react';
import {
  ArrowUp, Brush, Check, ChevronDown, Eraser, Expand as Grow, FlipHorizontal2, Lasso, Loader2, MapPin, Minus, MoreHorizontal, Plus, Redo2,
  Scan, Shrink, SquareDashed, Trash2, Undo2, Upload, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { ProviderMark } from '../settings/ProviderMark';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import { CanvasModal } from './libraries';

/** how the change is sent: the selection as a mask, the marks as a markup, or the words over the whole picture */
export type RedrawWay = 'mask' | 'markup' | 'edit';
/** how the editor is opened: selecting (the default), or drawing marks */
export type RedrawStart = 'mask' | 'remove' | 'markup';
/** a picture model, and how it changes a picture */
export interface RedrawModel { key: string; name: string; via: string; mask: boolean; markup: boolean; refs: number }
/** what is sent to be made */
export interface RedrawJob { way: RedrawWay; drawn: Blob | null; prompt: string; model: string; refs: string[] }
/** a picture beside it, to take from */
export interface RedrawRef { path: string; src: string }

type Point = [number, number];
/** what is selected (`select`) and what is drawn (`mark`); an eraser's stroke takes from both */
type Mark =
  | { kind: 'stroke'; layer: 'select' | 'mark' | 'both'; erase: boolean; width: number; color: string; points: Point[] }
  | { kind: 'shape'; layer: 'select'; erase: boolean; points: Point[] }
  | { kind: 'raster'; layer: 'select'; image: HTMLImageElement }
  | { kind: 'invert'; layer: 'select' }
  | { kind: 'grow'; layer: 'select'; px: number }
  | { kind: 'pin'; layer: 'mark'; size: number; color: string; at: Point; n: number };
type Tool = 'brush' | 'lasso' | 'rect' | 'eraser' | 'pin';

/** the wash a selection is shown in */
const WASH = 'rgb(92, 140, 255)';
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** what the words say first, by how it is sent */
const SAY: Record<RedrawWay, string> = {
  mask: '',
  markup: 'The numbered red points on the picture (and any tinted area) show where to change; the words say what to do at each number. Leave no mark in the result.',
  edit: '',
};
/** how far in and out the picture is zoomed, against it fitted, and the room kept round it fitted */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
const MARGIN = 48;

const canvasOf = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function strokeLine(ctx: CanvasRenderingContext2D, points: readonly Point[], width: number) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  if (points.length === 1) ctx.lineTo(points[0]![0] + 0.01, points[0]![1]);
  ctx.stroke();
}

/** the selection, at the picture's size: opaque (in the wash) where selected */
function paintSelect(ctx: CanvasRenderingContext2D, marks: readonly Mark[]) {
  const { width: W, height: H } = ctx.canvas;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = WASH; ctx.strokeStyle = WASH;
  for (const m of marks) {
    if (m.layer === 'mark') continue;
    if (m.kind === 'stroke') { ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over'; strokeLine(ctx, m.points, m.width); }
    else if (m.kind === 'shape') {
      ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over';
      ctx.beginPath(); m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    } else if (m.kind === 'raster') {
      /* a subject cut out: where it is opaque */
      const tint = canvasOf(W, H); const t = tint.getContext('2d')!;
      t.drawImage(m.image, 0, 0, W, H);
      t.globalCompositeOperation = 'source-in'; t.fillStyle = WASH; t.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(tint, 0, 0);
    } else if (m.kind === 'invert') { ctx.globalCompositeOperation = 'xor'; ctx.fillRect(0, 0, W, H); }
    else if (m.kind === 'grow') {
      /* grown: drawn again moved round a circle; shrunk: kept only where every move of it still covers */
      const was = canvasOf(W, H); was.getContext('2d')!.drawImage(ctx.canvas, 0, 0);
      const r = Math.abs(m.px);
      ctx.globalCompositeOperation = m.px > 0 ? 'source-over' : 'destination-in';
      for (let a = 0; a < 16; a++) ctx.drawImage(was, Math.cos((a / 16) * Math.PI * 2) * r, Math.sin((a / 16) * Math.PI * 2) * r);
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}

/** the numbered points put on the picture, at its size (an eraser's strokes taking them off) */
function paintMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[]) {
  const { width: W, height: H } = ctx.canvas;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  for (const m of marks) {
    if (m.layer === 'select') continue;
    ctx.globalCompositeOperation = m.kind === 'stroke' && m.erase ? 'destination-out' : 'source-over';
    if (m.kind === 'stroke') { ctx.strokeStyle = m.color; strokeLine(ctx, m.points, m.width); }
    else if (m.kind === 'pin') {
      const r = m.size / 2;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(m.at[0], m.at[1], r, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(2, r / 5); ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.fillStyle = m.color === '#ffffff' || m.color === '#ffd60a' ? '#000' : '#fff';
      ctx.font = `700 ${Math.round(r * 1.15)}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(m.n), m.at[0], m.at[1] + r * 0.05);
      ctx.textAlign = 'start';
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** how much of the picture is selected, from 0 to 1, read off a small copy */
function coverOf(source: HTMLCanvasElement): number {
  const k = Math.min(1, 160 / Math.max(source.width, source.height));
  const small = canvasOf(Math.max(1, Math.round(source.width * k)), Math.max(1, Math.round(source.height * k)));
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  let on = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 40) on += 1;
  return on / (small.width * small.height);
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob | null>((done) => c.toBlob(done, 'image/png'));

export function RedrawEditor({ src, models, model: firstModel, pictures, onClose, onMake, onSubject, onAddRef }: {
  src: string;
  start?: RedrawStart;
  /** the connected picture models that take a picture to change */
  models: readonly RedrawModel[];
  /** the one picked first (the picture's own, else the last used) */
  model?: string;
  onClose: () => void;
  onMake: (job: RedrawJob) => Promise<void>;
  /** the picture's subject, cut out (its URL): selected where it is opaque */
  onSubject?: () => Promise<string>;
  /** a picture brought in to take from */
  onAddRef?: (file: File) => Promise<RedrawRef | null>;
  /** the project's pictures, to take from */
  pictures?: ReadonlyArray<RedrawRef & { name: string }>;
}) {
  const t = useT();
  const [tool, setTool] = React.useState<Tool>('brush');
  const [size, setSize] = React.useState(0);
  const [marks, setMarks] = React.useState<Mark[]>([]);
  /* what was undone, to redo; marking anew forgets it */
  const [undone, setUndone] = React.useState<Mark[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<RedrawRef[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [cover, setCover] = React.useState(0);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  /* the stage's size, and the picture's place on it: zoomed against fitted, and moved from the middle */
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ z: 1, x: 0, y: 0 });
  const [hand, setHand] = React.useState(false);
  const [panning, setPanning] = React.useState(false);
  const [modelKey, setModelKey] = React.useState(firstModel);
  const picked = models.find((m) => m.key === modelKey) ?? models[0];
  const [open, setOpen] = React.useState<'models' | 'more' | 'refs' | null>(null);
  /* a lasso or box being drawn, shown as a line over the picture until it is let go */
  const [outline, setOutline] = React.useState<Mark | null>(null);
  /* a stroke being drawn: the selection's lit edge waits for it to end (a filter over the whole picture each move is slow) */
  const [stroking, setStroking] = React.useState(false);
  const selectCanvas = React.useRef<HTMLCanvasElement>(null);
  const markCanvas = React.useRef<HTMLCanvasElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const ring = React.useRef<HTMLDivElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const words = React.useRef<HTMLTextAreaElement>(null);
  const drawing = React.useRef<Mark | null>(null);
  const pan = React.useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);

  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const seen = new ResizeObserver(([entry]) => { if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height }); });
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  React.useEffect(() => {
    const s = selectCanvas.current?.getContext('2d'); const m = markCanvas.current?.getContext('2d');
    if (!s || !m) return;
    paintSelect(s, marks); paintMarks(m, marks);
    setCover(coverOf(s.canvas));
  }, [marks, natural]);

  /* the picture on the stage, clear of the tools above it and the words below it */
  const TOP = 68; const FOOT = onAddRef ? 176 : 116;
  const fit = natural && box.w ? Math.min((box.w - MARGIN * 2) / natural.w, (box.h - TOP - FOOT - 24) / natural.h, 4) : 1;
  const scale = fit * view.z;
  const pw = (natural?.w ?? 0) * scale; const ph = (natural?.h ?? 0) * scale;
  const midY = TOP + (box.h - TOP - FOOT) / 2;
  const left = box.w / 2 + view.x - pw / 2; const top = midY + view.y - ph / 2;
  /* sizes in the picture's pixels: the brush as set (else a 24th of the short side) */
  const short = natural ? Math.min(natural.w, natural.h) : 1000;
  const brushMax = Math.max(40, Math.round(short / 3));
  const brush = size || Math.max(8, Math.round(short / 24));
  const step = Math.max(2, Math.round(short / 120));

  /* zoomed to `z` round a point of the stage, which stays where it is */
  const zoomTo = (z: number, about?: { x: number; y: number }) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const p = about ?? { x: box.w / 2, y: midY };
    setView((v) => {
      const s0 = fit * v.z; const s1 = fit * next;
      const w = natural?.w ?? 0; const h = natural?.h ?? 0;
      const l0 = box.w / 2 + v.x - w * s0 / 2; const t0 = midY + v.y - h * s0 / 2;
      const l1 = p.x - ((p.x - l0) / s0) * s1; const t1 = p.y - ((p.y - t0) / s0) * s1;
      return { z: next, x: l1 + w * s1 / 2 - box.w / 2, y: t1 + h * s1 / 2 - midY };
    });
  };
  const fitView = () => setView({ z: 1, x: 0, y: 0 });
  const viewRef = React.useRef(view);
  viewRef.current = view;
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    /* a pinch or ⌘ and the wheel zoom round the pointer; two fingers or the wheel move the picture */
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest?.('textarea')) return;
      event.preventDefault();
      const r = el.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoomTo(viewRef.current.z * Math.exp(-event.deltaY * (event.ctrlKey && !event.metaKey ? 0.01 : 0.002)), { x: event.clientX - r.left, y: event.clientY - r.top });
      else setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  });

  /* where the pointer is on the picture, in its own pixels */
  const at = (event: { clientX: number; clientY: number }): Point => {
    const r = selectCanvas.current!.getBoundingClientRect();
    return [(event.clientX - r.left) * ((natural?.w ?? 1) / r.width), (event.clientY - r.top) * ((natural?.h ?? 1) / r.height)];
  };
  const pins = marks.filter((m) => m.kind === 'pin').length;
  const commit = (m: Mark) => { setMarks((list) => [...list, m]); setUndone([]); setProblem(null); };
  const brushing = tool === 'brush' || tool === 'eraser';
  const moveRing = (event: React.PointerEvent) => {
    const el = ring.current; const r = stage.current?.getBoundingClientRect();
    if (!el || !r) return;
    el.style.transform = `translate(${event.clientX - r.left}px, ${event.clientY - r.top}px)`;
    el.style.opacity = '1';
  };

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!natural || busy) return;
    setOpen(null);
    /* moved: Space held, or the middle button */
    if (hand || event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, from: { x: view.x, y: view.y } };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const p = at(event);
    if (tool === 'pin') { commit({ kind: 'pin', layer: 'mark', size: Math.max(28, Math.round(short / 16)), color: '#ff3b30', at: p, n: pins + 1 }); words.current?.focus(); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'lasso' || tool === 'rect') drawing.current = { kind: 'shape', layer: 'select', erase: event.altKey, points: [p] };
    else drawing.current = { kind: 'stroke', layer: tool === 'eraser' ? 'both' : 'select', erase: tool === 'eraser', color: WASH, width: brush, points: [p] };
    if (drawing.current.kind === 'stroke') { setStroking(true); move(event); }
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    moveRing(event);
    if (pan.current) {
      const d = pan.current;
      setView((v) => ({ ...v, x: d.from.x + event.clientX - d.x, y: d.from.y + event.clientY - d.y }));
      return;
    }
    const m = drawing.current;
    if (!m) return;
    const p = at(event);
    if (m.kind === 'stroke') {
      /* only the new piece is drawn, so a long stroke stays quick on a large picture */
      const last = m.points[m.points.length - 1]!;
      if (m.points.length > 1 || last[0] !== p[0] || last[1] !== p[1]) m.points.push(p);
      const targets = [selectCanvas.current, m.layer === 'both' ? markCanvas.current : null];
      for (const c of targets) {
        const ctx = c?.getContext('2d');
        if (!ctx) continue;
        ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = WASH;
        strokeLine(ctx, [last, p], m.width);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (m.kind === 'shape') {
      if (tool === 'rect') { const [x0, y0] = m.points[0]!; m.points = [[x0, y0], [p[0], y0], p, [x0, p[1]]]; }
      else m.points.push(p);
      setOutline({ ...m, points: [...m.points] });
    }
  };
  const up = () => {
    if (pan.current) { pan.current = null; setPanning(false); return; }
    const done = drawing.current;
    drawing.current = null;
    setOutline(null);
    setStroking(false);
    if (!done) return;
    if (done.kind === 'shape' && done.points.length < 3) return;
    commit(done);
  };
  const undo = () => { if (!marks.length) return; setUndone((u) => [...u, marks.at(-1)!]); setMarks((list) => list.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setMarks((list) => [...list, undone.at(-1)!]); setUndone((u) => u.slice(0, -1)); };
  const clear = () => { setUndone([]); setMarks([]); };
  const selected = cover > 0.0005;
  const invert = () => commit({ kind: 'invert', layer: 'select' });
  const grow = (px: number) => { if (selected) commit({ kind: 'grow', layer: 'select', px }); };
  /* the subject: cut out on this computer (or by the service that cuts out), selected where it stands */
  const subject = async () => {
    if (!onSubject || finding) return;
    setFinding(true); setProblem(null);
    try {
      const url = await onSubject();
      const image = await new Promise<HTMLImageElement>((done, fail) => {
        const img = new Image(); img.crossOrigin = 'anonymous';
        img.onload = () => done(img); img.onerror = () => fail(new Error('the subject did not load')); img.src = url;
      });
      commit({ kind: 'raster', layer: 'select', image });
    } catch (e) { setProblem(e instanceof Error ? e.message : String(e)); } finally { setFinding(false); }
  };

  const keys = React.useRef<(event: KeyboardEvent, isDown: boolean) => void>(() => {});
  /* the dialog's own keys, not the board's under it: ⌘Z / ⇧⌘Z undo and redo; [ ] the brush; B M L E N the brush, box,
     lasso, eraser and a numbered point; S the subject; I inside out; Space held moves; ⌘0 fits; in the words, theirs */
  keys.current = (event, isDown) => {
    if ((event.target as HTMLElement).closest?.('textarea, input') || event.isComposing) return;
    if (event.code === 'Space') { event.preventDefault(); setHand(isDown); return; }
    if (!isDown) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
    if (mod && key === 'z') take(event.shiftKey ? redo : undo);
    else if (mod && key === 'y') take(redo);
    else if (mod && key === '0') take(fitView);
    else if (mod && (key === '=' || key === '+')) take(() => zoomTo(view.z * 1.25));
    else if (mod && key === '-') take(() => zoomTo(view.z / 1.25));
    else if (mod) return;
    else if (key === '[') take(() => setSize(Math.max(2, Math.round(brush / 1.2))));
    else if (key === ']') take(() => setSize(Math.min(brushMax, Math.round(brush * 1.2) + 1)));
    else {
      const pick: Record<string, () => void> = {
        b: () => setTool('brush'), m: () => setTool('rect'), l: () => setTool('lasso'), e: () => setTool('eraser'), n: () => setTool('pin'),
        s: () => { void subject(); }, i: invert,
      };
      if (pick[key]) take(pick[key]);
    }
  };
  React.useEffect(() => {
    const press = (event: KeyboardEvent) => keys.current(event, true);
    const lift = (event: KeyboardEvent) => keys.current(event, false);
    window.addEventListener('keydown', press, true);
    window.addEventListener('keyup', lift, true);
    return () => { window.removeEventListener('keydown', press, true); window.removeEventListener('keyup', lift, true); };
  }, []);

  /* how it is sent: numbered points as marks (with the selection lit among them), a selection as a mask, else words */
  const marked = pins > 0;
  const way: RedrawWay | null = !picked ? null
    : marked ? (picked.markup ? 'markup' : null)
    : selected ? (picked.mask ? 'mask' : picked.markup ? 'markup' : null)
    : 'edit';
  const ready = Boolean(way) && Boolean(prompt.trim()) && !busy && !finding && Boolean(natural);
  const make = async () => {
    if (!ready || !natural || !picked || !way) return;
    let drawn: Blob | null = null;
    if (way !== 'edit') {
      const sel = canvasOf(natural.w, natural.h); paintSelect(sel.getContext('2d')!, marks);
      const out = canvasOf(natural.w, natural.h); const ctx = out.getContext('2d')!;
      if (way === 'mask') {
        /* opaque but where selected */
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, natural.w, natural.h);
        ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(sel, 0, 0);
      } else {
        /* the selection lit among the marks */
        ctx.globalAlpha = 0.4; ctx.drawImage(sel, 0, 0); ctx.globalAlpha = 1;
        const mk = canvasOf(natural.w, natural.h); paintMarks(mk.getContext('2d')!, marks); ctx.drawImage(mk, 0, 0);
      }
      drawn = await toBlob(out);
      if (!drawn) return;
    }
    setBusy(true);
    try { await onMake({ way, drawn, prompt: [SAY[way], prompt.trim()].filter(Boolean).join('\n\n'), model: picked.key, refs: refs.map((r) => r.path) }); } finally { setBusy(false); }
  };
  const addRefs = async (files: FileList | null) => {
    if (!files || !onAddRef) return;
    const room = Math.max(0, (picked?.refs ?? 4) - 1 - refs.length);
    for (const f of [...files].filter((x) => x.type.startsWith('image/')).slice(0, room)) {
      const r = await onAddRef(f).catch(() => null);
      if (r) setRefs((list) => [...list, r]);
    }
  };

  /* ── how it looks ── */
  const toolBtn = (on: boolean) => `flex h-9 w-9 items-center justify-center rounded-[10px] transition disabled:pointer-events-none disabled:opacity-30 ${on ? 'bg-[var(--cv-invert)] text-[var(--cv-on-invert)]' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const sep = <span className="mx-1 h-5 w-px shrink-0 bg-[var(--cv-float-line)]" />;
  const tools: Array<[Tool, React.ComponentType<{ size?: number; strokeWidth?: number }>, string, string]> = [
    ['brush', Brush, 'canvas.redraw.brush', 'B'], ['rect', SquareDashed, 'canvas.redraw.rect', 'M'], ['lasso', Lasso, 'canvas.redraw.lasso', 'L'],
  ];
  const cursor = hand || panning ? (panning ? 'cursor-grabbing' : 'cursor-grab') : brushing ? 'cursor-none' : 'cursor-crosshair';
  const ringSize = brush * scale;
  const float = 'border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';
  const warn = problem ?? (!picked ? t('canvas.redraw.noModel') : !way ? t(marked ? 'canvas.redraw.cannotMarks' : 'canvas.redraw.cannotMask') : null);
  const hint = marked ? 'canvas.redraw.pinHint' : selected ? 'canvas.redraw.markedHint' : 'canvas.redraw.wholeHint';

  return (
    <CanvasModal label={t('canvas.redraw.title')} onClose={onClose}>
      <div ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerEnter={() => { if (ring.current) ring.current.style.opacity = '1'; }} onPointerLeave={() => { if (ring.current) ring.current.style.opacity = '0'; }}
        onContextMenu={(event) => event.preventDefault()}
        className={`relative min-h-0 flex-1 touch-none select-none overflow-hidden ${cursor}`}
        style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--cv-ink) 8%, transparent) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }}>
        {/* the picture, its selection and its numbered points over it */}
        <div className="absolute" style={{ left, top, width: pw, height: ph }}>
          <img src={src} alt="" draggable={false} onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            className="block h-full w-full select-none rounded-[8px] shadow-[0_16px_48px_rgba(0,0,0,0.4)]" style={natural ? undefined : { maxWidth: 1, opacity: 0 }} />
          {natural ? (
            <>
              <canvas ref={selectCanvas} width={natural.w} height={natural.h} className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ opacity: 0.5, filter: stroking ? undefined : 'drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 1.5px rgb(92,140,255))' }} />
              <canvas ref={markCanvas} width={natural.w} height={natural.h} className="pointer-events-none absolute inset-0 h-full w-full" />
            </>
          ) : null}
          {outline && outline.kind === 'shape' && natural ? (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${natural.w} ${natural.h}`} preserveAspectRatio="none">
              <polygon points={outline.points.map((p) => p.join(',')).join(' ')} fill={outline.erase ? 'rgba(255,255,255,0.12)' : 'rgba(92,140,255,0.28)'}
                stroke="#fff" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} className="cv-ants" />
            </svg>
          ) : null}
          {finding ? (
            <div className="cv-fade pointer-events-none absolute inset-0 flex items-center justify-center rounded-[8px] bg-black/25">
              <span className="flex h-8 items-center gap-2 rounded-full bg-[var(--cv-float)] px-3 text-[12.5px] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]"><Loader2 size={14} className="animate-spin" />{t('canvas.redraw.finding')}</span>
            </div>
          ) : null}
        </div>
        {/* the brush: a ring as large as it paints, a dot in its middle */}
        {brushing && !hand && !panning ? (
          <div ref={ring} className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-100 will-change-transform">
            <div className="absolute rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{ width: ringSize, height: ringSize, left: -ringSize / 2, top: -ringSize / 2, background: tool === 'eraser' ? 'rgba(255,255,255,0.08)' : 'rgba(92,140,255,0.18)' }} />
            <div className="absolute -left-[2px] -top-[2px] h-[4px] w-[4px] rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
          </div>
        ) : null}

        {/* its name, where every picture window has it */}
        <div className="pointer-events-none absolute left-5 top-[22px] flex items-center gap-2 text-[14px] font-semibold text-[var(--cv-ink)]">{t('canvas.redraw.title')}</div>
        {/* the tools, over the picture */}
        <div onPointerDown={(event) => event.stopPropagation()}
          className={`absolute left-1/2 top-4 flex -translate-x-1/2 cursor-default items-center gap-0.5 rounded-[14px] p-1 ${float}`}>
          {tools.map(([k, Icon, label, key]) => (
            <Tooltip key={k} label={`${t(label)} · ${key}`}><button type="button" aria-label={t(label)} className={toolBtn(tool === k)} onClick={() => setTool(k)}><Icon size={17} strokeWidth={1.8} /></button></Tooltip>
          ))}
          {onSubject ? (
            <Tooltip label={`${t('canvas.redraw.subject')} · S`}>
              <button type="button" disabled={finding} onClick={() => { void subject(); }}
                className="flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-2.5 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:opacity-40">
                {finding ? <Loader2 size={15} className="animate-spin" /> : <Scan size={15} strokeWidth={1.8} />}{t('canvas.redraw.subject')}
              </button>
            </Tooltip>
          ) : null}
          <Tooltip label={`${t('canvas.redraw.erase')} · E`}><button type="button" aria-label={t('canvas.redraw.erase')} className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')}><Eraser size={17} strokeWidth={1.8} /></button></Tooltip>
          {sep}
          <Tooltip label={`${t('canvas.redraw.pin')} · N`}><button type="button" aria-label={t('canvas.redraw.pin')} className={toolBtn(tool === 'pin')} onClick={() => setTool('pin')}><MapPin size={17} strokeWidth={1.8} /></button></Tooltip>
          {sep}
          <label title={`${t('canvas.redraw.size')} · [ ]`} className="flex items-center gap-2 px-1.5">
            <span className="flex h-4 w-4 items-center justify-center"><span className="rounded-full bg-[var(--cv-ink-2)]" style={{ width: Math.max(3, Math.min(14, brush / short * 90)), height: Math.max(3, Math.min(14, brush / short * 90)) }} /></span>
            <input type="range" min={2} max={brushMax} value={brush} onChange={(event) => setSize(Number(event.target.value))} className="h-1 w-20 cursor-pointer accent-[var(--cv-ink)]" />
          </label>
          {sep}
          <Tooltip label={`${t('canvas.redraw.undo')} · ${MOD}Z`}><button type="button" aria-label={t('canvas.redraw.undo')} className={toolBtn(false)} disabled={!marks.length} onClick={undo}><Undo2 size={16} /></button></Tooltip>
          <Tooltip label={`${t('canvas.redraw.redo')} · ⇧${MOD}Z`}><button type="button" aria-label={t('canvas.redraw.redo')} className={toolBtn(false)} disabled={!undone.length} onClick={redo}><Redo2 size={16} /></button></Tooltip>
          {/* the rest: the selection turned inside out, grown, shrunk, cleared */}
          <div className="relative">
            <button type="button" aria-label={t('canvas.redraw.more')} className={toolBtn(open === 'more')} onClick={() => setOpen(open === 'more' ? null : 'more')}><MoreHorizontal size={17} /></button>
            {open === 'more' ? (
              <div className={`cv-bar-down absolute right-0 top-full z-20 mt-2 w-[200px] rounded-[14px] p-1.5 ${float}`}>
                {([
                  [FlipHorizontal2, 'canvas.redraw.invert', 'I', invert, false],
                  [Grow, 'canvas.redraw.grow', null, () => grow(step), !selected],
                  [Shrink, 'canvas.redraw.shrink', null, () => grow(-step), !selected],
                  [Trash2, 'canvas.redraw.clear', null, clear, !marks.length],
                ] as const).map(([Icon, label, key, run, off]) => (
                  <button key={label} type="button" disabled={off} onClick={() => { run(); setOpen(null); }}
                    className="flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-35 disabled:hover:bg-transparent">
                    <Icon size={15} className="text-[var(--cv-ink-2)]" /><span className="flex-1">{t(label)}</span>{key ? <span className="text-[11px] text-[var(--cv-ink-3)]">{key}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {sep}
          {/* how far in */}
          <button type="button" aria-label={t('canvas.redraw.zoomOut')} className={toolBtn(false)} onClick={() => zoomTo(view.z / 1.25)}><Minus size={15} /></button>
          <Tooltip label={`${t('canvas.redraw.fit')} · ${MOD}0`}>
            <button type="button" onClick={fitView} className="h-9 min-w-[48px] rounded-[10px] px-1 text-[12px] tabular-nums text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{Math.round(scale * 100)}%</button>
          </Tooltip>
          <button type="button" aria-label={t('canvas.redraw.zoomIn')} className={toolBtn(false)} onClick={() => zoomTo(view.z * 1.25)}><Plus size={15} /></button>
        </div>

        {/* what it should become, in one place under the picture: pictures to take from, the words, the model, send */}
        <div onPointerDown={(event) => event.stopPropagation()} className="absolute inset-x-0 bottom-4 flex cursor-default flex-col items-center px-4">
          {warn ? <div className="cv-fade mb-2 rounded-full bg-amber-500/15 px-3 py-1 text-[12px] text-amber-300">{warn}</div> : null}
          <div className={`w-[min(720px,100%)] rounded-[20px] px-3 pb-2.5 pt-2.5 transition focus-within:!border-[var(--cv-ring)] ${float}`}>
            {/* pictures to take from, as a node's composer shows what goes in: tiles, and a + to bring one */}
            {onAddRef || pictures?.length ? (
              <div className="mb-1 flex items-center gap-2 px-0.5 pt-0.5">
                {refs.map((r) => (
                  <span key={r.path} className="group/ref relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-inset ring-[var(--cv-float-line)]">
                    <img src={r.src} alt="" draggable={false} className="h-full w-full object-cover" />
                    <button type="button" aria-label={t('canvas.redraw.removeRef')} onClick={() => setRefs((list) => list.filter((x) => x.path !== r.path))}
                      className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition group-hover/ref:opacity-100"><X size={11} /></button>
                  </span>
                ))}
                {(picked?.refs ?? 4) - 1 > refs.length ? (
                  <Popover open={open === 'refs'} onOpenChange={(v) => setOpen(v ? 'refs' : null)} placement="top" align="start"
                    trigger={(
                      <Tooltip label={t('canvas.redraw.addRef')}>
                        <button type="button" aria-label={t('canvas.redraw.addRef')} onClick={() => setOpen(open === 'refs' ? null : 'refs')}
                          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] ${open === 'refs' ? 'bg-[var(--cv-float-hover)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_5%,transparent)]'}`}><Plus size={18} /></button>
                      </Tooltip>
                    )}>
                    <div className={`w-[300px] p-1.5 ${float} rounded-[16px]`}>
                      {onAddRef ? (
                        <button type="button" onClick={() => { setOpen(null); file.current?.click(); }}
                          className="flex h-10 w-full items-center gap-2.5 rounded-[10px] px-2 text-left text-[13.5px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                          <Upload size={16} className="text-[var(--cv-ink-2)]" />{t('canvas.redraw.fromComputer')}
                        </button>
                      ) : null}
                      {pictures?.length ? (
                        <>
                          <div className="px-2 pb-1.5 pt-2 text-[11.5px] text-[var(--cv-ink-3)]">{t('canvas.redraw.fromProject')}</div>
                          <div className="grid max-h-[220px] grid-cols-4 gap-1.5 overflow-y-auto px-1 pb-1">
                            {pictures.filter((p) => !refs.some((r) => r.path === p.path)).map((p) => (
                              <button key={p.path} type="button" title={p.name} onClick={() => { setRefs((list) => [...list, { path: p.path, src: p.src }]); setOpen(null); }}
                                className="aspect-square overflow-hidden rounded-[9px] ring-1 ring-inset ring-[var(--cv-float-line)] transition hover:ring-2 hover:ring-[var(--cv-ring)]">
                                <img src={p.src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
                              </button>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </Popover>
                ) : null}
                <input ref={file} type="file" accept="image/*" multiple hidden onChange={(event) => { void addRefs(event.target.files); event.target.value = ''; }} />
              </div>
            ) : null}
            <textarea ref={words} value={prompt} rows={1} onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
              placeholder={t(hint)}
              className="block max-h-[120px] min-h-[40px] w-full resize-none bg-transparent px-1.5 py-2 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none [field-sizing:content] placeholder:text-[var(--cv-ink-3)]" />
            <div className="flex items-center gap-1">
              {picked ? (
                <div className="relative">
                  <button type="button" onClick={() => setOpen(open === 'models' ? null : 'models')}
                    className="flex h-8 min-w-0 items-center gap-1.5 rounded-[9px] px-2 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                    <ProviderMark id={picked.via} size={14} /><span className="truncate">{picked.name}</span><ChevronDown size={13} />
                  </button>
                  {open === 'models' ? (
                    <div className={`cv-bar-up absolute bottom-full left-0 z-20 mb-2 w-[260px] rounded-[14px] p-1.5 ${float}`}>
                      {models.map((m) => (
                        <button key={m.key} type="button" onClick={() => { setModelKey(m.key); setOpen(null); }}
                          className="flex h-9 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                          <ProviderMark id={m.via} size={15} /><span className="min-w-0 flex-1 truncate">{m.name}</span>
                          {m.key === picked.key ? <Check size={14} className="text-[var(--cv-ink-2)]" /> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <span className="min-w-0 flex-1 truncate px-1 text-[11.5px] text-[var(--cv-ink-3)]">
                {way ? t(`canvas.redraw.way.${way}`) : null}{selected ? ` · ${t('canvas.redraw.covered').replace('{n}', cover < 0.01 ? '<1' : String(Math.round(cover * 100)))}` : ''}
              </span>
              <Tooltip label={`${t('canvas.redraw.send')} · ↵`}>
                <button type="button" aria-label={t('canvas.redraw.send')} disabled={!ready} onClick={() => { void make(); }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
                  {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={16} />}
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>
    </CanvasModal>
  );
}
