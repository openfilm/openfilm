/**
 * The waveform on a clip. Without it a sound track is plain bars: no telling where someone speaks, where they breathe,
 * where it is silent — and "did this cut land mid-word" can only be seen on the waveform.
 *
 * Drawn from the bottom, not mirrored: sound rows are short, and a mirrored waveform leaves half the height each way.
 * A skyline still reads when low. On a canvas, not hundreds of divs: dozens of clips with
 * hundreds of peaks each would be tens of thousands of nodes.
 *
 * Peaks come from the server: GET media?what=wave&path= → `{ duration (s), peaks }`, 40 peaks a second, 0..1;
 * 503 while the file is still being written. Drawn as loud as the clip plays: the file's own level times the clip's
 * volume, the band's top full scale (lib/waveform-columns `waveBarPx`). A volume that pushes a peak past it caps the
 * peak at the top and tints its clipped part; a silent clip is a line. A volume in hand redraws the columns already
 * worked out, at once, without asking the server again.
 */
import * as React from 'react';
import { waveBarPx, waveformColumns } from '@/lib/waveform-columns';
import { mediaFetch } from '@/lib/media-queue';
import { useThemeChanges } from '@/lib/theme-changes';

/** A sound's envelope: the whole file's peaks and its length (to turn peak indexes into ms). */
interface Wave {
  peaks: number[];
  durationMs: number;
}

/** Peaks per second the server sends; the length when the answer has none. */
const PEAKS_PER_SECOND = 40;

/** At most this many device pixels per canvas: past the browser's limit a canvas goes blank. */
const MAX_CANVAS_PX = 4096;
/** A change this soon after the last drawing is drawn once the changes stop for as long (ms). */
const BURST_MS = 150;

/*
 * Drawings waiting, done a few a frame (FRAME_BUDGET_MS of them at most): a zoom of a film with hundreds of sounds redrew
 * them all in one go, a long freeze. A newer drawing of a canvas replaces its older one; the stretched old bitmap holds
 * until it is done.
 */
const FRAME_BUDGET_MS = 6;
const waiting = new Map<HTMLCanvasElement, () => void>();
let drawing = 0;
function drawSoon(el: HTMLCanvasElement, draw: () => void) {
  waiting.set(el, draw);
  if (!drawing) drawing = requestAnimationFrame(drawSome);
}
function drawSome() {
  drawing = 0;
  const start = performance.now();
  for (const [el, draw] of waiting) {
    waiting.delete(el);
    draw();
    if (performance.now() - start > FRAME_BUDGET_MS) break;
  }
  if (waiting.size) drawing = requestAnimationFrame(drawSome);
}

/* the colors a waveform is drawn in, read once per color and theme: read from each canvas, each drawing laid out the
   page's styles again. A CSS variable is read off the canvas; any other color is its `color`, as the browser has it */
const colors = new Map<string, string>();
function colorOf(el: HTMLCanvasElement, color: string, theme: unknown): string {
  const key = `${String(theme)}\0${color}`;
  let c = colors.get(key);
  if (!c) {
    const name = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
    const style = getComputedStyle(el);
    c = (name ? style.getPropertyValue(name).trim() : '') || style.color || color;
    if (colors.size > 64) colors.clear();
    colors.set(key, c);
  }
  return c;
}

/** Waveforms already fetched: the same sound is drawn again on every drag and zoom. */
const CACHE = new Map<string, Wave>();
const PENDING = new Map<string, Promise<Wave | null>>();

/**
 * The waveform, asked again while the server says it is not ready yet (503: a file an agent has just written).
 * About half a minute at most; after that the block stays plain until its address changes.
 */
async function fetchWhenReady(url: string, tries = 30): Promise<Response> {
  const res = await mediaFetch(url);
  if (res.status !== 503 || tries <= 1) return res;
  const wait = Math.min(Math.max(Number(res.headers.get('retry-after')) || 1, 0.5), 5) * 1000;
  await new Promise((done) => setTimeout(done, wait));
  return fetchWhenReady(url, tries - 1);
}

async function loadWave(url: string): Promise<Wave | null> {
  if (CACHE.has(url)) return CACHE.get(url) ?? null;
  const already = PENDING.get(url);
  if (already) return already;
  const task = fetchWhenReady(url)
    .then(async (r) => {
      if (!r.ok) return null;
      const body = (await r.json()) as { peaks?: number[]; duration?: number; durationMs?: number };
      if (!body.peaks?.length) return null;
      const durationMs = typeof body.durationMs === 'number' ? body.durationMs
        : typeof body.duration === 'number' ? body.duration * 1000
          : (body.peaks.length / PEAKS_PER_SECOND) * 1000;
      return { peaks: body.peaks.map((v) => Math.max(0, Math.min(1, Number(v) || 0))), durationMs };
    })
    .catch(() => null)
    .then((wave) => {
      if (wave) {
        CACHE.set(url, wave);
        while (CACHE.size > 256) CACHE.delete(CACHE.keys().next().value!);
      }
      PENDING.delete(url);
      return wave;
    });
  PENDING.set(url, task);
  return task;
}

