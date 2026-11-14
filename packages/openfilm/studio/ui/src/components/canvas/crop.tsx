/**
 * A picture cropped and turned, as a photo app's crop tool does it: a box over the picture, its shape free or fixed;
 * quarter turns and mirrors; and a small straightening that turns the picture about the box and grows it just enough
 * to fill the box. The result is a PNG at the picture's own resolution.
 */
import React from 'react';
import { Check, FlipHorizontal2, FlipVertical2, LoaderCircle, RotateCcw, RotateCw } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

/** a 2D affine transform as canvas and CSS take it: x' = a·x + c·y + e, y' = b·x + d·y + f */
type Mat = [number, number, number, number, number, number];
type Box = { x: number; y: number; w: number; h: number };
/** a handle on the box: its corners and edges by compass */
type Grip = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
type Aspect = 'free' | 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3';
/**
 * What is chosen: the quarter turns and mirrors (`turn`, from the picture's pixels into the upright frame), the
 * straightening in degrees and the turn and growth it makes within the frame (`lift`), and the box, in frame pixels.
 */
type Crop = { turn: Mat; angle: number; lift: Mat; box: Box; aspect: Aspect };

const ID: Mat = [1, 0, 0, 1, 0, 0];
const ASPECTS: Aspect[] = ['free', 'original', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'];
/** each shape as it is after a quarter turn */
const TURNED: Partial<Record<Aspect, Aspect>> = { '4:3': '3:4', '3:4': '4:3', '16:9': '9:16', '9:16': '16:9', '3:2': '2:3', '2:3': '3:2' };
/** how far a box may lie past an edge, in frame pixels: the slack of floating point */
const EPS = 1e-3;
/** the smallest box side, in screen pixels */
const MIN_SHOWN = 32;
/** the guides inside the box: thirds while it is dragged, ninths while the picture is straightened */
const NINTHS = Array.from({ length: 8 }, (_, i) => [(i + 1) / 9, (i + 1) % 3 === 0] as const);
const THIRDS = NINTHS.filter(([, strong]) => strong);
const GRIPS: Array<{ grip: Grip; x: 0 | 0.5 | 1; y: 0 | 0.5 | 1; cursor: string }> = [
  { grip: 'nw', x: 0, y: 0, cursor: 'nwse-resize' }, { grip: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { grip: 'ne', x: 1, y: 0, cursor: 'nesw-resize' }, { grip: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { grip: 'se', x: 1, y: 1, cursor: 'nwse-resize' }, { grip: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { grip: 'sw', x: 0, y: 1, cursor: 'nesw-resize' }, { grip: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];
const LINE = '3px solid #fff';

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
function apply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
/** a turn by `deg` degrees (clockwise on screen) about (cx, cy), `k` times larger */
function about(cx: number, cy: number, deg: number, k = 1): Mat {
  const r = (deg * Math.PI) / 180;
  const a = k * Math.cos(r), b = k * Math.sin(r);
  return [a, b, -b, a, cx - a * cx + b * cy, cy - b * cx - a * cy];
}
const scaleOf = (m: Mat) => Math.hypot(m[0], m[1]);
const corners = (b: Box): Array<[number, number]> => [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
const within = (x: number, y: number, W: number, H: number) => x >= -EPS && y >= -EPS && x <= W + EPS && y <= H + EPS;

/** the upright frame's size: the picture's, its sides swapped when it lies a quarter turn over */
function frameOf(turn: Mat, w: number, h: number): [number, number] {
  return Math.abs(turn[0]) < 0.5 ? [h, w] : [w, h];
}

/** a shape's width over its height in this frame; none when free */
function ratioOf(aspect: Aspect, W: number, H: number): number | null {
  if (aspect === 'free') return null;
  if (aspect === 'original') return W / H;
  const [w, h] = aspect.split(':').map(Number);
  return w! / h!;
}

/** the largest box of a shape, centered in the frame */
function fitted(ratio: number, W: number, H: number): Box {
  const w = Math.min(W, H * ratio), h = w / ratio;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** a box lies in the frame and on the picture everywhere */
function fits(lift: Mat, box: Box, W: number, H: number): boolean {
  const back = inv(lift);
  return corners(box).every(([x, y]) => within(x, y, W, H) && within(...apply(back, x, y), W, H));
}

/** the box moved from `from` toward `to` as far as `ok` allows */
function reach(from: Box, to: Box, ok: (box: Box) => boolean): Box {
  if (ok(to)) return to;
  const at = (t: number): Box => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, w: from.w + (to.w - from.w) * t, h: from.h + (to.h - from.h) * t });
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ok(at(mid))) lo = mid; else hi = mid;
  }
  return at(lo);
}

/** the box with a handle dragged by (dx, dy): freely, or keeping its shape (corners follow the farther axis, edges
    grow about the box's middle) */
function resized(b: Box, grip: Grip, dx: number, dy: number, ratio: number | null, min: number): Box {
  const sx = grip.includes('e') ? 1 : grip.includes('w') ? -1 : 0;
  const sy = grip.includes('s') ? 1 : grip.includes('n') ? -1 : 0;
  if (ratio === null) {
    let left = b.x, right = b.x + b.w, top = b.y, bottom = b.y + b.h;
    if (sx < 0) left = Math.min(left + dx, right - min);
    if (sx > 0) right = Math.max(right + dx, left + min);
    if (sy < 0) top = Math.min(top + dy, bottom - min);
    if (sy > 0) bottom = Math.max(bottom + dy, top + min);
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  const wide = b.w + sx * dx, tall = (b.h + sy * dy) * ratio;
  const w = Math.max(sx && sy ? Math.max(wide, tall) : sx ? wide : tall, min, min * ratio);
  const h = w / ratio;
  return {
    x: sx > 0 ? b.x : sx < 0 ? b.x + b.w - w : b.x + (b.w - w) / 2,
    y: sy > 0 ? b.y : sy < 0 ? b.y + b.h - h : b.y + (b.h - h) / 2,
    w, h,
  };
}

/** the picture turned `by` degrees more about the box's middle and grown just enough to cover the box, never below
    its own size */
function straightened(lift: Mat, by: number, box: Box, W: number, H: number): Mat {
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const back = inv(lift);
  const [ux, uy] = apply(back, cx, cy);
  const spin = mul([back[0], back[1], back[2], back[3], 0, 0], about(0, 0, -by));
  /* how much larger the picture must be for this corner to land on it, on one axis */
  const need = (d: number, u: number, size: number) => (d > 0 ? d / Math.max(size - u, 1e-9) : d < 0 ? -d / Math.max(u, 1e-9) : 0);
  let k = 0;
  for (const [x, y] of corners(box)) {
    const [dx, dy] = apply(spin, x - cx, y - cy);
    k = Math.max(k, need(dx, ux, W), need(dy, uy, H));
  }
  const s = scaleOf(lift);
  return mul(about(cx, cy, by, Math.max(1, k * s) / s), lift);
}

/** everything turned or mirrored by `g`, the box and straightening with the picture */
function reoriented(c: Crop, g: Mat, mirror: boolean): Crop {
  const ends = corners(c.box).map(([x, y]) => apply(g, x, y));
  const xs = ends.map(([x]) => x), ys = ends.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return {
    turn: mul(g, c.turn),
    angle: mirror ? -c.angle : c.angle,
    lift: mul(mul(g, c.lift), inv(g)),
    box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
    aspect: mirror ? c.aspect : TURNED[c.aspect] ?? c.aspect,
  };
}

/** the result's size, and the part of the frame it shows: whole pixels when not straightened, so the cut is exact */
function outputOf(c: Crop, W: number, H: number): { box: Box; w: number; h: number } {
  const b = c.box;
  if (!c.angle) {
    const w = Math.max(1, Math.round(b.x + b.w) - Math.round(b.x)), h = Math.max(1, Math.round(b.y + b.h) - Math.round(b.y));
    const x = Math.max(0, Math.min(Math.round(b.x), W - w)), y = Math.max(0, Math.min(Math.round(b.y), H - h));
    return { box: { x, y, w, h }, w, h };
  }
  const s = scaleOf(c.lift);
  return { box: b, w: Math.max(1, Math.round(b.w / s)), h: Math.max(1, Math.round(b.h / s)) };
}

const untouched = (w: number, h: number): Crop => ({ turn: ID, angle: 0, lift: ID, box: { x: 0, y: 0, w, h }, aspect: 'free' });

/** a handle's mark: an L at a corner, a bar at an edge, both just outside the box's line */
function markOf(x: number, y: number): React.CSSProperties {
  if (x !== 0.5 && y !== 0.5) {
    return {
      width: 18, height: 18,
      left: x ? undefined : 11, right: x ? 11 : undefined, top: y ? undefined : 11, bottom: y ? 11 : undefined,
      borderLeft: x ? undefined : LINE, borderRight: x ? LINE : undefined, borderTop: y ? undefined : LINE, borderBottom: y ? LINE : undefined,
    };
  }
  return y === 0.5
    ? { width: 3, height: 20, top: 4, left: x ? 14 : 11, background: '#fff' }
    : { width: 20, height: 3, left: 4, top: y ? 14 : 11, background: '#fff' };
}

export function CropEditor({ src, name, onClose, onDone }: {
  src: string;
  name: string;
  onClose: () => void;
  /** the result, a PNG named after the picture */
  onDone: (file: File) => Promise<void> | void;
}) {
  const t = useT();
  const [picture, setPicture] = React.useState<HTMLImageElement | 'failed' | null>(null);
  React.useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setPicture(img);
    img.onerror = () => setPicture('failed');
    img.src = src;
    return () => { img.onload = null; img.onerror = null; };
  }, [src]);
  return (
    <CanvasModal label={t('canvas.crop.title')} onClose={onClose}>
      {picture && picture !== 'failed' ? <CropBody picture={picture} name={name} onDone={onDone} /> : (
        <>
          <div className="flex items-center px-5 pr-16 pt-4"><span className="text-[14px] font-semibold">{t('canvas.crop.title')}</span></div>
          <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--cv-ink-3)]">
            {picture === 'failed' ? t('canvas.crop.failed') : <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" />}
          </div>
        </>
      )}
    </CanvasModal>
  );
}

function CropBody({ picture, name, onDone }: { picture: HTMLImageElement; name: string; onDone: (file: File) => Promise<void> | void }) {
  const t = useT();
  const pw = picture.naturalWidth, ph = picture.naturalHeight;
  const [crop, setCrop] = React.useState<Crop>(() => untouched(pw, ph));
  const [grid, setGrid] = React.useState<'thirds' | 'fine' | null>(null);
  const [busy, setBusy] = React.useState(false);
  /* the room the frame is fitted into */
  const stage = React.useRef<HTMLDivElement>(null);
  const [room, setRoom] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const watch = new ResizeObserver((entries) => { const r = entries[0]?.contentRect; if (r) setRoom({ w: r.width, h: r.height }); });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const drag = React.useRef<{ grip: Grip | 'move'; from: Box; lift: Mat; ratio: number | null; min: number; x0: number; y0: number } | null>(null);

  const [W, H] = frameOf(crop.turn, pw, ph);
  /* screen pixels per frame pixel */
  const v = room.w > 0 && room.h > 0 ? Math.min(room.w / W, room.h / H) : 0;
  const out = outputOf(crop, W, H);

  const rotate = (dir: 1 | -1) => setCrop((c) => {
    const [fw, fh] = frameOf(c.turn, pw, ph);
    return reoriented(c, dir > 0 ? [0, 1, -1, 0, fh, 0] : [0, -1, 1, 0, 0, fw], false);
  });
  const flip = (across: boolean) => setCrop((c) => {
    const [fw, fh] = frameOf(c.turn, pw, ph);
    return reoriented(c, across ? [-1, 0, 0, 1, fw, 0] : [1, 0, 0, -1, 0, fh], true);
  });
  const pick = (aspect: Aspect) => setCrop((c) => {
    const [fw, fh] = frameOf(c.turn, pw, ph);
    const ratio = ratioOf(aspect, fw, fh);
    if (ratio === null) return { ...c, aspect };
    const box = fitted(ratio, fw, fh);
    return { ...c, aspect, box, lift: c.angle ? straightened(ID, c.angle, box, fw, fh) : ID };
  });
  const straighten = (to: number) => setCrop((c) => {
    if (to === c.angle) return c;
    const [fw, fh] = frameOf(c.turn, pw, ph);
    return { ...c, angle: to, lift: to ? straightened(c.lift, to - c.angle, c.box, fw, fh) : ID };
  });

  /* where the pointer is in the frame, in its pixels */
  const at = (event: React.PointerEvent<HTMLDivElement>): [number, number] => {
    const r = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - r.left) * W) / r.width, ((event.clientY - r.top) * H) / r.height];
  };
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    const grip = (event.target as HTMLElement).closest<HTMLElement>('[data-grip]')?.dataset.grip as Grip | 'move' | undefined;
    if (!grip || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const [x0, y0] = at(event);
    drag.current = { grip, from: crop.box, lift: crop.lift, ratio: ratioOf(crop.aspect, W, H), min: Math.min(MIN_SHOWN / v, W, H), x0, y0 };
    setGrid('thirds');
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = at(event);
    const dx = x - d.x0, dy = y - d.y0;
    const ok = (b: Box) => fits(d.lift, b, W, H);
    let box: Box;
    /* moved, or resized freely: each axis on its own, so the box slides along an edge it meets */
    if (d.grip === 'move') {
      const across = reach(d.from, { ...d.from, x: d.from.x + dx }, ok);
      box = reach(across, { ...across, y: d.from.y + dy }, ok);
    } else if (d.ratio === null) {
      const want = resized(d.from, d.grip, dx, dy, null, d.min);
      const across = reach(d.from, { ...d.from, x: want.x, w: want.w }, ok);
      box = reach(across, { ...across, y: want.y, h: want.h }, ok);
    } else box = reach(d.from, resized(d.from, d.grip, dx, dy, d.ratio, d.min), ok);
    setCrop((c) => ({ ...c, box }));
  };
  const up = () => { drag.current = null; setGrid(null); };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = out.w;
      canvas.height = out.h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      const sx = out.w / out.box.w, sy = out.h / out.box.h;
      ctx.setTransform(...mul([sx, 0, 0, sy, -out.box.x * sx, -out.box.y * sy], mul(crop.lift, crop.turn)));
      ctx.drawImage(picture, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const base = name.replace(/\.[^./\\]+$/, '') || 'picture';
      await onDone(new File([blob], `${base}-crop.png`, { type: 'image/png' }));
    } finally {
      setBusy(false);
    }
  };

  const keys = React.useRef<(event: KeyboardEvent) => void>(() => {});
  /* the dialog's own keys, not the board's under it: Enter applies, R / ⇧R turn right and left, H mirrors */
  keys.current = (event) => {
    if ((event.target as HTMLElement).closest?.('textarea, input:not([type=range]), [contenteditable=true]') || event.isComposing) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
    if (key === 'enter') take(() => { void done(); });
    else if (key === 'r') take(() => rotate(event.shiftKey ? -1 : 1));
    else if (key === 'h' && !event.shiftKey) take(() => flip(true));
  };
  React.useEffect(() => {
    const listen = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listen, true);
    return () => window.removeEventListener('keydown', listen, true);
  }, []);

  const b = crop.box;
  const place: React.CSSProperties = { left: b.x * v, top: b.y * v, width: b.w * v, height: b.h * v };
  const pristine = !crop.angle && crop.aspect === 'free' && crop.turn.every((n, i) => n === ID[i]) && b.x === 0 && b.y === 0 && b.w === pw && b.h === ph;
  const seg = (on: boolean) => `h-7 rounded-[8px] px-2.5 text-[12.5px] tabular-nums transition ${on ? 'bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`;
  const icon = 'flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
  return (
    <>
      <div className="flex items-center gap-2 px-5 pr-16 pt-4">
        <span className="mr-2 text-[14px] font-semibold">{t('canvas.crop.title')}</span>
        <div className="flex items-center gap-0.5 rounded-[11px] bg-[var(--cv-chip)] p-[3px]">
          {ASPECTS.map((a) => (
            <button key={a} type="button" aria-pressed={crop.aspect === a} className={seg(crop.aspect === a)} onClick={() => pick(a)}>
              {a === 'free' ? t('canvas.crop.free') : a === 'original' ? t('canvas.crop.original') : a}
            </button>
          ))}
        </div>
      </div>
      <div ref={stage} className="flex min-h-0 flex-1 items-center justify-center p-8">
        {v > 0 ? (
          <div className="relative shrink-0 touch-none select-none" style={{ width: W * v, height: H * v }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {/* the picture as it will be, darkened outside the box */}
            <div className="absolute inset-0 overflow-hidden">
              <img src={picture.src} alt="" draggable={false} crossOrigin="anonymous"
                className="absolute left-0 top-0 max-w-none origin-top-left"
                style={{ width: pw, height: ph, transform: `matrix(${mul([v, 0, 0, v, 0, 0], mul(crop.lift, crop.turn)).join(',')})` }} />
              <div className="pointer-events-none absolute" style={{ ...place, boxShadow: '0 0 0 99999px rgba(0, 0, 0, 0.55)' }} />
            </div>
            {/* the box: dragged inside to move, by its handles to resize */}
            <div data-grip="move" className="absolute cursor-move" style={{ ...place, boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.85)' }}>
              {grid ? (grid === 'fine' ? NINTHS : THIRDS).map(([f, strong]) => {
                const tone = strong ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.22)';
                return (
                  <React.Fragment key={f}>
                    <span className="pointer-events-none absolute inset-y-0 w-px" style={{ left: `${f * 100}%`, background: tone }} />
                    <span className="pointer-events-none absolute inset-x-0 h-px" style={{ top: `${f * 100}%`, background: tone }} />
                  </React.Fragment>
                );
              }) : null}
              {GRIPS.filter((g) => (g.x === 0.5 ? b.w * v >= 64 : g.y === 0.5 ? b.h * v >= 64 : true)).map((g) => (
                <div key={g.grip} data-grip={g.grip} className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, cursor: g.cursor }}>
                  <span className="pointer-events-none absolute" style={{ ...markOf(g.x, g.y), filter: 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.6))' }} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-1 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <button type="button" className={icon} aria-label={t('canvas.crop.rotateLeft')} title={`${t('canvas.crop.rotateLeft')}  ⇧R`} onClick={() => rotate(-1)}><RotateCcw size={16} /></button>
        <button type="button" className={icon} aria-label={t('canvas.crop.rotateRight')} title={`${t('canvas.crop.rotateRight')}  R`} onClick={() => rotate(1)}><RotateCw size={16} /></button>
        <button type="button" className={icon} aria-label={t('canvas.crop.flipH')} title={`${t('canvas.crop.flipH')}  H`} onClick={() => flip(true)}><FlipHorizontal2 size={16} /></button>
        <button type="button" className={icon} aria-label={t('canvas.crop.flipV')} title={t('canvas.crop.flipV')} onClick={() => flip(false)}><FlipVertical2 size={16} /></button>
        <span className="mx-3 h-4 w-px bg-[var(--cv-float-line)]" />
        <label className="flex items-center gap-2.5 text-[12px] text-[var(--cv-ink-3)]">
          {t('canvas.crop.straighten')}
          <input type="range" min={-45} max={45} step={0.5} value={crop.angle} title={t('canvas.crop.straightenHint')}
            onChange={(event) => straighten(Number(event.target.value))} onDoubleClick={() => straighten(0)}
            onPointerDown={() => { setGrid('fine'); window.addEventListener('pointerup', () => setGrid(null), { once: true }); }}
            className="h-1 w-40 cursor-pointer accent-[var(--cv-ink)]" />
          <span className="w-12 tabular-nums text-[var(--cv-ink-2)]">{crop.angle > 0 ? '+' : ''}{crop.angle.toFixed(1)}°</span>
        </label>
        <span className="flex-1" />
        <span className="mr-2 text-[12px] tabular-nums text-[var(--cv-ink-3)]">{out.w} × {out.h}</span>
        <button type="button" disabled={pristine} onClick={() => setCrop(untouched(pw, ph))}
          className="flex h-8 items-center rounded-[8px] px-2.5 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:pointer-events-none disabled:opacity-35">
          {t('canvas.crop.reset')}
        </button>
        <button type="button" title="Enter" aria-busy={busy} disabled={busy} onClick={() => { void done(); }}
          className="ml-1 flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-60">
          {busy ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : <Check size={13} />}{t('canvas.crop.apply')}
        </button>
      </div>
    </>
  );
}
