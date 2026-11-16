/**
 * A picture lit anew, set by hand: where the light comes from (a bulb moved on a sphere around the picture), its color,
 * how bright and how soft it is, and a fainter second light opposite; said as the words an image model relights the
 * picture by, the picture going in as its reference. Or one of the light presets, as it is.
 */
import React from 'react';
import { ArrowUp, Box, Lightbulb, RotateCcw, Square } from 'lucide-react';
import { useT } from '@/i18n';
import { PRESETS } from '@/lib/canvas-presets';
import { CanvasModal } from './libraries';
import { ColorSwatch } from '../ColorPicker';

const PICTURES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>('./presets/light*.webp', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.slice('./presets/'.length, -'.webp'.length), url]));
const LIGHT_PRESETS = PRESETS.filter((p) => p.group === 'light');

/** a light color: its swatch, and how the words name it */
type Swatch = { id: string; hex: string; words: string };
const COLORS: Swatch[] = [
  { id: 'warmWhite', hex: '#ffe2bf', words: 'warm white 3200 K' },
  { id: 'daylight', hex: '#f3f7ff', words: 'neutral 5600 K daylight' },
  { id: 'golden', hex: '#ffc163', words: 'warm golden' },
  { id: 'sunset', hex: '#ff7b3a', words: 'deep sunset orange' },
  { id: 'candle', hex: '#ffa24a', words: 'flickering 1900 K candle-orange' },
  { id: 'coolBlue', hex: '#7fb2ff', words: 'cool blue' },
  { id: 'moonlight', hex: '#b8c6ff', words: 'pale silver-blue moonlight' },
  { id: 'magenta', hex: '#ff38e8', words: 'vivid magenta' },
  { id: 'cyan', hex: '#2fe4ff', words: 'vivid cyan' },
  { id: 'green', hex: '#3cf57a', words: 'vivid green' },
];

/** where the light is: azimuth 0 from the camera, 90 from the right, 180 from behind, 270 from the left; elevation
    up from eye level */
type Light = { azimuth: number; elevation: number };
/** how the sphere is seen: turned around its upright axis (yaw), and tipped toward the eye from above (pitch) */
type View = { yaw: number; pitch: number };
type Vec = [number, number, number];

const START: Light = { azimuth: 315, elevation: 35 };
const PERSPECTIVE: View = { yaw: -30, pitch: 15 };
const FRONT: View = { yaw: 0, pitch: 0 };
const DIRECTIONS: Array<[string, (now: Light) => Light]> = [
  ['left', () => ({ azimuth: 270, elevation: 0 })],
  ['top', (now) => ({ azimuth: now.azimuth, elevation: 80 })],
  ['right', () => ({ azimuth: 90, elevation: 0 })],
  ['front', () => ({ azimuth: 0, elevation: 0 })],
  ['bottom', (now) => ({ azimuth: now.azimuth, elevation: -80 })],
  ['back', () => ({ azimuth: 180, elevation: 0 })],
];

/* the stage: its size, the sphere's radius, and the eye's distance from the picture (the perspective) */
const W = 372;
const H = 320;
const R = 120;
const DEPTH = 640;
const RAD = Math.PI / 180;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** a direction on the sphere as a point: x right, y up, z toward the camera */
const toVec = (azimuth: number, elevation: number, r = R): Vec =>
  [r * Math.cos(elevation * RAD) * Math.sin(azimuth * RAD), r * Math.sin(elevation * RAD), r * Math.cos(elevation * RAD) * Math.cos(azimuth * RAD)];