export function BlockWaveform({
  url, width, height, color, clipColor = color, volume = 1, inMs = 0, durMs, visiblePx,
}: {
  url: string;
  width: number;
  height: number;
  /**
   * The waveform's color; may be a CSS variable (`var(--tl-wave)`): a canvas cannot read variables, so it is read
   * back off the element, following the theme.
   */
  color: string;
  /** The color of a peak's part that the volume pushes past full scale; a CSS variable, as `color`. */
  clipColor?: string;
  /** The clip's volume, linear (1 as is, 0 silent): each peak is drawn that much louder or quieter. */
  volume?: number;
  /**
   * Draw only this stretch (px within the clip). Zoomed in, a clip can be tens of thousands of pixels wide and only a
   * slice is on screen: a canvas over the whole clip would be stretched past the limit (blurry) or burn memory on what
   * cannot be seen.
   */
  visiblePx?: { from: number; to: number };
  /**
   * Where in the source the clip starts and how much it plays. The envelope is the whole file's; without taking off
   * the in point the whole file is squeezed into the clip and the waveform lies about where the sound is.
   */
  inMs?: number;
  durMs: number;
}): React.ReactElement | null {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const [loaded, setLoaded] = React.useState(() => ({ url, wave: CACHE.get(url) ?? null }));
  // A new edit must never display the previous arrangement while its request is in flight.
  const wave = loaded.url === url ? loaded.wave : CACHE.get(url) ?? null;

  React.useEffect(() => {
    let alive = true;
    /* the same wave already in hand (from the cache) renders nothing: a clip drawn as it scrolls into view is not
       drawn twice */
    void loadWave(url).then((wave) => { if (alive) setLoaded((cur) => (cur.url === url && cur.wave === wave ? cur : { url, wave })); });
    return () => { alive = false; };
  }, [url]);

  /* its color is read as it draws: a theme changed, it draws again */
  const theme = useThemeChanges();
  const from = Math.max(0, Math.min(width, Math.floor(visiblePx?.from ?? 0)));
  const to = Math.max(from, Math.min(width, Math.ceil(visiblePx?.to ?? width)));
  const sliceW = to - from;

  /* when it was last drawn: a change soon after is part of a burst (a zoom, a scroll) */
  const drawnAt = React.useRef(-Infinity);
  /* the columns last worked out, and for what stretch of which sound at what size: a volume in hand changes none of
     it, and only paints them again */
  const shape = `${inMs}:${durMs}:${width}:${from}:${sliceW}`;
  const columnsOf = React.useRef<{ wave: Wave; shape: string; columns: number[] } | null>(null);
  const drawnSize = React.useRef('');
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !wave?.peaks.length || sliceW <= 0 || height <= 0) return undefined;
    /* only a volume, a color or the theme changed: drawn at the next frame, so a volume line in hand moves the
       waveform with it */
    const repaint = columnsOf.current?.wave === wave && columnsOf.current.shape === shape && drawnSize.current === `${shape}:${height}`;
    /* drawn soon (see drawSoon); in a burst of zoom or scroll steps, once the burst stops (the stretched old bitmap
       holds meanwhile): redrawn at every step, the waveforms were most of what a zoom cost */
    const draw = () => {
      drawnAt.current = performance.now();
      drawnSize.current = `${shape}:${height}`;
      /* capped in device pixels, not CSS pixels: capping CSS pixels would also drop Retina's 2×, and this layer is
         thin enough that blur makes it useless. Full ratio while it fits, down to 1× at the cap. */
      const drawW = Math.min(Math.round(sliceW), MAX_CANVAS_PX);
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, MAX_CANVAS_PX / drawW));
      el.width = Math.max(1, Math.round(drawW * dpr));
      el.height = Math.max(1, Math.round(height * dpr));
      const ctx = el.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, drawW, height);

      /* one column per pixel: more peaks than pixels takes the maximum (sampling would miss a drum hit and draw
         silence); fewer peaks than pixels interpolates (nearest-peak steps are the sampling grid, not the sound) */
      let columns = columnsOf.current?.wave === wave && columnsOf.current.shape === shape ? columnsOf.current.columns : null;
      if (!columns) {
        const sliceIn = inMs + (width > 0 ? (from / width) * durMs : 0);
        const sliceDur = width > 0 ? (sliceW / width) * durMs : durMs;
        columns = waveformColumns(wave, sliceIn, sliceDur, drawW);
        columnsOf.current = { wave, shape, columns };
      }
      /* two paths, two fills (the sound, and what of it clips): thousands of fillRect calls would be thousands of
         draws */
      const clipped = new Path2D();
      let clips = false;
      ctx.beginPath();
      for (let x = 0; x < drawW; x += 1) {
        const { barPx, clipPx } = waveBarPx(columns[x]!, volume, height);
        ctx.rect(x, height - barPx + clipPx, 1, barPx - clipPx);
        if (clipPx > 0) { clipped.rect(x, height - barPx, 1, clipPx); clips = true; }
      }
      ctx.fillStyle = colorOf(el, color, theme);
      ctx.fill();
      if (clips) {
        ctx.fillStyle = colorOf(el, clipColor, theme);
        ctx.fill(clipped);
      }
    };
    const timer = window.setTimeout(() => drawSoon(el, draw), !repaint && performance.now() - drawnAt.current < BURST_MS ? BURST_MS : 0);
    return () => { window.clearTimeout(timer); waiting.delete(el); };
  }, [wave, width, height, color, clipColor, volume, inMs, durMs, from, sliceW, shape, theme]);

  if (!wave?.peaks.length || sliceW <= 0) return null;
  return (
    <canvas
      ref={ref}
      data-wave-volume={volume}
      className="pointer-events-none absolute bottom-0"
      style={{ left: from, width: sliceW, height, color }}
    />
  );
}
