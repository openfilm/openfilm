/**
 * The thumbnails the timeline draws: only pictures that have loaded, kept across zooms. A zoom changes which shots a
 * clip wants (another rung of the ladder, see thumb-cache) and the server shoots them a few at a time; handed straight
 * to the row, every cell would point at a picture not made yet and the row would stand empty until it arrived. Here a
 * wanted shot joins once it has loaded, and until then each cell keeps the nearest picture it already has. A file
 * that changed (its version is in the key) keeps its old pictures until the new version's are all in, then shows
 * those instead (lib/thumb-versions): an edit never empties the clip, and it never shows old and new mixed.
 */
import * as React from 'react';

import { mediaImage } from './media-queue';
import { NO_THUMBS, addThumbs, failThumb, shownThumbs, wantThumbs, type ThumbVersions } from './thumb-versions';

export function useLoadedThumbs(wanted: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const [state, setState] = React.useState<ThumbVersions>(NO_THUMBS);
  const loadedRef = React.useRef(state.loaded);
  loadedRef.current = state.loaded;
  const pending = React.useRef(new Set<string>());
  const wantedRef = React.useRef(wanted);
  wantedRef.current = wanted;
  /* a picture that did not load, how many times it has been asked for, and the next try waiting */
  const tries = React.useRef(new Map<string, number>());
  /* failed at least once: a clip holding its old pictures does not wait for it */
  const hasFailed = React.useCallback((url: string) => tries.current.has(url), []);
  const retries = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  /* pictures that finished loading, added together on the next frame (a zoom loads dozens) */
  const arrived = React.useRef(new Map<string, string>());
  const flush = React.useRef(0);

  React.useEffect(() => {
    /* a clip wanted in another version holds the one it shows until the new one is in */
    setState((prev) => wantThumbs(prev, wanted, hasFailed));
    const load = (key: string, url: string) => {
      if (loadedRef.current.get(key) === url || pending.current.has(url)) return;
      pending.current.add(url);
      /* in turn with Studio's other media requests (lib/media-queue): a picture no longer wanted when its turn comes
         (another zoom) is not asked for */
      void mediaImage(url, () => wantedRef.current.get(key) === url).then((ok) => {
        pending.current.delete(url);
        if (ok === null) return;
        if (ok) arrive(key, url);
        else failed(key, url);
      });
    };
    const arrive = (key: string, url: string) => {
      tries.current.delete(url);
      arrived.current.set(key, url);
      if (flush.current) return;
      flush.current = requestAnimationFrame(() => {
        flush.current = 0;
        const batch = arrived.current; arrived.current = new Map();
        setState((prev) => addThumbs(prev, batch, wantedRef.current, hasFailed));
      });
    };
    /* not there (yet): asked again a little later while it is still wanted, and the next time it is wanted. Waiting
       for the next zoom instead left a clip on the nearest other picture it had (a trimmed clip on its source's black
       first frame) for as long as nobody zoomed */
    const failed = (key: string, url: string) => {
      const n = (tries.current.get(url) ?? 0) + 1;
      tries.current.set(url, n);
      if (n === 1) setState((prev) => failThumb(prev, wantedRef.current, hasFailed));
      if (n > 6) return;
      const timer = setTimeout(() => {
        retries.current.delete(timer);
        if (wantedRef.current.get(key) === url) load(key, url);
      }, Math.min(8000, 1000 * 2 ** (n - 1)));
      retries.current.add(timer);
    };
    for (const [key, url] of wanted) load(key, url);
  }, [wanted, hasFailed]);

  React.useEffect(() => () => {
    if (flush.current) cancelAnimationFrame(flush.current);
    for (const timer of retries.current) clearTimeout(timer);
  }, []);
  return React.useMemo(() => shownThumbs(state), [state]);
}
