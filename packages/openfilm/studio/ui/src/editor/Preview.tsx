/**
 * The picture: the film's timeline page (film.html played by src/timeline.mjs, with Studio's bridge and stage) on the film's own origin,
 * scaled to fit. The editor tells it which moment to draw and what changed; it says when the moment is on screen and
 * what is under a point. The stage (studio/server/stage.js) answers the picture-area
 * editing's questions (`stage`) and tells of an in-place text edit ending and of keys pressed in the picture.
 *
 * An edit is applied to the page in place (a move, a trim, a volume, a tweak, and clips added or removed: a split, a
 * paste, a drop, a delete), what it puts on screen made ready out of sight first (src/timeline.mjs); only another stage
 * or head of the film, a page or file it uses changed on disk, or a clip that cannot load, loads the film again, in a
 * second, hidden frame that replaces the shown one once its first picture is drawn whole (its videos loaded, however
 * long that takes), and is told the edits made meanwhile. Either way the picture never goes black for an edit.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Film } from '../api';
import { useT } from '@/i18n';
import type { ClipSpan } from '@/lib/film-shape';
import type { Sound } from './player';
import { reloaded, shownAfter, updateKeys, type Frame } from './preview-frames';

export type FilmInfo = { duration: number; width: number; height: number; sounds: Sound[]; spans: ClipSpan[] };
/** What is selected in the picture: an element of a page (named by selector and match), or a whole clip. */
export type Target = {
  clip: string; kind: 'element' | 'page' | 'video' | 'still'; quad: [number, number][];
  at?: string; n?: number; tag?: string; text?: string | null; style?: Record<string, string>;
};
export type PreviewHandle = {
  seek(t: number): void;
  update(film: Film, head?: string): void;
  preview(clip: string, overrides: unknown[] | null): void;
  pick(x: number, y: number): Promise<Target | null>;
  /*
   * The stage's part (optional so a handle that only forwards the calls above, such as a steady wrapper, still is one;
   * Preview's own handle has them all).
   */
  /** Ask the film's stage (an op of studio/server/stage.js); null when nothing is there or it does not answer. */
  stage?<T = unknown>(op: string, args?: object): Promise<T | null>;
  /** Hear the stage's events; returns the way to stop. */
  onStage?(listener: (e: StageEvent) => void): () => void;
  /** The frame showing the film now: its box is the picture's. */
  frame?(): HTMLIFrameElement | null;
  /** Move focus into the picture (an in-place text edit types there). */
  focus?(): void;
  /** Load the film again behind the picture (a page or a file it uses changed on disk). */
  reload?(): void;
};

/**
 * What the film's stage tells on its own: an in-place text edit ended (`commit` with the new words), a key pressed
 * while the picture had focus (not while typing in it), or another load of the film is shown (its handles are new).
 */
export type StageEvent =
  | { event: 'text'; handle: number; commit: boolean; value?: string; before?: string }
  | { event: 'key'; key: KeyboardEvent }
  | { event: 'reset' };

