/**
 * A picture changed in part, as the models that redraw make it: brushed, lassoed or boxed where it is to be redrawn (a
 * mask, clear where marked), the same over what is to go (with words that say to take it out and fill the place in),
 * or with the changes drawn on it (a markup: strokes, arrows, boxes, words and numbered pins on a clear picture its
 * size, the words below then able to say "1: …, 2: …"); then what it should become, in words, and the model that does
 * it. What is marked is kept as a PNG of the picture's own size; the change is a new picture, made from this one,
 * beside it.
 *
 * The picture is worked on as in a drawing program: zoomed (a pinch, ⌘ and the wheel, + and -) round the pointer,
 * moved (Space or the middle button and a drag, or two fingers), fitted again (⌘0); the brush is a ring the size it
 * paints; what is marked is a tinted wash with a lit edge, hidden for a look at the picture (H), turned inside out (I).
 */
import React from 'react';
import {
  ArrowUpRight, Brush, Check, ChevronDown, Eraser, Eye, EyeOff, FlipHorizontal2, Lasso, MapPin, Maximize, Minus, PenLine, Plus, Redo2, Sparkles,
  Square, SquareDashed, Trash2, Type as TypeIcon, Undo2, Wand2,
} from 'lucide-react';
import { useT } from '@/i18n';
import { ProviderMark } from '../settings/ProviderMark';
import { CanvasModal } from './libraries';

export type RedrawWay = 'mask' | 'markup';
/** how the editor is opened: brushing what to redraw, brushing what to take out, or drawing the change */
export type RedrawStart = 'mask' | 'remove' | 'markup';
/** a model that redraws part of a picture, and how */
export interface RedrawModel { key: string; name: string; via: string; mask: boolean; markup: boolean }

type Point = [number, number];
/** something marked: a brush stroke (or an eraser's), a filled shape (lasso, box; or erased so), the whole turned
    inside out, an arrow, a box drawn round something, words, or a numbered pin */
type Mark =
  | { kind: 'stroke'; erase: boolean; width: number; color: string; points: Point[] }
  | { kind: 'shape'; erase: boolean; points: Point[] }
  | { kind: 'invert' }
  | { kind: 'arrow'; width: number; color: string; from: Point; to: Point }
  | { kind: 'box'; width: number; color: string; from: Point; to: Point }
  | { kind: 'text'; size: number; color: string; at: Point; text: string }
  | { kind: 'pin'; size: number; color: string; at: Point; n: number };
type Tool = 'brush' | 'lasso' | 'rect' | 'eraser' | 'pen' | 'arrow' | 'box' | 'text' | 'pin';

/** the wash a mask is shown in; the markup's colors, plain ones the model reads as marks */
const WASH = 'rgb(92, 140, 255)';
const MARKS = ['#ff3b30', '#ffd60a', '#34c759', '#2f7bff', '#ffffff'];
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** the words that ask for what was marked to be taken out */
const REMOVE_WORDS = 'Remove what is in the marked area completely and fill the place in naturally, continuing the surroundings, their texture, light and perspective, with no trace of what was there.';
/** how far in and out the picture is zoomed, against it fitted */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
/** the room kept round the picture fitted */
const MARGIN = 56;

