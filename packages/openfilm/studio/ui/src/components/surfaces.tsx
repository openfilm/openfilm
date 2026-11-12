/**
 * The surfaces of plugins: a plugin's workbench is a whole surface of its own, shown in the panes' place beside the
 * library and the app's chat, as the canvas is. It is given the project and nothing of another plugin's: it reads and
 * writes the film itself with the editor's own parts (editor/use-film for the film and its edits, editor/Preview for
 * the picture, editor/player for the clock), so no workbench reaches into another.
 *
 * The edit and the canvas are held by ProjectView itself. Every other workbench of OpenFilm's own is listed here by its
 * name (`workbench` in its plugin's openfilm.json, src/plugins.mjs) and loaded when first shown. One someone made is
 * a web page (its skill's `index.html`, lib/project-plugins), shown in a frame on the plugins' own origin
 * (studio/server/plugin-pages.mjs): it is told where the project's files are (`?project=`, their address there), reads
 * them from there, and writes them (PUT) once the person lets it; it cannot reach the editor. One that brings a
 * program (studio/server/plugin-programs.mjs) is shown what its program serves, started when its workbench is first
 * shown, once the person lets it run. ProjectView shows the one picked without knowing which there are.
 */
import React from 'react';
import { useT } from '@/i18n';
import { sourcesApi, SourceError } from '@/lib/project-sources';

export interface SurfaceProps {
  projectId: string;
  /** the project's folder on this computer */
  folder: string;
  /** the address of the project's files on the film's origin */
  film: string;
}

/** The surfaces there are, by the workbench their plugin names: `color: React.lazy(() => import('./color/ColorView'))`. */
export const SURFACES: Record<string, React.LazyExoticComponent<React.ComponentType<SurfaceProps>>> = {};

/** The workbenches ProjectView holds itself: the edit, the canvas, and Motion (a view of the edit's timeline). */
export const OWN_SURFACES: readonly string[] = ['edit', 'canvas', 'motion'];

/** A plugin's surface by its workbench's name, or the page of one someone made; one this build has no surface for says so. */
export function PluginSurface({ id, page, files, title, program, runs, ...props }: SurfaceProps & { id: string; page?: string; files?: string; title?: string; program?: boolean; runs?: boolean }) {
  const t = useT();
  if (program) return <ProgramSurface key={`${id}:${props.projectId}:${runs ? 1 : 0}`} uid={id} projectId={props.projectId} title={title ?? id} />;
  if (page) return <iframe key={page} src={`${page}${files ? `?project=${encodeURIComponent(files)}` : ''}`} title={title ?? id} allow="autoplay" className="min-h-0 min-w-0 flex-1 border-0 bg-[var(--bg-panel)]" />;
  const Surface = SURFACES[id];
  if (!Surface) return <p className="m-auto max-w-[360px] px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.surfaceMissing')}</p>;
  return <React.Suspense fallback={null}><Surface {...props} /></React.Suspense>;
}

const NOTE = 'm-auto max-w-[420px] whitespace-pre-wrap px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]';

/** The surface of a plugin that brings a program: the program started (or found running), then what it serves. */
function ProgramSurface({ uid, projectId, title }: { uid: string; projectId: string; title: string }) {
  const t = useT();
  const [state, setState] = React.useState<{ url: string } | { error: string; refused?: boolean } | null>(null);
  React.useEffect(() => {
    let live = true;
    sourcesApi.startPlugin(uid, projectId).then(
      (url) => { if (live) setState({ url }); },
      (e) => { if (live) setState({ error: e instanceof Error ? e.message : String(e), refused: e instanceof SourceError && e.status === 403 }); },
    );
    return () => { live = false; };
  }, [uid, projectId]);
  if (!state) return <p className={NOTE}>{t('assetDrawer.surfaceStarting')}</p>;
  if ('error' in state) return <p className={NOTE}>{state.refused ? t('assetDrawer.surfaceNotAllowed') : `${t('assetDrawer.surfaceFailed')}\n\n${state.error}`}</p>;
  return <iframe src={state.url} title={title} allow="autoplay" className="min-h-0 min-w-0 flex-1 border-0 bg-[var(--bg-panel)]" />;
}
