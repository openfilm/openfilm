/**
 * A project's version history and the actions on it, for the Version history panel.
 *
 *   const history = useProjectHistory(projectId, { onError: toast.showError, onMoved: reloadFilm });
 *   // on the project's `{ type: 'history' }` event: history.refresh()
 *   <ProjectHistoryControls history={history} open={open} anchor={anchor} onClose={…} />
 *
 * It loads on mount (and when the project changes), after each of its own actions, and when `refresh()` is called.
 * An action answers with its outcome: refusals the panel asks about (uncommitted changes, a merge that collides, a
 * branch with commits on no other) come back to it; any other failure is said through `onError`.
 */
import React from 'react';
import { projectEvents } from '@/api';
import { useT } from '@/i18n';
import { historyApi, historyErrorKey, historyProgressOf, type HistoryProgress, type HistoryResult, type HistoryState } from '@/lib/project-history';

export interface ProjectHistory {
  /** null: not loaded yet. */
  state: HistoryState | null;
  /** An action on its way: the panel waits. */
  busy: string | null;
  /** How far the action on its way is (or the history being loaded, when an older one is brought up to date). */
  progress: HistoryProgress | null;
  refresh: () => Promise<void>;
  commit: (message: string) => Promise<boolean>;
  discard: () => Promise<boolean>;
  restore: (commit: string) => Promise<HistoryResult>;
  checkout: (o: { branch: string; create?: boolean; from?: string; carry?: 'leave' | 'bring' }) => Promise<HistoryResult<{ parkedBack?: boolean }>>;
  rename: (from: string, name: string) => Promise<boolean>;
  remove: (name: string, force?: boolean) => Promise<HistoryResult>;
  merge: (o: { branch: string; message: string; prefer?: 'ours' | 'theirs' }) => Promise<HistoryResult<{ merged?: boolean }>>;
}

/** Refusals the panel asks the person about instead of saying them. */
const ASKED = new Set(['dirty', 'conflict', 'unmerged']);

export function useProjectHistory(projectId: string, {
  onError,
  onMoved,
  beforeCommit,
}: {
  /** A failed action, in a sentence for the person (show it as an error toast). */
  onError: (message: string) => void;
  /** The folder now holds other files (gone back, switched, merged, discarded): reload the film. */
  onMoved?: () => void;
  /** Runs before committing: flush edits still waiting to be written, so the commit holds what the person sees. */
  beforeCommit?: () => Promise<unknown>;
}): ProjectHistory {
  const t = useT();
  const [state, setState] = React.useState<HistoryState | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<HistoryProgress | null>(null);
  /* a ref as well as state: a second click lands before React re-renders */
  const inFlight = React.useRef(false);

  const refresh = React.useCallback(async () => {
    const fresh = await historyApi.load(projectId);
    /* not loaded: keep what is shown; one hiccup should not empty the panel */
    if (fresh) setState(fresh);
    /* loading may have brought an older history up to date, with progress of its own */
    if (!inFlight.current) setProgress(null);
  }, [projectId]);

  React.useEffect(() => {
    setState(null);
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

  /**
   * Run one action at a time. `moves`: it changes the folder's files when it goes through. A refusal the panel asks
   * about comes back to it; any other is said.
   */
  const act = React.useCallback(async <T,>(name: string, run: () => Promise<HistoryResult<T>>, moves: boolean, asked = ASKED): Promise<HistoryResult<T>> => {
    if (inFlight.current) return { ok: false, status: 429, code: 'busy' };
    inFlight.current = true;
    setBusy(name);
    try {
      const result = await run();
      if (result.ok && moves) onMoved?.();
      if (!result.ok && !(result.code && asked.has(result.code))) onError(t(historyErrorKey(result)));
      await refresh();
      return result;
    } finally {
      inFlight.current = false;
      setBusy(null);
      setProgress(null);
    }
  }, [onMoved, onError, refresh, t]);

  return {
    state,
    busy,
    progress,
    refresh,
    commit: async (message) => (await act('commit', async () => { await beforeCommit?.(); return historyApi.commit(projectId, message); }, false, new Set())).ok,
    discard: async () => (await act('discard', () => historyApi.discard(projectId), true, new Set())).ok,
    restore: (commit) => act('restore', () => historyApi.restore(projectId, commit), true),
    checkout: (o) => act('checkout', () => historyApi.checkout(projectId, o), true),
    rename: async (from, name) => (await act('rename', () => historyApi.rename(projectId, from, name), false, new Set())).ok,
    remove: (name, force) => act('remove', () => historyApi.remove(projectId, name, force), false),
    merge: (o) => act('merge', () => historyApi.merge(projectId, o), true),
  };
}
