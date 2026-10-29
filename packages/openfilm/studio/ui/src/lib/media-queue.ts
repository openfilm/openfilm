/**
 * Studio's background requests for media (a file's length and size, a waveform, and the pictures: the timeline's
 * thumbnails, a clip's poster, the media pane's covers): a few at a time.
 *
 * A browser keeps six connections to Studio. Opening a project used to ask for every file's facts and every picture at
 * once, and those requests held all six for half a minute: an edit made meanwhile (a sound dropped at the film's end)
 * waited for a free one, and the person saw it not land. So they go in two lines: a web page's facts and pictures are
 * found by drawing it in the headless browser, one at a time on the server, so one at a time here (more would only
 * wait there, each holding a connection); a media file's come from ffmpeg, MEDIA_IN_FLIGHT at a time. The editor's own
 * requests always find a connection. A media file's facts go before its pictures (a video's length decides which
 * frames are asked for); a page's pictures go before its facts (they are what the person waits to see, and a page
 * clip's length is in film.html already).
 */
import * as React from 'react';

export const MEDIA_IN_FLIGHT = 2;
export const PAGES_IN_FLIGHT = 1;

/** `first`: what waits there goes before `then` */
type Line = { running: number; most: number; first: Array<() => void>; then: Array<() => void>; picturesFirst: boolean };
const files: Line = { running: 0, most: MEDIA_IN_FLIGHT, first: [], then: [], picturesFirst: false };
const pages: Line = { running: 0, most: PAGES_IN_FLIGHT, first: [], then: [], picturesFirst: true };

/** A request about a web page (its `path`) is drawn in the headless browser. */
const lineOf = (url: string): Line => (/\.html?$/i.test(new URL(url, 'http://studio').searchParams.get('path') ?? '') ? pages : files);

/** Wait for a turn, run, give the turn on. `still`: asked when the turn comes; false skips it (not wanted any more). */
async function inTurn<T>(run: () => Promise<T>, line: Line, picture: boolean, still?: () => boolean): Promise<T | undefined> {
  if (line.running >= line.most) await new Promise<void>((go) => (picture === line.picturesFirst ? line.first : line.then).push(go));
  line.running += 1;
  try {
    if (still && !still()) return undefined;
    return await run();
  } finally {
    line.running -= 1;
    (line.first.shift() ?? line.then.shift())?.();
  }
}

/** `fetch`, waiting its turn among the media requests. */
export async function mediaFetch(url: string, init?: RequestInit): Promise<Response> {
  return (await inTurn(() => fetch(url, init), lineOf(url), false))!;
}

/** Pictures loaded once: the browser has them, so they are shown again without waiting a turn. */
const LOADED = new Set<string>();
const LOADED_MAX = 2000;
/** Pictures waiting their turn or loading, each asked for once. */
const WAITING = new Map<string, { done: Promise<boolean | null>; stills: Array<() => boolean> }>();

/**
 * Load a picture into the browser's cache, waiting its turn; true when it loaded, false when it did not. `still` is
 * asked when its turn comes: a picture not wanted any more by then (another zoom, a tile scrolled away) is not asked
 * for at all (null).
 */
export async function mediaImage(url: string, still?: () => boolean): Promise<boolean | null> {
  if (LOADED.has(url)) return true;
  /* asked again while waiting (the timeline asks again on every change): one request, wanted while anyone wants it */
  const queued = WAITING.get(url);
  if (queued) { queued.stills.push(still ?? (() => true)); return queued.done; }
  const stills = [still ?? (() => true)];
  const done = inTurn(() => new Promise<boolean>((loaded) => {
    const img = new Image();
    img.onload = () => loaded(true);
    img.onerror = () => loaded(false);
    img.src = url;
  }), lineOf(url), true, () => stills.some((s) => s())).then((ok) => {
    WAITING.delete(url);
    if (ok) {
      LOADED.add(url);
      if (LOADED.size > LOADED_MAX) LOADED.delete(LOADED.values().next().value!);
    }
    return ok ?? null;
  });
  WAITING.set(url, { done, stills });
  return done;
}

/**
 * A picture's address once it has had its turn (loaded or not: a failure is the `<img>`'s to show and retry), else
 * the last one that had it, so a picture made again never flickers. `wanted` false: not asked for yet (off screen).
 */
export function useMediaImage(url: string | null | undefined, wanted = true): string | null {
  const [ready, setReady] = React.useState<string | null>(() => (url && LOADED.has(url) ? url : null));
  React.useEffect(() => {
    if (!url || !wanted || ready === url) return undefined;
    let live = true;
    void mediaImage(url, () => live).then((had) => { if (live && had !== null) setReady(url); });
    return () => { live = false; };
  }, [url, wanted, ready]);
  return url && LOADED.has(url) ? url : ready;
}

/**
 * The pictures of `urls` (by any key) that have had their turn: what can be drawn now. A key whose address changed
 * (its file made again) keeps the last one it had until the new one has had its turn, as useMediaImage does.
 */
export function useMediaImages(urls: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const [ready, setReady] = React.useState<ReadonlySet<string>>(() => new Set());
  const wanted = React.useRef(urls);
  wanted.current = urls;
  const last = React.useRef<Record<string, string>>({});
  React.useEffect(() => {
    for (const url of new Set(Object.values(urls))) {
      if (ready.has(url)) continue;
      void mediaImage(url, () => Object.values(wanted.current).includes(url))
        .then((had) => { if (had !== null) setReady((cur) => (cur.has(url) ? cur : new Set(cur).add(url))); });
    }
  }, [urls]); // eslint-disable-line react-hooks/exhaustive-deps
  return React.useMemo(() => {
    const shown: Record<string, string> = {};
    for (const [key, url] of Object.entries(urls)) {
      const had = ready.has(url) || LOADED.has(url) ? url : last.current[key];
      if (had) shown[key] = had;
    }
    last.current = shown;
    return shown;
  }, [urls, ready]);
}
