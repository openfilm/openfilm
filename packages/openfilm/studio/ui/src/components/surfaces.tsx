/**
 * The surfaces of plugins: a plugin's workbench is a whole surface of its own, shown in the panes' place beside the
 * library and the app's chat, as the canvas is. It is given the project and nothing of another plugin's: it reads and
 * writes the film itself with the editor's own parts (editor/use-film for the film and its edits, editor/Preview for
 * the picture, editor/player for the clock), so no workbench reaches into another.
 *
 * The edit and the canvas are held by ProjectView itself. Every other workbench of OpenFilm's own is listed here by its
 * name (`workbench` in its plugin's openfilm.json, src/plugins.mjs) and loaded when first shown. One someone made is
 * a web page (its skill's `index.html`, lib/project-plugins), shown in a frame on the film's origin, as a film's pages
 * are: it is told where the project's files are (`?project=`, their address there) and reads them from there; it
 * cannot reach the editor. ProjectView shows the one picked without knowing which there are.
 */
import React from 'react';
import { useT } from '@/i18n';

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
export function PluginSurface({ id, page, title, ...props }: SurfaceProps & { id: string; page?: string; title?: string }) {
  const t = useT();
  if (page) return <iframe key={page} src={`${page}?project=${encodeURIComponent(props.film)}`} title={title ?? id} allow="autoplay" className="min-h-0 min-w-0 flex-1 border-0 bg-[var(--bg-panel)]" />;
  const Surface = SURFACES[id];
  if (!Surface) return <p className="m-auto max-w-[360px] px-8 text-center text-[13px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.surfaceMissing')}</p>;
  return <React.Suspense fallback={null}><Surface {...props} /></React.Suspense>;
}
