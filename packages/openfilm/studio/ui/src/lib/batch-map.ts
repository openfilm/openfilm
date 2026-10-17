/**
 * Entries set one by one, handed on together: the first one waits `ms`, and everything set in that time goes in the
 * same batch. For the media facts probed as a project opens (ProjectView): thousands of files answer one after another,
 * and each answer set on its own laid out the media pane and the timeline's sources again, the picture stalling for
 * tens of ms each time while a person watched it play.
 */
export function batchMap<K, V>(flush: (batch: Map<K, V>) => void, ms: number) {
  let batch = new Map<K, V>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    set(key: K, value: V) {
      batch.set(key, value);
      if (timer != null) return;
      timer = setTimeout(() => {
        timer = null;
        const done = batch;
        batch = new Map();
        flush(done);
      }, ms);
    },
    /** What is waiting dropped (the project closed). */
    cancel() {
      if (timer != null) clearTimeout(timer);
      timer = null;
      batch = new Map();
    },
  };
}
