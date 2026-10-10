/**
 * A mask (CapCut's 蒙版) as plain CSS: `mask-image` layers any browser draws, nothing of our own, no new attribute.
 * What the inspector's Mask section and the mask's handles on the picture read and write, for a whole clip (its
 * `style`) and a layer inside a page (its override's `style`) alike.
 *
 * Positions and sizes are % of the box (across and down). Feather and a rectangle's radius are % of the box's shorter
 * side: the same softness across and down, whatever the box's proportions. Below, "units" are px of the box scaled so
 * that its shorter side is 100 — the geometry gradients need (a gradient line's length depends on the proportions).
 *
 * How each shape is written:
 *
 *   linear   `linear-gradient(<rotate>deg, #000 a%, transparent b%)`: the line through (x, y) turned `rotate`, the
 *            picture showing on the side the gradient starts (below it, unturned); a → b is the feather across it.
 *   mirror   `linear-gradient(<rotate>deg, transparent a%, #000 b%, #000 c%, transparent d%)`: a band `h` wide.
 *   ellipse  `radial-gradient(ellipse <w/2>% <h/2>% at x% y%, #000 i%, transparent o%)`: i → o is the feather about
 *            its edge (100%). A radial gradient cannot be turned, so an ellipse has no rotation.
 *   rect     two bands as mirror's, across (`rotate + 90deg`) and down (`rotate + 180deg`), intersected
 *            (`mask-composite: intersect`): turned by their angles, feathered by their stops. Gradients cannot round
 *            a corner, so a rect with a radius is written as the SVG below.
 *   star, heart, a rect with a radius
 *            `url("data:image/svg+xml,…")`: an inline SVG of the shape over the box (viewBox in the box's proportions,
 *            preserveAspectRatio='none' to fill it, so turning does not skew), placed by its `transform`. A rect's
 *            feather is an feGaussianBlur; star and heart have none.
 *
 * Invert: the gradients swap black and transparent. The rect's two bands and an SVG cannot (the outside of two bands
 * is not two outsides): a full `linear-gradient(#000, #000)` layer goes above them with `mask-composite: exclude` —
 * whole XOR shape is the outside of the shape.
 *
 * Not `clip-path`: a crop is the clip's `clip-path: inset()` (clip-look), and a box has one clip-path. Crop and mask
 * stack instead: the crop cuts the box, the mask is drawn in the whole (uncropped) box, both hide.
 *
 * With faded edges (Effects, also `mask-image`: clip-look's fadeCss) the fade's gradients come first and the mask's
 * layers after, every layer intersecting the ones below it (mask layers composite from the bottom up), so each hides
 * what it hides. `mask-composite` is then one `intersect`, or a list when an inverted shape needs its `exclude`.
 *
 * Anything else in `mask-image` (written by hand, or by an agent) is a custom mask: shown as such, never rewritten,
 * the raw CSS (Advanced) has it.
 */
import { fadeCss, fadeOf, type Fade } from './clip-look.ts';

export type MaskShape = 'linear' | 'mirror' | 'ellipse' | 'rect' | 'star' | 'heart';
export const MASK_SHAPES: readonly MaskShape[] = ['linear', 'mirror', 'ellipse', 'rect', 'star', 'heart'];

export interface Mask {
  shape: MaskShape;
  /** The center, or for linear / mirror a point on the line: % across and down the box. */
  x: number;
  y: number;
  /** Size, % of the box's width and height (ellipse, rect, star, heart); mirror's band is `h`, % of the shorter side. */
  w: number;
  h: number;
  /** Clockwise, degrees (−180..180). */
  rotate: number;
  /** % of the box's shorter side. */
  feather: number;
  /** A rect's corners, % of the box's shorter side. */
  radius: number;
  invert: boolean;
}

/** The box the mask is drawn in (any unit: only its proportions count). */
export interface MaskBox { w: number; h: number }

