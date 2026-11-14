/**
 * A picture changed, said in words, and shown where on it when that helps: an area selected (brushed, lassoed, boxed,
 * its subject picked, grown, shrunk or turned inside out) and marks drawn on it (strokes, arrows, boxes, words,
 * numbered pins), with pictures beside it to take from. What is sent is what the model picked can take: the marks
 * (with the selection lit among them) for one that reads a markup, the selection as a mask for one that redraws where
 * a mask is clear, else the words alone over the whole picture. The change is a new picture, made from this one,
 * beside it.
 *
 * The picture is worked on as in a drawing program: zoomed (a pinch, ⌘ and the wheel) round the pointer, moved (Space
 * or the middle button and a drag, or two fingers), fitted again (⌘0); the brush is a ring the size it paints; the
 * selection is a tinted wash with a lit edge; both are hidden for a look at the picture (H).
 */
import React from 'react';
import {
  ArrowUp, ArrowUpRight, Brush, Check, ChevronDown, Eraser, Eye, EyeOff, FlipHorizontal2, Highlighter, Lasso, Loader2, MapPin, Maximize, Minus,
  Plus, Redo2, Scan, Shrink, Expand as Grow, Sparkles, Square, SquareDashed, Trash2, Type as TypeIcon, Undo2, X,
} from 'lucide-react';
import { useT } from '@/i18n';
import { ProviderMark } from '../settings/ProviderMark';
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
  | { kind: 'arrow'; layer: 'mark'; width: number; color: string; from: Point; to: Point }
  | { kind: 'box'; layer: 'mark'; width: number; color: string; from: Point; to: Point }
  | { kind: 'text'; layer: 'mark'; size: number; color: string; at: Point; text: string }
  | { kind: 'pin'; layer: 'mark'; size: number; color: string; at: Point; n: number };
type Tool = 'brush' | 'lasso' | 'rect' | 'eraser' | 'pen' | 'arrow' | 'box' | 'text' | 'pin';

