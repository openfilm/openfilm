/**
 * The surfaces of plugins: a plugin's workbench is a whole surface of its own, shown in the panes' place beside the
 * library and the app's chat, as the canvas is. It is given the project and nothing of another plugin's: it reads and
 * writes the film itself with the editor's own parts (editor/use-film for the film and its edits, editor/Preview for
 * the picture, editor/player for the clock), so no workbench reaches into another.
 *
 * OpenFilm's own workbenches are elements their plugins bring (plugins/<id>: its package.json's `browser`), which the
 * shell lays out where the layout says (shell/workbenches: the edit among the page's panels, the canvas in its box).
 * Any other is shown here, in the panes' place. One someone made is a web page (its skill's `index.html`,
 * lib/project-plugins), shown in a frame on the plugins' own origin (studio/server/plugin-pages.mjs): it is told
 * where the project's files are (`?project=`, their address there), reads them from there, and writes them (PUT) once
 * the person lets it; it cannot reach the editor. One that brings a program (studio/server/plugin-programs.mjs) is
 * shown what its program serves, started when its workbench is first shown, once the person lets it run. One that
 * brings an element (its package.json's `browser`: a module whose default export is a custom element) is not in a
 * frame at all: the module is loaded into this page and the element put where the workbench is, so it does all a
 * workbench of OpenFilm's own does (menus over the library, drags from it, the editor's API), again once the person
 * lets it run. The shell shows the one picked without knowing which there are.
 */
import React from 'react';
import { useT } from '@/i18n';
import { sourcesApi, SourceError } from '@/lib/project-sources';

export interface SurfaceProps {
  projectId: string;
  /** the project's folder on this computer */
  folder: string;
}

/**
 * A plugin's surface by its workbench's name: its element (one of OpenFilm's own, or one someone made once the person
 * lets it run), the page of one someone made, or what its program serves; one this build has nothing to show for says so.
 */
export function PluginSurface({ id, page, files, title, program, runs, inApp, element, ...props }: SurfaceProps & { id: string; page?: string; files?: string; title?: string; program?: boolean; runs?: boolean; inApp?: boolean; element?: string }) {
  const t = useT();
  if (element) return <ElementSurface key={element} url={element} files={files} projectId={props.projectId} folder={props.folder} />;
  if (inApp) return <p className={NOTE}>{t('assetDrawer.surfaceNotAllowed')}</p>;
  if (program) return <ProgramSurface key={`${id}:${props.projectId}:${runs ? 1 : 0}`} uid={id} projectId={props.projectId} title={title ?? id} />;
  if (page) return <iframe key={page} src={`${page}${files ? `?project=${encodeURIComponent(files)}` : ''}`} title={title ?? id} allow="autoplay" className="min-h-0 min-w-0 flex-1 border-0 bg-[var(--bg-panel)]" />;
  return <p className="m-auto max-w-[360px] px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.surfaceMissing')}</p>;
}

/** How a plugin's surface or element says something in its place: it is starting, it is not let run, it failed. */
export const NOTE = 'm-auto max-w-[420px] whitespace-pre-wrap px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]';

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

/* a module's address → the name its element is defined under: a module is loaded, and its class defined, once. Names
   are counted as classes are defined, not as modules are asked for: several may load at once */
const elementTags = new Map<string, Promise<string>>();
const tagsDefined = new Map<string, string>();
let defined = 0;
/** The name a module's element is defined under, if its module was loaded already (none: not yet). */
export const elementTagNow = (url: string): string | undefined => tagsDefined.get(url);
export function elementTag(url: string): Promise<string> {
  let tag = elementTags.get(url);
  if (!tag) {
    tag = import(/* @vite-ignore */ url).then((module: { default?: unknown }) => {
      const made = module.default;
      if (typeof made !== 'function' || !(made.prototype instanceof HTMLElement)) throw new Error('The default export of its module is not a custom element (a class that extends HTMLElement).');
      /* one its author defined under a name of their own keeps that name */
      const named = (customElements as unknown as { getName?: (c: unknown) => string | null }).getName?.(made);
      if (named) return named;
      let name = '';
      do name = `openfilm-plugin-${++defined}`; while (customElements.get(name));
      customElements.define(name, made as CustomElementConstructor);
      return name;
    });
    elementTags.set(url, tag);
    tag.then((name) => { tagsDefined.set(url, name); }, () => { elementTags.delete(url); });
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
