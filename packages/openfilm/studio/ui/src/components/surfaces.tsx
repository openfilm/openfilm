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
 * shown, once the person lets it run. One that brings an element (its package.json's `browser`: a module whose default
 * export is a custom element) is not in a frame at all: the module is loaded into this page and the element put where
 * the workbench is, so it does all a workbench of OpenFilm's own does (menus over the library, drags from it, the
 * editor's API), again once the person lets it run. ProjectView shows the one picked without knowing which there are.
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

/** The workbenches shown without a plugin's surface (shell/workbenches): the edit, the canvas, and Motion (a view of the edit's timeline). */
export const OWN_SURFACES: readonly string[] = ['edit', 'canvas', 'motion'];

/** A plugin's surface by its workbench's name, or the page of one someone made; one this build has no surface for says so. */
export function PluginSurface({ id, page, files, title, program, runs, inApp, element, ...props }: SurfaceProps & { id: string; page?: string; files?: string; title?: string; program?: boolean; runs?: boolean; inApp?: boolean; element?: string }) {
  const t = useT();
  if (inApp) return element ? <ElementSurface key={element} url={element} files={files} projectId={props.projectId} folder={props.folder} /> : <p className={NOTE}>{t('assetDrawer.surfaceNotAllowed')}</p>;
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

/* a module's address → the name its element is defined under: a module is loaded, and its class defined, once */
const elementTags = new Map<string, Promise<string>>();
export function elementTag(url: string): Promise<string> {
  let tag = elementTags.get(url);
  if (!tag) {
    tag = import(/* @vite-ignore */ url).then((module: { default?: unknown }) => {
      const made = module.default;
      if (typeof made !== 'function' || !(made.prototype instanceof HTMLElement)) throw new Error('The default export of its module is not a custom element (a class that extends HTMLElement).');
      /* one its author defined under a name of their own keeps that name */
      const named = (customElements as unknown as { getName?: (c: unknown) => string | null }).getName?.(made);
      if (named) return named;
      const name = `openfilm-plugin-${elementTags.size}`;
      customElements.define(name, made as CustomElementConstructor);
      return name;
    });
    elementTags.set(url, tag);
    tag.catch(() => { elementTags.delete(url); });
  }
  return tag;
}

/**
 * The surface of a plugin that brings an element: its module loaded into this page, and one element of it put here.
 * It is told the project by attributes: `project-id` (for the editor's API), `project` (where the project's files are
 * read and written, as a plugin's page is told) and `folder` (the project's folder on this computer).
 */
function ElementSurface({ url, files, projectId, folder }: { url: string; files?: string | undefined; projectId: string; folder: string }) {
  const t = useT();
  const host = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true, element: HTMLElement | null = null;
    elementTag(url).then((tag) => {
      if (!live || !host.current) return;
      element = document.createElement(tag);
      element.setAttribute('project-id', projectId);
      if (files) element.setAttribute('project', files);
      if (folder) element.setAttribute('folder', folder);
      Object.assign(element.style, { display: 'block', flex: '1 1 0', minWidth: '0', minHeight: '0' });
      host.current.append(element);
    }, (e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; element?.remove(); };
  }, [url, files, projectId, folder]);
  if (error) return <p className={NOTE}>{`${t('assetDrawer.surfaceFailed')}\n\n${error}`}</p>;
  return <div ref={host} className="flex min-h-0 min-w-0 flex-1" />;
}
