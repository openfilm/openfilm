/**
 * `pageChangesOf(loc)` for the inspector's "Changes inside the page": the clip's changes from film.html, and which of
 * them the page no longer has an element for, as the film's stage last said (studio/server/stage.js `lostOverrides`).
 *
 * The inspector reads it every second while a page clip's panel is open; the stage is asked only then (a read in the
 * last few seconds), once a second, so a closed panel costs nothing.
 */
import React from 'react';
import type { PreviewHandle } from '../editor/Preview';
import { lostByClip, pageChangesAt, type FilmParts } from '@/lib/page-changes';
import type { PageChanges } from './FilmInspector';

const ASK_EVERY_MS = 1000;
/** how long after the last read the stage is still asked */
const KEEP_ASKING_MS = 3000;

export function usePageChanges(
  preview: React.RefObject<PreviewHandle | null>,
  film: React.RefObject<FilmParts | null | undefined>,
): (loc: string) => PageChanges | null {
  const lost = React.useRef<ReadonlyMap<string, readonly string[]>>(new Map());
  const readAt = React.useRef(0);
  const asking = React.useRef(false);

  const ask = React.useCallback(() => {
    const handle = preview.current;
    if (!handle?.stage || asking.current) return;
    asking.current = true;
    void handle.stage('lostOverrides').then((answer) => {
      /* no answer (a film loading again): keep what was known */
      if (answer != null) lost.current = lostByClip(answer);
    }).finally(() => { asking.current = false; });
  }, [preview]);

  React.useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - readAt.current < KEEP_ASKING_MS) ask();
    }, ASK_EVERY_MS);
    return () => window.clearInterval(id);
  }, [ask]);

  return React.useCallback((loc: string) => {
    /* the first read in a while: ask now rather than at the next tick */
    if (Date.now() - readAt.current > KEEP_ASKING_MS) ask();
    readAt.current = Date.now();
    return pageChangesAt(film.current, loc, lost.current);
  }, [ask, film]);
}