const toLight = ([x, y, z]: Vec): Light => ({
  azimuth: (Math.atan2(x, z) / RAD + 360) % 360,
  elevation: clamp(Math.asin(clamp(y / Math.hypot(x, y, z), -1, 1)) / RAD, -80, 80),
});
/** a point as the view sees it: turned by its yaw, then its pitch (as CSS's rotateX(-pitch) rotateY(yaw) turns the card) */
function turn([x, y, z]: Vec, view: View): Vec {
  const cy = Math.cos(view.yaw * RAD), sy = Math.sin(view.yaw * RAD), cp = Math.cos(view.pitch * RAD), sp = Math.sin(view.pitch * RAD);
  const z1 = -x * sy + z * cy;
  return [x * cy + z * sy, y * cp - z1 * sp, y * sp + z1 * cp];
}
/** the other way: a point the view sees, back where it is */
function unturn([x, y, z]: Vec, view: View): Vec {
  const cy = Math.cos(view.yaw * RAD), sy = Math.sin(view.yaw * RAD), cp = Math.cos(view.pitch * RAD), sp = Math.sin(view.pitch * RAD);
  const z1 = -y * sp + z * cp;
  return [x * cy - z1 * sy, y * cp + z * sp, x * sy + z1 * cy];
}
/** where a seen point falls on the stage, from its middle with y down, and how much nearness grows it */
function project([x, y, z]: Vec) {
  const s = DEPTH / (DEPTH - z);
  return { x: x * s, y: -y * s, s };
}
/** the sphere's own outline on the stage: a little larger than its radius, seen in perspective */
const OUTLINE = (R * DEPTH) / Math.sqrt(DEPTH * DEPTH - R * R);
/** a point of the sphere the eye sees (not hidden by its near side) lies nearer than this */
const NEAR = (R * R) / DEPTH;

/** the point of the sphere under a point of the stage, on its near or far side; past its outline, the outline */
function under(sx: number, sy: number, far: boolean): { at: Vec; out: boolean } {
  const a = sx * sx + sy * sy + DEPTH * DEPTH, b = -2 * DEPTH * DEPTH, c = DEPTH * DEPTH - R * R;
  const disc = b * b - 4 * a * c;
  const out = disc < 0;
  const t = (-b + (out ? 0 : (far ? 1 : -1) * Math.sqrt(disc))) / (2 * a);
  const p: Vec = [sx * t, -sy * t, DEPTH - DEPTH * t];
  const k = R / Math.hypot(...p);
  return { at: [p[0] * k, p[1] * k, p[2] * k], out };
}

/** a ring on the sphere drawn as paths: in front of the picture's plane or behind it, and on the side the eye sees or
    the far side */
function ring(points: Vec[], view: View) {
  const out = { front: { near: '', far: '' }, back: { near: '', far: '' } };
  let last = '';
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!, b = points[i]!;
    const mid: Vec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const layer = mid[2] >= 0 ? 'front' : 'back';
    const side = turn(mid, view)[2] >= NEAR ? 'near' : 'far';
    const pa = project(turn(a, view)), pb = project(turn(b, view));
    if (layer + side !== last) out[layer][side] += `M${pa.x.toFixed(1)} ${pa.y.toFixed(1)}`;
    out[layer][side] += `L${pb.x.toFixed(1)} ${pb.y.toFixed(1)}`;
    last = layer + side;
  }
  return out;
}
const sweep = (from: number, to: number, at: (deg: number) => Vec, steps = 96) =>
  Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps));

const rgba = (hex: string, alpha: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${clamp(alpha, 0, 1).toFixed(3)})`;
/** a typed color as #rrggbb, or null */
function hexOf(text: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.replace(/./g, (c) => c + c) : h}`;
}

/** a color's name in words: a swatch's own, or from its hue, with the hex to be exact */
function colorWords(hex: string): string {
  const swatch = COLORS.find((c) => c.hex === hex);
  if (swatch) return swatch.words;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.15 || l > 0.94) return `neutral white (${hex})`;
  const hue = (max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  const names: Array<[number, string]> = [[15, 'red'], [40, 'orange'], [52, 'amber'], [68, 'yellow'], [95, 'yellow-green'], [150, 'green'], [175, 'teal'],
    [195, 'cyan'], [220, 'sky blue'], [250, 'blue'], [280, 'violet'], [310, 'purple'], [335, 'magenta'], [350, 'pink'], [360, 'red']];
  const name = names.find(([upTo]) => (hue + 360) % 360 < upTo)![1];
  const shade = l > 0.78 ? 'pale ' : l < 0.3 ? 'deep ' : s > 0.75 ? 'vivid ' : '';
  return `${shade}${name} (${hex})`;
}

