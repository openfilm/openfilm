/**
 * The viewer showing one media file instead of the film: what an editor's source monitor does when a clip is picked
 * in the media pane. Video and sound play with their own playhead; a still is shown. The film stays
 * loaded behind it, so going back costs nothing: Esc, or picking anything on the timeline (the host clears it).
 *
 * While it is up the keys are its own, as a source monitor's: I and O mark the part of the file to use (X lets the
 * marks go), and `,` inserts it at the film's playhead, `.` overwrites there (lib/media-place).
 */
import React from 'react';
import { Expand } from 'lucide-react';
import { anchorTime, type Anchor } from '@/editor/player';
import { useT } from '@/i18n';
import { STILL_DROP_MS } from '@/lib/asset-timeline';
import type { SourceRange } from '@/lib/media-place';
import { exactRate, formatTimecode, snapToFrame, useTimecodeFps } from '@/lib/timecode';
import { type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { isTypingTarget } from './typing-target';
import { KIND_ICON, MediaPreview } from './MediaPreview';
import { PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';
import { ViewerBar } from './ViewerBar';

/** A file's in and out marks (its own seconds), kept while Studio is open: back on a file, its marks are there. */
type Marks = { in: number | null; out: number | null };
const marksByPath = new Map<string, Marks>();

/** The marked part as the timeline takes it (ms of the file), or null for all of it. */
function rangeOf(marks: Marks, duration: number): SourceRange | null {
  if (marks.in == null && marks.out == null) return null;
  const inSec = marks.in ?? 0;
  const outSec = marks.out ?? duration;
  return outSec > inSec ? { inMs: Math.round(inSec * 1000), outMs: Math.round(outSec * 1000) } : null;
}

/**
 * The source's keys while it is up (before the editor's own: these are the source monitor's): I / O mark, X lets the
 * marks go, `,` / `.` put the part marked on the film. Not while typing.
 */
function useSourceKeys(path: string, time: number, duration: number, onPlace: SourcePreviewProps['onPlace']) {
  const [marks, setMarksState] = React.useState<Marks>(() => marksByPath.get(path) ?? { in: null, out: null });
  React.useEffect(() => { setMarksState(marksByPath.get(path) ?? { in: null, out: null }); }, [path]);
  const setMarks = React.useCallback((next: Marks) => { marksByPath.set(path, next); setMarksState(next); }, [path]);
  const now = React.useRef({ time, duration, marks });
  now.current = { time, duration, marks };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as Element | null)?.closest?.('[role="dialog"]')) return;
      const { time: at, duration: dur, marks: m } = now.current;
      const key = e.key.toLowerCase();
      /* on the file's own frame grid, as the film's marks are on the film's */
      const sec = Math.min(dur, snapToFrame(at * 1000) / 1000);
      let next: Marks | null = null;
      if (key === 'i' && !e.shiftKey) next = { in: sec, out: m.out != null && m.out > sec ? m.out : null };
      else if (key === 'o' && !e.shiftKey) next = { in: m.in != null && m.in < sec ? m.in : null, out: sec };
      else if (key === 'x' && !e.shiftKey) next = { in: null, out: null };
      else if ((e.key === ',' || e.key === '.') && onPlace && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        onPlace(e.key === ',' ? 'insert' : 'overwrite', rangeOf(m, dur));
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      setMarks(next);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onPlace, setMarks]);
  return marks;
}

/**
 * Where the source is, as a line across the viewer: the part played filled, a knob while the pointer is over it or
 * dragging. Clicking anywhere on it goes there; dragging scrubs.
 */
function Scrubber({ time, duration, onSeek, label, marks }: { time: number; duration: number; onSeek: (sec: number) => void; label: string; marks?: Marks }) {
  const [dragging, setDragging] = React.useState(false);
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))) * duration;
  };
  const part = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={time}
      /* not focusable: the arrow keys stay the film's (its playhead is where `,` and `.` put the part marked) */
      className="group relative mx-3 flex h-3 shrink-0 cursor-pointer items-center"
      onPointerDown={(e) => { if (!(duration > 0)) return; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); onSeek(at(e)); }}
      onPointerMove={(e) => { if (dragging) onSeek(at(e)); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
    >
      <div className={`relative w-full overflow-hidden rounded-full bg-white/15 transition-[height] ${dragging ? 'h-1' : 'h-0.5 group-hover:h-1'}`}>
        <div className="absolute inset-y-0 left-0 bg-[var(--text)]" style={{ width: `${part * 100}%` }} />
      </div>
      {/* the part marked with I and O: a band over the line, its ends standing up from it */}
      {marks && duration > 0 && (marks.in != null || marks.out != null) ? (() => {
        const from = Math.max(0, Math.min(1, (marks.in ?? 0) / duration));
        const to = Math.max(0, Math.min(1, (marks.out ?? duration) / duration));
        return (
          <span aria-hidden data-source-marks={`${marks.in ?? ''}-${marks.out ?? ''}`} className="pointer-events-none absolute inset-y-0" style={{ left: `${from * 100}%`, width: `${Math.max(0, to - from) * 100}%` }}>
            <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--accent)] opacity-70" />
            {marks.in != null ? <span className="absolute -top-0.5 bottom-[-2px] left-0 w-[2px] rounded-full bg-[var(--accent)]" /> : null}
            {marks.out != null ? <span className="absolute -top-0.5 bottom-[-2px] right-0 w-[2px] rounded-full bg-[var(--accent)]" /> : null}
          </span>
        );
      })() : null}
      <span
        className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[var(--text)] shadow transition-opacity ${dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        style={{ left: `${part * 100}%` }}
      />
    </div>
  );
}

