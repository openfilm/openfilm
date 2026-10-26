/**
 * A project's version history and the actions on it, for the Version history panel.
 *
 *   const history = useProjectHistory(projectId, { onError: toast.showError, beforeChange: film.settled });
 *   // on the project's `{ type: 'history' }` event: history.refresh()
 *   <ProjectHistoryControls history={history} open={open} onClose={…} />
 *
 * It loads on mount (and when the project changes), after each of its own actions, and when `refresh()` is called.
 * A failed action is said through `onError`, but a checkout refused for changes ('dirty'), which the panel asks about.
 * A checkout or a discard tells every page of the project (`{ type: 'history', moved }`), which reads the film and
 * Studio's state of it again (ProjectView).
 */
import React from 'react';
import { projectEvents } from '@/api';
import { useT } from '@/i18n';
import { historyApi, historyErrorKey, historyProgressOf, type HistoryProgress, type HistoryResult, type HistoryState } from '@/lib/project-history';

/** How many versions the list asks for at a time. */
const PAGE = 50;

export interface ProjectHistory {
  /** null: not loaded yet. */
  state: HistoryState | null;
  /** The history could not be read (and none was shown yet): the panel says so and offers to try again. */
  failed: boolean;
  /** An action on its way: the panel waits. */
  busy: string | null;
  /** How far the action on its way is (or the history being loaded, when an older one is brought up to date). */
  progress: HistoryProgress | null;
  refresh: () => Promise<void>;
  /** Older versions too, PAGE more. */
  showMore: () => Promise<void>;
  save: (message: string) => Promise<boolean>;
  discard: () => Promise<boolean>;
  checkout: (commit: string, discard?: boolean) => Promise<HistoryResult<{ commit: string; missing?: string[] }>>;
  copy: (commit: string, name: string) => Promise<HistoryResult<{ project: { id: string; name: string }; missing?: string[] }>>;
  delete: (commits: string[]) => Promise<boolean>;
  recover: (commits: string[]) => Promise<boolean>;
}

export function useProjectHistory(projectId: string, {
  onError,
  beforeChange,
}: {
  /** A failed action, in a sentence for the person (show it as an error toast). */
  onError: (message: string) => void;
  /** Runs before committing, discarding or checking out: edits still waiting to be written land first, so the
   * version holds what the person sees and a checkout is not undone by them. */
  beforeChange?: () => Promise<unknown>;
}): ProjectHistory {
  const t = useT();
  const [state, setState] = React.useState<HistoryState | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<HistoryProgress | null>(null);
  /* a ref as well as state: a second click lands before React re-renders */
  const inFlight = React.useRef(false);
  const limit = React.useRef(PAGE);

  const refresh = React.useCallback(async () => {
    const fresh = await historyApi.load(projectId, limit.current);
    /* not loaded: keep what is shown; one hiccup should not empty the panel */
    if (fresh) setState(fresh);
    setFailed(!fresh);
    /* loading may have brought an older history up to date, with progress of its own */
    if (!inFlight.current) setProgress(null);
  }, [projectId]);

  React.useEffect(() => {
    setState(null);
    setFailed(false);
    limit.current = PAGE;
    void refresh();
  }, [refresh]);

  /* how far an action is, as the server says while it runs; the history event at its end clears it */
  React.useEffect(() => {
    setProgress(null);
    return projectEvents(projectId, (event) => {
      if (event.type === 'history') { setProgress(null); return; }
      const p = historyProgressOf(event);
      if (p) setProgress(p);
    });
  }, [projectId]);

  /** Run one action at a time; a refusal is said, except `quiet` codes the panel answers itself. */
  const act = React.useCallback(async <T,>(name: string, run: () => Promise<HistoryResult<T>>, quiet: string[] = []): Promise<HistoryResult<T>> => {
    if (inFlight.current) return { ok: false, status: 429, code: 'busy' };
    inFlight.current = true;
    setBusy(name);
    try {
      const result = await run();
      if (!result.ok && !(result.code && quiet.includes(result.code))) onError(t(historyErrorKey(result)));
      await refresh();
      return result;
    } finally {
      inFlight.current = false;
      setBusy(null);
      setProgress(null);
    }
  }, [onError, refresh, t]);

  return {
    state,
    failed,
    busy,
    progress,
    refresh,
    showMore: async () => { limit.current += PAGE; await refresh(); },
    save: async (message) => (await act('save', async () => { await beforeChange?.(); return historyApi.save(projectId, message); })).ok,
    discard: async () => (await act('discard', async () => { await beforeChange?.(); return historyApi.discard(projectId); })).ok,
    checkout: (commit, discard = false) => act('checkout', async () => { await beforeChange?.(); return historyApi.checkout(projectId, commit, discard); }, ['dirty']),
    copy: (commit, name) => act('copy', () => historyApi.copy(projectId, commit, name)),
    delete: async (commits) => (await act('delete', () => historyApi.delete(projectId, commits))).ok,
    recover: async (commits) => (await act('recover', () => historyApi.recover(projectId, commits))).ok,
  };
}
