/**
 * The color workbench's pictures off the page's thread (scope-worker): one worker for the desk, frames read from the
 * footage at its own depth (the plugin's server, `frame`), and what is made of them: the scopes of the shot at the
 * playhead, and small pictures of shots (the strip, the styles). And the scopes drawn, with their graticules: IRE
 * lines on a waveform or a parade, the targets and the skin-tone line on a vectorscope.
 */
import * as React from 'react';
import type { Chain, Drawn, FromWorker, Read, Scope, ToWorker } from './scope-worker';

export type { Chain, Read, Scope };

/** The desk's worker, and the frames it holds (by key), asked once each. */
export interface Pictures {
  worker: Worker;
  /**
   * A frame of `src` at file second `s`, its longer side `box`, read into the worker: resolves with its key (null: it
   * could not be read). `page`: a page clip's (its id), drawn as the film draws it, with the changes made in it.
   */
  frame: (src: string, s: number, box: number, page?: string | null) => Promise<string | null>;
  /** Listen to what the worker says. */
  listen: (fn: (m: FromWorker) => void) => () => void;
  seq: () => number;
}

export function usePictures(projectId: string): Pictures | null {
  const [made, setMade] = React.useState<Pictures | null>(null);
  React.useEffect(() => {
    const worker = new Worker(new URL('./scope-worker.ts', import.meta.url), { type: 'module' });
    const heard = new Set<(m: FromWorker) => void>();
    worker.onmessage = ({ data }: MessageEvent<FromWorker>) => { for (const fn of heard) fn(data); };
    const asked = new Map<string, Promise<string | null>>();
    let n = 0;
    setMade({
      worker,
      listen: (fn) => { heard.add(fn); return () => { heard.delete(fn); }; },
      seq: () => ++n,
      frame: (src, s, box, page = null) => {
        const key = `${page ? `${page}:` : ''}${src}@${s.toFixed(3)}@${box}`;
        let p = asked.get(key);
        if (!p) {
          p = (async () => {
            if (page) {
              /* a page has no file to cut a frame from: Studio draws it, as an export does (its 8 bits, as the screen shows it) */
              const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(src)}&ms=${Math.round(s * 1000)}&w=${Math.min(960, box)}&clip=${encodeURIComponent(page)}`);
              if (!res.ok) throw new Error(`Studio answered ${res.status}`);
              const bitmap = await createImageBitmap(await res.blob());
              const c = new OffscreenCanvas(bitmap.width, bitmap.height);
              const g = c.getContext('2d')!;
              g.drawImage(bitmap, 0, 0);
              const rgba = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
              const raw = new Uint16Array((rgba.length / 4) * 3);
              for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { raw[j] = rgba[i]! * 257; raw[j + 1] = rgba[i + 1]! * 257; raw[j + 2] = rgba[i + 2]! * 257; }
              worker.postMessage({ type: 'frame', key, w: bitmap.width, h: bitmap.height, data: raw.buffer } satisfies ToWorker, [raw.buffer]);
              bitmap.close();
              return key;
            }
            const res = await fetch(`/api/plugins/color/projects/${encodeURIComponent(projectId)}/frame?src=${encodeURIComponent(src)}&s=${s.toFixed(3)}&box=${box}`);
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Studio answered ${res.status}`);
            const w = Number(res.headers.get('x-width')), h = Number(res.headers.get('x-height'));
            const data = await res.arrayBuffer();
            worker.postMessage({ type: 'frame', key, w, h, data } satisfies ToWorker, [data]);
            return key;
          })().catch(() => { asked.delete(key); return null; });
          asked.set(key, p);
          if (asked.size > 60) asked.delete(asked.keys().next().value!);
        }
        return p;
      },
    });
    return () => { worker.terminate(); heard.clear(); };
  }, [projectId]);
  return made;
}

const chainKey = (chain: Chain | null) => (chain ? chain.map((f) => `${f.name}:${f.text.length}:${f.text.slice(-160)}`).join('|') : '');

/**
 * The scopes of `src` at file second `second`, graded by `chain` (null: not ready): its waveform or parade, its
 * vectorscope, its histogram, and what it measures. Drawn again as any of them changes, the frame read a moment after
 * the moment last moved.
 */
