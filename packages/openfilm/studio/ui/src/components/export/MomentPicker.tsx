/**
 * Picking the moments an image or slides export takes (lib/export-moments): the film drawn large at one moment, a strip
 * of the film to find it on, and the frames picked so far, each drawn as it will come out (the frame and fill chosen
 * beside it).
 *
 * The strip zooms and scrolls as the timeline does (Ctrl/⌘ + wheel or a pinch around the pointer, a sideways swipe or
 * Shift + wheel to scroll, the zoom bar under it), down to a second across. Pointer gestures only find a moment;
 * adding one requires the Add frame button or Enter. The frames picked are not all marked on it: the one selected below shows its dot there, to be dragged.
 *
 * Every picture is the server's (pageframes.mjs), the film drawn as an export draws it, so what is seen here is what is
 * exported, burned subtitles aside. The server draws one frame at a time, a second or more each for a film with
 * footage, so the pictures are asked for one at a time here too, the large one first (the latest moment only: scrubbing
 * never queues every frame passed over), then the strip in sight, nearest the moment shown first, then the frames
 * picked. All are drawn at one width, so a frame picked from the large picture is not drawn again.
 */
import { Check, Loader2, MoveHorizontal, Plus, X, ZoomIn, ZoomOut } from 'lucide-react';
import React from 'react';

import { useT } from '@/i18n';
import { ContextMenu, type ContextMenuEntry } from '@/components/ContextMenu';
import {
  STRIP_WHOLE, clampView, cleanMoments, everyCount, everyMoments, filmFrameUrl, momentAt, sameFrame, sceneMiddles, stepFor, stripZoomMax,
  viewShowing, zoomView, type StripView,
} from '@/lib/export-moments';
import { filmFrameBox, type FilmFrameBox, type FilmFrameFill, type FilmFrameId } from '@/lib/film-frame';
import { formatRulerLabel, formatTimecode, stepFrames } from '@/lib/timecode';

/** How wide every picture is drawn: the large one's width, the others shown smaller. */
const FRAME_W = 960;
const STRIP_H = 56;
/** How long a cell of the strip may be (ms): the shortest at least a cell's width across. */
const CELL_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];
/** How far apart the ruler's labels may be (ms): the closest at least TICK_PX apart. */
const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000, 3_600_000];
const TICK_PX = 72;
/** The intervals "every few seconds" offers. */
const EVERY_SECONDS = [1, 2, 3, 5, 10, 15, 30, 60];

export interface MomentPickerProps {
  projectId: string;
  totalMs: number;
  fps: number;
  stage: { w: number; h: number };
  frame: FilmFrameId;
  fill: FilmFrameFill;
  /** The picture clips, for "the middle of each scene". */
  scenes: readonly { startMs: number; durMs: number }[];
  /** The markers on the film (ms). */
  markersMs: readonly number[];
  playheadMs?: number | undefined;
  value: readonly number[];
  onChange: (list: number[]) => void;
  max: number;
  /** A line under the strip (what the pictures leave out). */
  note?: string | undefined;
}

