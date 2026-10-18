/**
 * The picture: the film's timeline page (film.html played by src/timeline.mjs, with Studio's bridge and stage) on the film's own origin,
 * scaled to fit. The editor tells it which moment to draw and what changed; it says when the moment is on screen and
 * what is under a point. The stage (studio/server/stage.js) answers the picture-area
 * editing's questions (`stage`) and tells of an in-place text edit ending and of keys pressed in the picture.
 *
 * An edit is applied to the page in place (a move, a trim, a volume, a tweak, clips added or removed: a split, a
 * paste, a drop, a delete, and another stage size), what it puts on screen made ready out of sight first
 * (src/timeline.mjs); only another head of the film (its styles), a page or file it uses changed on disk, or a clip that cannot load, loads the film again, in a
 * second, hidden frame that replaces the shown one once its first picture is drawn whole (its videos loaded, however
 * long that takes), and is told the edits made meanwhile. Either way the picture never goes black for an edit.
 */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Film } from '../api';
import { useT } from '@/i18n';
import type { ClipSpan } from '@/lib/film-shape';
import type { Anchor, Sound } from './player';
import { pageScaleFor, reloaded, shownAfter, updateKeys, type Frame } from './preview-frames';
import { usePreviewPrefs } from '@/lib/preview-prefs';
import { chromiumBased } from '@/lib/browser';

/** How far the film's frame reaches past the picture's box on each side, in px (see the `stage-frames` clip). */
const BLEED = 1;

