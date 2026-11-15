/**
 * The grade worker (grade-worker.ts) from the page: one for the workbench's life, asked for the newest picture only
 * (what is asked while it works waits, and is replaced by what is asked after it), and the colors under the pointer.
 */
import * as React from 'react';
import type { Grade } from '../../../../../plugins/color/engine/grade.mjs';
import type { FromWorker, Picked, Rendered, Scope, ToWorker } from './grade-worker';

export interface Shot {
  w: number;
  h: number;
  graded: ImageData;
  original: ImageData | null;
  scopes: Rendered['scopes'];
  ms: number;
  missing: string[];
}

export interface Grader {
  /** the picture as graded now, and the footage it was graded from */
  shot: Shot | null;
  /** a frame of the footage to grade: 16-bit RGB */
  setFrame(w: number, h: number, data: ArrayBuffer): void;
  /** LUT files, by path, as their text */
  addLuts(luts: Record<string, string>): void;
  render(grade: Grade, o: { others: string[]; draft: boolean; key: number | null; scopes: Scope[] }): void;
  pick(x: number, y: number): Promise<Picked>;
  whiteAt(grade: Grade, x: number, y: number): Promise<{ white: number; tint: number }>;
}

export function useGrader(): Grader {
  const worker = React.useRef<Worker | null>(null);
  const [shot, setShot] = React.useState<Shot | null>(null);
  const busy = React.useRef(false);
  const waiting = React.useRef<Extract<ToWorker, { type: 'render' }> | null>(null);
  const seq = React.useRef(0);
  const asks = React.useRef(new Map<number, (m: FromWorker) => void>());
  const original = React.useRef<ImageData | null>(null);

  React.useEffect(() => {
    const w = new Worker(new URL('./grade-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === 'rendered') {
        busy.current = false;
        if (m.original) original.current = new ImageData(new Uint8ClampedArray(m.original), m.w, m.h);
        setShot({ w: m.w, h: m.h, graded: new ImageData(new Uint8ClampedArray(m.graded), m.w, m.h), original: original.current, scopes: m.scopes, ms: m.ms, missing: m.missing });
        const next = waiting.current;
        waiting.current = null;
        if (next) { busy.current = true; w.postMessage(next); }
        return;
      }
      const done = asks.current.get(m.seq);
      if (done) { asks.current.delete(m.seq); done(m); }
    };
    return () => { w.terminate(); worker.current = null; };
  }, []);

  return React.useMemo<Grader>(() => ({
    get shot() { return shot; },
    setFrame(w, h, data) {
      original.current = null;
      worker.current?.postMessage({ type: 'frame', w, h, data } satisfies ToWorker, [data]);
    },
    addLuts(luts) { worker.current?.postMessage({ type: 'luts', luts } satisfies ToWorker); },
    render(grade, o) {
      const m: Extract<ToWorker, { type: 'render' }> = { type: 'render', seq: ++seq.current, grade, ...o };
      if (busy.current) { waiting.current = m; return; }
      busy.current = true;
      worker.current?.postMessage(m);
    },
    pick(x, y) {
      return new Promise((done) => {
        const s = ++seq.current;
        asks.current.set(s, (m) => done(m as Picked));
        worker.current?.postMessage({ type: 'pick', seq: s, x, y } satisfies ToWorker);
      });
    },
    whiteAt(grade, x, y) {
      return new Promise((done) => {
        const s = ++seq.current;
        asks.current.set(s, (m) => { const r = m as Extract<FromWorker, { type: 'whitened' }>; done({ white: r.white, tint: r.tint }); });
        worker.current?.postMessage({ type: 'white', seq: s, grade, x, y } satisfies ToWorker);
      });
    },
  }), [shot]);
}
