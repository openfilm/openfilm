/**
 * The thumbnails the timeline draws: only pictures that have loaded, kept across zooms. A zoom changes which shots a
 * clip wants (another rung of the ladder, see thumb-cache) and the server shoots them a few at a time; handed straight
 * to the row, every cell would point at a picture not made yet and the row would stand empty until it arrived. Here a
 * wanted shot joins once it has loaded, and until then each cell keeps the nearest picture it already has. A file
 * that changed (its mtime is in the key) drops its old pictures as soon as the new version is wanted, so a clip never
 * shows what its file used to be.
 */
import * as React from 'react';

/** `mtime:clipId` of a key (`mtime:clipId@intoMs#v`, see thumb-frame), and the clip id alone. */
function versionOf(key: string): { version: string; clip: string } | null {
  const at = key.lastIndexOf('@', key.lastIndexOf('#'));
  if (at < 0) return null;
  const version = key.slice(0, at);
  const colon = version.indexOf(':');
  return colon < 0 ? null : { version, clip: version.slice(colon + 1) };
}

export function useLoadedThumbs(wanted: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const [loaded, setLoaded] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  const loadedRef = React.useRef(loaded);
  loadedRef.current = loaded;
  const pending = React.useRef(new Set<string>());
  const wantedRef = React.useRef(wanted);
  wantedRef.current = wanted;
  /* a picture that did not load, how many times it has been asked for, and the next try waiting */
  const tries = React.useRef(new Map<string, number>());
  const retries = React.useRef(new Set<ReturnType<typeof setTimeout>>());
  /* pictures that finished loading, added together on the next frame (a zoom loads dozens) */
  const arrived = React.useRef(new Map<string, string>());
  const flush = React.useRef(0);

  React.useEffect(() => {
    /* the versions wanted now: an older version of the same clip goes */
    const current = new Map<string, string>();
    for (const key of wanted.keys()) { const v = versionOf(key); if (v) current.set(v.clip, v.version); }
    setLoaded((prev) => {
      let next: Map<string, string> | null = null;
      for (const key of prev.keys()) {
        const v = versionOf(key);
        if (v && current.has(v.clip) && current.get(v.clip) !== v.version) (next ??= new Map(prev)).delete(key);
      }
      return next ?? prev;
    });
    const load = (key: string, url: string) => {
      if (loadedRef.current.get(key) === url || pending.current.has(url)) return;
      pending.current.add(url);
      const img = new Image();
      img.onload = () => {
        pending.current.delete(url);
        tries.current.delete(url);
        arrived.current.set(key, url);
        if (flush.current) return;
        flush.current = requestAnimationFrame(() => {
          flush.current = 0;
          const batch = arrived.current; arrived.current = new Map();
          setLoaded((prev) => { const next = new Map(prev); for (const [k, u] of batch) next.set(k, u); return next; });
        });
      };
      /* not there (yet): asked again a little later while it is still wanted, and the next time it is wanted. Waiting
         for the next zoom instead left a clip on the nearest other picture it had (a trimmed clip on its source's black
         first frame) for as long as nobody zoomed */
      img.onerror = () => {
        pending.current.delete(url);
        const n = (tries.current.get(url) ?? 0) + 1;
        tries.current.set(url, n);
        if (n > 6) return;
        const timer = setTimeout(() => {
          retries.current.delete(timer);
          if (wantedRef.current.get(key) === url) load(key, url);
        }, Math.min(8000, 1000 * 2 ** (n - 1)));
        retries.current.add(timer);
      };
      img.src = url;
    };
    for (const [key, url] of wanted) load(key, url);
  }, [wanted]);

  React.useEffect(() => () => {
    if (flush.current) cancelAnimationFrame(flush.current);
    for (const timer of retries.current) clearTimeout(timer);
  }, []);
  return loaded;
}