/** Which parameters a shape has: the panel and the handles show only these. */
export const MASK_FIELDS: Record<MaskShape, { size: 'box' | 'band' | null; rotate: boolean; feather: boolean; radius: boolean }> = {
  linear: { size: null, rotate: true, feather: true, radius: false },
  mirror: { size: 'band', rotate: true, feather: true, radius: false },
  ellipse: { size: 'box', rotate: false, feather: true, radius: false },
  rect: { size: 'box', rotate: true, feather: true, radius: true },
  star: { size: 'box', rotate: true, feather: false, radius: false },
  heart: { size: 'box', rotate: true, feather: false, radius: false },
};

/** One `mask-image` layer and how it composites with the layers below it. */
export interface MaskLayer { image: string; op: 'intersect' | 'exclude' }

/* ───────────── numbers ───────────── */

const round = (n: number, d = 2) => {
  const k = 10 ** d;
  const v = Math.round(n * k) / k;
  return Object.is(v, -0) ? 0 : v;
};
const fmt = (n: number, d = 2) => String(round(n, d));
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** 0..360 (a gradient's angle as written). */
const deg360 = (a: number) => { const v = round((((a % 360) + 360) % 360)); return v === 360 ? 0 : v; };
/** −180..180 (the angle as the panel shows it). */
const deg180 = (a: number) => { const v = round(((((a + 180) % 360) + 360) % 360) - 180); return v === -180 ? 180 : v; };
const sameAngle = (a: number, b: number) => Math.abs(deg180(a - b)) < 0.05;

/** The box in units: its shorter side 100. */
function unitsOf(box?: MaskBox | null): { W: number; H: number } {
  const w = box && box.w > 0 ? box.w : 100;
  const h = box && box.h > 0 ? box.h : 100;
  const k = 100 / Math.min(w, h);
  return { W: w * k, H: h * k };
}

type U = { W: number; H: number };
/** A gradient angle's direction on screen (0deg up, 90deg right). */
const dirOf = (deg: number) => { const r = (deg * Math.PI) / 180; return { x: Math.sin(r), y: -Math.cos(r) }; };
/** How long a gradient line at `deg` is across the box (CSS: it reaches the far corners). */
const lineLength = (u: U, deg: number) => { const d = dirOf(deg); return Math.abs(u.W * d.x) + Math.abs(u.H * d.y); };
/** How far along that line a point (units) lies, from its start. */
const along = (u: U, deg: number, px: number, py: number) => {
  const d = dirOf(deg);
  return (px - u.W / 2) * d.x + (py - u.H / 2) * d.y + lineLength(u, deg) / 2;
};
/** The point on the line through the box's center at `deg`, `t` from the line's start. */
const pointAlong = (u: U, deg: number, t: number) => {
  const d = dirOf(deg);
  const s = t - lineLength(u, deg) / 2;
  return { x: u.W / 2 + s * d.x, y: u.H / 2 + s * d.y };
};

/* ───────────── CSS words ───────────── */

const BLACK = '#000';
const CLEAR = 'transparent';
const CLEAR_RE = String.raw`(?:transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\))`;
const SOLID_RE = String.raw`(?:#000(?:000)?|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))`;
const COLOR = `(${CLEAR_RE}|${SOLID_RE})`;
const NUM = String.raw`(-?\d*\.?\d+(?:e-?\d+)?)`;
const PCT = `${NUM}%`;
const isSolid = (c: string) => new RegExp(`^${SOLID_RE}$`, 'i').test(c.trim());
/** The full layer an inverted shape is excluded from. */
const FULL = `linear-gradient(${BLACK}, ${BLACK})`;
const FULL_RE = new RegExp(String.raw`^linear-gradient\(\s*(?:(?:180deg|to bottom)\s*,\s*)?${SOLID_RE}\s*,\s*${SOLID_RE}\s*\)$`, 'i');

/** `mask-image`'s layers, split at the top-level commas (a color's or a url's own kept whole). */
export function maskLayersOf(v: string | undefined): string[] {
  const s = (v ?? '').trim();
  if (!s || s === 'none') return [];
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let from = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  out.push(s.slice(from).trim());
  return out;
}

/** Each layer's `mask-composite` (the list repeats to the number of layers, as CSS does). */
function opsOf(v: string | undefined, n: number): string[] {
  const list = (v ?? '').split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  const ops = list.length ? list : ['add'];
  return Array.from({ length: n }, (_, i) => ops[i % ops.length]!);
}

/* ───────────── gradients ───────────── */

/** A gradient's stops at `at` (units along a line `L` long), as `color pos%`. */
const stops = (colors: string[], at: number[], L: number) => colors.map((c, i) => `${c} ${fmt((at[i]! / L) * 100)}%`).join(', ');

/** A band `hw` either side of the point (units), at `deg`, its edges feathered over `f`. */
function bandCss(u: U, deg: number, px: number, py: number, hw: number, f: number, invert: boolean): string {
  const L = lineLength(u, deg);
  const t = along(u, deg, px, py);
  const colors = invert ? [BLACK, CLEAR, CLEAR, BLACK] : [CLEAR, BLACK, BLACK, CLEAR];
  return `linear-gradient(${fmt(deg360(deg))}deg, ${stops(colors, [t - hw - f / 2, t - hw + f / 2, t + hw - f / 2, t + hw + f / 2], L)})`;
}

type Linear = { deg: number; colors: string[]; at: number[] };

/** A linear gradient of 2 or 4 positioned stops in black and transparent, or null. */
function linearOf(g: string): Linear | null {
  const m = /^linear-gradient\(\s*(.*)\)$/is.exec(g.trim());
  if (!m) return null;
  const parts = maskLayersOf(m[1]!);
  let deg = 180;
  const first = parts[0] ?? '';
  const angle = new RegExp(`^${NUM}(deg|turn)$|^0$`, 'i').exec(first);
  if (angle) { deg = angle[2]?.toLowerCase() === 'turn' ? Number(angle[1]) * 360 : Number(angle[1] ?? 0); parts.shift(); }
  else if (/^to\s/i.test(first)) return null;
  if (parts.length !== 2 && parts.length !== 4) return null;
  const colors: string[] = [];
  const at: number[] = [];
  for (const p of parts) {
    const s = new RegExp(`^${COLOR}\\s+${PCT}$`, 'i').exec(p);
    if (!s) return null;
    colors.push(isSolid(s[1]!) ? BLACK : CLEAR);
    at.push(Number(s[2]));
  }
  for (let i = 1; i < at.length; i += 1) if (at[i]! < at[i - 1]! - 1e-6) return null;
  return { deg, colors, at };
}

/** A band (as bandCss writes it): its middle and half width along the line from its start, and its feather (units). */
function bandOf(u: U, g: Linear): { t: number; hw: number; f: number; invert: boolean } | null {
  if (g.at.length !== 4) return null;
  const pattern = g.colors.join(' ');
  const invert = pattern === `${BLACK} ${CLEAR} ${CLEAR} ${BLACK}`;
  if (!invert && pattern !== `${CLEAR} ${BLACK} ${BLACK} ${CLEAR}`) return null;
  const L = lineLength(u, g.deg);
  const [s1, s2, s3, s4] = g.at.map((p) => (p / 100) * L) as [number, number, number, number];
  return { t: (s1 + s2 + s3 + s4) / 4, hw: (s3 + s4 - s1 - s2) / 4, f: (s2 - s1 + s4 - s3) / 2, invert };
}

/* ───────────── SVG ───────────── */

/** A five-pointed star, its points on a circle of 1 about 0, 0, the top one up. */
export const STAR_D = (() => {
  const pts: string[] = [];
  for (let k = 0; k < 10; k += 1) {
    const a = ((-90 + k * 36) * Math.PI) / 180;
    const r = k % 2 ? 0.382 : 1;
    pts.push(`${fmt(r * Math.cos(a), 3)} ${fmt(r * Math.sin(a), 3)}`);
  }
  return `M${pts.join('L')}Z`;
})();
/** A heart inside −1..1 both ways, its tip down. */
export const HEART_D = 'M0 1C-.55 .62 -1 .22 -1 -.32C-1 -.72 -.72 -1 -.45 -1C-.22 -1 -.06 -.86 0 -.68C.06 -.86 .22 -1 .45 -1C.72 -1 1 -.72 1 -.32C1 .22 .55 .62 0 1Z';
/** The blur that feathers an SVG rect: its standard deviation is the feather over this. */
const BLUR_PER_FEATHER = 3;

/** `url("data:image/svg+xml,…")`: only what a URL or the attribute around it cannot hold is escaped. */
const svgUrl = (svg: string) => `url("data:image/svg+xml,${svg.replace(/[%#<>"]/g, (c) => encodeURIComponent(c))}")`;

function svgOf(u: U, body: string): string {
  return svgUrl(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${fmt(u.W)} ${fmt(u.H)}' preserveAspectRatio='none'>${body}</svg>`);
}

/** The SVG a `url(data:image/svg+xml,…)` layer holds, or null. */
function svgText(layer: string): string | null {
  const m = /^url\(\s*(["']?)data:image\/svg\+xml(?:;charset=utf-?8|;utf8)?,(.*)\1\s*\)$/is.exec(layer.trim());
  if (!m) return null;
  try { return decodeURIComponent(m[2]!); } catch { return null; }
}

const Q = `['"]`;
const SVG_RE = new RegExp(String.raw`^<svg xmlns=${Q}http://www\.w3\.org/2000/svg${Q} viewBox=${Q}0 0 ${NUM} ${NUM}${Q} preserveAspectRatio=${Q}none${Q}>(.*)</svg>$`, 's');
const PATH_RE = new RegExp(String.raw`^<path transform=${Q}translate\(${NUM} ${NUM}\) rotate\(${NUM}\) scale\(${NUM} ${NUM}\)${Q} d=${Q}([^'"]*)${Q}\s*/>$`);
const RECT_RE = new RegExp(
  String.raw`^(?:<filter id=${Q}f${Q} x=${Q}-1${Q} y=${Q}-1${Q} width=${Q}3${Q} height=${Q}3${Q}><feGaussianBlur stdDeviation=${Q}${NUM}${Q}\s*/></filter>)?`
  + String.raw`<rect transform=${Q}translate\(${NUM} ${NUM}\) rotate\(${NUM}\)${Q} x=${Q}${NUM}${Q} y=${Q}${NUM}${Q} width=${Q}${NUM}${Q} height=${Q}${NUM}${Q} rx=${Q}${NUM}${Q}( filter=${Q}url\(#f\)${Q})?\s*/>$`,
);

/** A star, a heart or a round rect from its SVG layer (not inverted: that is the layer above). */
function svgShapeOf(layer: string): Mask | null {
  const svg = svgText(layer);
  const m = svg ? SVG_RE.exec(svg.trim()) : null;
  if (!m) return null;
  const W = Number(m[1]);
  const H = Number(m[2]);
  if (!(W > 0 && H > 0)) return null;
  const body = m[3]!.trim();
  const pct = (n: number, of: number) => round((n / of) * 100);
  const short = Math.min(W, H) / 100;
  const p = PATH_RE.exec(body);
  if (p) {
    const shape = p[6] === STAR_D ? 'star' : p[6] === HEART_D ? 'heart' : null;
    if (!shape) return null;
    const [cx, cy, r, sx, sy] = p.slice(1, 6).map(Number) as [number, number, number, number, number];
    return { shape, x: pct(cx, W), y: pct(cy, H), w: pct(sx * 2, W), h: pct(sy * 2, H), rotate: deg180(r), feather: 0, radius: 0, invert: false };
  }
  const r = RECT_RE.exec(body);
  if (r) {
    const blur = r[1] != null ? Number(r[1]) : 0;
    /* the blur and the attribute that uses it come together */
    if ((r[1] != null) !== (r[10] != null)) return null;
    const [cx, cy, rot, x, y, w, h, rx] = r.slice(2, 10).map(Number) as [number, number, number, number, number, number, number, number];
    if (Math.abs(x + w / 2) > 0.02 || Math.abs(y + h / 2) > 0.02) return null;
    return {
      shape: 'rect', x: pct(cx, W), y: pct(cy, H), w: pct(w, W), h: pct(h, H), rotate: deg180(rot),
      feather: round((blur * BLUR_PER_FEATHER) / short), radius: round(rx / short), invert: false,
    };
  }
  return null;
}

/* ───────────── a shape, written and read ───────────── */

/**
 * A mask with its numbers in range: sizes at least 0.5 %, feather 0..100, a rect's radius at most half its shorter
 * side; what the shape has not (MASK_FIELDS) is 0.
 */
export function clampMask(m: Mask, box?: MaskBox | null): Mask {
  const u = unitsOf(box);
  const fields = MASK_FIELDS[m.shape];
  const w = fields.size === 'box' ? clamp(m.w, 0.5, 1000) : 0;
  const h = fields.size ? clamp(m.h, 0.5, 1000) : 0;
  const half = Math.min((w / 100) * u.W, (h / 100) * u.H) / 2;
  return {
    ...m,
    x: clamp(m.x, -500, 600),
    y: clamp(m.y, -500, 600),
    w,
    h,
    rotate: fields.rotate ? deg180(m.rotate) : 0,
    feather: fields.feather ? clamp(m.feather, 0, 100) : 0,
    radius: fields.radius ? clamp(m.radius, 0, round(half)) : 0,
  };
}

/** A new mask of `shape`, from what the last one was (its place, size and turn kept where they mean the same). */
export function maskDefault(shape: MaskShape, box?: MaskBox | null, from?: Mask | null): Mask {
  const u = unitsOf(box);
  /* a shape is half the shorter side, the same across and down on the picture */
  const square = { w: round((50 / u.W) * 100), h: round((50 / u.H) * 100) };
  const sized = from && MASK_FIELDS[from.shape].size === 'box';
  const base: Mask = {
    shape,
    x: from?.x ?? 50,
    y: from?.y ?? 50,
    w: sized ? from!.w : square.w,
    h: sized ? from!.h : square.h,
    rotate: from && MASK_FIELDS[from.shape].rotate ? from.rotate : 0,
    feather: from && MASK_FIELDS[from.shape].feather ? from.feather : shape === 'rect' ? 0 : 10,
    radius: from?.radius ?? 0,
    invert: from?.invert ?? false,
  };
  if (shape === 'mirror') base.h = from?.shape === 'mirror' ? from.h : 30;
  return clampMask(base, box);
}

/** The layers that draw a mask, top first (see the file head for each shape's). */
export function shapeLayers(mask: Mask, box?: MaskBox | null): MaskLayer[] {
  const u = unitsOf(box);
  const m = mask;
  const px = (m.x / 100) * u.W;
  const py = (m.y / 100) * u.H;
  const layer = (image: string): MaskLayer => ({ image, op: 'intersect' });
  const inverted = (list: MaskLayer[]): MaskLayer[] => (m.invert ? [{ image: FULL, op: 'exclude' }, ...list] : list);
  switch (m.shape) {
    case 'linear': {
      const deg = m.rotate;
      const L = lineLength(u, deg);
      const t = along(u, deg, px, py);
      const f = Math.max(0, m.feather);
      const colors = m.invert ? [CLEAR, BLACK] : [BLACK, CLEAR];
      return [layer(`linear-gradient(${fmt(deg360(deg))}deg, ${stops(colors, [t - f / 2, t + f / 2], L)})`)];
    }
    case 'mirror': {
      const band = Math.max(0, m.h);
      return [layer(bandCss(u, m.rotate, px, py, band / 2, Math.min(m.feather, band), m.invert))];
    }
    case 'ellipse': {
      const rx = m.w / 2;
      const ry = m.h / 2;
      /* the feather about the edge, as a share of the ray: in units, by the ellipse's mean radius */
      const mean = ((rx / 100) * u.W + (ry / 100) * u.H) / 2;
      const k = mean > 0 ? (Math.min(m.feather, 2 * mean) / 2 / mean) * 100 : 0;
      const colors = m.invert ? [CLEAR, BLACK] : [BLACK, CLEAR];
      return [layer(`radial-gradient(ellipse ${fmt(rx)}% ${fmt(ry)}% at ${fmt(m.x)}% ${fmt(m.y)}%, ${colors[0]} ${fmt(100 - k)}%, ${colors[1]} ${fmt(100 + k)}%)`)];
    }
    case 'rect': {
      const wu = (m.w / 100) * u.W;
      const hu = (m.h / 100) * u.H;
      if (m.radius > 0) {
        const r = Math.min(m.radius, wu / 2, hu / 2);
        const f = Math.min(m.feather, wu, hu);
        const blur = f > 0 ? `<filter id='f' x='-1' y='-1' width='3' height='3'><feGaussianBlur stdDeviation='${fmt(f / BLUR_PER_FEATHER, 3)}'/></filter>` : '';
        return inverted([layer(svgOf(u, `${blur}<rect transform='translate(${fmt(px)} ${fmt(py)}) rotate(${fmt(m.rotate)})' x='${fmt(-wu / 2, 3)}' y='${fmt(-hu / 2, 3)}' width='${fmt(wu, 3)}' height='${fmt(hu, 3)}' rx='${fmt(r)}'${f > 0 ? " filter='url(#f)'" : ''}/>`))]);
      }
      const f = Math.min(m.feather, wu, hu);
      return inverted([
        layer(bandCss(u, m.rotate + 90, px, py, wu / 2, f, false)),
        layer(bandCss(u, m.rotate + 180, px, py, hu / 2, f, false)),
      ]);
    }
    default: {
      const d = m.shape === 'star' ? STAR_D : HEART_D;
      const sx = ((m.w / 100) * u.W) / 2;
      const sy = ((m.h / 100) * u.H) / 2;
      return inverted([layer(svgOf(u, `<path transform='translate(${fmt(px)} ${fmt(py)}) rotate(${fmt(m.rotate)}) scale(${fmt(sx, 3)} ${fmt(sy, 3)})' d='${d}'/>`))]);
    }
  }
}

/** The mask some layers draw (all of them, as shapeLayers writes them), or null. `ops`: each layer's composite. */
function shapeOfLayers(layers: string[], ops: string[], u: U): Mask | null {
  const n = layers.length;
  const pct = (n: number, of: number) => round((n / of) * 100);
  /* an inverted rect or SVG: the whole, excluded */
  if (n >= 2 && FULL_RE.test(layers[0]!) && ops[0] === 'exclude') {
    const inner = shapeOfLayers(layers.slice(1), ops.slice(1), u);
    return inner && (inner.shape === 'rect' || inner.shape === 'star' || inner.shape === 'heart') && !inner.invert ? { ...inner, invert: true } : null;
  }
  if (n === 2) {
    if (ops[0] !== 'intersect') return null;
    const a = linearOf(layers[0]!);
    const b = linearOf(layers[1]!);
    const ba = a && bandOf(u, a);
    const bb = b && bandOf(u, b);
    if (!a || !b || !ba || !bb || ba.invert || bb.invert || !sameAngle(b.deg, a.deg + 90)) return null;
    /* the center: where the two bands' middles cross */
    const pa = pointAlong(u, a.deg, ba.t);
    const pb = pointAlong(u, b.deg, bb.t);
    const da = dirOf(a.deg);
    const db = dirOf(b.deg);
    const sa = (pa.x - u.W / 2) * da.x + (pa.y - u.H / 2) * da.y;
    const sb = (pb.x - u.W / 2) * db.x + (pb.y - u.H / 2) * db.y;
    const cx = u.W / 2 + sa * da.x + sb * db.x;
    const cy = u.H / 2 + sa * da.y + sb * db.y;
    return {
      shape: 'rect', x: pct(cx, u.W), y: pct(cy, u.H), w: pct(ba.hw * 2, u.W), h: pct(bb.hw * 2, u.H),
      rotate: deg180(a.deg - 90), feather: round((ba.f + bb.f) / 2), radius: 0, invert: false,
    };
  }
  if (n !== 1) return null;
  const g = layers[0]!;
  const svg = svgShapeOf(g);
  if (svg) return svg;
  const radial = new RegExp(String.raw`^radial-gradient\(\s*(?:ellipse\s+)?${PCT}\s+${PCT}\s+at\s+${PCT}\s+${PCT}\s*,\s*${COLOR}\s+${PCT}\s*,\s*${COLOR}\s+${PCT}\s*\)$`, 'i').exec(g.trim());
  if (radial) {
    const [rx, ry, x, y] = radial.slice(1, 5).map(Number) as [number, number, number, number];
    const i = Number(radial[6]);
    const o = Number(radial[8]);
    const invert = !isSolid(radial[5]!);
    if (isSolid(radial[5]!) === isSolid(radial[7]!) || o < i) return null;
    /* the edge is the middle of the feather; the feather in units by the written ellipse's mean radius */
    const edge = (i + o) / 200;
    const mean = ((rx / 100) * u.W + (ry / 100) * u.H) / 2;
    return {
      shape: 'ellipse', x: round(x), y: round(y), w: round(rx * 2 * edge), h: round(ry * 2 * edge),
      rotate: 0, feather: round(((o - i) / 100) * mean), radius: 0, invert,
    };
  }
  const lin = linearOf(g);
  if (!lin) return null;
  const L = lineLength(u, lin.deg);
  if (lin.at.length === 2) {
    if (lin.colors[0] === lin.colors[1]) return null;
    const [a, b] = lin.at.map((p) => (p / 100) * L) as [number, number];
    const p = pointAlong(u, lin.deg, (a + b) / 2);
    return {
      shape: 'linear', x: pct(p.x, u.W), y: pct(p.y, u.H), w: 0, h: 0,
      rotate: deg180(lin.deg), feather: round(b - a), radius: 0, invert: lin.colors[0] === CLEAR,
    };
  }
  const band = bandOf(u, lin);
  if (!band) return null;
  const p = pointAlong(u, lin.deg, band.t);
  return {
    shape: 'mirror', x: pct(p.x, u.W), y: pct(p.y, u.H), w: 0, h: round(band.hw * 2),
    rotate: deg180(lin.deg), feather: round(band.f), radius: 0, invert: band.invert,
  };
}

/* ───────────── the whole mask-image: faded edges and a shape ───────────── */

/**
 * What a `mask-image` (with its `mask-composite`) holds: faded edges (clip-look's), then one shape. Each is undefined
 * when there is none; both null when the layers are not that (a custom mask). The layers come back as written, so
 * one of the two can be rewritten and the other kept exactly.
 */
export interface MaskStack {
  fade: Fade | undefined | null;
  shape: Mask | undefined | null;
  fadeLayers: string[];
  shapeLayers: MaskLayer[];
}

export function maskStackOf(maskImage: string | undefined, maskComposite: string | undefined, box?: MaskBox | null): MaskStack {
  const layers = maskLayersOf(maskImage);
  const n = layers.length;
  if (!n) return { fade: undefined, shape: undefined, fadeLayers: [], shapeLayers: [] };
  const ops = opsOf(maskComposite, n);
  const u = unitsOf(box);
  /* a shape is the last one to three layers; what is above it has to be faded edges, intersected */
  for (const len of [3, 2, 1]) {
    if (len > n) continue;
    const head = layers.slice(0, n - len);
    const tail = layers.slice(n - len);
    const shape = shapeOfLayers(tail, ops.slice(n - len), u);
    if (!shape) continue;
    if (head.length && ops.slice(0, head.length).some((op) => op !== 'intersect')) continue;
    const fade = head.length ? fadeOf(head.join(', '), 'intersect') : undefined;
    if (fade === null) continue;
    return {
      fade,
      shape,
      fadeLayers: head,
      shapeLayers: tail.map((image, i) => ({ image, op: ops[n - len + i] === 'exclude' ? 'exclude' : 'intersect' })),
    };
  }
  const fade = fadeOf(maskImage, maskComposite);
  if (fade) return { fade, shape: undefined, fadeLayers: layers, shapeLayers: [] };
  return { fade: null, shape: null, fadeLayers: [], shapeLayers: [] };
}

/** `mask-image` and `mask-composite` for faded edges' layers over a shape's; nulls: no mask. */
export function maskStackCss(fadeLayers: readonly string[], shape: readonly MaskLayer[]): { 'mask-image': string | null; 'mask-composite': string | null } {
  const all: MaskLayer[] = [...fadeLayers.map((image) => ({ image, op: 'intersect' as const })), ...shape];
  if (!all.length) return { 'mask-image': null, 'mask-composite': null };
  /* the bottom layer's operator is never used (nothing is under it): one `intersect` says it unless one excludes */
  const ops = all.map((l, i) => (i === all.length - 1 ? 'intersect' : l.op));
  return {
    'mask-image': all.map((l) => l.image).join(', '),
    'mask-composite': all.length < 2 ? null : ops.every((op) => op === 'intersect') ? 'intersect' : ops.join(', '),
  };
}

/** The mask a `mask-image` has: undefined for none, null for a custom one. */
export function maskOf(maskImage: string | undefined, maskComposite: string | undefined, box?: MaskBox | null): Mask | undefined | null {
  return maskStackOf(maskImage, maskComposite, box).shape;
}

/** The faded edges a `mask-image` has (with a mask under them or not): undefined for none, null when not readable. */
export function fadeIn(maskImage: string | undefined, maskComposite: string | undefined): Fade | undefined | null {
  return maskStackOf(maskImage, maskComposite).fade;
}

/** The properties with the shape set (null: taken off), the faded edges kept as written; null when it is a custom mask. */
export function withMask(
  maskImage: string | undefined, maskComposite: string | undefined, mask: Mask | null, box?: MaskBox | null,
): { 'mask-image': string | null; 'mask-composite': string | null } | null {
  const now = maskStackOf(maskImage, maskComposite, box);
  if (now.shape === null) return null;
  return maskStackCss(now.fadeLayers, mask ? shapeLayers(clampMask(mask, box), box) : []);
}

/** The properties with the faded edges set (null: taken off), the shape kept as written; null when it is a custom mask. */
export function withFade(
  maskImage: string | undefined, maskComposite: string | undefined, fade: Fade | null,
): { 'mask-image': string | null; 'mask-composite': string | null } | null {
  const now = maskStackOf(maskImage, maskComposite);
  if (now.fade === null) return null;
  return maskStackCss(maskLayersOf(fadeCss(fade)['mask-image'] ?? undefined), now.shapeLayers);
}

/** Whether the Mask section and the faded edges say all of `prop: value` (else the raw CSS shows it as written). */
export function maskOwned(prop: string, value: string, all: (p: string) => string | undefined): boolean {
  if (prop === 'mask-image') return maskStackOf(value, all('mask-composite')).shape !== null && maskLayersOf(value).length > 0;
  if (prop === 'mask-composite') return maskStackOf(all('mask-image'), value).shape !== null && maskLayersOf(all('mask-image')).length > 0;
  return false;
}
