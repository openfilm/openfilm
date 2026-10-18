/**
 * A project's own cover, from its card in the Projects popover: a picture chosen on this computer, or back to the
 * film's poster (studio/server/cover.mjs). The popover provides the actions; each card's "…" menu offers them.
 */
import React from 'react';
import { api } from '@/api';
import type { LibraryProject } from './ProjectsView';

export interface ProjectCoverActions {
  /** Pick a picture on this computer for its cover. */
  change: (project: LibraryProject) => void;
  /** No cover of its own: the film's poster again. */
  restore: (project: LibraryProject) => void;
}

export const ProjectCoverContext = React.createContext<ProjectCoverActions | null>(null);

/** The card's picture: its own cover when it has one (asked for again once it changes), else the film's poster. */
export const posterUrl = (project: { id: string; cover?: number }) =>
  `/api/projects/${encodeURIComponent(project.id)}/poster${project.cover ? `?cover=${project.cover}` : ''}`;

/** The pictures a cover may be (cover.mjs reads what they are, not their names). */
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

/**
 * The actions and the file input they use. `changed` gets the project's new cover time (null: none of its own);
 * `failed` is told when Studio could not take the picture.
 */
export function useProjectCover(changed: (id: string, cover: number | null) => void, failed: () => void) {
  const input = React.useRef<HTMLInputElement>(null);
  const picking = React.useRef<string | null>(null);

  const actions = React.useMemo<ProjectCoverActions>(() => ({
    change: (project) => {
      picking.current = project.id;
      if (input.current) { input.current.value = ''; input.current.click(); }
    },
    restore: (project) => {
      void api.clearCover(project.id).then(() => changed(project.id, null), failed);
    },
  }), [changed, failed]);

  const picker = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      hidden
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        const id = picking.current;
        picking.current = null;
        if (!file || !id) return;
        void api.setCover(id, { file }).then((cover) => changed(id, cover), failed);
      }}
    />
  );

  return { actions, picker };
}