/** where a light is, as a photographer says it: the side, the height, and the angles */
function placeOf(azimuth: number, elevation: number) {
  const signed = ((azimuth + 180) % 360) - 180;
  const turnTo = Math.abs(signed), side = signed < 0 ? 'left' : 'right';
  const place = turnTo <= 22.5 ? 'the front' : turnTo <= 67.5 ? `the front ${side}` : turnTo <= 112.5 ? `the ${side} side`
    : turnTo <= 157.5 ? `behind on the ${side}` : 'directly behind';
  const height = elevation >= 35 ? 'high above' : elevation >= 12 ? 'slightly above' : elevation > -12 ? 'at eye level'
    : elevation > -35 ? 'slightly below' : 'well below';
  const up = Math.abs(elevation) < 2.5 ? 'level with the subject' : `about ${Math.round(Math.abs(elevation) / 5) * 5}° ${elevation > 0 ? 'above' : 'below'}`;
  const across = turnTo < 2.5 ? 'in line with the camera' : turnTo > 177.5 ? 'straight behind the subject'
    : turnTo > 90 ? `${Math.round((180 - turnTo) / 5) * 5}° to the ${side} of straight behind` : `${Math.round(turnTo / 5) * 5}° to the ${side} of the camera`;
  const from = elevation >= 65 ? 'almost directly above' : elevation <= -65 ? 'almost directly below' : `${place}, ${height}`;
  return { turnTo, place, from: `${from} (${up} and ${across})` };
}

/** the words an image model relights the picture by */
function lightWords({ light, color, bright, soft, fill, fillColor }: { light: Light; color: string; bright: number; soft: boolean; fill: boolean; fillColor: string }) {
  const { turnTo, from } = placeOf(light.azimuth, light.elevation);
  const role = light.elevation >= 65 ? 'top light' : light.elevation <= -35 ? 'underlight' : turnTo > 112.5 ? 'backlight' : turnTo > 67.5 ? 'side light' : 'key light';
  const strength = bright < 20 ? 'faint, the scene dark and low-key' : bright < 45 ? 'dim and moody' : bright < 75 ? 'bright' : 'very bright, the scene high-key';
  const shadows = soft ? 'gentle, feathered shadows and a smooth falloff' : 'crisp, sharp-edged shadows and strong contrast';
  const does = role === 'backlight' ? ', outlining the subject with a glowing rim while its front falls into shadow'
    : role === 'side light' ? ', leaving the far side in shadow' : role === 'top light' ? ', casting shadows straight down'
    : role === 'underlight' ? ', throwing shadows upward' : '';
  let second = '';
  if (fill) {
    const other = placeOf((light.azimuth + 180) % 360, 0);
    const rim = other.turnTo >= 90;
    second = `, and a subtle ${colorWords(fillColor)} ${rim ? 'rim light' : 'fill light'} from ${other.place}${rim ? ' tracing the edges of the subject' : ' lifting the shadows'}`;
  }
  return `Relight the reference picture with a ${soft ? 'soft, diffused' : 'hard, direct'} ${colorWords(color)} ${role} from ${from}, ${strength}, `
    + `with ${shadows}${does}${second}; keep every person, face, pose, object, the framing and the layout of the background exactly the same, `
    + 'and change only the light, the shadows and the color of the light.';
}