/** The source's own transport: its scrub line, then the bar the film's viewer has (time, play, and its name). */
function SourceBar({ time, duration, playing, onToggle, onSeek, disabled, marks, onFullscreen }: {
  time: number; duration: number; playing: boolean; onToggle: () => void; onSeek: (sec: number) => void; disabled?: boolean;
  marks?: Marks;
  onFullscreen: () => void;
}) {
  const t = useT();
  const marked = marks && (marks.in != null || marks.out != null)
    ? `${formatTimecode((marks.in ?? 0) * 1000, { hours: false })} – ${formatTimecode((marks.out ?? duration) * 1000, { hours: false })}`
    : null;
  return (
    <div className="shrink-0 pt-1">
      <Scrubber time={time} duration={disabled ? 0 : duration} onSeek={onSeek} label={t('media.scrub')} marks={marks} />
      <ViewerBar
        timeMs={time * 1000}
        totalMs={disabled ? 0 : duration * 1000}
        playing={playing}
        onPlayPause={onToggle}
        onFullscreen={onFullscreen}
        /* the part marked with I and O, while there is one (`,` and `.` put it on the film) */
        frame={marked ? <span data-source-range="" className="shrink-0 text-[11px] tabular-nums text-[var(--accent)]">{marked}</span> : undefined}
      />
    </div>
  );
}

/** The preview full screen, or back (the same button). */
function toggleFullscreen(el: HTMLElement | null) {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void el?.requestFullscreen?.().catch(() => {});
}

export interface SourcePreviewProps {
  file: WorkspaceResource;
  sources: MediaSources;
  onClose: () => void;
  /** Put the file on the film at its playhead: the part marked (null: all of it), inserted or over what is there. */
  onPlace?: (mode: 'insert' | 'overwrite', range: SourceRange | null) => void;
}

export function SourcePreview(props: SourcePreviewProps) {
  /* a web page is previewed on its own: its own timeline from 0, driven here through Studio's bridge. Each file is a
     preview of its own (keyed by its path): another one picked starts at 0, paused, with nothing of the last one's
     clock (a frame of its playback could land after a reset and carry its time over) */
  return props.file.kind === 'mg'
    ? <PagePreview key={props.file.path} {...props} />
    : <MediaPreviewPane key={props.file.path} {...props} />;
}

