/**
 * The scopes, as a colorist reads them: a waveform (luma up the scope, by where it is across the picture), a parade
 * (red, green and blue side by side), a vectorscope (hue round it, saturation out from the middle, with the 75 %
 * targets of each primary and secondary and the skin-tone line) and a histogram. Each is drawn by the grade worker
 * from the picture as graded; two show at once, one above the other, each chosen by its own tabs.
 */
import * as React from 'react';
import type { Scope } from './grade-worker';
import { VECTOR, WAVE } from './grade-worker';
import type { Shot } from './use-grader';

export const SCOPES: Scope[] = ['waveform', 'parade', 'vectorscope', 'histogram'];

export function Scopes({ shot, chosen, onChoose, words }: {
  shot: Shot | null;
  chosen: [Scope, Scope];
  onChoose: (slot: 0 | 1, scope: Scope) => void;
  words: Record<Scope, string>;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 bg-[var(--bg-panel)] p-2">
      {([0, 1] as const).map((slot) => (
        <div key={slot} className="flex min-h-0 flex-1 flex-col gap-1">
          <div role="tablist" className="flex shrink-0 gap-0.5">
            {SCOPES.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={chosen[slot] === s} onClick={() => onChoose(slot, s)}
                className={`rounded-[4px] px-1.5 py-0.5 text-[10.5px] transition ${chosen[slot] === s ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}>
                {words[s]}
              </button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[6px] bg-black">
            <ScopeView scope={chosen[slot]} shot={shot} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ScopeView({ scope, shot }: { scope: Scope; shot: Shot | null }) {
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const data = shot?.scopes[scope];
  React.useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!data) return;
    if (scope === 'histogram') drawHistogram(ctx, c.width, c.height, data as Uint32Array);
    else {
      const [w, h] = scope === 'vectorscope' ? [VECTOR, VECTOR] : [WAVE.w, WAVE.h];
      ctx.putImageData(new ImageData(new Uint8ClampedArray(data as ArrayBuffer), w, h), 0, 0);
    }
  }, [data, scope]);
  if (scope === 'vectorscope') {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative aspect-square h-full max-w-full">
          <canvas ref={canvas} width={VECTOR} height={VECTOR} className="absolute inset-0 h-full w-full" />
          <VectorGraticule />
        </div>
      </div>
    );
  }
  return (
    <>
      <canvas ref={canvas} width={scope === 'histogram' ? 512 : WAVE.w} height={WAVE.h} className="absolute inset-0 h-full w-full" />
      {scope === 'histogram' ? null : <WaveGraticule parade={scope === 'parade'} />}
    </>
  );
}

/** Lines at every 10 IRE, labelled at 0, 50 and 100; a parade's three parts apart. */
function WaveGraticule({ parade }: { parade: boolean }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      {Array.from({ length: 11 }, (_, i) => (
        <line key={i} x1="0" x2="100" y1={100 - i * 10} y2={100 - i * 10} stroke={i === 0 || i === 10 ? 'rgba(255,190,90,0.45)' : 'rgba(255,255,255,0.08)'} strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
      ))}
      {parade ? [1, 2].map((i) => <line key={i} x1={(i * 100) / 3} x2={(i * 100) / 3} y1="0" y2="100" stroke="rgba(255,255,255,0.15)" strokeWidth="1" vectorEffect="non-scaling-stroke" />) : null}
      {[0, 50, 100].map((v) => (
        <text key={v} x="1" y={Math.min(97, Math.max(4, 100 - v + 1.2))} fontSize="3.6" fill="rgba(255,255,255,0.45)" style={{ fontFamily: 'var(--font-mono)' }}>{v}</text>
      ))}
    </svg>
  );
}

const KR = 0.2126, KB = 0.0722;
/** Where a color is on the vectorscope, 0–100 each way (y down). */
const vecAt = (r: number, g: number, b: number): [number, number] => {
  const y = KR * r + (1 - KR - KB) * g + KB * b;
  return [((b - y) / 1.8556 + 0.5) * 100, (0.5 - (r - y) / 1.5748) * 100];
};
const TARGETS: [string, [number, number, number], string][] = [
  ['R', [0.75, 0, 0], '#ff6b61'], ['Yl', [0.75, 0.75, 0], '#ffd60a'], ['G', [0, 0.75, 0], '#5fd97a'],
  ['Cy', [0, 0.75, 0.75], '#32d4e6'], ['B', [0, 0, 0.75], '#5aa8ff'], ['Mg', [0.75, 0, 0.75], '#ff6bd6'],
];
/** The skin-tone line: about 123° round from the blue axis, as vectorscopes mark it. */
const SKIN = (() => { const a = (123 * Math.PI) / 180; return [50 + Math.cos(a) * 46, 50 - Math.sin(a) * 46]; })();

function VectorGraticule() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="24.5" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      <line x1="50" x2="50" y1="2" y2="98" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      <line x1="2" x2="98" y1="50" y2="50" stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      <line x1="50" y1="50" x2={SKIN[0]} y2={SKIN[1]} stroke="rgba(255,200,150,0.35)" strokeWidth="0.4" strokeDasharray="1.2 1" />
      {TARGETS.map(([name, rgb, color]) => {
        const [x, y] = vecAt(...rgb);
        const [lx, ly] = [50 + (x - 50) * 1.18, 50 + (y - 50) * 1.18];
        return (
          <g key={name}>
            <rect x={x - 2} y={y - 2} width="4" height="4" fill="none" stroke={color} strokeOpacity="0.7" strokeWidth="0.4" />
            <text x={lx} y={ly + 1.3} fontSize="3.6" textAnchor="middle" fill={color} fillOpacity="0.8" style={{ fontFamily: 'var(--font-mono)' }}>{name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function drawHistogram(ctx: CanvasRenderingContext2D, w: number, h: number, bins: Uint32Array) {
  let max = 1;
  /* scaled to the 99th part of the highest bins, so one full bin (black bars, a white sky) does not flatten the rest */
  const all = Array.from(bins.subarray(0, 768)).sort((a, b) => a - b);
  max = Math.max(1, all[Math.floor(all.length * 0.995)]);
  ctx.globalCompositeOperation = 'lighter';
  const colors = ['rgba(255,80,70,0.55)', 'rgba(80,220,110,0.55)', 'rgba(80,140,255,0.6)'];
  for (let c = 0; c < 3; c++) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < 256; i++) ctx.lineTo((i / 255) * w, h - Math.min(1, bins[c * 256 + i] / max) * h * 0.95);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = colors[c];
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath();
  for (let i = 0; i < 256; i++) { const y = h - Math.min(1, bins[768 + i] / max) * h * 0.95; if (i) ctx.lineTo((i / 255) * w, y); else ctx.moveTo(0, y); }
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}
