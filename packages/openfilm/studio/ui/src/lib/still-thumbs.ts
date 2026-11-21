/**
 * A picture clip's thumbnail: a small copy of its file, made once by the server and kept (its poster,
 * studio/server/derived.mjs), where the timeline drew the file itself. A photograph of twelve million pixels was
 * fetched and decoded whole by the editor for a cell a few dozen pixels wide, each one each time the project was
 * opened: a film of pictures stood without them for seconds, and held their pixels for as long as it was open.
 *
 * A picture the server cannot make a small copy of (a kind its ffmpeg does not read) is drawn from its file, as
 * before; an SVG always is (it is drawn, not decoded, at any size).
 */
import * as React from 'react';

import { mediaImage } from './media-queue.ts';

/** The picture files the server is asked a small copy of. */
const SMALL_COPY = /\.(png|jpe?g|bmp|webp|avif|gif)$/i;

/** Whether the server is asked for a small copy of this picture file (else it is drawn from the file itself). */
export const stillHasSmallCopy = (path: string): boolean => SMALL_COPY.test(path);

/** Where the small copy of a picture file is asked for: `version`, its file's change time, so the browser keeps it. */
export function stillThumbUrl(projectId: string, path: string, version: number): string {
  return `/api/projects/${encodeURIComponent(projectId)}/media?what=poster&path=${encodeURIComponent(path)}&v=${version}`;
}

/**
 * What each of `wanted` (a picture file's path, and its version) is drawn from, once it is known: its small copy, or
 * `fileOf(path)`, the file itself, when none could be made. A file that changed keeps the picture it had until the
 * new one is in.
 */
export function useStillThumbs(projectId: string, wanted: ReadonlyMap<string, number>, fileOf: (path: string) => string): ReadonlyMap<string, string> {
  const [shown, setShown] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  /* what is had of each file, and what is asked for now, by path and version */
  const have = React.useRef(new Map<string, number>());
  const asking = React.useRef(new Set<string>());
  const wantedRef = React.useRef(wanted);
  wantedRef.current = wanted;
  const fileRef = React.useRef(fileOf);
  fileRef.current = fileOf;
  const project = React.useRef(projectId);

  React.useEffect(() => {
    /* another project: nothing of the last one is its */
    if (project.current !== projectId) {
      project.current = projectId;
      have.current.clear();
      asking.current.clear();
      setShown(new Map());
    }
    for (const [path, version] of wanted) {
      const id = `${path}\0${version}`;
      if (have.current.get(path) === version || asking.current.has(id)) continue;
      asking.current.add(id);
      const url = stillThumbUrl(projectId, path, version);
      /* ahead of the frames asked for one by one: one picture fills every cell of its clips */
      void mediaImage(url, () => wantedRef.current.get(path) === version, 'visible').then((ok) => {
        asking.current.delete(id);
        /* not wanted any more at its turn (null), or another project's */
        if (ok === null || project.current !== projectId) return;
        have.current.set(path, version);
        const from = ok ? url : fileRef.current(path);
        setShown((cur) => (cur.get(path) === from ? cur : new Map(cur).set(path, from)));
      });
    }
  }, [projectId, wanted]);
  return shown;
}