export type FilmInfo = { duration: number; width: number; height: number; sounds: Sound[]; spans: ClipSpan[] };
/** What is selected in the picture: an element of a page (named by selector and match), or a whole clip. */
export type Target = {
  clip: string; kind: 'element' | 'page' | 'video' | 'still'; quad: [number, number][];
  at?: string; n?: number; tag?: string; text?: string | null; style?: Record<string, string>;
};
export type PreviewHandle = {
  /** Show the still moment t (the film stops playing). */
  seek(t: number): void;
  /** Play on this line (the player's, on this page's clock): the film draws its own frames from it until `seek`. */
  play?(anchor: Anchor): void;
  /** Stretches rendered to play in place of the film while it plays (studio/server/preview-cache.mjs); [] none. */
  renders?(list: PreviewRender[]): void;
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

/** A stretch of the film rendered into a video (film seconds [a, b)), played in its place while the film plays. */
export type PreviewRender = { a: number; b: number; src: string };
/**
 * How playing went, about once a second over `ms` (studio/server/bridge.js `played`): refreshes the screen had while
 * playing, the film's frames drawn, how many refreshes got no new frame (`late`), whether a render played, and per half
 * second of film [its start, refreshes, late].
 */
export type PlayedReport = { frames: number; drawn: number; late: number; rendered: boolean; ms: number; spans: [number, number, number][] };

/**
 * What the film's stage tells on its own: the words of an in-place text edit as they are typed, the edit ended
 * (`commit` with the new words), a key pressed while the picture had focus (not while typing in it), or another load
 * of the film is shown (its handles are new).
 */
export type StageEvent =
  | { event: 'typing'; handle: number; value: string }
  /* `hold`: what kept the other layers in place as the words were typed (style for the same override, null takes a key away) */
  | { event: 'text'; handle: number; commit: boolean; value?: string; before?: string; hold?: Record<string, string | null> }
  | { event: 'key'; key: KeyboardEvent }
  | { event: 'reset' };

type Props = {
  folder: string;
  stage: { w: number; h: number };
  /** where the film is: a loaded page draws its first frame there */
  time: () => number;
  /** the film's frame rate (frames a second, 29.97 as 30000/1001): playing draws each of its frames, none between */
  fps?: number;
  onInfo(info: FilmInfo): void;
  /**
   * A key pressed while the picture had focus (key events do not cross documents), after the stage's own listeners
   * had it: `defaultPrevented` when one of them used it. The web page already kept the browser's own action for the
   * keys the editor handles (Space, arrows, Home/End, ⌘Z/⇧⌘Z, [ ], ⇧⌘H, ⇧⌘L).
   */
  onKey?(e: KeyboardEvent): void;
  /** The film could not be drawn (the message), or it is drawn again (null). */
  onError?(message: string | null): void;
  /** How playing went, about once a second while it plays. */
  onPlayed?(report: PlayedReport): void;
  children?: ReactNode;
};

/** Clock readings asked of a frame as it comes up: the one answered soonest says best where its clock is. */
const CLOCK_PINGS = 5;
/** How long the viewer keeps another size before the film is loaded again for it (ms): not at each step of a drag. */
const RESCALE_MS = 600;

export const Preview = forwardRef<PreviewHandle, Props>(function Preview({ folder, stage, time, fps, onInfo, onKey, onError, onPlayed, children }, ref) {
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
  /* the viewer measured once: the film loads only then, its pages drawn for that size (see pageScale) */
  const [measured, setMeasured] = useState(false);
  /*
   * The device pixels a page draws per CSS px (its devicePixelRatio, `film-dpr` in the film's address, see
   * studio/server/pages.mjs): what the viewer shows, not the film's full size scaled down, while that switch is on;
   * null: the screen's own. A load of the film keeps the scale it was made with; another one, kept a moment, loads
   * the film again behind the picture.
   */
  const { fitPages } = usePreviewPrefs();
  const pageScale = fitPages && fit.w > 0 ? pageScaleFor(fit.k, window.devicePixelRatio || 1) : null;
  const scaleOf = useRef(new Map<number, number | null>());
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
  const onPlayedRef = useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  /* the stretches rendered to play in the film's place: told to each load of the film once it is up */
  const rendered = useRef<PreviewRender[]>([]);
  useEffect(() => { onErrorRef.current?.(failed); }, [failed]);

  const post = (key: number | undefined, message: object) => {
    if (key == null) return;
    elements.current.get(key)?.contentWindow?.postMessage({ source: 'openfilm-studio', ...message }, origin);
  };
  /*
   * Playing: the line the film plays on (null while still), told to the frame shown, and to a frame that comes up
   * meanwhile once it shows. The line is on this page's clock; each frame's clock starts elsewhere (another document,
   * another process), so each is told it on its own: by how far its clock is from this one, read with a few pings and
   * taken from the one answered soonest (the time a message takes is the error, a fraction of a millisecond).
   */
  const line = useRef<Anchor | null>(null);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const clocks = useRef(new Map<number, { offset: number; rtt: number }>());
  const tellPlay = (key: number | undefined) => {
    const a = line.current;
    if (key == null || !a) return;
    const offset = clocks.current.get(key)?.offset ?? 0;
    post(key, { type: 'play', t: a.t, at: a.at + offset, rate: a.rate, fps: fpsRef.current ?? 0 });
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
  /* one ref callback a frame keeps for its life: a new one each render would be called with null on every render,
     and drop the clock, scale and readiness measured for a frame still on screen */
  const refs = useRef(new Map<number, (el: HTMLIFrameElement | null) => void>());
  const refOf = (key: number) => {
    let ref = refs.current.get(key);
    if (!ref) {
      ref = (el) => {
        if (el) { elements.current.set(key, el); return; }
        elements.current.delete(key); up.current.delete(key); clocks.current.delete(key); scaleOf.current.delete(key); refs.current.delete(key);
      };
      refs.current.set(key, ref);
    }
    return ref;
  };
  /** load the film again behind the picture (its structure changed, or the folder's film was replaced) */
  const reload = () => setFrames((list) => {
    const next = reloaded(list);
    born.current.set(next[next.length - 1].key, updates.current);
    return next;
  });

  useImperativeHandle(ref, () => ({
    seek(t) {
      line.current = null;
      post(shownRef.current?.key, { type: 'seek', t, seq: ++seq.current });
    },
    play(anchor) {
      line.current = { ...anchor };
      tellPlay(shownRef.current?.key);
    },
    renders(list) {
      rendered.current = list;
      for (const key of up.current) post(key, { type: 'renders', list });
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
        if (rendered.current.length) post(key, { type: 'renders', list: rendered.current });
        /* where its clock is: first by where each clock started, then by pings */
        if (Number(m.origin) > 0) clocks.current.set(key, { offset: performance.timeOrigin - Number(m.origin), rtt: Infinity });
        for (let i = 0; i < CLOCK_PINGS; i++) setTimeout(() => post(key, { type: 'clock', ping: performance.now() }), 40 * i);
        /* the film changed here while this frame was loading: it gets the latest before its first picture */
        if ((born.current.get(key) ?? 0) < updates.current && latest.current) post(key, { type: 'update', film: latest.current, head: latestHead.current, seq: ++seq.current });
        /* behind the picture shown: its first picture is waited for whole (its videos loaded), as it replaces that one */
        const behind = shownRef.current != null && shownRef.current.key !== key;
        post(key, { type: 'seek', t: time(), seq: ++seq.current, ...(behind ? { behind: true } : {}) });
      } else if (m.type === 'played') {
        if (key === shownRef.current?.key) {
          onPlayedRef.current?.({ frames: Number(m.frames), drawn: Number(m.drawn) || 0, late: Number(m.late), rendered: Boolean(m.rendered), ms: Number(m.ms), spans: Array.isArray(m.spans) ? m.spans : [] });
        }
      } else if (m.type === 'clock') {
        const back = performance.now();
        const rtt = back - Number(m.ping);
        const had = clocks.current.get(key);
        if (!(rtt >= 0) || (had && had.rtt <= rtt)) return;
        clocks.current.set(key, { offset: Number(m.now) - (Number(m.ping) + rtt / 2), rtt });
        /* playing on it: told the line again, on its clock as now read */
        if (line.current && key === shownRef.current?.key) tellPlay(key);
      } else if (m.type === 'seeked') {
        const swap = !framesRef.current.find((f) => f.key === key)?.ready;
        setFrames((list) => shownAfter(list, key));
        /* shown now: the film playing, it plays on from the line; still, the playhead may have moved while it drew,
           and seeks went to the frame shown then */
        if (swap && line.current) tellPlay(key);
        else if (swap && Math.abs(time() - Number(m.t)) > 1e-6) post(key, { type: 'seek', t: time(), seq: ++seq.current });
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
        } else if (m.event === 'typing') {
          tell({ event: 'typing', handle: Number(m.handle), value: String(m.value ?? '') });
        } else if (m.event === 'text') {
          tell({
            event: 'text', handle: Number(m.handle), commit: Boolean(m.commit),
            ...(typeof m.value === 'string' ? { value: m.value, before: String(m.before ?? '') } : {}),
            ...(m.hold && typeof m.hold === 'object' ? { hold: m.hold as Record<string, string | null> } : {}),
          });
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
    const size = (width: number, height: number) => {
      const k = Math.max(0.01, Math.min(width / stage.w, height / stage.h));
      setFit({ w: Math.floor(stage.w * k), h: Math.floor(stage.h * k), k });
    };
    /* measured now, before the first picture: the film loads once, for this size */
    if (el.clientWidth > 0 && el.clientHeight > 0) size(el.clientWidth, el.clientHeight);
    setMeasured(true);
    const observer = new ResizeObserver(([entry]) => size(entry.contentRect.width, entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [stage.w, stage.h]);

  /* a load keeps the scale it was made with */
  if (measured) for (const f of frames) if (!scaleOf.current.has(f.key)) scaleOf.current.set(f.key, pageScale);
  /* the viewer kept another size (fullscreen, a pane resized), or the switch changed: the film loads again behind */
  const shownScale = shown ? scaleOf.current.get(shown.key) : undefined;
  useEffect(() => {
    if (!shown || shownScale === undefined || shownScale === pageScale || frames.some((f) => !f.ready)) return undefined;
    const timer = setTimeout(reload, RESCALE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageScale, shownScale, shown?.key, frames.length]);

  const error = failed;
  return (
    <div className="stage-box" ref={box}>
      <div className="stage" style={{ width: fit.w, height: fit.h }}>
        {/* the frames, clipped to the picture's whole-px box; each reaches BLEED px past it on every side, so the edge
            of a frame (a part of a device px a browser rounds its own way, a backdrop it paints under the film) is
            never on screen as a line along the picture */}
        <div className="stage-frames">
        {(measured ? frames : []).map((f) => (
          <iframe
            key={f.key}
            ref={refOf(f.key)}
            /* `film-missing=skip`: a clip whose file is not there keeps its time and plays as nothing, the rest plays on
               (src/timeline.mjs); the timeline marks it and offers to relink it */
            src={`${folder}film.html?load=${f.key}&film-missing=skip${scaleOf.current.get(f.key) != null ? `&film-dpr=${scaleOf.current.get(f.key)}` : ''}`}
            /* the film's videos play when the person presses play here: another origin needs this to be allowed */
            allow="autoplay"
            scrolling="no"
            title="film"
            /* the one loading is transparent, not hidden: the film is on another site, in a process of its own, and a
               frame hidden from there is not drawn at all, so a page that waits to draw (an image's decode()) would
               never be ready */
            style={{
              width: stage.w, height: stage.h,
              transform: `translate(${-BLEED}px, ${-BLEED}px) scale(${(fit.w + 2 * BLEED) / stage.w}, ${(fit.h + 2 * BLEED) / stage.h})`,
              ...(f === shown ? {} : { opacity: 0, pointerEvents: 'none' }),
            }}
          />
        ))}
        </div>
        {shown && !error ? children : null}
        {!shown && !error ? <div className="cover"><span role="status" className="text-sweep">{t('project.previewStageMount')}</span></div> : null}
        {error ? (
          <div className="cover" role="alert">
            <div className="max-w-[420px] text-[13px] leading-relaxed text-white/70">
              <p>{t('project.previewFailed')}</p>
              {/* in Safari or Firefox the likely reason is the browser: films are drawn and exported in Chromium */}
              {!chromiumBased() ? <p className="mt-1.5">{t('project.previewBrowser')}</p> : null}
              <p className="mt-1.5 text-[11.5px] text-white/45">{error}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