export function useScopes(pictures: Pictures | null, src: string | null, second: number | null, chain: Chain | null, scopes: readonly Scope[], shot: { drawn: boolean; page: string | null } = { drawn: false, page: null }) {
  const [frame, setFrame] = React.useState<string | null>(null);
  const [out, setOut] = React.useState<{ scopes: Partial<Record<Scope, Drawn>>; bins: Uint32Array; read: Read } | null>(null);
  const seq = React.useRef(0);
  React.useEffect(() => {
    if (!pictures || !src || second == null) return;
    let live = true;
    /* a page's frame is drawn by Studio's browser, which takes a while: asked once the playhead rests, not as it plays */
    const t = setTimeout(() => { void pictures.frame(src, second, 480, shot.page).then((k) => { if (live && k) setFrame(k); }); }, shot.page ? 600 : 120);
    return () => { live = false; clearTimeout(t); };
  }, [pictures, src, second, shot.page]);
  React.useEffect(() => pictures?.listen((m) => {
    if (m.type === 'rendered' && m.seq === seq.current) setOut({ scopes: m.scopes, bins: m.bins, read: m.read });
  }), [pictures]);
  const wanted = scopes.join(',');
  const ck = chainKey(chain);
  React.useEffect(() => {
    if (!pictures || !frame || !chain) return;
    seq.current = pictures.seq();
    pictures.worker.postMessage({ type: 'render', seq: seq.current, key: frame, chain: chain.map((f) => ({ ...f })), scopes: wanted.split(',') as Scope[], drawn: shot.drawn } satisfies ToWorker);
  }, [pictures, frame, ck, wanted, shot.drawn]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => (out ? { ...out, frame } : null), [out, frame]);
}

/**
 * Small pictures: each of `items` (a frame of its file at a second, graded by its chain) as a data URL once made, by
 * its id. Made again when its chain changes.
 */
export function useThumbs(pictures: Pictures | null, items: readonly { id: string; src: string; second: number; chain: Chain | null; drawn?: boolean; page?: string | null }[], box = 240): Record<string, string> {
  const [made, setMade] = React.useState<Record<string, string>>({});
  const want = React.useRef(new Map<number, string>());
  React.useEffect(() => pictures?.listen((m) => {
    if (m.type !== 'thumbed') return;
    const id = want.current.get(m.seq);
    if (!id) return;
    want.current.delete(m.seq);
    const c = document.createElement('canvas');
    c.width = m.w; c.height = m.h;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(m.image), m.w, m.h), 0, 0);
    const url = c.toDataURL('image/jpeg', 0.86);
    setMade((was) => ({ ...was, [id]: url }));
  }), [pictures]);
  const key = items.map((i) => `${i.id}@${i.src}@${i.second.toFixed(2)}@${i.drawn ? 'drawn' : ''}@${chainKey(i.chain)}`).join('\n');
  React.useEffect(() => {
    if (!pictures) return;
    let live = true;
    for (const item of items) {
      if (!item.chain) continue;
      const chain = item.chain.map((f) => ({ ...f }));
      void pictures.frame(item.src, item.second, box, item.page ?? null).then((k) => {
        if (!live || !k) return;
        const n = pictures.seq();
        want.current.set(n, item.id);
        pictures.worker.postMessage({ type: 'thumb', seq: n, key: k, chain, drawn: Boolean(item.drawn) } satisfies ToWorker);
      });
    }
    return () => { live = false; };
  }, [pictures, key, box]); // eslint-disable-line react-hooks/exhaustive-deps
  return made;
}

/** A scope drawn to fill its box, with its graticule. */
export function ScopeView({ drawn, scope, bins }: { drawn: Drawn | null | undefined; scope: Scope; bins?: Uint32Array | null }) {
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  const box = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    if (scope === 'vectorscope') drawVector(g, size.w, size.h, drawn ?? null);
    else if (scope === 'histogram') drawHistogram(g, size.w, size.h, bins ?? null);
    else drawWave(g, size.w, size.h, drawn ?? null, scope === 'parade');
  }, [drawn, scope, size, bins]);
  return (
    <div ref={box} className="relative h-full w-full">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

const GRID = 'rgba(255,255,255,0.10)';
const LABEL = 'rgba(255,255,255,0.34)';

function imageOf(d: Drawn): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = d.w; c.height = d.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(d.image.slice(0)), d.w, d.h), 0, 0);
  return c;
}