/** the wash a selection is shown in; the marks' colors, plain ones the model reads as marks */
const WASH = 'rgb(92, 140, 255)';
const MARKS = ['#ff3b30', '#ffd60a', '#34c759', '#2f7bff', '#ffffff'];
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** what the words say first, by how it is sent */
const SAY: Record<RedrawWay, string> = {
  mask: '',
  markup: 'The marks drawn on the picture (strokes, arrows, boxes, words, numbered pins, and a tinted area) show where and what to change; follow them, and leave no mark in the result.',
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

/** the marks drawn on the picture, at its size, in their colors */
function paintMarks(ctx: CanvasRenderingContext2D, marks: readonly Mark[]) {
  const { width: W, height: H } = ctx.canvas;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  for (const m of marks) {
    if (m.layer === 'select') continue;
    ctx.globalCompositeOperation = m.kind === 'stroke' && m.erase ? 'destination-out' : 'source-over';
    if (m.kind === 'stroke') { ctx.strokeStyle = m.color; strokeLine(ctx, m.points, m.width); }
    else if (m.kind === 'arrow') {
      const [x0, y0] = m.from; const [x1, y1] = m.to;
      const angle = Math.atan2(y1 - y0, x1 - x0); const head = m.width * 4;
      ctx.strokeStyle = m.color; ctx.fillStyle = m.color;
      strokeLine(ctx, [m.from, [x1 - Math.cos(angle) * head * 0.6, y1 - Math.sin(angle) * head * 0.6]], m.width);
      ctx.beginPath(); ctx.moveTo(x1, y1);
      ctx.lineTo(x1 - head * Math.cos(angle - 0.42), y1 - head * Math.sin(angle - 0.42));
      ctx.lineTo(x1 - head * Math.cos(angle + 0.42), y1 - head * Math.sin(angle + 0.42));
      ctx.closePath(); ctx.fill();
    } else if (m.kind === 'box') {
      const x = Math.min(m.from[0], m.to[0]); const y = Math.min(m.from[1], m.to[1]);
      const w = Math.abs(m.to[0] - m.from[0]); const h = Math.abs(m.to[1] - m.from[1]);
      ctx.strokeStyle = m.color; ctx.lineWidth = m.width; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(m.width * 2, w / 2, h / 2)); ctx.stroke();
    } else if (m.kind === 'text') {
      ctx.font = `600 ${m.size}px system-ui, -apple-system, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = Math.max(2, m.size / 6); ctx.lineJoin = 'round';
      ctx.strokeStyle = m.color === '#ffffff' || m.color === '#ffd60a' ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
      ctx.strokeText(m.text, m.at[0], m.at[1]);
      ctx.fillStyle = m.color; ctx.fillText(m.text, m.at[0], m.at[1]);
    } else if (m.kind === 'pin') {
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

export function RedrawEditor({ src, start, models, model: firstModel, onClose, onMake, onSubject, onAddRef }: {
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
}) {
  const t = useT();
  const [tool, setTool] = React.useState<Tool>(start === 'markup' ? 'pen' : 'brush');
  const [size, setSize] = React.useState(0);
  const [color, setColor] = React.useState(MARKS[0]!);
  const [colorsOpen, setColorsOpen] = React.useState(false);
  const [marks, setMarks] = React.useState<Mark[]>([]);
  /* what was undone, to redo; marking anew forgets it */
  const [undone, setUndone] = React.useState<Mark[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [refs, setRefs] = React.useState<RedrawRef[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [finding, setFinding] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [shown, setShown] = React.useState(true);
  const [cover, setCover] = React.useState(0);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  /* the stage's size, and the picture's place on it: zoomed against fitted, and moved from the middle */
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ z: 1, x: 0, y: 0 });
  const [hand, setHand] = React.useState(false);
  const [panning, setPanning] = React.useState(false);
  const [modelKey, setModelKey] = React.useState(firstModel);
  const picked = models.find((m) => m.key === modelKey) ?? models[0];
  const [modelsOpen, setModelsOpen] = React.useState(false);
  /* words being written where the picture was pressed, in its own pixels */
  const [typing, setTyping] = React.useState<{ at: Point; text: string } | null>(null);
  /* a shape being drawn (lasso, box, arrow), shown as a line over the picture until it is let go */
  const [outline, setOutline] = React.useState<Mark | null>(null);
  const selectCanvas = React.useRef<HTMLCanvasElement>(null);
  const markCanvas = React.useRef<HTMLCanvasElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const ring = React.useRef<HTMLDivElement>(null);
  const file = React.useRef<HTMLInputElement>(null);
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

  /* the picture on the stage */
  const fit = natural && box.w ? Math.min((box.w - MARGIN * 2) / natural.w, (box.h - MARGIN * 2 - 56) / natural.h, 4) : 1;
  const scale = fit * view.z;
  const pw = (natural?.w ?? 0) * scale; const ph = (natural?.h ?? 0) * scale;
  const left = box.w / 2 + view.x - pw / 2; const top = (box.h - 56) / 2 + view.y - ph / 2;
  /* sizes in the picture's pixels: the brush as set (else a 24th of the short side), a mark's line */
  const short = natural ? Math.min(natural.w, natural.h) : 1000;
  const brushMax = Math.max(40, Math.round(short / 3));
  const brush = size || Math.max(8, Math.round(short / 24));
  const line = Math.max(3, Math.round(short / 220));
  const step = Math.max(2, Math.round(short / 120));

  /* zoomed to `z` round a point of the stage, which stays where it is */
  const zoomTo = (z: number, about?: { x: number; y: number }) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const p = about ?? { x: box.w / 2, y: (box.h - 56) / 2 };
    setView((v) => {
      const s0 = fit * v.z; const s1 = fit * next;
      const w = natural?.w ?? 0; const h = natural?.h ?? 0;
      const l0 = box.w / 2 + v.x - w * s0 / 2; const t0 = (box.h - 56) / 2 + v.y - h * s0 / 2;
      const l1 = p.x - ((p.x - l0) / s0) * s1; const t1 = p.y - ((p.y - t0) / s0) * s1;
      return { z: next, x: l1 + w * s1 / 2 - box.w / 2, y: t1 + h * s1 / 2 - (box.h - 56) / 2 };
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
  const commitTyping = () => {
    if (typing?.text.trim()) commit({ kind: 'text', layer: 'mark', size: Math.max(16, Math.round(short / 28)), color, at: typing.at, text: typing.text.trim() });
    setTyping(null);
  };
  const brushing = tool === 'brush' || tool === 'eraser' || tool === 'pen';
  const moveRing = (event: React.PointerEvent) => {
    const el = ring.current; const r = stage.current?.getBoundingClientRect();
    if (!el || !r) return;
    el.style.transform = `translate(${event.clientX - r.left}px, ${event.clientY - r.top}px)`;
    el.style.opacity = '1';
  };

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!natural || busy) return;
    setColorsOpen(false); setModelsOpen(false);
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
    if (tool === 'text') { commitTyping(); setTyping({ at: p, text: '' }); return; }
    if (tool === 'pin') { commit({ kind: 'pin', layer: 'mark', size: Math.max(26, Math.round(short / 18)), color, at: p, n: pins + 1 }); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'lasso' || tool === 'rect') drawing.current = { kind: 'shape', layer: 'select', erase: event.altKey, points: [p] };
    else if (tool === 'arrow') drawing.current = { kind: 'arrow', layer: 'mark', width: line, color, from: p, to: p };
    else if (tool === 'box') drawing.current = { kind: 'box', layer: 'mark', width: line, color, from: p, to: p };
    else drawing.current = { kind: 'stroke', layer: tool === 'eraser' ? 'both' : tool === 'pen' ? 'mark' : 'select', erase: tool === 'eraser', color, width: tool === 'pen' ? line : brush, points: [p] };
    if (drawing.current.kind === 'stroke') move(event);
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
      const targets = [m.layer !== 'mark' ? selectCanvas.current : null, m.layer !== 'select' ? markCanvas.current : null];
      for (const c of targets) {
        const ctx = c?.getContext('2d');
        if (!ctx) continue;
        ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over';
        ctx.strokeStyle = c === selectCanvas.current ? WASH : m.color;
        strokeLine(ctx, [last, p], m.width);
        ctx.globalCompositeOperation = 'source-over';
      }
    } else if (m.kind === 'shape') {
      if (tool === 'rect') { const [x0, y0] = m.points[0]!; m.points = [[x0, y0], [p[0], y0], p, [x0, p[1]]]; }
      else m.points.push(p);
      setOutline({ ...m, points: [...m.points] });
    } else if (m.kind === 'arrow' || m.kind === 'box') { m.to = p; setOutline({ ...m }); }
  };
  const up = () => {
    if (pan.current) { pan.current = null; setPanning(false); return; }
    const done = drawing.current;
    drawing.current = null;
    setOutline(null);
    if (!done) return;
    const tiny = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]) < 4;
    if ((done.kind === 'arrow' || done.kind === 'box') && tiny(done.from, done.to)) return;
    if (done.kind === 'shape' && done.points.length < 3) return;
    commit(done);
  };
  const undo = () => { if (!marks.length) return; setUndone((u) => [...u, marks.at(-1)!]); setMarks((list) => list.slice(0, -1)); };
  const redo = () => { if (!undone.length) return; setMarks((list) => [...list, undone.at(-1)!]); setUndone((u) => u.slice(0, -1)); };
  const clear = () => { setUndone([]); setMarks([]); setTyping(null); };
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
  /* the dialog's own keys, not the board's under it: ⌘Z / ⇧⌘Z undo and redo; [ ] the brush; B L M the brush, lasso and
     box; S the subject; E the eraser; I inside out; P A R T N a mark's pen, arrow, box, words, pin; H hide; Space held
     moves; ⌘0 fits, ⌘+ ⌘- zoom; in a words box, the box's own */
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
        b: () => setTool('brush'), l: () => setTool('lasso'), m: () => setTool('rect'), e: () => setTool('eraser'), s: () => { void subject(); }, i: invert,
        p: () => setTool('pen'), a: () => setTool('arrow'), r: () => setTool('box'), t: () => setTool('text'), n: () => setTool('pin'), h: () => setShown((v) => !v),
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

  /* how it is sent: the marks when there are some and the model reads them, else the selection as a mask, else the words */
  const all: Mark[] = typing?.text.trim() ? [...marks, { kind: 'text', layer: 'mark', size: Math.max(16, Math.round(short / 28)), color, at: typing.at, text: typing.text.trim() }] : marks;
  const marked = all.some((m) => m.layer === 'mark' && !(m.kind === 'stroke' && m.erase));
  const way: RedrawWay | null = !picked ? null
    : marked ? (picked.markup ? 'markup' : null)
    : selected ? (picked.mask ? 'mask' : picked.markup ? 'markup' : null)
    : 'edit';
  const ready = Boolean(way) && Boolean(prompt.trim()) && !busy && !finding && Boolean(natural);
  const make = async () => {
    if (!ready || !natural || !picked || !way) return;
    let drawn: Blob | null = null;
    if (way !== 'edit') {
      const sel = canvasOf(natural.w, natural.h); paintSelect(sel.getContext('2d')!, all);
      const out = canvasOf(natural.w, natural.h); const ctx = out.getContext('2d')!;
      if (way === 'mask') {
        /* opaque but where selected */
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, natural.w, natural.h);
        ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(sel, 0, 0);
      } else {
        /* the selection lit among the marks */
        ctx.globalAlpha = 0.4; ctx.drawImage(sel, 0, 0); ctx.globalAlpha = 1;
        const mk = canvasOf(natural.w, natural.h); paintMarks(mk.getContext('2d')!, all); ctx.drawImage(mk, 0, 0);
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
  const toolBtn = (on: boolean) => `relative flex h-9 w-9 items-center justify-center rounded-[10px] transition ${on ? 'bg-[var(--cv-invert)] text-[var(--cv-on-invert)] shadow-sm' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const iconBtn = 'flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:pointer-events-none disabled:opacity-30';
  const sep = <span className="mx-1 h-6 w-px shrink-0 bg-[var(--cv-float-line)]" />;
  const tip = (label: string, key: string | null, node: React.ReactElement, id?: string) => <Tooltip key={id} label={key ? `${label} · ${key}` : label}>{node}</Tooltip>;
  const selectTools: Array<[Tool, React.ComponentType<{ size?: number; strokeWidth?: number }>, string, string]> = [
    ['brush', Brush, 'canvas.redraw.brush', 'B'], ['lasso', Lasso, 'canvas.redraw.lasso', 'L'], ['rect', SquareDashed, 'canvas.redraw.rect', 'M'],
  ];
  const markTools: Array<[Tool, React.ComponentType<{ size?: number; strokeWidth?: number }>, string, string]> = [
    ['pen', Highlighter, 'canvas.redraw.pen', 'P'], ['arrow', ArrowUpRight, 'canvas.redraw.arrow', 'A'], ['box', Square, 'canvas.redraw.box', 'R'],
    ['text', TypeIcon, 'canvas.redraw.text', 'T'], ['pin', MapPin, 'canvas.redraw.pin', 'N'],
  ];
  const ideas = (selected || marked ? ['remove', 'swap', 'color', 'add'] : ['look', 'light', 'season', 'add']) as string[];
  const cursor = hand || panning ? (panning ? 'cursor-grabbing' : 'cursor-grab') : brushing ? 'cursor-none' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair';
  const ringSize = (tool === 'pen' ? line : brush) * scale;
  const says = !picked ? t('canvas.redraw.noModel')
    : !way ? t(marked ? 'canvas.redraw.cannotMarks' : 'canvas.redraw.cannotMask')
    : t(`canvas.redraw.way.${way}`);

  return (
    <CanvasModal label={t('canvas.redraw.title')} onClose={onClose}>
      {/* the top: its name, and the view */}
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={15} className="text-[var(--cv-edge-lit)]" />{t('canvas.redraw.title')}</span>
        <span className="truncate text-[12px] text-[var(--cv-ink-3)]">{t('canvas.redraw.intro')}</span>
        <span className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-[3px] text-[12px] text-[var(--cv-ink-2)]">
          <button type="button" aria-label={t('canvas.redraw.zoomOut')} title={`${t('canvas.redraw.zoomOut')} · ${MOD}-`} className="flex h-7 w-7 items-center justify-center rounded-[7px] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]" onClick={() => zoomTo(view.z / 1.25)}><Minus size={13} /></button>
          <button type="button" title={`${t('canvas.redraw.fit')} · ${MOD}0`} onClick={fitView} className="h-7 min-w-[48px] rounded-[7px] px-1 tabular-nums transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{Math.round(scale * 100)}%</button>
          <button type="button" aria-label={t('canvas.redraw.zoomIn')} title={`${t('canvas.redraw.zoomIn')} · ${MOD}+`} className="flex h-7 w-7 items-center justify-center rounded-[7px] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]" onClick={() => zoomTo(view.z * 1.25)}><Plus size={13} /></button>
          <button type="button" aria-label={t('canvas.redraw.fit')} title={`${t('canvas.redraw.fit')} · ${MOD}0`} className="flex h-7 w-7 items-center justify-center rounded-[7px] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]" onClick={fitView}><Maximize size={12} /></button>
        </div>
      </div>

      {/* the picture, on a quiet dotted stage, its tools along its foot */}
      <div ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerEnter={() => { if (ring.current) ring.current.style.opacity = '1'; }} onPointerLeave={() => { if (ring.current) ring.current.style.opacity = '0'; }}
        onContextMenu={(event) => event.preventDefault()}
        className={`relative mx-4 mt-3 min-h-0 flex-1 touch-none select-none overflow-hidden rounded-[16px] bg-[var(--cv-card-2)] ${cursor}`}
        style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--cv-ink) 9%, transparent) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }}>
        <div className="absolute" style={{ left, top, width: pw, height: ph }}>
          <img src={src} alt="" draggable={false} onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            className="block h-full w-full select-none rounded-[6px] shadow-[0_12px_40px_rgba(0,0,0,0.35)]" style={natural ? undefined : { maxWidth: 1, opacity: 0 }} />
          {natural ? (
            <>
              <canvas ref={selectCanvas} width={natural.w} height={natural.h} className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150"
                style={{ opacity: shown ? 0.5 : 0, filter: 'drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 1.5px rgb(92,140,255))' }} />
              <canvas ref={markCanvas} width={natural.w} height={natural.h} className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150" style={{ opacity: shown ? 1 : 0 }} />
            </>
          ) : null}
          {/* a lasso, box or arrow being drawn: its line, until it is let go */}
          {outline && natural ? (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${natural.w} ${natural.h}`} preserveAspectRatio="none">
              {outline.kind === 'shape' ? (
                <polygon points={outline.points.map((p) => p.join(',')).join(' ')} fill={outline.erase ? 'rgba(255,255,255,0.12)' : 'rgba(92,140,255,0.28)'}
                  stroke="#fff" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} className="cv-ants" />
              ) : outline.kind === 'box' ? (
                <rect x={Math.min(outline.from[0], outline.to[0])} y={Math.min(outline.from[1], outline.to[1])} width={Math.abs(outline.to[0] - outline.from[0])} height={Math.abs(outline.to[1] - outline.from[1])} fill="none" stroke={outline.color} strokeWidth={outline.width} rx={outline.width * 2} />
              ) : outline.kind === 'arrow' ? (
                <line x1={outline.from[0]} y1={outline.from[1]} x2={outline.to[0]} y2={outline.to[1]} stroke={outline.color} strokeWidth={outline.width} strokeLinecap="round" />
              ) : null}
            </svg>
          ) : null}
          {typing && natural ? (
            <input autoFocus value={typing.text} onChange={(event) => setTyping({ ...typing, text: event.target.value })}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Enter') { event.preventDefault(); commitTyping(); }
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTyping(null); }
              }}
              placeholder={t('canvas.redraw.typeHere')}
              style={{ left: typing.at[0] * scale, top: typing.at[1] * scale - 16, color }}
              className="absolute z-10 h-8 min-w-[140px] rounded-[8px] border border-white/30 bg-black/55 px-2 text-[14px] font-semibold shadow-lg outline-none backdrop-blur-md placeholder:text-white/40" />
          ) : null}
          {finding ? (
            <div className="cv-fade pointer-events-none absolute inset-0 flex items-center justify-center rounded-[6px] bg-black/25">
              <span className="flex h-8 items-center gap-2 rounded-full bg-[var(--cv-float)] px-3 text-[12.5px] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]"><Loader2 size={14} className="animate-spin" />{t('canvas.redraw.finding')}</span>
            </div>
          ) : null}
        </div>
        {/* the brush: a ring as large as it paints, a dot in its middle */}
        {brushing && !hand && !panning ? (
          <div ref={ring} className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-100">
            <div className="absolute rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{ width: ringSize, height: ringSize, left: -ringSize / 2, top: -ringSize / 2, background: tool === 'eraser' ? 'rgba(255,255,255,0.08)' : tool === 'brush' ? 'rgba(92,140,255,0.18)' : 'transparent' }} />
            <div className="absolute -left-[2px] -top-[2px] h-[4px] w-[4px] rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
          </div>
        ) : null}
        <div className="pointer-events-none absolute right-3 top-3 rounded-[8px] bg-[var(--cv-float)]/80 px-2 py-1 text-[11px] text-[var(--cv-ink-3)] backdrop-blur-sm">{t('canvas.redraw.moveHint')}</div>

        {/* the tools, along its foot: select · change the selection · draw marks · the brush · undo, hide, clear */}
        <div onPointerDown={(event) => event.stopPropagation()}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-default items-center gap-0.5 rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
          {selectTools.map(([k, Icon, label, key]) => tip(t(label), key, <button type="button" aria-label={t(label)} className={toolBtn(tool === k)} onClick={() => setTool(k)}><Icon size={17} strokeWidth={1.8} /></button>, k))}
          {onSubject ? tip(t('canvas.redraw.subject'), 'S', <button type="button" aria-label={t('canvas.redraw.subject')} className={iconBtn} disabled={finding} onClick={() => { void subject(); }}>{finding ? <Loader2 size={17} className="animate-spin" /> : <Scan size={17} strokeWidth={1.8} />}</button>) : null}
          {tip(t('canvas.redraw.erase'), 'E', <button type="button" aria-label={t('canvas.redraw.erase')} className={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')}><Eraser size={17} strokeWidth={1.8} /></button>)}
          {sep}
          {tip(t('canvas.redraw.invert'), 'I', <button type="button" aria-label={t('canvas.redraw.invert')} className={iconBtn} onClick={invert}><FlipHorizontal2 size={17} strokeWidth={1.8} /></button>)}
          {tip(t('canvas.redraw.grow'), null, <button type="button" aria-label={t('canvas.redraw.grow')} className={iconBtn} disabled={!selected} onClick={() => grow(step)}><Grow size={16} strokeWidth={1.8} /></button>)}
          {tip(t('canvas.redraw.shrink'), null, <button type="button" aria-label={t('canvas.redraw.shrink')} className={iconBtn} disabled={!selected} onClick={() => grow(-step)}><Shrink size={16} strokeWidth={1.8} /></button>)}
          {sep}
          {markTools.map(([k, Icon, label, key]) => tip(t(label), key, <button type="button" aria-label={t(label)} className={toolBtn(tool === k)} onClick={() => setTool(k)}><Icon size={17} strokeWidth={1.8} /></button>, k))}
          {/* the marks' color */}
          <div className="relative">
            {tip(t('canvas.redraw.color'), null, (
              <button type="button" aria-label={t('canvas.redraw.color')} className={iconBtn} onClick={() => setColorsOpen((v) => !v)}>
                <span className="h-[18px] w-[18px] rounded-full ring-2 ring-[var(--cv-float)] shadow-[0_0_0_1.5px_var(--cv-ink-3)]" style={{ background: color }} />
              </button>
            ))}
            {colorsOpen ? (
              <div className="cv-bar-up absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 gap-2 rounded-[12px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-2 shadow-[var(--cv-float-shadow)]">
                {MARKS.map((c) => (
                  <button key={c} type="button" aria-label={c} onClick={() => { setColor(c); setColorsOpen(false); }}
                    className={`h-[22px] w-[22px] rounded-full transition ${c === color ? 'ring-2 ring-[var(--cv-ink)] ring-offset-2 ring-offset-[var(--cv-float)]' : 'ring-1 ring-black/20 hover:scale-110'}`} style={{ background: c }} />
                ))}
              </div>
            ) : null}
          </div>
          {brushing ? (
            <>
              {sep}
              <label title={`${t('canvas.redraw.size')} · [ ]`} className="flex items-center gap-2 px-1.5 text-[12px] text-[var(--cv-ink-3)]">
                <input type="range" min={2} max={brushMax} value={tool === 'pen' ? line : brush} disabled={tool === 'pen'} onChange={(event) => setSize(Number(event.target.value))}
                  className="h-1 w-24 cursor-pointer accent-[var(--cv-ink)] disabled:opacity-30" />
                <span className="w-7 text-right tabular-nums text-[var(--cv-ink-2)]">{tool === 'pen' ? line : brush}</span>
              </label>
            </>
          ) : null}
          {sep}
          {tip(t('canvas.redraw.undo'), `${MOD}Z`, <button type="button" aria-label={t('canvas.redraw.undo')} className={iconBtn} disabled={!marks.length} onClick={undo}><Undo2 size={16} /></button>)}
          {tip(t('canvas.redraw.redo'), `⇧${MOD}Z`, <button type="button" aria-label={t('canvas.redraw.redo')} className={iconBtn} disabled={!undone.length} onClick={redo}><Redo2 size={16} /></button>)}
          {tip(t(shown ? 'canvas.redraw.hide' : 'canvas.redraw.show'), 'H', <button type="button" aria-label={t(shown ? 'canvas.redraw.hide' : 'canvas.redraw.show')} className={iconBtn} onClick={() => setShown((v) => !v)}>{shown ? <Eye size={16} /> : <EyeOff size={16} />}</button>)}
          {tip(t('canvas.redraw.clear'), null, <button type="button" aria-label={t('canvas.redraw.clear')} className={iconBtn} disabled={!marks.length} onClick={clear}><Trash2 size={16} /></button>)}
        </div>
      </div>

      {/* what it should become: as a node's own composer — what it takes from, the words, the model, send */}
      <div className="px-4 pb-4 pt-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
          {ideas.map((k) => (
            <button key={k} type="button" onClick={() => setPrompt((v) => (v.trim() ? `${v.trim()} ` : '') + t(`canvas.redraw.ideas.${k}`))}
              className="h-7 rounded-full border-[0.5px] !border-[var(--cv-float-line)] px-3 text-[12px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
              {t(`canvas.redraw.ideas.${k}`)}
            </button>
          ))}
          <span className="ml-auto truncate pl-2 text-[11.5px] tabular-nums text-[var(--cv-ink-3)]">{selected ? t('canvas.redraw.covered').replace('{n}', cover < 0.01 ? '<1' : String(Math.round(cover * 100))) : null}</span>
        </div>
        <div className="rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] px-4 pb-3 pt-3.5 shadow-[var(--cv-float-shadow)] transition focus-within:!border-[var(--cv-ring)]">
          {/* the picture it changes, and pictures to take from */}
          <div className="flex items-center gap-2">
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-inset ring-[var(--cv-float-line)]" title={t('canvas.redraw.this')}>
              <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
            </span>
            {refs.map((r) => (
              <span key={r.path} className="group/ref relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-inset ring-[var(--cv-float-line)]">
                <img src={r.src} alt="" draggable={false} className="h-full w-full object-cover" />
                <button type="button" aria-label={t('canvas.redraw.removeRef')} onClick={() => setRefs((list) => list.filter((x) => x.path !== r.path))}
                  className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition group-hover/ref:opacity-100"><X size={11} /></button>
              </span>
            ))}
            {onAddRef && (picked?.refs ?? 4) - 1 > refs.length ? (
              <Tooltip label={t('canvas.redraw.addRef')}>
                <button type="button" aria-label={t('canvas.redraw.addRef')} onClick={() => file.current?.click()}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--cv-ink)_5%,transparent)] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><Plus size={18} /></button>
              </Tooltip>
            ) : null}
            <input ref={file} type="file" accept="image/*" multiple hidden onChange={(event) => { void addRefs(event.target.files); event.target.value = ''; }} />
          </div>
          <textarea value={prompt} rows={2} onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
            placeholder={t(selected || marked ? (pins ? 'canvas.redraw.pinHint' : 'canvas.redraw.markedHint') : 'canvas.redraw.wholeHint')}
            className="mt-3 block max-h-[22vh] min-h-[44px] w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
          <div className="mt-2 flex min-w-0 items-center gap-1">
            {/* the model that changes it */}
            {picked ? (
              <div className="relative">
                <button type="button" onClick={() => setModelsOpen((v) => !v)}
                  className="flex h-9 min-w-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                  <ProviderMark id={picked.via} size={16} /><span className="truncate">{picked.name}</span><ChevronDown size={14} className="text-[var(--cv-ink-3)]" />
                </button>
                {modelsOpen ? (
                  <div className="cv-bar-up absolute bottom-full left-0 z-20 mb-2 w-[280px] rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                    <div className="px-2 pb-1 pt-0.5 text-[11px] text-[var(--cv-ink-3)]">{t('canvas.redraw.model')}</div>
                    {models.map((m) => (
                      <button key={m.key} type="button" onClick={() => { setModelKey(m.key); setModelsOpen(false); }}
                        className="flex h-10 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-[var(--cv-chip)]"><ProviderMark id={m.via} size={14} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate leading-4">{m.name}</span>
                          <span className="block truncate text-[11px] leading-4 text-[var(--cv-ink-3)]">{[m.mask ? t('canvas.redraw.can.mask') : null, m.markup ? t('canvas.redraw.can.markup') : null, t('canvas.redraw.can.edit')].filter(Boolean).join(' · ')}</span>
                        </span>
                        {m.key === picked.key ? <Check size={14} className="text-[var(--cv-ink-2)]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {/* how it will be sent, said plainly */}
            <span className={`min-w-0 flex-1 truncate px-1 text-[12px] ${way ? 'text-[var(--cv-ink-3)]' : 'text-amber-500/90'}`}>{problem ?? says}</span>
            <Tooltip label={`${t('canvas.redraw.send')} · ${MOD}↵`}>
              <button type="button" aria-label={t('canvas.redraw.send')} disabled={!ready} onClick={() => { void make(); }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
                {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    </CanvasModal>
  );
}