function MediaPreviewPane({ file, sources, onClose, onPlace }: SourcePreviewProps) {
  const t = useT();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const mediaRef = React.useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState((file.durationMs ?? 0) / 1000);
  const [failed, setFailed] = React.useState(false);
  const timed = file.kind === 'video' || file.kind === 'audio';
  const src = sources.file(file);

  React.useEffect(() => { setPlaying(false); setTime(0); setFailed(false); setDuration((file.durationMs ?? 0) / 1000); }, [file.path, file.durationMs]);
  /* a still has no part to mark: `,` and `.` put it whole */
  const marks = useSourceKeys(file.path, timed ? time : 0, timed ? duration : 0, onPlace);

  const toggle = React.useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) { if (media.ended || media.currentTime >= media.duration - 0.05) media.currentTime = 0; void media.play().catch(() => {}); }
    else media.pause();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      /* space plays the source while it is up, not the film behind it */
      if (e.key === ' ' && timed) { e.preventDefault(); e.stopPropagation(); toggle(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, timed, toggle]);

  /* the playhead follows the media every frame while it plays (timeupdate is 4 Hz) */
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => { const m = mediaRef.current; if (m) setTime(m.currentTime); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onLoadedMetadata: (e: React.SyntheticEvent<HTMLMediaElement>) => { if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration); },
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => setTime(e.currentTarget.currentTime),
    onError: () => setFailed(true),
  };

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex flex-col bg-[var(--dock-pane)]">
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 py-2.5" onClick={timed ? toggle : undefined}>
        {failed ? (
          <p className="text-[12.5px] text-[var(--text-muted)]">{t('media.cannotPreview')}</p>
        ) : file.kind === 'video' ? (
          <video
            key={file.path}
            ref={mediaRef}
            src={src}
            /* a poster that fails to load covers the first frame in black: only when there is one */
            poster={sources.poster?.(file)}
            playsInline
            /* picked to be seen: it plays from the start at once (the click that picked it lets the sound play) */
            autoPlay
            preload="auto"
            className="h-full w-full object-contain"
            {...mediaEvents}
          />
        ) : file.kind === 'image' ? (
          <img src={src} alt={file.name} className="h-full w-full object-contain" onError={() => setFailed(true)} />
        ) : file.kind === 'audio' ? (
          <div className="relative h-[42%] w-full max-w-[920px] overflow-hidden rounded-md">
            <MediaPreview file={file} sources={sources} />
            {duration > 0 ? <span className="pointer-events-none absolute inset-y-0 w-px bg-white/90" style={{ left: `${(time / duration) * 100}%` }} /> : null}
            <audio key={file.path} ref={mediaRef} src={src} preload="auto" autoPlay {...mediaEvents} />
          </div>
        ) : (
          /* a file Studio does not play: what it is, by its icon and name */
          <div className="flex min-w-0 flex-col items-center gap-2 text-center">
            {React.createElement(KIND_ICON[file.kind], { size: 40, strokeWidth: 1.4, className: 'text-[var(--text-muted)]' })}
            <span className="max-w-full truncate text-[13px] font-medium text-[var(--text)]">{file.name}</span>
            <p className="text-[12.5px] text-[var(--text-muted)]">{t('media.cannotPreview')}</p>
          </div>
        )}
      </div>
      {timed ? (
        <SourceBar
          time={time}
          duration={duration}
          playing={playing}
          onToggle={toggle}
          onSeek={(v) => { const m = mediaRef.current; if (m) m.currentTime = v; setTime(v); }}
          marks={marks}
          onFullscreen={() => toggleFullscreen(rootRef.current)}
        />
      ) : (
        <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1 truncate">{file.w && file.h ? `${file.w} × ${file.h}` : ''}</span>
          <Tooltip label={t('viewer.fullscreen')}>
            <button type="button" aria-label={t('viewer.fullscreen')} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleFullscreen(rootRef.current)} className={PANE_BTN}>
              <Expand size={PANE_ICON} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

/** Clock readings asked of a page as it comes up: the one answered soonest says best where its clock is. */
const CLOCK_PINGS = 5;

/**
 * One web page on its own, the way the preview plays the film: on the film's origin (a page is its author's code; on
 * the editor's origin it could reach the editor), with Studio's bridge in it, driven by messages. Still, it is told the
 * moment to draw (seek t → frame(t)); playing, the line it plays on, and it draws its own frames from it, on the
 * project's frame grid (studio/server/bridge.js `play`): no message a frame, so a busy editor does not hold the picture.
 */
function PagePreview({ file, sources, onClose, onPlace }: SourcePreviewProps) {
  const t = useT();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const seq = React.useRef(0);
  const surface = sources.pageSurface?.(file) ?? null;
  const origin = React.useMemo(() => {
    try { return surface ? new URL(surface, window.location.href).origin : null; } catch { return null; }
  }, [surface]);
  const [size, setSize] = React.useState<{ w: number; h: number; duration: number } | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [scale, setScale] = React.useState(1);
  /* playing draws each frame of the project's rate, as the film would draw the page, none between */
  const fps = exactRate(useTimecodeFps());
  const fpsRef = React.useRef(fps);
  fpsRef.current = fps;

  const post = React.useCallback((message: object) => {
    if (!origin) return;
    frameRef.current?.contentWindow?.postMessage({ source: 'openfilm-studio', ...message }, origin);
  }, [origin]);
  /* the picture at t: at the very end of a page with a duration its last frame (it draws below its duration) */
  const end = size?.duration ? size.duration - 1e-3 : Infinity;
  const draw = React.useCallback((at: number) => {
    post({ type: 'seek', seq: ++seq.current, t: Math.max(0, Math.min(at, end)) });
  }, [post, end]);
  /*
   * Playing: the line the page plays on (null while still), on this page's clock. The page's clock starts elsewhere
   * (another document, another process), so it is told the line by how far its clock is from this one, read with a
   * few pings and taken from the one answered soonest (the time a message takes is the error, a fraction of a
   * millisecond).
   */
  const line = React.useRef<Anchor | null>(null);
  const clock = React.useRef<{ offset: number; rtt: number } | null>(null);
  const tellPlay = React.useCallback(() => {
    const a = line.current;
    if (!a) return;
    post({ type: 'play', t: a.t, at: a.at + (clock.current?.offset ?? 0), rate: a.rate, fps: fpsRef.current });
  }, [post]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: unknown; type?: unknown; duration?: unknown; width?: unknown; height?: unknown; origin?: unknown; ping?: unknown; now?: unknown;
      } | null;
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin || data?.source !== 'openfilm-film') return;
      if (data.type === 'error') { setFailed(true); return; }
      if (data.type === 'clock') {
        const rtt = performance.now() - Number(data.ping);
        if (!(rtt >= 0) || (clock.current && clock.current.rtt <= rtt)) return;
        clock.current = { offset: Number(data.now) - (Number(data.ping) + rtt / 2), rtt };
        /* playing on it: told the line again, on its clock as now read */
        tellPlay();
        return;
      }
      if (data.type !== 'ready') return;
      const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
      setSize({ w: num(data.width, 1920), h: num(data.height, 1080), duration: num(data.duration, 0) });
      /* where its clock is: first by where each clock started, then by pings */
      clock.current = Number(data.origin) > 0 ? { offset: performance.timeOrigin - Number(data.origin), rtt: Infinity } : null;
      for (let i = 0; i < CLOCK_PINGS; i++) setTimeout(() => post({ type: 'clock', ping: performance.now() }), 40 * i);
      draw(0);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [draw, origin, post, tellPlay]);

  React.useEffect(() => {
    const box = boxRef.current;
    if (!box || !size) return;
    const fit = () => setScale(Math.min(box.clientWidth / size.w, box.clientHeight / size.h));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [size]);

  /* a page without a duration has no end: it plays over the length a drop on the timeline gives it */
  const duration = size ? size.duration || STILL_DROP_MS / 1000 : 0;
  /* a page without a duration has no part to mark: it goes with the length a drop gives it */
  const timedPage = Boolean(size?.duration);
  const marks = useSourceKeys(file.path, timedPage ? time : 0, timedPage ? duration : 0, onPlace);
  const play = React.useCallback(() => {
    if (!size) return;
    const from = time >= duration - 0.05 ? 0 : time;
    line.current = { t: from, at: performance.now(), rate: 1 };
    tellPlay();
    setPlaying(true);
  }, [time, duration, size, tellPlay]);
  /* still at `at` (a pause, the end, a scrub): the page stops playing and draws that moment */
  const still = React.useCallback((at: number) => {
    line.current = null;
    setPlaying(false);
    setTime(at);
    draw(at);
  }, [draw]);
  /* stopped on the frame being shown: the timecode, the picture and a mark all mean that frame */
  const pause = React.useCallback(() => {
    const a = line.current;
    if (a) still(Math.min(duration, snapToFrame(anchorTime(a, performance.now()) * 1000) / 1000));
  }, [duration, still]);
  /* picked to be seen: it plays from the start once the page is ready (once: a pause stays a pause) */
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!size || started.current) return;
    started.current = true;
    play();
  }, [size, play]);
  const toggle = React.useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  /* the page draws itself while it plays; the timecode and the scrub line follow its line here, to its end */
  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      const a = line.current;
      if (!a) return;
      const at = Math.min(anchorTime(a, performance.now()), duration);
      if (at >= duration) { still(duration); return; }
      setTime(at);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, still]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, toggle]);

  return (
    <div ref={rootRef} className="absolute inset-0 z-20 flex flex-col bg-[var(--dock-pane)]">
      <div ref={boxRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-2.5" onClick={toggle}>
        {/* nothing to play it on (no surface for this page) is the same as a page that failed */}
        {failed || !surface ? <p className="text-[12.5px] text-[var(--text-muted)]">{t('media.cannotPreview')}</p> : (
          <div className="relative shrink-0 overflow-hidden bg-black" style={size ? { width: size.w * scale, height: size.h * scale } : { width: 1, height: 1, opacity: 0 }}>
            <iframe
              ref={frameRef}
              key={file.path}
              src={surface}
              title={file.name}
              className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
              style={{ width: size?.w ?? 1920, height: size?.h ?? 1080, transform: `scale(${scale})` }}
            />
          </div>
        )}
      </div>
      <SourceBar
        time={time}
        duration={duration}
        playing={playing}
        onToggle={toggle}
        onSeek={still}
        disabled={!size}
        marks={marks}
        onFullscreen={() => toggleFullscreen(rootRef.current)}
      />
    </div>
  );
}
