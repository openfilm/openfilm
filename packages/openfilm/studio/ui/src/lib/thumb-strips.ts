/**
 * A video's strip: pictures from all along its file in one image (studio/server/derived.mjs `strip`), which the
 * timeline draws a clip's thumbnails from at once. One request a file, kept by the browser, where every cell of
 * every clip was a frame of its own to ask for, two at a time: a row stood empty, or on a picture borrowed from far
 * away, until its frames came, each time the film was opened, zoomed, or a clip of it trimmed. The frames asked for
 * one by one (ProjectView's `thumbs`) still come after, where a cell stands between two of the strip's pictures.
 *
 * A strip's picture is a shot like any other to the row (lib/thumb-pick takes the nearest in time): its address is
 * the strip's image with the place of the picture in it after the `#` (`stripCell`), which BlockThumbs draws from.
 *
 * A file whose key frames are far apart has a first strip of those alone, there in a moment, and a closer one made
 * behind it (the server says so: `closer`): asked for again a little later, it takes the first one's place.
 */
import * as React from 'react';

import { mediaFetch, mediaImage } from './media-queue.ts';

/** A strip as loaded: its image's address, its grid, each picture's size, and each one's moment in the file (ms). */
export type ThumbStrip = { url: string; cols: number; rows: number; w: number; h: number; times: readonly number[] };

/** A picture of a strip, as a shot's address: the strip's image, and after the `#` where the picture is in it. */
export function stripCell(strip: ThumbStrip, i: number): string {
  return `${strip.url}#cell=${i},${strip.cols},${strip.rows},${strip.w},${strip.h}`;
}

/** The place a shot's address names in a strip's image; null for a picture of its own. */
export function parseStripCell(url: string): { src: string; col: number; row: number; cols: number; rows: number; w: number; h: number } | null {
  const at = url.lastIndexOf('#cell=');
  if (at < 0) return null;
  const [i, cols, rows, w, h] = url.slice(at + 6).split(',').map(Number);
  if (!(cols! > 0 && rows! > 0 && w! > 0 && h! > 0) || !(i! >= 0)) return null;
  return { src: url.slice(0, at), col: i! % cols!, row: Math.floor(i! / cols!), cols: cols!, rows: rows!, w: w!, h: h! };
}

/**
 * How a strip's picture fills a cell `width` × `height` px: the strip's image as the cell's background, sized and
 * placed so that this one picture covers the cell, cropped about its middle as a picture of its own is (object-fit:
 * cover).
 */