/** a soft cone of light from a point of the stage toward the picture's middle */
function Beam({ id, from, color, strength, wide }: { id: string; from: { x: number; y: number; s: number }; color: string; strength: number; wide: boolean }) {
  const length = Math.hypot(from.x, from.y);
  if (length < 14) return null;
  const nx = -from.y / length, ny = from.x / length;
  const tip = 4 * from.s, base = wide ? 62 : 30;
  return (
    <g>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={from.x} y1={from.y} x2={0} y2={0}>
          <stop offset="0" stopColor={color} stopOpacity={strength} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${id})`}
        points={`${from.x + nx * tip},${from.y + ny * tip} ${from.x - nx * tip},${from.y - ny * tip} ${-nx * base},${-ny * base} ${nx * base},${ny * base}`} />
    </g>
  );
}

/**
 * The light's direction, in 3D: the picture as a card in a glass sphere, the bulb on the sphere drawn before or behind
 * the card by the side it is on, its beam toward the card, the card lit roughly as asked. Drag the bulb to move the
 * light (past the sphere's edge it goes round to the far side); drag elsewhere to turn the view; arrows move the light.
 */
function Orbit({ src, light, view, color, bright, soft, fill, fillColor, onLight, onView, onGrab }: {
  src: string; light: Light; view: View; color: string; bright: number; soft: boolean; fill: boolean; fillColor: string;
  onLight: (light: Light) => void; onView: (view: View) => void; onGrab: () => void;
}) {
  const t = useT();
  const uid = React.useId().replace(/:/g, '');
  const [ratio, setRatio] = React.useState(4 / 3);
  /* the pointer over the bulb, to show it is moved, not turned */
  const [over, setOver] = React.useState(false);
  const drag = React.useRef<{ kind: 'light'; far: boolean; out: boolean } | { kind: 'view'; x: number; y: number; from: View } | null>(null);

  const key = toVec(light.azimuth, light.elevation);
  const keySeen = turn(key, view);
  const bulb = project(keySeen);
  const keyFront = key[2] >= 0;
  const fillAt = toVec((light.azimuth + 180) % 360, Math.abs(((light.azimuth + 180) % 360) - 180) <= 90 ? 15 : 5);
  const fillBulb = project(turn(fillAt, view));
  const fillFront = fillAt[2] >= 0;
  const power = bright / 100;

  const rings = [
    ring(sweep(0, 360, (d) => [R * Math.sin(d * RAD), 0, R * Math.cos(d * RAD)]), view),
    ring(sweep(0, 360, (d) => [0, R * Math.sin(d * RAD), R * Math.cos(d * RAD)]), view),
    ring(sweep(0, 360, (d) => [R * Math.sin(d * RAD), R * Math.cos(d * RAD), 0]), view),
  ];
  const latitude = ring(sweep(0, 360, (d) => toVec(d, light.elevation)), view);
  const meridian = ring(sweep(0, light.elevation, (d) => toVec(light.azimuth, d), 32), view);

  /* the card lit roughly as asked: brighter toward the light, a glow at its edges when lit from behind */
  const dir = toVec(light.azimuth, light.elevation, 1);
  const spot = { x: 50 + 50 * dir[0], y: 50 - 50 * dir[1] };
  const shade = clamp(0.5 - 0.3 * power + (dir[2] < 0 ? -0.35 * dir[2] : 0), 0.08, 0.85);
  const tint = power * (0.25 + 0.4 * Math.max(dir[2], 0)) * (dir[2] < -0.3 ? 0.4 : 1);
  const rim = dir[2] < 0 ? -dir[2] * (0.4 + 0.6 * power) : 0;
  const cardW = ratio >= 1 ? 136 : 136 * ratio, cardH = ratio >= 1 ? 136 / ratio : 136;

  const at = (event: React.PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    /* in its own units, however large it is drawn */
    return { x: (event.clientX - box.left) * (W / box.width) - W / 2, y: (event.clientY - box.top) * (H / box.height) - H / 2 };
  };
  const moveLight = (x: number, y: number) => {
    const d = drag.current;
    if (d?.kind !== 'light') return;
    const { out } = under(x, y, d.far);
    if (d.out && !out) d.far = !d.far;
    d.out = out;
    onLight(toLight(unturn(under(x, y, d.far).at, view)));
  };
  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    onGrab();
    const p = at(event);
    drag.current = Math.hypot(p.x - bulb.x, p.y - bulb.y) <= 16 * bulb.s + 8
      ? { kind: 'light', far: keySeen[2] < NEAR, out: false }
      : { kind: 'view', x: p.x, y: p.y, from: view };
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const p = at(event);
    if (!d) { setOver(Math.hypot(p.x - bulb.x, p.y - bulb.y) <= 16 * bulb.s + 8); return; }
    if (d.kind === 'light') moveLight(p.x, p.y);
    else onView({ yaw: clamp(d.from.yaw + (p.x - d.x) * 0.5, -70, 70), pitch: clamp(d.from.pitch + (p.y - d.y) * 0.4, -45, 60) });
  };
  const key5 = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 15 : 5;
    const next = event.key === 'ArrowLeft' ? { ...light, azimuth: (light.azimuth - step + 360) % 360 }
      : event.key === 'ArrowRight' ? { ...light, azimuth: (light.azimuth + step) % 360 }
      : event.key === 'ArrowUp' ? { ...light, elevation: clamp(light.elevation + step, -80, 80) }
      : event.key === 'ArrowDown' ? { ...light, elevation: clamp(light.elevation - step, -80, 80) } : null;
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    onGrab();
    onLight(next);
  };

  const lines = (layer: 'front' | 'back') => (
    <g fill="none" strokeLinecap="round">
      {rings.map((r, i) => (
        <g key={i} stroke="currentColor">
          <path d={r[layer].near} strokeOpacity={0.3} strokeWidth={1} />
          <path d={r[layer].far} strokeOpacity={0.13} strokeWidth={1} strokeDasharray="2 4" />
        </g>
      ))}
      <path d={latitude[layer].near} stroke={color} strokeOpacity={0.75} strokeWidth={1.25} strokeDasharray="4 4" />
      <path d={latitude[layer].far} stroke={color} strokeOpacity={0.3} strokeWidth={1} strokeDasharray="2 5" />
      <path d={meridian[layer].near + meridian[layer].far} stroke={color} strokeOpacity={0.6} strokeWidth={1.5} />
    </g>
  );
  const marker = (front: boolean) => (
    <>
      {fill && fillFront === front ? (
        <span className="pointer-events-none absolute rounded-full border border-white/70"
          style={{ zIndex: front ? 5 : 2, left: W / 2 + fillBulb.x, top: H / 2 + fillBulb.y, width: 12 * fillBulb.s, height: 12 * fillBulb.s, transform: 'translate(-50%, -50%)',
            background: fillColor, boxShadow: `0 0 10px 2px ${rgba(fillColor, 0.6)}`, opacity: fillFront ? 1 : 0.6 }} />
      ) : null}
      {keyFront === front ? (
        <span className="pointer-events-none absolute flex items-center justify-center rounded-full border-2 border-white/85"
          style={{ zIndex: front ? 5 : 2, left: W / 2 + bulb.x, top: H / 2 + bulb.y, width: 28 * bulb.s, height: 28 * bulb.s, transform: 'translate(-50%, -50%)',
            background: color, boxShadow: `0 0 ${10 + 22 * power}px ${2 + 5 * power}px ${rgba(color, 0.35 + 0.5 * power)}`, opacity: keyFront ? 1 : 0.6 }}>
          <Lightbulb size={Math.round(14 * bulb.s)} className="text-black/70" />
        </span>
      ) : null}
    </>
  );
  const svg = (layer: 'front' | 'back', z: number) => (
    <svg className="pointer-events-none absolute inset-0 text-[var(--cv-ink)]" width={W} height={H} viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`} style={{ zIndex: z }}>
      {layer === 'back' ? (
        <>
          <defs>
            <radialGradient id={`${uid}-glass`} cx="38%" cy="32%" r="70%">
              <stop offset="0" stopColor="currentColor" stopOpacity={0.1} />
              <stop offset="0.7" stopColor="currentColor" stopOpacity={0.03} />
              <stop offset="1" stopColor="currentColor" stopOpacity={0.09} />
            </radialGradient>
          </defs>
          <circle r={OUTLINE} fill={`url(#${uid}-glass)`} />
        </>
      ) : <circle r={OUTLINE} fill="none" stroke="currentColor" strokeOpacity={0.22} />}
      {lines(layer)}
      {keyFront === (layer === 'front') ? <Beam id={`${uid}-${layer}-key`} from={bulb} color={color} strength={0.25 + 0.45 * power} wide={soft} /> : null}
      {fill && fillFront === (layer === 'front') ? <Beam id={`${uid}-${layer}-fill`} from={fillBulb} color={fillColor} strength={0.25} wide={false} /> : null}
    </svg>
  );

  return (
    <div role="group" tabIndex={0} aria-label={t('canvas.light.direction')}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerLeave={() => setOver(false)} onKeyDown={key5}
      className={`relative isolate shrink-0 touch-none select-none outline-none ${over ? 'cursor-move' : 'cursor-grab active:cursor-grabbing'}`}
      style={{ width: W, height: H, perspective: DEPTH, perspectiveOrigin: '50% 50%' }}>
      {svg('back', 1)}
      {marker(false)}
      {/* the picture, turned as the view turns it */}
      <div className="absolute overflow-hidden rounded-[6px] bg-black"
        style={{ zIndex: 3, left: (W - cardW) / 2, top: (H - cardH) / 2, width: cardW, height: cardH, transform: `rotateX(${-view.pitch}deg) rotateY(${view.yaw}deg)`,
          boxShadow: rim ? `0 0 ${8 + 16 * rim}px ${1 + 3 * rim}px ${rgba(color, rim)}` : '0 8px 22px rgba(0, 0, 0, 0.35)' }}>
        <img src={src} alt="" draggable={false} onLoad={(event) => setRatio(event.currentTarget.naturalWidth / Math.max(1, event.currentTarget.naturalHeight))}
          className="h-full w-full object-cover" />
        <span className="absolute inset-0" style={{ background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, transparent 0%, rgba(0, 0, 0, ${shade}) ${soft ? 115 : 70}%)` }} />
        <span className="absolute inset-0" style={{ mixBlendMode: 'screen', background: `radial-gradient(circle at ${spot.x}% ${spot.y}%, ${rgba(color, tint)} 0%, transparent ${soft ? 85 : 55}%)` }} />
        {fill ? <span className="absolute inset-0" style={{ mixBlendMode: 'screen', background: `radial-gradient(circle at ${100 - spot.x}% 45%, ${rgba(fillColor, 0.22)} 0%, transparent 60%)` }} /> : null}
      </div>
      {svg('front', 4)}
      {marker(true)}
    </div>
  );
}

/** a choice among a few, the one taken lit */
function Segmented<T extends string>({ options, on, onPick }: { options: Array<[T, React.ReactNode]>; on: T | null; onPick: (value: T) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-[11px] bg-[var(--cv-chip)] p-[3px]">
      {options.map(([value, label]) => (
        <button key={value} type="button" onClick={() => onPick(value)}
          className={`flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] transition ${value === on ? 'bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** the light colors to pick from, small or full size */
function Swatches({ value, small, onPick }: { value: string; small?: boolean; onPick: (hex: string) => void }) {
  const t = useT();
  return (
    <div className={`flex flex-wrap p-1 ${small ? 'gap-2' : 'gap-2.5'}`}>
      {COLORS.map((c) => (
        <button key={c.id} type="button" title={t(`canvas.light.colors.${c.id}`)} aria-label={t(`canvas.light.colors.${c.id}`)} onClick={() => onPick(c.hex)}
          className={`${small ? 'h-5 w-5' : 'h-7 w-7'} rounded-full transition ${c.hex === value ? 'ring-2 ring-[var(--cv-ink)] ring-offset-2 ring-offset-[var(--cv-modal)]' : 'ring-1 ring-inset ring-white/20 hover:scale-110'}`}
          style={{ background: c.hex }} />
      ))}
    </div>
  );
}

const label = 'mb-2 flex items-center justify-between text-[12px] text-[var(--cv-ink-3)]';

export function LightPanel({ src, onClose, onMake }: {
  src: string;                    // the picture's URL
  onClose: () => void;
  /** a preset picked (its id), or the light set by hand as words, with the person's own words: made at once */
  onMake: (made: { preset: string; words: string } | { words: string }) => void;
}) {
  const t = useT();
  const [light, setLight] = React.useState<Light>(START);
  const [view, setView] = React.useState<View>(PERSPECTIVE);
  const [color, setColor] = React.useState(COLORS[0]!.hex);
  /* the hex being typed, until it is a color or the box is left */
  const [typing, setTyping] = React.useState<string | null>(null);
  const [bright, setBright] = React.useState(70);
  const [soft, setSoft] = React.useState(true);
  const [fill, setFill] = React.useState(false);
  const [fillColor, setFillColor] = React.useState(COLORS[5]!.hex);
  /* a preset picked (made as it is), or none: the light as set by hand; and the person's own words beside it */
  const [preset, setPreset] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'presets' | 'custom'>('presets');
  const [extra, setExtra] = React.useState('');
  const frame = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(frame.current), []);

  /** the light and the view eased to where they are set, the light the short way round */
  const glide = (toLight: Light | null, toView: View | null) => {
    cancelAnimationFrame(frame.current);
    const fromLight = light, fromView = view, start = performance.now();
    const across = toLight ? ((toLight.azimuth - fromLight.azimuth + 540) % 360) - 180 : 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 280), e = 1 - (1 - k) ** 3;
      if (toLight) setLight({ azimuth: (fromLight.azimuth + across * e + 360) % 360, elevation: fromLight.elevation + (toLight.elevation - fromLight.elevation) * e });
      if (toView) setView({ yaw: fromView.yaw + (toView.yaw - fromView.yaw) * e, pitch: fromView.pitch + (toView.pitch - fromView.pitch) * e });
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };
  const reset = () => {
    glide(START, PERSPECTIVE);
    setColor(COLORS[0]!.hex);
    setTyping(null);
    setBright(70);
    setSoft(true);
    setFill(false);
    setFillColor(COLORS[5]!.hex);
  };

  const words = lightWords({ light, color, bright, soft, fill, fillColor });
  const seen = Math.abs(view.yaw) < 0.5 && Math.abs(view.pitch) < 0.5 ? 'front' : 'perspective';
  const azimuth = Math.round(light.azimuth) % 360, elevation = Math.round(light.elevation);
  const pointed = DIRECTIONS.find(([, to]) => {
    const want = to(light);
    return Math.abs(want.elevation - light.elevation) < 1 && (Math.abs(want.elevation) >= 80 || Math.abs(((want.azimuth - light.azimuth + 540) % 360) - 180) < 1);
  })?.[0];

  const make = () => onMake(preset && tab === 'presets' ? { preset, words: extra.trim() } : { words: [words, extra.trim()].filter(Boolean).join('\n\n') });
  const card = 'rounded-[16px] bg-[color-mix(in_srgb,var(--cv-ink)_3.5%,transparent)] p-4';
  return (
    <CanvasModal label={t('canvas.light.title')} onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <span className="text-[14px] font-semibold">{t('canvas.light.title')}</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-2 pt-3">
        {/* where the light comes from: the picture in its sphere, as large as there is room */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-[16px] bg-[var(--cv-card-2)]"
            style={{ backgroundImage: 'radial-gradient(color-mix(in srgb, var(--cv-ink) 8%, transparent) 1px, transparent 1.4px)', backgroundSize: '18px 18px' }}>
            <div className="origin-center scale-[1.6]">
              <Orbit src={src} light={light} view={view} color={color} bright={bright} soft={soft} fill={fill} fillColor={fillColor}
                onLight={(v) => { setLight(v); setTab('custom'); setPreset(null); }} onView={setView} onGrab={() => cancelAnimationFrame(frame.current)} />
            </div>
            <div className="absolute left-3 top-3 z-10">
              <Segmented<'perspective' | 'front'> on={seen} onPick={(v) => glide(null, v === 'front' ? FRONT : PERSPECTIVE)}
                options={[['perspective', <><Box size={13} />{t('canvas.light.views.perspective')}</>], ['front', <><Square size={13} />{t('canvas.light.views.front')}</>]]} />
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 text-center text-[12px] tabular-nums text-[var(--cv-ink-2)]">
              {t('canvas.light.readout').replace('{elevation}', String(elevation)).replace('{azimuth}', String(azimuth))} · {t('canvas.light.hint')}
            </div>
          </div>
          <div className="flex items-center justify-center gap-1">
            {DIRECTIONS.map(([id, to]) => (
              <button key={id} type="button" onClick={() => { glide(to(light), null); setTab('custom'); setPreset(null); }}
                className={`h-8 min-w-[56px] rounded-[9px] px-3 text-[12.5px] transition ${pointed === id && tab === 'custom' ? 'bg-[var(--cv-invert)] text-[var(--cv-on-invert)]' : 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`}>
                {t(`canvas.light.directions.${id}`)}
              </button>
            ))}
          </div>
        </div>

        {/* what the light is: a preset as it is, or set by hand */}
        <div className="flex w-[360px] shrink-0 flex-col gap-3">
          <Segmented<'presets' | 'custom'> on={tab} onPick={setTab} options={[['presets', t('canvas.light.presets')], ['custom', t('canvas.light.customTab')]]} />
          {tab === 'presets' ? (
            <div className="grid min-h-0 grid-cols-2 content-start gap-2 overflow-y-auto p-0.5">
              {LIGHT_PRESETS.map((p) => (
                <button key={p.id} type="button" onClick={() => setPreset(preset === p.id ? null : p.id)} className="group/preset min-w-0 rounded-[13px] p-1 text-left transition hover:bg-[var(--cv-float-hover)]">
                  <span className={`relative block aspect-[3/2] overflow-hidden rounded-[10px] bg-[var(--cv-chip)] transition ${preset === p.id ? 'ring-2 ring-[var(--cv-ring)]' : 'ring-1 ring-inset ring-[var(--cv-float-line)]'}`}>
                    {PICTURES[p.id] ? <img src={PICTURES[p.id]} alt="" draggable={false} loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover/preset:scale-[1.05]" /> : null}
                  </span>
                  <span className={`mt-1.5 block truncate px-1 text-[12.5px] ${preset === p.id ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)]'}`}>{t(`canvas.presets.names.${p.id}`)}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <section className={card}>
                <div className={label}>{t('canvas.light.color')}<span className="text-[var(--cv-ink-2)]">{COLORS.find((c) => c.hex === color) ? t(`canvas.light.colors.${COLORS.find((c) => c.hex === color)!.id}`) : null}</span></div>
                <Swatches value={color} onPick={(hex) => { setColor(hex); setTyping(null); }} />
                <div className="mt-2 flex items-center gap-2 px-1">
                  <ColorSwatch label={t('canvas.light.custom')} value={color} onCommit={(hex) => { setColor(hex); setTyping(null); }}
                    className="h-7 w-7 overflow-hidden rounded-full ring-1 ring-inset ring-white/20" />
                  <input value={typing ?? color} spellCheck={false} aria-label={t('canvas.light.hex')}
                    onChange={(event) => { setTyping(event.target.value); const hex = hexOf(event.target.value); if (hex) setColor(hex); }}
                    onBlur={() => setTyping(null)}
                    className="h-7 w-24 rounded-[8px] bg-[var(--cv-chip)] px-2 font-mono text-[12px] uppercase text-[var(--cv-ink)] outline-none focus:ring-1 focus:ring-[var(--cv-ring)]" />
                </div>
              </section>
              <section className={card}>
                <div className={label}><span>{t('canvas.light.brightness')}</span><span className="tabular-nums text-[var(--cv-ink-2)]">{bright}</span></div>
                <input type="range" min={0} max={100} value={bright} onChange={(event) => setBright(Number(event.target.value))}
                  aria-label={t('canvas.light.brightness')} className="h-1 w-full cursor-pointer accent-[var(--cv-ink)]" />
                <div className={`${label} mt-4`}>{t('canvas.light.softness')}</div>
                <Segmented<'hard' | 'soft'> on={soft ? 'soft' : 'hard'} onPick={(v) => setSoft(v === 'soft')}
                  options={[['hard', t('canvas.light.hard')], ['soft', t('canvas.light.soft')]]} />
              </section>
              <section className={card}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-[var(--cv-ink)]">{t('canvas.light.second')}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--cv-ink-3)]">{t('canvas.light.secondHint')}</div>
                  </div>
                  <button type="button" role="switch" aria-checked={fill} aria-label={t('canvas.light.second')} onClick={() => setFill((v) => !v)}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition ${fill ? 'bg-[var(--cv-invert)]' : 'bg-[var(--cv-chip)] ring-1 ring-inset ring-[var(--cv-float-line)]'}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${fill ? 'left-[18px] bg-[var(--cv-on-invert)]' : 'left-0.5 bg-[var(--cv-ink-3)]'}`} />
                  </button>
                </div>
                {fill ? <div className="mt-2.5"><Swatches small value={fillColor} onPick={setFillColor} /></div> : null}
              </section>
              <button type="button" onClick={reset}
                className="flex h-8 items-center justify-center gap-1.5 self-start rounded-full px-3 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                <RotateCcw size={13} />{t('canvas.light.reset')}
              </button>
            </div>
          )}
        </div>
      </div>
      {/* the person's own words beside the light, and send: made at once, as every picture window makes */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-end gap-3 rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] py-2.5 pl-4 pr-2.5 shadow-[var(--cv-float-shadow)] transition focus-within:!border-[var(--cv-ring)]">
          <span className="mb-[7px] shrink-0 rounded-full bg-[var(--cv-chip)] px-2.5 py-1 text-[12px] text-[var(--cv-ink-2)]">
            {tab === 'presets' && preset ? t(`canvas.presets.names.${preset}`) : tab === 'presets' ? t('canvas.light.pickOne') : t('canvas.light.byHand')}
          </span>
          <textarea value={extra} rows={1} onChange={(event) => setExtra(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (tab === 'custom' || preset) make(); } }}
            placeholder={t('canvas.light.extra')}
            className="max-h-[96px] min-h-[38px] min-w-0 flex-1 resize-none bg-transparent py-2 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none [field-sizing:content] placeholder:text-[var(--cv-ink-3)]" />
          <button type="button" aria-label={t('canvas.light.make')} disabled={tab === 'presets' && !preset} onClick={make}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </CanvasModal>
  );
}
