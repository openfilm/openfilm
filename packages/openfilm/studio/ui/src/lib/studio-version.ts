/**
 * The page and the Studio serving it are one version. When Studio comes back after it was away as another one (a
 * newer openfilm replaced it, or the desktop app took over from the one `openfilm open` started), this page's code
 * may no longer match what the server answers: it reloads, once the edits it is writing have been written (every
 * edit is written to the folder as it is made, so nothing else is lost).
 */
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const RELOADED_FOR = 'openfilm-studio:reloaded-for';

/**
 * `version`: what Studio's /api/health says now (null: no answer). `idle`: no edit is being written. `storage`
 * remembers the version a reload was for, so a page that still disagrees after it (a stale cache) does not reload
 * again and again.
 */
export function watchStudioVersion({ version, idle, reload, storage, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }: {
  version: () => Promise<string | null>;
  idle: () => boolean;
  reload: () => void;
  storage: Store | null;
  wait?: (ms: number) => Promise<unknown>;
}) {
  /* the version this page was loaded from: asked as it starts */
  const loaded = version().catch(() => null);
  return {
    /** Studio is back: reload when it is another version. Resolves true when it reloads. */
    async back(): Promise<boolean> {
      const was = await loaded;
      const now = await version().catch(() => null);
      if (!was || !now || now === was) return false;
      try {
        if (!storage || storage.getItem(RELOADED_FOR) === now) return false;
        storage.setItem(RELOADED_FOR, now);
      } catch { return false; }
      /* an edit on its way is let through first (10 s at most: a write that hangs does not keep the old page) */
      for (let i = 0; i < 50 && !idle(); i++) await wait(200);
      reload();
      return true;
    },
  };
}