export function stripCellStyle(cell: NonNullable<ReturnType<typeof parseStripCell>>, width: number, height: number) {
  const k = Math.max(width / cell.w, height / cell.h);
  const x = cell.col * cell.w * k + (cell.w * k - width) / 2;
  const y = cell.row * cell.h * k + (cell.h * k - height) / 2;
  return {
    backgroundImage: `url(${JSON.stringify(cell.src)})`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${cell.cols * cell.w * k}px ${cell.rows * cell.h * k}px`,
    backgroundPosition: `${-x}px ${-y}px`,
  } as const;
}

/** First index whose time is at least `at` (times.length when none is). */
function firstAtLeast(times: readonly number[], at: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < at) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** How many of a strip's pictures past each edge a clip takes: an edge pulled out shows what it reveals. */
const PAST_EDGE = 3;

/**
 * The strip's pictures a clip that shows `fromMs`–`toMs` of its file draws from, by their place in the strip: those
 * inside, the one just before its start (the picture on screen at its first moment) and a few past each edge; a clip
 * between two pictures has its nearest ones.
 */
export function stripShots(times: readonly number[], fromMs: number, toMs: number): number[] {
  if (!times.length) return [];
  const first = Math.max(0, firstAtLeast(times, fromMs) - 1 - PAST_EDGE);
  const last = Math.min(times.length - 1, firstAtLeast(times, toMs) - 1 + PAST_EDGE);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

/**
 * Whether the strip has a picture within `withinMs` of `atMs`: the frame at `atMs` then need not be asked for, the
 * cell it is for shows as much of that moment from the strip.
 */
export function stripHas(times: readonly number[], atMs: number, withinMs: number): boolean {
  if (!times.length) return false;
  const i = firstAtLeast(times, atMs);
  return (i < times.length && times[i]! - atMs <= withinMs) || (i > 0 && atMs - times[i - 1]! <= withinMs);
}

/** How long after a strip could not be had it is asked for again, each try (ms); then no more until its file changes. */
const RETRY_MS = [3000, 15_000];
/** How long after a first strip came a closer one is asked for, each time while it is still being made (ms). */
const CLOSER_MS = [1500, 3000, 6000, 12_000, 25_000, 50_000];

/**
 * The strips of `wanted` (each video's path, and its file's version), as they load: asked for ahead of every other
 * picture (a strip fills every clip of its file). A file made again keeps its last strip until the new one is in.
 */
export function useThumbStrips(projectId: string, wanted: ReadonlyMap<string, number>): ReadonlyMap<string, ThumbStrip> {
  /* `whole`: all it will ever be (not a first one of key frames with a closer one coming) */
  const [strips, setStrips] = React.useState<ReadonlyMap<string, ThumbStrip & { version: number; whole: boolean }>>(() => new Map());
  /* what is had of each file, as soon as it is (the state above is a render behind: asked again in between, a strip
     just loaded was asked for a second time) */
  const have = React.useRef(new Map<string, { version: number; url: string; whole: boolean }>());
  const wantedRef = React.useRef(wanted);
  wantedRef.current = wanted;
  /* the ones asked for now, and how many times each has failed, by path and version */
  const asking = React.useRef(new Set<string>());
  const tries = React.useRef(new Map<string, number>());
  const timers = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  const project = React.useRef(projectId);

  const ask = React.useCallback((path: string, version: number, again = 0) => {
    const id = `${path}\0${version}`;
    const had = have.current.get(path);
    if (asking.current.has(id) || (had?.version === version && (had.whole || !again)) || (tries.current.get(id) ?? 0) > RETRY_MS.length) return;
    asking.current.add(id);
    const of = project.current;
    const address = (what: string, more = '') => `/api/projects/${encodeURIComponent(of)}/media?what=${what}&path=${encodeURIComponent(path)}&v=${version}${more}`;
    const later = (ms: number, next: number) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        if (wantedRef.current.get(path) === version) ask(path, version, next);
      }, ms);
      timers.current.add(timer);
    };
    void (async () => {
      let closer = false;
      try {
        /* a closer one asked for again goes behind what a person is waiting to see; its address is another each time
           (an answer that says "being made" is not kept, but nothing in between may keep it either) */
        const res = await mediaFetch(address('strip', again ? `&again=${again}` : ''), undefined, again ? 'background' : 'visible');
        if (!res.ok) throw new Error(String(res.status));
        const index = await res.json() as { cols: number; rows: number; w: number; h: number; times: number[]; part?: string; closer?: boolean };
        if (!(index.cols > 0 && index.rows > 0 && index.w > 0 && index.h > 0) || !Array.isArray(index.times) || !index.times.length) throw new Error('no strip');
        closer = Boolean(index.closer);
        const whole = index.part !== 'keys';
        const url = address('strip-picture', `&part=${whole ? 'all' : 'keys'}`);
        /* the same one as before (the closer one is not made yet): nothing to load */
        const same = have.current.get(path);
        if (!(same?.version === version && same.url === url)) {
          /* drawn only once its image is in: a row pointing at a picture not loaded yet would stand empty */
          if (!(await mediaImage(url, undefined, again ? 'normal' : 'visible'))) throw new Error('no picture');
          if (project.current !== of) return;
          have.current.set(path, { version, url, whole: whole || !closer });
          if (wantedRef.current.get(path) === version) setStrips((cur) => new Map(cur).set(path, { url, cols: index.cols, rows: index.rows, w: index.w, h: index.h, times: index.times, version, whole: whole || !closer }));
        } else if (!closer && !same.whole) have.current.set(path, { ...same, whole: true });
        tries.current.delete(id);
      } catch {
        if (project.current !== of) return;
        const n = (tries.current.get(id) ?? 0) + 1;
        tries.current.set(id, n);
        const wait = RETRY_MS[n - 1];
        if (wait != null) later(wait, again);
        return;
      } finally {
        asking.current.delete(id);
      }
      /* a closer one is being made: asked for again in a while, as long as it is */
      const wait = closer ? CLOSER_MS[again] : undefined;
      if (wait != null && project.current === of) later(wait, again + 1);
    })();
  }, []);

  React.useEffect(() => {
    /* another project: nothing of the last one is its */
    if (project.current !== projectId) {
      project.current = projectId;
      asking.current.clear();
      tries.current.clear();
      have.current.clear();
      setStrips(new Map());
    }
    for (const [path, version] of wanted) ask(path, version);
  }, [projectId, wanted, ask]);
  React.useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
  return strips;
}
