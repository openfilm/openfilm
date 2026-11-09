/**
 * The film being edited: film.html as the server last wrote it, plus the edits made here since, already applied.
 *
 * An edit shows at once: it is applied here with the server's own code (server/ops.mjs), the picture is told, and the
 * edit is sent to be written, one request at a time, each against the revision the last one produced. When the
 * server answers that the film moved on without it (the agent removed the clip), the film here becomes the server's;
 * so it does when the folder's film, once every edit here is written, is not the one here (the agent wrote it a moment
 * before, and the server applied the edit on top). A film.html that cannot be read (the agent is halfway through
 * writing it, or wrote it wrong) is `broken`: the film here stays as it last was, and edits wait for it to be whole.
 *
 * Undo and redo are edits too, worked out by clip id from the film before and after (`inverse`), so undoing a move
 * puts that clip back without putting back what the agent changed meanwhile.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { applyOps, EditError } from '../../../server/ops.mjs';
import { filmHead } from '../../../../src/film-doc.mjs';
import { api, ApiError, projectEvents, type Film, type Op, type ProjectFilm } from '../api';
import { inverse } from './undo';
import { dropStep, inTurn, moveStep, nextStep, pushStep, type Steps } from './steps';

export type FilmState = { value: Film; rev: string };

/**
 * One edit a person made here, undoable: what undoes it, what makes it again, and what to call it in the history.
 * `outside`: an edit of another file than film.html (a subtitle's times, in its transcript), undone and made again by
 * its own calls, which resolve to null or why they could not; its `undo` and `redo` are empty, unless the edit changed
 * film.html too (a layer pasted into a page of its own): then the other file is undone or made again first, and
 * film.html only once it is.
 */
export type Step = { undo: Op[]; redo: Op[]; label: string; at: number; outside?: OutsideStep };
export type OutsideStep = { undo: () => Promise<string | null>; redo: () => Promise<string | null> };

/**
 * The film of a project, editable. `onChange(value, kind, head)` tells the picture: `edit` for an edit made here (try
 * it in place), `server` for the film as the folder has it now (the agent wrote it, or an edit was refused), with its
 * file's head when known (a changed one is the film loaded again: its styles are not in the value).
 */
