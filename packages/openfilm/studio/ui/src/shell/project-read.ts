/**
 * The project read by Studio's shell, with a workbench in the page or none: the project and its film as the folder
 * has them (or why they could not be read), and its files as the folder lists them, kept fresh by the folder's events.
 * A project that is gone is left. What a workbench draws from the film (its picture, film.html missing) it reads
 * itself from the same events; what it reads of the project again is put here with the operations this gives it.
 */
import * as React from 'react';
import { api, ApiError, projectEvents, type Listing, type ProjectFilm } from '@/api';
import { leaveProject } from '@/lib/navigate';

export function useProjectRead(projectId: string) {
  /* how many times the project's files changed since it opened (see the folder's events below) */
  const [filesTick, setFilesTick] = React.useState(0);
  const [loaded, setLoaded] = React.useState<ProjectFilm | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);
  const [rawListing, setRawListing] = React.useState<Listing | null>(null);
  /** the first read's answer, once it is taken (a workbench reads what film.html was then from it) */
  const [firstRead, setFirstRead] = React.useState<ProjectFilm | null>(null);
  /* snapshots taken from elsewhere (adoptFilm): a first read answered after one of them is of an older film */
  const filmReads = React.useRef(0);

  /** List the project's files again. */
  const listFiles = React.useCallback(() => api.files(projectId).then(setRawListing, () => {}), [projectId]);
  /** Read the project and its film again (a version put back), and take what is read. */
  const readFilm = React.useCallback(() => {
    void api.film(projectId).then((f) => { setLoaded(f); }, () => {});
  }, [projectId]);
  /** A snapshot of the project read elsewhere (a page reconnecting): the film as first loaded stays, the project is read. */
  const adoptFilm = React.useCallback((latest: ProjectFilm) => {
    filmReads.current += 1;
    setLoaded((current) => current?.doc ? current : latest);
    setFailure(null);
  }, []);

  /* ── the project, its film and its files ── */
  React.useEffect(() => {
    let live = true;
    const first = filmReads.current;
    /* a project the list no longer has (deleted meanwhile, a tab of it opened again): gone, so this page leaves it */
    api.film(projectId, AbortSignal.timeout(8000)).then((l) => {
      if (!live || first !== filmReads.current) return;
      setLoaded(l); setFirstRead(l);
    }, (e: Error) => {
      if (!live || first !== filmReads.current) return;
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) leaveProject(); else setFailure(e.message);
    });
    void api.opened(projectId).catch(() => {});
    void listFiles();
    const stop = projectEvents(projectId, (event) => {
      /* deleted (here, in another tab, by an agent), or its folder gone: this page leaves it (with tabs, its tab closes) */
      if (event.type === 'gone') { leaveProject(); return; }
      /* renamed from another tab, or the projects list */
      if (event.type === 'project') { setLoaded((l) => (l ? { ...l, project: event.project } : l)); return; }
      if (event.type !== 'files') return;
      void listFiles();
      /* a page's picture depends on the files it loads (its styles, code, pictures): its thumbnails are asked again
         (the server answers an unchanged one in a word) */
      setFilesTick((n) => n + 1);
    });
    return () => { live = false; stop(); };
  }, [projectId, listFiles]);

  return { loaded, setLoaded, failure, filesTick, rawListing, setRawListing, firstRead, listFiles, readFilm, adoptFilm };
}