type Props = {
  folder: string;
  stage: { w: number; h: number };
  /** where the film is: a loaded page draws its first frame there */
  time: () => number;
  onInfo(info: FilmInfo): void;
  /**
   * A key pressed while the picture had focus (key events do not cross documents), after the stage's own listeners
   * had it: `defaultPrevented` when one of them used it. The web page already kept the browser's own action for the
   * keys the editor handles (Space, arrows, Home/End, ⌘Z/⇧⌘Z, [ ], ⇧⌘H, ⇧⌘L).
   */
  onKey?(e: KeyboardEvent): void;
  /** The film could not be drawn (the message), or it is drawn again (null). */
  onError?(message: string | null): void;
  children?: ReactNode;
};

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ folder, stage, time, onInfo, onKey, onError, children }, ref) {
  const t = useT();
  const origin = new URL(folder).origin;
  const [frames, setFrames] = useState<Frame[]>([{ key: 1, ready: false }]);
  const elements = useRef(new Map<number, HTMLIFrameElement>());
  const seq = useRef(0);
  const picks = useRef(new Map<number, (target: Target | null) => void>());
  const asks = useRef(new Map<number, (result: unknown) => void>());
  const listeners = useRef(new Set<(e: StageEvent) => void>());
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0, k: 1 });
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const shown = frames.find((f) => f.ready) ?? null;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  /** what failed in the frame being loaded, else in the one shown */
  const failed = (frames.find((f) => !f.ready) ?? shown)?.error ?? null;
  const failedRef = useRef(failed);
  failedRef.current = failed;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => { onErrorRef.current?.(failed); }, [failed]);

  const post = (key: number | undefined, message: object) => {
    if (key == null) return;
    elements.current.get(key)?.contentWindow?.postMessage({ source: 'openfilm-studio', ...message }, origin);
  };
  /*
   * A frame loads film.html as the folder has it when it starts; the films given since (`update`) are kept, and a frame
   * that comes up after some is given the latest, so a load in progress never misses an edit.
   */
  const updates = useRef(0);
  const latest = useRef<Film | null>(null);
  /* the film file's head as last told (its styles): a frame loaded with another one is loaded again */
  const latestHead = useRef<string | undefined>(undefined);
  const born = useRef(new Map<number, number>());
  /* the frames whose film said it is ready: each is told every edit from then on, the one loading behind too (it is
     shown next, and must not come up without the edits made while it drew its first picture) */
  const up = useRef(new Set<number>());
  /** load the film again behind the picture (its structure changed, or the folder's film was replaced) */
  const reload = () => setFrames((list) => {
    const next = reloaded(list);
    born.current.set(next[next.length - 1].key, updates.current);
    return next;
  });

  useImperativeHandle(ref, () => ({
    seek(t) {
      post(shownRef.current?.key, { type: 'seek', t, seq: ++seq.current });
    },
    update(film, head) {
      updates.current += 1;
      latest.current = film;
      if (head != null) latestHead.current = head;
      /* a film that failed is loaded again as it is now, rather than changed in place */
      if (!shownRef.current || failedRef.current) { reload(); return; }
      for (const key of updateKeys(shownRef.current.key, up.current)) post(key, { type: 'update', film, head: latestHead.current, seq: ++seq.current });
    },
    preview(clip, overrides) {
      post(shownRef.current?.key, { type: 'preview', clip, overrides });
    },
    pick(x, y) {
      const key = shownRef.current?.key;
      if (key == null) return Promise.resolve(null);
      const id = ++seq.current;
      return new Promise((resolve) => {
        picks.current.set(id, resolve);
        post(key, { type: 'pick', x, y, seq: id });
        setTimeout(() => { if (picks.current.delete(id)) resolve(null); }, 1500);
      });
    },
    stage<T>(op: string, args: object = {}): Promise<T | null> {
      const key = shownRef.current?.key;
      if (key == null) return Promise.resolve(null);
      const id = ++seq.current;
      return new Promise<T | null>((resolve) => {
        asks.current.set(id, resolve as (result: unknown) => void);
        post(key, { type: 'stage', op, ...args, seq: id });
        setTimeout(() => { if (asks.current.delete(id)) resolve(null); }, 1500);
      });
    },
    onStage(listener) {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
    frame: () => elements.current.get(shownRef.current?.key ?? -1) ?? null,
    reload,
    focus() {
      const el = elements.current.get(shownRef.current?.key ?? -1);
      el?.focus();
      el?.contentWindow?.focus();
    },
  }), []);

  const tell = (e: StageEvent) => { for (const listener of [...listeners.current]) listener(e); };
  /* another load of the film is shown: what the stage named in the old one is gone */
  const shownKey = shown?.key;
  const firstShown = useRef(true);
  useEffect(() => {
    if (shownKey == null) return;
    if (firstShown.current) { firstShown.current = false; return; }
    tell({ event: 'reset' });
  }, [shownKey]);

  /* the folder (a project) changed: start over */
  useEffect(() => {
    updates.current = 0;
    latest.current = null;
    born.current.clear();
    up.current.clear();
    setFrames([{ key: 1, ready: false }]);
  }, [folder]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== origin || e.data?.source !== 'openfilm-film') return;
      const key = [...elements.current].find(([, el]) => el.contentWindow === e.source)?.[0];
      if (key == null) return;
      const m = e.data;
      if (m.type === 'ready') {
        onInfo(m as FilmInfo);
        up.current.add(key);
        /* the film changed here while this frame was loading: it gets the latest before its first picture */
        if ((born.current.get(key) ?? 0) < updates.current && latest.current) post(key, { type: 'update', film: latest.current, head: latestHead.current, seq: ++seq.current });
        /* behind the picture shown: its first picture is waited for whole (its videos loaded), as it replaces that one */
        const behind = shownRef.current != null && shownRef.current.key !== key;
        post(key, { type: 'seek', t: time(), seq: ++seq.current, ...(behind ? { behind: true } : {}) });
      } else if (m.type === 'seeked') {
        const swap = !framesRef.current.find((f) => f.key === key)?.ready;
        setFrames((list) => shownAfter(list, key));
        /* shown now: the playhead may have moved while it drew, and seeks went to the frame shown then */
        if (swap && Math.abs(time() - Number(m.t)) > 1e-6) post(key, { type: 'seek', t: time(), seq: ++seq.current });
      } else if (m.type === 'updated') {
        if (m.inPlace) onInfo(m as FilmInfo);
        else reload();
      } else if (m.type === 'picked') {
        const resolve = picks.current.get(m.seq);
        picks.current.delete(m.seq);
        resolve?.(m.target ?? null);
      } else if (m.type === 'stage') {
        const resolve = asks.current.get(m.seq);
        asks.current.delete(m.seq);
        resolve?.(m.result ?? null);
      } else if (m.type === 'stage-event') {
        if (key !== shownRef.current?.key) return;
        if (m.event === 'key') {
          const key = new KeyboardEvent('keydown', {
            key: String(m.key), code: String(m.code), repeat: Boolean(m.repeat), metaKey: Boolean(m.metaKey),
            ctrlKey: Boolean(m.ctrlKey), shiftKey: Boolean(m.shiftKey), altKey: Boolean(m.altKey), cancelable: true,
          });
          tell({ event: 'key', key });
          onKeyRef.current?.(key);
        } else if (m.event === 'text') {
          tell({ event: 'text', handle: Number(m.handle), commit: Boolean(m.commit), ...(typeof m.value === 'string' ? { value: m.value, before: String(m.before ?? '') } : {}) });
        }
      } else if (m.type === 'error') {
        setFrames((list) => list.map((f) => (f.key === key ? { ...f, error: String(m.message) } : f)));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  /* the picture fits the viewer, whatever its shape */
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const k = Math.max(0.01, Math.min(width / stage.w, height / stage.h));
      setFit({ w: Math.floor(stage.w * k), h: Math.floor(stage.h * k), k });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage.w, stage.h]);

  const error = failed;
  return (
    <div className="stage-box" ref={box}>
      <div className="stage" style={{ width: fit.w, height: fit.h }}>
        {frames.map((f) => (
          <iframe
            key={f.key}
            ref={(el) => { if (el) elements.current.set(f.key, el); else { elements.current.delete(f.key); up.current.delete(f.key); } }}
            src={`${folder}film.html?load=${f.key}`}
            /* the film's videos play when the person presses play here: another origin needs this to be allowed */
            allow="autoplay"
            scrolling="no"
            title="film"
            /* the one loading is transparent, not hidden: the film is on another site, in a process of its own, and a
               frame hidden from there is not drawn at all, so a page that waits to draw (an image's decode()) would
               never be ready */
            style={{ width: stage.w, height: stage.h, transform: `scale(${fit.k})`, ...(f === shown ? {} : { opacity: 0, pointerEvents: 'none' }) }}
          />
        ))}
        {shown && !error ? children : null}
        {!shown && !error ? <div className="cover"><span role="status" className="text-sweep">{t('project.previewStageMount')}</span></div> : null}
        {error ? (
          <div className="cover" role="alert">
            <div className="max-w-[420px] text-[13px] leading-relaxed text-white/70">
              <p>{t('project.previewFailed')}</p>
              <p className="mt-1.5 text-[11.5px] text-white/45">{error}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