function shapePath(ctx: CanvasRenderingContext2D, points: readonly Point[]) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function draw(ctx: CanvasRenderingContext2D, m: Exclude<Mark, { kind: 'invert' }>) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (m.kind === 'stroke') {
    ctx.lineWidth = m.width;
    ctx.beginPath();
    m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (m.points.length === 1) ctx.lineTo(m.points[0]![0] + 0.01, m.points[0]![1]);
    ctx.stroke();
  } else if (m.kind === 'shape') {
    shapePath(ctx, m.points);
    ctx.fill();
  } else if (m.kind === 'arrow') {
    const [x0, y0] = m.from; const [x1, y1] = m.to;
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = m.width * 4;
    ctx.lineWidth = m.width;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - Math.cos(angle) * head * 0.6, y1 - Math.sin(angle) * head * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - head * Math.cos(angle - 0.42), y1 - head * Math.sin(angle - 0.42));
    ctx.lineTo(x1 - head * Math.cos(angle + 0.42), y1 - head * Math.sin(angle + 0.42));
    ctx.closePath();
    ctx.fill();
  } else if (m.kind === 'box') {
    ctx.lineWidth = m.width;
    const x = Math.min(m.from[0], m.to[0]); const y = Math.min(m.from[1], m.to[1]);
    const w = Math.abs(m.to[0] - m.from[0]); const h = Math.abs(m.to[1] - m.from[1]);
    const r = Math.min(m.width * 2, w / 2, h / 2);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
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
 * What was marked, at the picture's size: shown (`look`) over it, or as the file a model takes — a mask opaque but where
 * marked, a markup clear but for its marks.
 */
function paint(ctx: CanvasRenderingContext2D, way: RedrawWay, marks: readonly Mark[], look: boolean) {
  const { width, height } = ctx.canvas;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  if (way === 'mask' && !look) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); }
  for (const m of marks) {
    if (m.kind === 'invert') {
      /* inside out: what is marked clear, what was clear marked */
      ctx.globalCompositeOperation = 'xor';
      ctx.fillStyle = look ? WASH : '#000';
      ctx.fillRect(0, 0, width, height);
      continue;
    }
    const erase = (m.kind === 'stroke' || m.kind === 'shape') && m.erase;
    if (way === 'mask' && !look) { ctx.globalCompositeOperation = erase ? 'source-over' : 'destination-out'; ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; }
    else {
      ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
      const color = way === 'mask' || m.kind === 'shape' ? WASH : m.color;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
    }
    draw(ctx, m);
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** how much of the picture is marked, from 0 to 1, read off a small copy of what is shown */
function coverOf(source: HTMLCanvasElement): number {
  const small = document.createElement('canvas');
  const k = Math.min(1, 160 / Math.max(source.width, source.height));
  small.width = Math.max(1, Math.round(source.width * k));
  small.height = Math.max(1, Math.round(source.height * k));
  const ctx = small.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(source, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  let on = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 40) on += 1;
  return on / (small.width * small.height);
}

export function RedrawEditor({ src, start = 'mask', models, model: firstModel, onClose, onMake }: {
  src: string;
  start?: RedrawStart;
  /** the connected models that redraw part of a picture: only the ways they redraw by are offered */
  models: readonly RedrawModel[];
  /** the one picked first (the picture's own, else the last used) */
  model?: string;
  onClose: () => void;
  /** what was marked (the PNG a model takes), what it should become, and the model: made beside the picture */
  onMake: (way: RedrawWay, drawn: Blob, prompt: string, model: string) => Promise<void>;
}) {
  const t = useT();
  const can = { mask: models.some((m) => m.mask), markup: models.some((m) => m.markup) };
  const [mode, setMode] = React.useState<RedrawStart>(() => (start === 'markup' ? (can.markup ? 'markup' : 'mask') : can.mask ? start : 'markup'));
  const way: RedrawWay = mode === 'markup' ? 'markup' : 'mask';
  const [tool, setTool] = React.useState<Tool>(() => (start === 'markup' && can.markup ? 'pen' : 'brush'));
  const [size, setSize] = React.useState(0);
  const [color, setColor] = React.useState(MARKS[0]!);
  const [marks, setMarks] = React.useState<Mark[]>([]);
  /* what was undone, to redo; marking anew forgets it */
  const [undone, setUndone] = React.useState<Mark[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [shown, setShown] = React.useState(true);
  const [cover, setCover] = React.useState(0);
  const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
  /* the stage's size, and the picture's place on it: zoomed against fitted, and moved from the middle */
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ z: 1, x: 0, y: 0 });
  const [hand, setHand] = React.useState(false);
  const [panning, setPanning] = React.useState(false);
  const usable = models.filter((m) => (way === 'mask' ? m.mask : m.markup));
  const [modelKey, setModelKey] = React.useState(firstModel);
  const picked = usable.find((m) => m.key === modelKey) ?? usable[0];
  const [modelsOpen, setModelsOpen] = React.useState(false);
  /* words being written where the picture was pressed, in its own pixels */
  const [typing, setTyping] = React.useState<{ at: Point; text: string } | null>(null);
  /* a shape being drawn (lasso, box, arrow), shown as a line over the picture until it is let go */
  const [outline, setOutline] = React.useState<Mark | null>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const ring = React.useRef<HTMLDivElement>(null);
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
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    paint(ctx, way, marks, true);
    if (way === 'mask' && canvas.current) setCover(coverOf(canvas.current));
  }, [marks, way, natural]);

  /* the picture on the stage */
  const fit = natural && box.w ? Math.min((box.w - MARGIN * 2) / natural.w, (box.h - MARGIN * 2) / natural.h, 4) : 1;
  const scale = fit * view.z;
  const pw = (natural?.w ?? 0) * scale; const ph = (natural?.h ?? 0) * scale;
  const left = box.w / 2 + view.x - pw / 2; const top = box.h / 2 + view.y - ph / 2;
  /* the brush, in the picture's pixels: as set, else a 24th of its short side */
  const short = natural ? Math.min(natural.w, natural.h) : 1000;
  const brushMax = Math.max(40, Math.round(short / 3));
  const brush = size || Math.max(8, Math.round(short / 24));
  const line = Math.max(3, Math.round(short / 220));

  /* zoomed to `z` round a point of the stage, which stays where it is */
  const zoomTo = (z: number, about?: { x: number; y: number }) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const p = about ?? { x: box.w / 2, y: box.h / 2 };
    setView((v) => {
      const s0 = fit * v.z; const s1 = fit * next;
      const l0 = box.w / 2 + v.x - (natural?.w ?? 0) * s0 / 2; const t0 = box.h / 2 + v.y - (natural?.h ?? 0) * s0 / 2;
      const ix = (p.x - l0) / s0; const iy = (p.y - t0) / s0;
      const l1 = p.x - ix * s1; const t1 = p.y - iy * s1;
      return { z: next, x: l1 + (natural?.w ?? 0) * s1 / 2 - box.w / 2, y: t1 + (natural?.h ?? 0) * s1 / 2 - box.h / 2 };
    });
  };
  const fitView = () => setView({ z: 1, x: 0, y: 0 });
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
  const viewRef = React.useRef(view);
  viewRef.current = view;

  /* where the pointer is on the picture, in its own pixels */
  const at = (event: { clientX: number; clientY: number }): Point => {
    const r = canvas.current!.getBoundingClientRect();
    return [(event.clientX - r.left) * ((natural?.w ?? 1) / r.width), (event.clientY - r.top) * ((natural?.h ?? 1) / r.height)];
  };
  const pins = marks.filter((m) => m.kind === 'pin').length;
  const commit = (m: Mark) => { setMarks((list) => [...list, m]); setUndone([]); };
  const commitTyping = () => {
    if (typing?.text.trim()) commit({ kind: 'text', size: Math.max(16, Math.round(short / 28)), color, at: typing.at, text: typing.text.trim() });
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
    /* moved: Space or the hand held, or the middle button */
    if (hand || event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pan.current = { x: event.clientX, y: event.clientY, from: { x: view.x, y: view.y } };
      setPanning(true);
      return;
    }
    if (event.button !== 0) return;
    const p = at(event);
    if (way === 'markup' && tool === 'text') { commitTyping(); setTyping({ at: p, text: '' }); return; }
    if (way === 'markup' && tool === 'pin') { commit({ kind: 'pin', size: Math.max(26, Math.round(short / 18)), color, at: p, n: pins + 1 }); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const erase = tool === 'eraser';
    if (tool === 'lasso' || tool === 'rect') drawing.current = { kind: 'shape', erase: event.altKey, points: [p] };
    else if (tool === 'arrow') drawing.current = { kind: 'arrow', width: line, color, from: p, to: p };
    else if (tool === 'box') drawing.current = { kind: 'box', width: line, color, from: p, to: p };
    else drawing.current = { kind: 'stroke', erase, color, width: way === 'markup' && !erase ? line : brush, points: [p] };
    if (drawing.current.kind === 'stroke') {
      const ctx = canvas.current?.getContext('2d');
      if (ctx) paint(ctx, way, [...marks, drawing.current], true);
    }
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
      m.points.push(p);
      const ctx = canvas.current?.getContext('2d');
      if (!ctx) return;
      ctx.globalCompositeOperation = m.erase ? 'destination-out' : 'source-over';
      ctx.strokeStyle = way === 'mask' ? WASH : m.color;
      ctx.lineWidth = m.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(last[0], last[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
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
  const invert = () => { if (way === 'mask') commit({ kind: 'invert' }); };
  const clear = () => { setUndone([]); setMarks([]); setTyping(null); };
  const switchTo = (next: RedrawStart) => {
    if ((next === 'markup') !== (way === 'markup')) { setMarks([]); setUndone([]); setTool(next === 'markup' ? 'pen' : 'brush'); }
    setMode(next); setTyping(null); setShown(true);
  };

  const keys = React.useRef<(event: KeyboardEvent, isDown: boolean) => void>(() => {});
  /* the dialog's own keys, not the board's under it: ⌘Z / ⇧⌘Z undo and redo; [ ] the brush; B L M E the brush, lasso,
     box and eraser (in a markup B A R T P: pen, arrow, box, words, pin); I inside out; H hide; Space held moves;
     ⌘0 fits, ⌘+ ⌘- zoom; in a words box, the box's own */
  keys.current = (event, isDown) => {
    if ((event.target as HTMLElement).closest?.('textarea, input') || event.isComposing) return;
    if (event.code === 'Space') { event.preventDefault(); setHand(isDown); return; }
    if (!isDown) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
    const markup = way === 'markup';
    if (mod && key === 'z') take(event.shiftKey ? redo : undo);
    else if (mod && key === 'y') take(redo);
    else if (mod && key === '0') take(fitView);
    else if (mod && (key === '=' || key === '+')) take(() => zoomTo(view.z * 1.25));
    else if (mod && key === '-') take(() => zoomTo(view.z / 1.25));
    else if (mod) return;
    else if (key === '[') take(() => setSize(Math.max(2, Math.round(brush / 1.2))));
    else if (key === ']') take(() => setSize(Math.min(brushMax, Math.round(brush * 1.2) + 1)));
    else if (key === 'e') take(() => setTool('eraser'));
    else if (key === 'h') take(() => setShown((v) => !v));
    else if (key === 'b') take(() => setTool(markup ? 'pen' : 'brush'));
    else if (!markup && key === 'l') take(() => setTool('lasso'));
    else if (!markup && key === 'm') take(() => setTool('rect'));
    else if (!markup && key === 'i') take(invert);
    else if (markup && key === 'a') take(() => setTool('arrow'));
    else if (markup && key === 'r') take(() => setTool('box'));
    else if (markup && key === 't') take(() => setTool('text'));
    else if (markup && key === 'p') take(() => setTool('pin'));
  };
  React.useEffect(() => {
    const press = (event: KeyboardEvent) => keys.current(event, true);
    const lift = (event: KeyboardEvent) => keys.current(event, false);
    window.addEventListener('keydown', press, true);
    window.addEventListener('keyup', lift, true);
    return () => { window.removeEventListener('keydown', press, true); window.removeEventListener('keyup', lift, true); };
  }, []);

  const make = async () => {
    if (!natural || busy || !picked) return;
    const all: Mark[] = typing?.text.trim() ? [...marks, { kind: 'text', size: Math.max(16, Math.round(short / 28)), color, at: typing.at, text: typing.text.trim() }] : marks;
    const out = document.createElement('canvas');
    out.width = natural.w;
    out.height = natural.h;
    paint(out.getContext('2d')!, way, all, false);
    const blob = await new Promise<Blob | null>((done) => out.toBlob(done, 'image/png'));
    if (!blob) return;
    setBusy(true);
    const words = mode === 'remove' ? [REMOVE_WORDS, prompt.trim()].filter(Boolean).join('\n\n') : prompt.trim();
    try { await onMake(way, blob, words, picked.key); } finally { setBusy(false); }
  };
  const drawn = way === 'mask' ? cover > 0.0005 : marks.some((m) => !(m.kind === 'stroke' && m.erase)) || Boolean(typing?.text.trim());
  const ready = drawn && (mode === 'remove' || Boolean(prompt.trim())) && !busy && Boolean(picked);

  /* ── how it looks ── */
  const railButton = (on: boolean) => `relative flex h-9 w-9 items-center justify-center rounded-[10px] transition ${on ? 'bg-[var(--cv-invert)] text-[var(--cv-on-invert)] shadow-sm' : 'text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const iconButton = 'flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:pointer-events-none disabled:opacity-30';
  const tools: Array<[Tool, React.ComponentType<{ size?: number; strokeWidth?: number }>, string, string]> = way === 'mask'
    ? [['brush', Brush, 'canvas.redraw.brush', 'B'], ['lasso', Lasso, 'canvas.redraw.lasso', 'L'], ['rect', SquareDashed, 'canvas.redraw.rect', 'M'], ['eraser', Eraser, 'canvas.redraw.erase', 'E']]
    : [['pen', PenLine, 'canvas.redraw.pen', 'B'], ['arrow', ArrowUpRight, 'canvas.redraw.arrow', 'A'], ['box', Square, 'canvas.redraw.box', 'R'], ['text', TypeIcon, 'canvas.redraw.text', 'T'], ['pin', MapPin, 'canvas.redraw.pin', 'P'], ['eraser', Eraser, 'canvas.redraw.erase', 'E']];
  const ways: Array<[RedrawStart, React.ComponentType<{ size?: number }>, string, boolean]> = [
    ['mask', Brush, 'canvas.redraw.mask', can.mask], ['remove', Wand2, 'canvas.redraw.removeWay', can.mask], ['markup', PenLine, 'canvas.redraw.markup', can.markup],
  ];
  const ideas = mode === 'mask' ? (['color', 'swap', 'add', 'look'] as const) : mode === 'markup' ? (['follow', 'swap', 'add'] as const) : ([] as const);
  const cursor = hand || panning ? (panning ? 'cursor-grabbing' : 'cursor-grab') : brushing ? 'cursor-none' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair';
  const ringSize = (tool === 'pen' ? line : brush) * scale;

  return (
    <CanvasModal label={t('canvas.redraw.title')} onClose={onClose}>
      {/* the top: its name, the three ways, and the view */}
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <span className="flex items-center gap-2 text-[14px] font-semibold"><Sparkles size={15} className="text-[var(--cv-edge-lit)]" />{t('canvas.redraw.title')}</span>
        <div className="ml-2 flex items-center gap-0.5 rounded-[11px] bg-[var(--cv-chip)] p-[3px]">
          {ways.filter(([, , , on]) => on).map(([k, Icon, label]) => (
            <button key={k} type="button" onClick={() => switchTo(k)}
              className={`flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] transition ${mode === k ? 'bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
              <Icon size={14} />{t(label)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {/* zoomed how far, and back to all of it */}
        <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-[3px] text-[12px] text-[var(--cv-ink-2)]">
          <button type="button" aria-label={t('canvas.redraw.zoomOut')} title={`${t('canvas.redraw.zoomOut')} · ${MOD}-`} className={iconButton} onClick={() => zoomTo(view.z / 1.25)}><Minus size={14} /></button>
          <button type="button" title={`${t('canvas.redraw.fit')} · ${MOD}0`} onClick={fitView} className="h-8 min-w-[52px] rounded-[8px] px-1.5 tabular-nums transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{Math.round(scale * 100)}%</button>
          <button type="button" aria-label={t('canvas.redraw.zoomIn')} title={`${t('canvas.redraw.zoomIn')} · ${MOD}+`} className={iconButton} onClick={() => zoomTo(view.z * 1.25)}><Plus size={14} /></button>
          <button type="button" aria-label={t('canvas.redraw.fit')} title={`${t('canvas.redraw.fit')} · ${MOD}0`} className={iconButton} onClick={fitView}><Maximize size={13} /></button>
        </div>
      </div>

      {/* the picture, on a quiet checkered stage */}
      <div ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onPointerEnter={() => { if (ring.current) ring.current.style.opacity = '1'; }} onPointerLeave={() => { if (ring.current) ring.current.style.opacity = '0'; }}
        onContextMenu={(event) => event.preventDefault()}
        className={`relative mx-4 mt-3 min-h-0 flex-1 touch-none select-none overflow-hidden rounded-[16px] bg-[var(--cv-card-2)] ${cursor}`}
        style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--cv-ink) 9%, transparent) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }}>
        <div className="absolute" style={{ left, top, width: pw, height: ph }}>
          <img src={src} alt="" draggable={false} onLoad={(event) => setNatural({ w: event.currentTarget.naturalWidth, h: event.currentTarget.naturalHeight })}
            className="block h-full w-full select-none rounded-[6px] shadow-[0_12px_40px_rgba(0,0,0,0.35)]" style={natural ? undefined : { maxWidth: 1, opacity: 0 }} />
          {natural ? (
            <canvas ref={canvas} width={natural.w} height={natural.h}
              className="pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-150"
              style={way === 'mask'
                ? { opacity: shown ? 0.5 : 0, filter: 'drop-shadow(0 0 0.6px #fff) drop-shadow(0 0 1.5px rgb(92,140,255))' }
                : { opacity: shown ? 1 : 0 }} />
          ) : null}
          {/* a lasso, box or arrow being drawn: its line, until it is let go */}
          {outline && natural ? (
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${natural.w} ${natural.h}`} preserveAspectRatio="none">
              {outline.kind === 'shape' ? (
                <polygon points={outline.points.map((p) => p.join(',')).join(' ')} fill={outline.erase ? 'rgba(255,255,255,0.12)' : 'rgba(92,140,255,0.28)'}
                  stroke="#fff" strokeWidth={1.5 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} className="cv-ants" />
              ) : outline.kind === 'arrow' || outline.kind === 'box' ? (
                outline.kind === 'box'
                  ? <rect x={Math.min(outline.from[0], outline.to[0])} y={Math.min(outline.from[1], outline.to[1])} width={Math.abs(outline.to[0] - outline.from[0])} height={Math.abs(outline.to[1] - outline.from[1])} fill="none" stroke={outline.color} strokeWidth={outline.width} rx={outline.width * 2} />
                  : <line x1={outline.from[0]} y1={outline.from[1]} x2={outline.to[0]} y2={outline.to[1]} stroke={outline.color} strokeWidth={outline.width} strokeLinecap="round" />
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
        </div>
        {/* the brush: a ring as large as it paints, a dot in its middle */}
        {brushing && !hand && !panning ? (
          <div ref={ring} className="pointer-events-none absolute left-0 top-0 opacity-0 transition-opacity duration-100">
            <div className="absolute rounded-full border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
              style={{ width: ringSize, height: ringSize, left: -ringSize / 2, top: -ringSize / 2, background: tool === 'eraser' ? 'rgba(255,255,255,0.08)' : way === 'mask' ? 'rgba(92,140,255,0.18)' : 'transparent' }} />
            <div className="absolute -left-[2px] -top-[2px] h-[4px] w-[4px] rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" />
          </div>
        ) : null}

        {/* the tools, on the left */}
        <div onPointerDown={(event) => event.stopPropagation()}
          className="absolute left-3 top-1/2 flex -translate-y-1/2 cursor-default flex-col items-center gap-1 rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
          {tools.map(([k, Icon, label, key]) => (
            <button key={k} type="button" aria-label={t(label)} title={`${t(label)} · ${key}`} className={railButton(tool === k)} onClick={() => setTool(k)}><Icon size={16} strokeWidth={1.8} /></button>
          ))}
          {way === 'markup' ? (
            <div className="mt-1 flex flex-col items-center gap-1.5 border-t !border-[var(--cv-float-line)] pt-2">
              {MARKS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => setColor(c)}
                  className={`h-[18px] w-[18px] rounded-full transition ${c === color ? 'ring-2 ring-[var(--cv-ink)] ring-offset-2 ring-offset-[var(--cv-float)]' : 'ring-1 ring-black/20 hover:scale-110'}`} style={{ background: c }} />
              ))}
            </div>
          ) : (
            <div className="mt-1 flex flex-col items-center gap-1 border-t !border-[var(--cv-float-line)] pt-1.5">
              <button type="button" aria-label={t('canvas.redraw.invert')} title={`${t('canvas.redraw.invert')} · I`} className={railButton(false)} onClick={invert}><FlipHorizontal2 size={16} strokeWidth={1.8} /></button>
            </div>
          )}
        </div>

        {/* the brush's size, what is marked, undo, and a look at the picture alone: below it */}
        <div onPointerDown={(event) => event.stopPropagation()}
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 cursor-default items-center gap-1 rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] px-2 py-1.5 shadow-[var(--cv-float-shadow)]">
          {brushing ? (
            <label title={`${t('canvas.redraw.size')} · [ ]`} className="flex items-center gap-2.5 pl-1.5 pr-2 text-[12px] text-[var(--cv-ink-3)]">
              <span className="flex h-5 w-5 items-center justify-center"><span className="rounded-full bg-[var(--cv-ink-2)]" style={{ width: Math.max(3, Math.min(18, (tool === 'pen' ? line : brush) / short * 120)), height: Math.max(3, Math.min(18, (tool === 'pen' ? line : brush) / short * 120)) }} /></span>
              <input type="range" min={2} max={brushMax} value={brush} disabled={tool === 'pen'} onChange={(event) => setSize(Number(event.target.value))}
                className="h-1 w-32 cursor-pointer accent-[var(--cv-ink)] disabled:opacity-30" />
              <span className="w-9 text-right tabular-nums text-[var(--cv-ink-2)]">{tool === 'pen' ? line : brush}</span>
            </label>
          ) : null}
          {brushing ? <span className="mx-1 h-5 w-px bg-[var(--cv-float-line)]" /> : null}
          <button type="button" title={`${MOD}Z`} aria-label={t('canvas.redraw.undo')} className={iconButton} disabled={!marks.length} onClick={undo}><Undo2 size={15} /></button>
          <button type="button" title={`⇧${MOD}Z`} aria-label={t('canvas.redraw.redo')} className={iconButton} disabled={!undone.length} onClick={redo}><Redo2 size={15} /></button>
          <button type="button" title={`${t(shown ? 'canvas.redraw.hide' : 'canvas.redraw.show')} · H`} aria-label={t(shown ? 'canvas.redraw.hide' : 'canvas.redraw.show')} className={iconButton} onClick={() => setShown((v) => !v)}>{shown ? <Eye size={15} /> : <EyeOff size={15} />}</button>
          <button type="button" aria-label={t('canvas.redraw.clear')} title={t('canvas.redraw.clear')} className={iconButton} disabled={!marks.length} onClick={clear}><Trash2 size={15} /></button>
          {way === 'mask' ? (
            <span className={`ml-1 min-w-[64px] rounded-[8px] px-2 py-1 text-center text-[11.5px] tabular-nums ${cover > 0.0005 ? 'bg-[color-mix(in_srgb,rgb(92,140,255)_18%,transparent)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>
              {cover > 0.0005 ? t('canvas.redraw.covered').replace('{n}', cover < 0.01 ? '<1' : String(Math.round(cover * 100))) : t('canvas.redraw.nothingYet')}
            </span>
          ) : null}
        </div>
        {/* how to move round it, said once, quietly */}
        <div className="pointer-events-none absolute right-3 top-3 rounded-[8px] bg-[var(--cv-float)]/80 px-2 py-1 text-[11px] text-[var(--cv-ink-3)] backdrop-blur-sm">{t('canvas.redraw.moveHint')}</div>
      </div>

      {/* what it should become, ideas to start from, the model, and Make */}
      <div className="px-5 pb-4 pt-3">
        {ideas.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {ideas.map((k) => (
              <button key={k} type="button" onClick={() => setPrompt((v) => (v.trim() ? `${v.trim()} ` : '') + t(`canvas.redraw.ideas.${k}`))}
                className="h-7 rounded-full border-[0.5px] !border-[var(--cv-float-line)] px-3 text-[12px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                {t(`canvas.redraw.ideas.${k}`)}…
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-3 rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-chip)] py-2.5 pl-4 pr-2.5 transition focus-within:!border-[var(--cv-ring)]">
          <textarea value={prompt} rows={2} onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); if (ready) void make(); } }}
            placeholder={t(mode === 'mask' ? 'canvas.redraw.maskHint' : mode === 'remove' ? 'canvas.redraw.removeHint' : pins ? 'canvas.redraw.pinHint' : 'canvas.redraw.markupHint')}
            className="min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[13.5px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
          {/* the model that redraws it */}
          {picked ? (
            <div className="relative shrink-0">
              <button type="button" onClick={() => setModelsOpen((v) => !v)} disabled={usable.length < 2}
                className="flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:hover:bg-transparent">
                <ProviderMark id={picked.via} size={15} />{picked.name}{usable.length > 1 ? <ChevronDown size={13} /> : null}
              </button>
              {modelsOpen ? (
                <div className="cv-bar-up absolute bottom-full right-0 z-20 mb-2 w-[240px] rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                  <div className="px-2 pb-1 pt-0.5 text-[11px] text-[var(--cv-ink-3)]">{t('canvas.redraw.model')}</div>
                  {usable.map((m) => (
                    <button key={m.key} type="button" onClick={() => { setModelKey(m.key); setModelsOpen(false); }}
                      className="flex h-9 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                      <ProviderMark id={m.via} size={16} /><span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {m.key === picked.key ? <Check size={14} className="text-[var(--cv-ink-2)]" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" disabled={!ready} onClick={() => { void make(); }} title={`${MOD}↵`}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-30">
            <Sparkles size={13} />{t(busy ? 'canvas.redraw.making' : mode === 'remove' ? 'canvas.redraw.removeMake' : 'canvas.redraw.make')}
          </button>
        </div>
      </div>
    </CanvasModal>
  );
}