export function useFilm(projectId: string, initial: FilmState | null, onChange: (value: Film, kind: 'edit' | 'server', head?: string) => void, onRead: (latest: ProjectFilm) => void) {
  const [state, setState] = useState<FilmState | null>(initial);
  const [error, setError] = useState<string | null>(null);
  /** why film.html cannot be read now (null: it can) */
  const [broken, setBroken] = useState<string | null>(null);
  const brokenRev = useRef<string | null>(null);
  /** edits applied here and not yet written */
  const pending = useRef(0);
  const [steps, setStepsState] = useState<Steps<Step>>({ done: [], undone: [] });
  /* the steps as they are now, ahead of the render: an undo pressed right after an edit (a nudge written the moment
     before it) undoes that edit, not the one before */
  const stepsRef = useRef(steps);
  const setSteps = useCallback((next: (s: Steps<Step>) => Steps<Step>) => {
    stepsRef.current = next(stepsRef.current);
    setStepsState(stepsRef.current);
  }, []);
  const ref = useRef(state);
  const queue = useRef(Promise.resolve());
  const changed = useRef(onChange);
  changed.current = onChange;
  const read = useRef(onRead);
  read.current = onRead;
  useEffect(() => { if (initial && !ref.current) { ref.current = initial; setState(initial); } }, [initial]);

  /** Accept a disk snapshot only while it still belongs to this view and no newer edit superseded it. */
  const fromServer = useCallback(async ({ signal, accept = () => true, force = false }: { signal?: AbortSignal; accept?: () => boolean; force?: boolean } = {}) => {
    const latest = await api.film(projectId, signal);
    if (!accept()) return 'stale';
    read.current(latest);
    if (latest.filmMissing || !latest.doc || !latest.value) {
      brokenRev.current = latest.rev;
      setBroken(latest.filmMissing ? null : latest.problems.join('\n') || 'film.html cannot be read');
      return 'broken';
    }
    if (!force && !brokenRev.current && latest.rev === ref.current?.rev) return 'current';
    if (brokenRev.current) { brokenRev.current = null; setBroken(null); setError(null); }
    const next = { value: latest.value, rev: latest.rev };
    ref.current = next;
    setState(next);
    changed.current(next.value, 'server', filmHead(latest.text));
    return 'current';
  }, [projectId]);

  /* One refresh at a time. A transient read failure must not lose the folder's only change event. A read started
     before another change or an optimistic edit is rechecked after it, instead of painting an older timeline. */
  useEffect(() => {
    const life = new AbortController();
    let wanted: { rev?: string; force: boolean } | null = null;
    let reading = false, failures = 0;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const sync = async () => {
      if (reading || retry || !wanted || life.signal.aborted) return;
      reading = true;
      try {
        await queue.current;
        if (life.signal.aborted || pending.current) return;
        const job = wanted;
        wanted = null;
        if (!job.force && job.rev && job.rev === ref.current?.rev && !brokenRev.current) return;
        const before = ref.current;
        try {
          const result = await fromServer({
            signal: AbortSignal.any([life.signal, AbortSignal.timeout(8000)]), force: job.force,
            accept: () => !life.signal.aborted && !wanted && !pending.current && ref.current === before,
          });
          if (result === 'stale') wanted ??= job;
          failures = 0;
        } catch (error) {
          if (life.signal.aborted || wanted || (error instanceof ApiError && [401, 404, 410].includes(error.status))) return;
          if (failures < 4) {
            wanted = job;
            retry = setTimeout(() => { retry = null; void sync(); }, 250 * 2 ** failures++);
          }
        }
      } finally {
        reading = false;
        if (wanted) void sync();
      }
    };
    const request = (rev?: string, force = false) => {
      wanted = { rev, force: force || Boolean(wanted?.force) };
      failures = 0;
      if (retry) { clearTimeout(retry); retry = null; }
      void sync();
    };
    const stop = projectEvents(projectId, (event) => {
      if (event.type === 'film') request(event.rev, !event.rev);
      /* The stream's initial project snapshot comes after the watcher is attached. Catch a write between the
         first HTTP read and that attachment, and recheck when a temporarily missing file is reported. */
      else if (event.type === 'project') request();
      else if (event.type === 'film-missing') { brokenRev.current ??= 'missing'; request(); }
    });
    const visible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('focus', visible);
    return () => {
      life.abort();
      if (retry) clearTimeout(retry);
      stop();
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('focus', visible);
    };
  }, [projectId, fromServer]);

  /**
   * Apply `ops` here at once, then write them. Resolves once written: null, or why it was not (the film here is then
   * the folder's again). Resolves at once with the reason when the film here refuses them.
   */
  /* `quiet`: the caller says why it was refused itself (the inspector, beside its field), so `error` is not set.
     `one`: the step an undo or redo takes, moved to the other list once applied here */
  const run = useCallback((ops: Op[], record: 'do' | 'undo' | 'redo' = 'do', label = 'history.stepEdit', quiet = false, one?: Step, outside?: OutsideStep): Promise<string | null> => {
    const current = ref.current;
    if (!current || !ops.length) return Promise.resolve(null);
    /* film.html cannot be read: the edit could not be written, and shown it would draw the picture again from the
       broken file. Nothing changes; the note on the film already says why (`broken`) */
    if (brokenRev.current) return Promise.resolve(null);
    let after: Film;
    try { after = applyOps(structuredClone(current.value), ops) as Film; }
    catch (e) {
      const why = e instanceof EditError ? e.message : String(e);
      if (!quiet) setError(why);
      return Promise.resolve(why);
    }
    const before = current.value;
    const next = { value: after, rev: current.rev };
    ref.current = next;
    setState(next);
    setError(null);
    changed.current(after, 'edit');
    pending.current += 1;
    const step: Step = { undo: inverse(before, after, ops), redo: ops, label, at: Date.now(), ...(outside ? { outside } : {}) };
    setSteps((s) => (record === 'do' ? pushStep(s, step) : one ? moveStep(s, one, record) : s));
    const written = queue.current.then(async (): Promise<string | null> => {
      let done;
      try {
        done = await api.edit(projectId, ref.current?.rev ?? null, ops, record === 'undo');
        if (typeof done?.rev !== 'string' || !done.value) throw new Error('Studio did not return the saved film.');
      } catch (e) {
        pending.current -= 1;
        const why = e instanceof ApiError ? e.message : String(e);
        /* what was not written is not a step to undo */
        if (record === 'do') setSteps((s) => ({ ...s, done: s.done.filter((x) => x !== step) }));
        const recovered = pending.current ? 'stale' : await fromServer({
          signal: AbortSignal.timeout(8000), accept: () => !pending.current, force: true,
        }).catch(() => 'failed');
        if ((recovered === 'broken' || recovered === 'failed') && !pending.current) {
          /* the folder's film cannot be read: back to the film as it was before this edit (the note on the film says
             why, so it is not said again) */
          ref.current = current;
          setState(current);
          changed.current(current.value, 'server');
          if (recovered === 'broken') return null;
        }
        if (!quiet) setError(why);
        return why;
      }
      pending.current -= 1;
      const here = ref.current;
      if (!here) return null;
      /* Every edit here written: the folder's film is the truth (another write came in under this one). */
      const theirs = pending.current === 0 ? done.value : null;
      if (theirs && (done.rebased || JSON.stringify(theirs) !== JSON.stringify(here.value))) {
        ref.current = { value: theirs, rev: done.rev };
        setState(ref.current);
        changed.current(theirs, 'server', filmHead(done.text));
      } else {
        ref.current = { ...here, rev: done.rev };
        setState(ref.current);
      }
      return null;
    });
    queue.current = written.then(() => {}, () => {});
    return written;
  }, [projectId, fromServer, setSteps]);

  /* a step of another file: moved between the lists at once, its call made in turn with the film's writes; one that
     cannot be undone (the file changed since, elsewhere) leaves both lists, and says why. Resolves once made: true,
     or false when it could not be */
  const runOutside = useCallback((step: Step, kind: 'undo' | 'redo'): Promise<boolean> => {
    setSteps((s) => moveStep(s, step, kind));
    const written = queue.current.then(async () => {
      const why = await step.outside![kind]().catch((e: unknown) => String(e instanceof Error ? e.message : e));
      if (why) {
        setError(why);
        setSteps((s) => dropStep(s, step));
      }
      return !why;
    });
    queue.current = written.then(() => {}, () => {});
    return written;
  }, [setSteps]);
  /* a step of the film: one whose ops cannot be applied or written now (the agent removed its clip since) leaves both
     lists, as one of another file does, so the next undo takes the step before it and the history ends at the oldest.
     Resolves once the next step can be taken: at once for film.html alone, once written for another file. */
  const step = useCallback((one: Step, kind: 'undo' | 'redo'): Promise<void> => {
    const ops = kind === 'undo' ? one.undo : one.redo;
    const drop = (why: string | null) => { if (why) setSteps((s) => dropStep(s, one)); };
    if (one.outside && !ops.length) return runOutside(one, kind).then(() => {});
    /* film.html and another file: the other file first, both ways (it can be refused: written since), film.html only
       once it is written, so the two never disagree */
    if (one.outside) return runOutside(one, kind).then((ok) => (ok ? run(ops, kind).then(drop) : undefined));
    /* nothing to apply (an edit that changed nothing): it only moves */
    if (!ops.length) { setSteps((s) => moveStep(s, one, kind)); return Promise.resolve(); }
    /* applied here at once: the next step can be taken now, its write queued after this one's */
    void run(ops, kind, undefined, false, one).then(drop);
    return Promise.resolve();
  }, [run, runOutside, setSteps]);
  /* undo, redo and the history's jumps one at a time: the next step is looked for once the last one is taken */
  const turn = useRef(inTurn());
  const undo = useCallback(() => {
    void turn.current(() => { const one = nextStep(stepsRef.current, 'undo'); return one ? step(one, 'undo') : undefined; });
  }, [step]);
  const redo = useCallback(() => {
    void turn.current(() => { const one = nextStep(stepsRef.current, 'redo'); return one ? step(one, 'redo') : undefined; });
  }, [step]);
  /** Undo or redo until `done` steps are done (the edit history's rows: click one to go back or forward to it), one
      step after another, each once the one before is taken (a step of another file waits for its write) */
  const rollbackTo = useCallback((done: number) => {
    void turn.current(async () => {
      let { done: d, undone: u } = stepsRef.current;
      const order: Array<[Step, 'undo' | 'redo']> = [];
      while (d.length > done && d.length) { const one = d[d.length - 1]!; order.push([one, 'undo']); u = [...u, one]; d = d.slice(0, -1); }
      while (d.length < done && u.length) { const one = u[u.length - 1]!; order.push([one, 'redo']); d = [...d, one]; u = u.slice(0, -1); }
      for (const [one, kind] of order) await step(one, kind);
    });
  }, [step]);
  /** `outside`: another file this edit changed too, made already; one undo takes both back (see Step). */
  const edit = useCallback((ops: Op[], label?: string, quiet?: boolean, outside?: OutsideStep) => run(ops, 'do', label, quiet, undefined, outside), [run]);
  /** An edit of another file, made already: kept as a step, so ⌘Z undoes it in turn with the film's. */
  const record = useCallback((label: string, outside: OutsideStep) => {
    setSteps((s) => pushStep(s, { undo: [], redo: [], label, at: Date.now(), outside }));
  }, [setSteps]);
  /** The film was replaced as a whole (an earlier version put back): the edits made before are not undone into it. */
  const forget = useCallback(() => setSteps(() => ({ done: [], undone: [] })), [setSteps]);

  return {
    film: state?.value ?? null, rev: state?.rev ?? null, error, broken, edit, record, undo, redo, rollbackTo, forget, steps,
    canUndo: steps.done.length > 0, canRedo: steps.undone.length > 0, settled: () => queue.current,
  };
}