function drawWave(g: CanvasRenderingContext2D, w: number, h: number, d: Drawn | null, parade: boolean) {
  const pad = { l: 24, r: 6, t: 6, b: 6 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const ire of [0, 25, 50, 75, 100]) {
    const y = pad.t + ih * (1 - ire / 100);
    g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.moveTo(pad.l, Math.round(y) + 0.5); g.lineTo(w - pad.r, Math.round(y) + 0.5); g.stroke();
    g.fillStyle = LABEL; g.fillText(String(ire), pad.l - 5, y);
  }
  if (parade) for (const k of [1, 2]) { const x = Math.round(pad.l + (iw * k) / 3) + 0.5; g.strokeStyle = GRID; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, pad.t + ih); g.stroke(); }
  if (d) { g.globalCompositeOperation = 'lighter'; g.drawImage(imageOf(d), pad.l, pad.t, iw, ih); g.globalCompositeOperation = 'source-over'; }
}

/** The 75 % targets of the primaries and secondaries (BT.709 Cb, Cr), and the skin-tone line. */
const TARGETS: [string, number, number, number][] = [['R', 0.75, 0, 0], ['Y', 0.75, 0.75, 0], ['G', 0, 0.75, 0], ['C', 0, 0.75, 0.75], ['B', 0, 0, 0.75], ['M', 0.75, 0, 0.75]];
const cbcr = (r: number, g: number, b: number) => { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; return [(b - y) / 1.8556, (r - y) / 1.5748] as const; };

function drawVector(g: CanvasRenderingContext2D, w: number, h: number, d: Drawn | null) {
  const s = Math.min(w, h) - 6;
  const x0 = (w - s) / 2, y0 = (h - s) / 2, cx = w / 2, cy = h / 2;
  g.fillStyle = '#0a0a0b'; g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = GRID; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, s / 2, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, s / 4, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(cx - s / 2, cy); g.lineTo(cx + s / 2, cy); g.moveTo(cx, cy - s / 2); g.lineTo(cx, cy + s / 2); g.stroke();
  /* skin tones lie along this line */
  const [sb, sr] = cbcr(0.8, 0.55, 0.45);
  const len = Math.hypot(sb, sr);
  g.strokeStyle = 'rgba(255,200,150,0.32)';
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (sb / len) * (s / 2), cy - (sr / len) * (s / 2)); g.stroke();
  g.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [name, r, gg, b] of TARGETS) {
    const [cb, cr] = cbcr(r, gg, b);
    const x = cx + cb * s, y = cy - cr * s;
    g.strokeStyle = LABEL; g.strokeRect(x - 3, y - 3, 6, 6);
    g.fillStyle = LABEL; g.fillText(name, x + (cb > 0 ? 10 : -10), y);
  }
  if (d) { g.globalCompositeOperation = 'lighter'; g.drawImage(imageOf(d), x0, y0, s, s); g.globalCompositeOperation = 'source-over'; }
}

function drawHistogram(g: CanvasRenderingContext2D, w: number, h: number, bins: Uint32Array | null) {
  const pad = 6;
  const iw = w - pad * 2, ih = h - pad * 2;
  g.strokeStyle = GRID; g.lineWidth = 1;
  for (const k of [0.25, 0.5, 0.75]) { const x = Math.round(pad + iw * k) + 0.5; g.beginPath(); g.moveTo(x, pad); g.lineTo(x, pad + ih); g.stroke(); }
  if (!bins) return;
  let max = 1;
  for (let i = 0; i < 1024; i++) if (i % 256 > 1 && i % 256 < 254) max = Math.max(max, bins[i]!);
  const colors = ['rgba(255,80,70,0.55)', 'rgba(80,220,110,0.55)', 'rgba(90,140,255,0.55)', 'rgba(235,235,235,0.35)'];
  g.globalCompositeOperation = 'lighter';
  for (let c = 0; c < 4; c++) {
    g.fillStyle = colors[c]!;
    g.beginPath(); g.moveTo(pad, pad + ih);
    for (let i = 0; i < 256; i++) g.lineTo(pad + (iw * i) / 255, pad + ih - ih * Math.min(1, Math.sqrt(bins[c * 256 + i]! / max)));
    g.lineTo(pad + iw, pad + ih); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}