export function MomentPicker(props: MomentPickerProps) {
  const { projectId, totalMs, fps, value, onChange, max } = props;
  const t = useT();
  const box = React.useMemo(() => filmFrameBox(props.stage, props.frame, props.fill), [props.stage, props.frame, props.fill]);
  const playhead = props.playheadMs != null && props.playheadMs > 0 && props.playheadMs < totalMs ? momentAt(props.playheadMs, totalMs, fps) : null;
  const [cursor, setCursor] = React.useState(() => value[0] ?? playhead ?? momentAt(totalMs / 2, totalMs, fps));
  /** the frame picked that is selected (its dot shows on the strip), if it is still picked */
  const [selectedMs, setSelected] = React.useState<number | null>(null);
  const selected = selectedMs != null && value.some((m) => sameFrame(m, selectedMs, fps)) ? selectedMs : null;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const picked = value.some((m) => sameFrame(m, cursor, fps));
  const full = value.length >= max;

  /* what the strip shows, and how wide it is */
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  const [stripW, setStripW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setStripW(el.clientWidth));
    ro.observe(el);
    setStripW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [view, setViewRaw] = React.useState<StripView>(STRIP_WHOLE);
  const setView = React.useCallback((v: StripView) => setViewRaw(clampView(v, totalMs)), [totalMs]);
  const span = totalMs / view.zoom;
  const msPerPx = stripW > 0 ? span / stripW : 1;

  /* the cells in sight: a cell is a step of the film long, at least a picture's width across */
  const cellStep = stepFor(msPerPx, STRIP_H * (props.stage.w / Math.max(1, props.stage.h)), CELL_STEPS);
  const cells = React.useMemo(() => {
    if (!(stripW > 0)) return [];
    const out: { at: number; ms: number }[] = [];
    for (let k = Math.floor(view.start / cellStep); k * cellStep < Math.min(totalMs, view.start + span); k++) {
      out.push({ at: k * cellStep, ms: momentAt(k * cellStep + cellStep / 2, totalMs, fps) });
    }
    return out;
  }, [stripW, view.start, span, cellStep, totalMs, fps]);

  const url = (ms: number) => filmFrameUrl(projectId, ms, FRAME_W);
  const frames = useFrames([
    url(cursor),
    ...[...cells].sort((a, b) => Math.abs(a.ms - cursor) - Math.abs(b.ms - cursor)).map((c) => url(c.ms)),
    ...value.map(url),
  ]);

  /** the moment shown, the strip scrolled to it when it is out of sight */
  const goTo = (ms: number) => {
    setCursor(ms);
    setView(viewShowing(view, ms, totalMs));
  };
  const set = (list: number[]) => {
    onChange(list);
    setSelected(null);
    if (list.length && !list.some((m) => sameFrame(m, cursor, fps))) goTo(list[0]!);
  };
  /** Confirmation is idempotent: adding an already-picked frame never removes it. */
  const add = (ms: number) => {
    const at = momentAt(ms, totalMs, fps);
    if (value.some((m) => sameFrame(m, at, fps))) { setSelected(at); return; }
    if (full) return;
    onChange(cleanMoments([...value, at], totalMs, fps, max));
    setSelected(at);
  };
  const remove = (ms: number) => {
    onChange(value.filter((m) => !sameFrame(m, ms, fps)));
    if (selected != null && sameFrame(selected, ms, fps)) setSelected(null);
  };
  const move = (from: number, to: number) => {
    onChange(cleanMoments(value.map((m) => (sameFrame(m, from, fps) ? to : m)), totalMs, fps, max));
    setSelected(to);
    goTo(to);
  };
  const focus = () => rootRef.current?.focus({ preventScroll: true });

  const onKey = (e: React.KeyboardEvent) => {
    // Buttons and fields keep their own keyboard behavior; Enter confirms the strip's preview only.
    if (e.defaultPrevented || e.nativeEvent.isComposing || (e.target as Element).closest('button,input,select,textarea,[contenteditable]')) return;
    const step = (from: number, dir: 1 | -1) => (e.shiftKey ? momentAt(from + dir * 1000, totalMs, fps) : momentAt(stepFrames(from, dir, fps), totalMs, fps));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      /* Alt moves the frame selected; the arrows alone, the moment shown */
      if (e.altKey && selected != null) move(selected, step(selected, dir));
      else { goTo(step(cursor, dir)); if (selected != null && !sameFrame(selected, cursor, fps)) setSelected(null); }
    } else if (e.key === 'Enter') add(cursor);
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selected != null) remove(selected);
      else if (picked) remove(cursor);
      else return;
    } else if (e.key === 'Home' || e.key === 'End') goTo(momentAt(e.key === 'Home' ? 0 : totalMs, totalMs, fps));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  /* "every few seconds": the intervals that give more than one frame and no more than the most */
  const [everyMenu, setEveryMenu] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const everyRef = React.useRef<HTMLButtonElement | null>(null);
  const everyItems: ContextMenuEntry[] = EVERY_SECONDS
    .map((s) => ({ s, n: everyCount(s * 1000, totalMs) }))
    .filter(({ n }) => n > 1 && n <= max)
    .map(({ s, n }) => ({
      id: String(s),
      label: t('exportCenter.moments.everyN').replace('{s}', String(s)).replace('{n}', String(n)),
      onSelect: () => set(everyMoments(s * 1000, totalMs, fps, max)),
    }));
  const markers = React.useMemo(() => cleanMoments(props.markersMs, totalMs, fps, max), [props.markersMs, totalMs, fps, max]);

  const quick = 'h-7 rounded-full border border-[var(--border)] px-3 text-[12px] font-medium text-[var(--text-muted)] transition hover:border-[var(--text-faint)] hover:text-[var(--text)]';
  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKey} className="flex min-w-0 flex-col gap-3 outline-none">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{t('exportCenter.moments.quick')}</span>
        {playhead != null && <button type="button" className={quick} onClick={() => set([playhead])}>{t('exportCenter.moments.playhead')}</button>}
        <button type="button" className={quick} onClick={() => set(sceneMiddles(props.scenes, totalMs, fps, max))}>{t('exportCenter.moments.scenes')}</button>
        {markers.length > 0 && <button type="button" className={quick} onClick={() => set(markers)}>{t('exportCenter.moments.markers')}</button>}
        {everyItems.length > 0 && (
          <button
            ref={everyRef}
            type="button"
            className={quick}
            onClick={(e) => {
              if (everyMenu) { setEveryMenu(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              setEveryMenu({ x: r.left, y: r.bottom + 4, top: r.top - 4 });
            }}
          >
            {t('exportCenter.moments.every')}
          </button>
        )}
      </div>

      <Preview frames={frames} url={url(cursor)} box={box} ms={cursor} fps={fps}>
        <button
          type="button"
          onClick={() => add(cursor)}
          disabled={picked || full}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50"
        >
          {picked ? <Check size={14} /> : <Plus size={14} />}
          {t(picked ? 'exportCenter.moments.added' : 'exportCenter.moments.add')}
          {!picked ? <kbd className="ml-1 font-sans text-[11px] text-[var(--text-faint)]">↵</kbd> : null}
        </button>
      </Preview>

      <Strip
        stripRef={stripRef}
        stripW={stripW}
        view={view}
        setView={setView}
        msPerPx={msPerPx}
        cells={cells.map((c) => ({ ...c, src: frames.get(url(c.ms)) }))}
        cellStep={cellStep}
        totalMs={totalMs}
        fps={fps}
        cursor={cursor}
        selected={selected}
        markers={markers}
        onCursor={(ms) => { setCursor(ms); if (selected != null && !sameFrame(selected, ms, fps)) setSelected(null); focus(); }}
        onDragSelected={(ms) => setCursor(ms)}
        onMoveSelected={(to) => { if (selected != null) move(selected, to); focus(); }}
        label={t('exportCenter.moments.strip')}
      />
      <div className="-mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-[260px] text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          {t('exportCenter.moments.hint')}
          {props.note ? <span className="block">{props.note}</span> : null}
        </p>
        {stripZoomMax(totalMs) > 1 && (
          <ZoomControls view={view} totalMs={totalMs} setView={setView} anchor={cursor >= view.start && cursor <= view.start + span ? (cursor - view.start) / span : 0.5} t={t} />
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
          {t('exportCenter.moments.picked').replace('{n}', String(value.length))}
          {full ? <span className="ml-2 normal-case tracking-normal text-[var(--warn)]">{t('exportCenter.moments.limit').replace('{n}', String(max))}</span> : null}
        </span>
        {value.length > 0 && (
          <button type="button" onClick={() => set([])} className="text-[12px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
            {t('exportCenter.moments.clear')}
          </button>
        )}
      </div>
      <p className="-mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        {t(value.length ? 'exportCenter.moments.selectHint' : 'exportCenter.moments.none')}
      </p>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(136px, 1fr))' }}>
        {value.map((ms, i) => {
          const on = selected != null && sameFrame(ms, selected, fps);
          return (
            <div key={ms} className="group relative flex min-w-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  /* a click selects it, its dot on the strip, the large picture at it; a second click lets it go */
                  if (on) setSelected(null);
                  else { setSelected(ms); goTo(ms); }
                  focus();
                }}
                aria-pressed={on}
                aria-label={formatTimecode(ms, { fps })}
                className={`relative overflow-hidden border-2 transition ${on ? 'border-[var(--accent)]' : 'border-transparent hover:border-[var(--border)]'}`}
              >
                <Framed box={box} src={frames.get(url(ms))} />
              </button>
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums">
                <span className={`min-w-5 shrink-0 rounded-md px-1 py-0.5 text-center text-[10px] font-medium ${on ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                  {i + 1}
                </span>
                <span className={`min-w-0 truncate ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{formatTimecode(ms, { fps })}</span>
                <button
                  type="button"
                  onClick={() => remove(ms)}
                  aria-label={t('exportCenter.moments.remove')}
                  className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {!picked && !full && (
          <button
            type="button"
            onClick={() => add(cursor)}
            aria-label={t('exportCenter.moments.add')}
            className="flex items-center justify-center self-start border border-dashed border-[var(--border)] text-[var(--text-faint)] transition hover:border-[var(--text-faint)] hover:text-[var(--text)]"
            style={{ aspectRatio: `${box.w} / ${box.h}` }}
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {everyMenu && (
        <ContextMenu x={everyMenu.x} y={everyMenu.y} flipTo={everyMenu.top} dense trigger={everyRef} items={everyItems} onClose={() => setEveryMenu(null)} />
      )}
    </div>
  );
}

/** The frames drawn so far, by address (as pictures held in this page). */
interface Frames { get: (url: string) => string | undefined }

/**
 * Frames from the server, one at a time, the first of `wanted` not drawn yet first: a frame no longer wanted (a moment
 * scrubbed past) is never asked for. Each is kept as a picture in this page while the picker is open, so showing it
 * again asks the server nothing.
 */
function useFrames(wanted: readonly string[]): Frames {
  const [, drawn] = React.useReducer((n: number) => n + 1, 0);
  const state = React.useRef({ done: new Map<string, string>(), failed: new Set<string>(), busy: false, alive: true, wanted });
  state.current.wanted = wanted;
  const next = React.useCallback(() => {
    const s = state.current;
    if (s.busy || !s.alive) return;
    const url = s.wanted.find((u) => !s.done.has(u) && !s.failed.has(u));
    if (!url) return;
    s.busy = true;
    void fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => { if (s.alive) s.done.set(url, URL.createObjectURL(blob)); }, () => { s.failed.add(url); })
      .finally(() => {
        s.busy = false;
        if (!s.alive) return;
        drawn();
        next();
      });
  }, []);
  React.useEffect(() => next(), [wanted.join('\n'), next]);
  React.useEffect(() => {
    const s = state.current;
    s.alive = true;
    return () => {
      s.alive = false;
      for (const u of s.done.values()) URL.revokeObjectURL(u);
      s.done.clear();
    };
  }, []);
  return { get: (url) => state.current.done.get(url) };
}

/** The film in the export's frame: bars where the film does not reach it, cut where it overflows. */
function Framed({ box, src, children }: { box: FilmFrameBox; src: string | undefined; children?: React.ReactNode }) {
  return (
    <div className="relative w-full overflow-hidden bg-black" style={{ aspectRatio: `${box.w} / ${box.h}` }}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            left: `${(box.inner.left / box.w) * 100}%`,
            top: `${(box.inner.top / box.h) * 100}%`,
            width: `${(box.inner.w / box.w) * 100}%`,
            height: `${(box.inner.h / box.h) * 100}%`,
          }}
        />
      ) : null}
      {children}
    </div>
  );
}

/** The large picture of one moment: until it is drawn, the last one drawn stays up, with a spinner. */
function Preview({ frames, url, box, ms, fps, children }: {
  frames: Frames; url: string; box: FilmFrameBox; ms: number; fps: number; children?: React.ReactNode;
}) {
  const src = frames.get(url);
  const last = React.useRef<string | undefined>(undefined);
  if (src) last.current = src;
  return (
    /* Grow with the export window; leave room for its controls on shorter displays. */
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div
        className="w-full overflow-hidden border border-[var(--border)]"
        style={{ maxWidth: `calc(min(56dvh, 620px, max(180px, 100dvh - 380px)) * ${box.w / box.h})` }}
      >
        <Framed box={box} src={src ?? last.current}>
          {src ? null : <Loader2 size={16} className="absolute right-3 top-3 animate-spin text-white/80" />}
        </Framed>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className="font-mono text-[12px] tabular-nums text-[var(--text-muted)]">
          {formatTimecode(ms, { fps })}
        </span>
        {children}
      </div>
    </div>
  );
}

/**
 * The film as a row of pictures under a ruler, the part in sight of `view`. Pressed or dragged, it moves the moment
 * shown, including double clicks. Items are selected or added with the controls below the strip.
 * The frame selected below shows its dot above it, dragged to move it;
 * the film's markers are under it. Zoomed in, a bar under it shows and moves what is in sight.
 */
function Strip({ stripRef, stripW, view, setView, msPerPx, cells, cellStep, totalMs, fps, cursor, selected, markers, onCursor, onDragSelected, onMoveSelected, label, overlay }: {
  stripRef: React.RefObject<HTMLDivElement | null>;
  stripW: number;
  view: StripView;
  setView: (v: StripView) => void;
  msPerPx: number;
  /** the cells in sight: where each starts (ms), the moment it shows, its picture once drawn */
  cells: readonly { at: number; ms: number; src: string | undefined }[];
  cellStep: number;
  totalMs: number;
  fps: number;
  cursor: number;
  selected: number | null;
  markers: readonly number[];
  onCursor: (ms: number) => void;
  onDragSelected: (ms: number) => void;
  onMoveSelected: (to: number) => void;
  label: string;
  /** Range selection shares this filmstrip, drawing its trim handles over the same frames. */
  overlay?: React.ReactNode;
}) {
  const x = (ms: number) => (ms - view.start) / msPerPx;
  const at = (clientX: number) => {
    const r = stripRef.current!.getBoundingClientRect();
    return momentAt(view.start + (clientX - r.left) * msPerPx, totalMs, fps);
  };
  const [hover, setHover] = React.useState<number | null>(null);
  /* the selected frame's dot being dragged: where it is now */
  const [drag, setDrag] = React.useState<number | null>(null);
  const pin = drag ?? selected;

  /* Ctrl/⌘ + wheel (and a pinch) zooms around the pointer, a sideways swipe or Shift + wheel scrolls, as on the
     timeline. A native listener: React's onWheel is passive and cannot stop the browser's page zoom. */
  const latest = React.useRef({ view, msPerPx, setView, totalMs });
  latest.current = { view, msPerPx, setView, totalMs };
  React.useEffect(() => {
    const el = stripRef.current?.parentElement;
    if (!el) return undefined;
    let factor = 1;
    let anchor = 0;
    let raf = 0;
    const flush = () => {
      raf = 0;
      const { view: v, setView: set, totalMs: total } = latest.current;
      const f = factor;
      factor = 1;
      if (f !== 1) set(zoomView(v, f, anchor, total));
    };
    const pixels = (e: WheelEvent, d: number) => (e.deltaMode === 1 ? d * 16 : e.deltaMode === 2 ? d * 400 : d);
    const onWheel = (e: WheelEvent) => {
      const r = stripRef.current!.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        factor *= Math.exp(-pixels(e, e.deltaY) / 180);
        anchor = Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
        if (!raf) raf = requestAnimationFrame(flush);
        return;
      }
      const dx = pixels(e, e.deltaX || (e.shiftKey ? e.deltaY : 0));
      if (!dx || latest.current.view.zoom <= 1) return;
      e.preventDefault();
      const { view: v, msPerPx: k, setView: set } = latest.current;
      set({ ...v, start: v.start + dx * k });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stripRef]);

  /* the ruler: labels at least TICK_PX apart, on whole steps of the clock */
  const tickStep = stepFor(msPerPx, TICK_PX, TICK_STEPS);
  const ticks: number[] = [];
  if (stripW > 0) for (let ms = Math.ceil(view.start / tickStep) * tickStep; ms <= view.start + stripW * msPerPx; ms += tickStep) ticks.push(ms);
  const inSight = (ms: number) => ms >= view.start - msPerPx && ms <= view.start + stripW * msPerPx + msPerPx;

  return (
    <div className="relative select-none">
      {/* the ruler, and the selected frame's dot */}
      <div className="relative h-5 overflow-hidden text-[10.5px] tabular-nums text-[var(--text-faint)]">
        {ticks.map((ms) => (
          <span key={ms} className="absolute bottom-0 flex items-end" style={{ left: x(ms) }}>
            <span className="h-1.5 w-px bg-[var(--border-strong,var(--border))]" />
            <span className="ml-1 leading-none">{formatRulerLabel(ms, fps)}</span>
          </span>
        ))}
        {pin != null && inSight(pin) && (
          <span
            role="button"
            aria-label={formatTimecode(pin, { fps })}
            className="absolute bottom-0 z-10 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] shadow-[var(--shadow-sm)]"
            style={{ left: x(pin) }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag(pin);
            }}
            onPointerMove={(e) => {
              if (drag == null) return;
              const to = at(e.clientX);
              if (!sameFrame(to, drag, fps)) { setDrag(to); onDragSelected(to); }
            }}
            onPointerUp={() => {
              if (drag == null) return;
              if (selected != null && !sameFrame(drag, selected, fps)) onMoveSelected(drag);
              setDrag(null);
            }}
            onPointerCancel={() => setDrag(null)}
          />
        )}
      </div>
      <div
        ref={stripRef}
        role={overlay ? 'group' : 'slider'}
        aria-label={label}
        aria-valuemin={overlay ? undefined : 0}
        aria-valuemax={overlay ? undefined : Math.round(totalMs)}
        aria-valuenow={overlay ? undefined : Math.round(cursor)}
        aria-valuetext={overlay ? undefined : formatTimecode(cursor, { fps })}
        className="relative cursor-pointer overflow-hidden bg-black"
        style={{ height: STRIP_H }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          onCursor(at(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) onCursor(at(e.clientX));
          else setHover(at(e.clientX));
        }}
        onPointerLeave={() => setHover(null)}
      >
        {cells.map((c) => (
          <span
            key={c.at}
            className="absolute inset-y-0 overflow-hidden border-r border-black/50"
            style={{ left: x(c.at), width: cellStep / msPerPx }}
          >
            {c.src ? <img src={c.src} alt="" draggable={false} className="h-full w-full object-cover" /> : null}
          </span>
        ))}
        {/* past the film's end */}
        {x(totalMs) < stripW && <span className="absolute inset-y-0 right-0 bg-[var(--surface-2)]" style={{ left: x(totalMs) }} />}
        {overlay}
        {pin != null && inSight(pin) && (
          <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[var(--accent)]" style={{ left: x(pin) }} />
        )}
        {hover != null && (
          <span className="pointer-events-none absolute inset-y-0 w-px bg-white/45" style={{ left: x(hover) }}>
            <span className="absolute left-1 top-1 whitespace-nowrap rounded bg-black/75 px-1 py-px font-mono text-[10.5px] tabular-nums text-white">
              {formatTimecode(hover, { fps })}
            </span>
          </span>
        )}
        {inSight(cursor) && (
          <span className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: x(cursor) }} />
        )}
      </div>
      {/* the film's markers */}
      <div className="relative h-2.5 overflow-hidden">
        {markers.filter(inSight).map((ms) => (
          <button
            key={ms}
            type="button"
            tabIndex={-1}
            aria-label={formatTimecode(ms, { fps })}
            onClick={() => onCursor(ms)}
            className="absolute top-0.5 h-0 w-0 -translate-x-1/2 border-x-[4px] border-b-[6px] border-x-transparent border-b-[var(--warn)]"
            style={{ left: x(ms) }}
          />
        ))}
      </div>
      {/* zoomed in: what is in sight of the whole film, dragged to scroll */}
      {view.zoom > 1 && (
        <div
          className="relative mt-0.5 h-1.5 rounded-full bg-[var(--bg-hover)]"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const span = totalMs / view.zoom;
            const grab = view.start + span / 2;
            const onTrack = (clientX: number) => ((clientX - r.left) / Math.max(1, r.width)) * totalMs;
            /* a press on the bar's thumb drags it from where it was held; elsewhere, centers it there */
            const offset = Math.abs(onTrack(e.clientX) - grab) <= span / 2 ? onTrack(e.clientX) - view.start : span / 2;
            setView({ ...view, start: onTrack(e.clientX) - offset });
            const move = (ev: PointerEvent) => setView({ ...view, start: onTrack(ev.clientX) - offset });
            const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <span
            className="absolute inset-y-0 cursor-grab rounded-full bg-[var(--text-faint)]"
            style={{ left: `${(view.start / totalMs) * 100}%`, width: `${100 / view.zoom}%` }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Zoom out, a bar from the whole film to a second across, zoom in, and the whole film again. They zoom around `anchor`
 * (0 to 1 across the strip): the moment shown, while it is in sight.
 */
function ZoomControls({ view, totalMs, setView, anchor, t }: {
  view: StripView; totalMs: number; setView: (v: StripView) => void; anchor: number; t: (k: string) => string;
}) {
  const most = stripZoomMax(totalMs);
  /* the bar is even in the log of the zoom: each step doubles it alike */
  const level = Math.log(view.zoom) / Math.log(most);
  const zoomTo = (zoom: number) => setView(zoomView(view, zoom / view.zoom, anchor, totalMs));
  const button = 'flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40';
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button type="button" className={button} onClick={() => zoomTo(view.zoom / 2)} disabled={view.zoom <= 1} aria-label={t('exportCenter.moments.zoomOut')} title={t('exportCenter.moments.zoomOut')}>
        <ZoomOut size={15} />
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={level}
        onChange={(e) => zoomTo(most ** Number(e.target.value))}
        aria-label={t('exportCenter.moments.zoom')}
        className="w-24 accent-[var(--text)]"
      />
      <button type="button" className={button} onClick={() => zoomTo(view.zoom * 2)} disabled={view.zoom >= most} aria-label={t('exportCenter.moments.zoomIn')} title={t('exportCenter.moments.zoomIn')}>
        <ZoomIn size={15} />
      </button>
      <button type="button" className={button} onClick={() => setView(STRIP_WHOLE)} disabled={view.zoom <= 1} aria-label={t('exportCenter.moments.zoomFit')} title={t('exportCenter.moments.zoomFit')}>
        <MoveHorizontal size={15} />
      </button>
    </div>
  );
}

export { Strip as Filmstrip, ZoomControls as FilmstripZoom, useFrames as useFilmFrames };
