/**
 * The viewer showing one media file instead of the film: what an editor's source monitor does when a clip is picked
 * in the media pane (CapCut, DaVinci). Video and sound play with their own playhead; a still is shown. The film stays
 * loaded behind it, so going back costs nothing: Esc, or picking anything on the timeline (the host clears it).
 *
 * While it is up the keys are its own, as a source monitor's: I and O mark the part of the file to use (X lets the
 * marks go), and `,` inserts it at the film's playhead, `.` overwrites there (lib/media-place).
 */
import React from 'react';
import { ArrowDownToLine, BetweenHorizontalStart } from 'lucide-react';
import { useT } from '@/i18n';
import { STILL_DROP_MS } from '@/lib/asset-timeline';
import type { SourceRange } from '@/lib/media-place';
import { formatTimecode, snapToFrame } from '@/lib/timecode';
import { type MediaSources, type WorkspaceResource } from '@/lib/workspace-resources';
import { isTypingTarget } from './typing-target';
import { MediaPreview } from './MediaPreview';
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
function SourceBar({ time, duration, playing, onToggle, onSeek, name, disabled, marks, onPlace }: {
  time: number; duration: number; playing: boolean; onToggle: () => void; onSeek: (sec: number) => void; name: string; disabled?: boolean;
  marks?: Marks;
  /** Put the part marked on the film (the `,` and `.` keys' buttons). */
  onPlace?: (mode: 'insert' | 'overwrite') => void;
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
        frame={(
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate text-[12px] text-[var(--text-dim)]">{name}</span>
            {marked ? <span data-source-range="" className="shrink-0 text-[11px] tabular-nums text-[var(--accent)]">{marked}</span> : null}
            {onPlace ? <>
              <Tooltip label={t('media.insertSource')} shortcut=",">
                <button type="button" aria-label={t('media.insertSource')} onMouseDown={(e) => e.preventDefault()} onClick={() => onPlace('insert')} className={PANE_BTN}>
                  <BetweenHorizontalStart size={PANE_ICON} />
                </button>
              </Tooltip>
              <Tooltip label={t('media.overwriteSource')} shortcut=".">
                <button type="button" aria-label={t('media.overwriteSource')} onMouseDown={(e) => e.preventDefault()} onClick={() => onPlace('overwrite')} className={PANE_BTN}>
                  <ArrowDownToLine size={PANE_ICON} />
                </button>
              </Tooltip>
            </> : null}
          </span>
        )}
      />
    </div>
  );
}

export interface SourcePreviewProps {
  file: WorkspaceResource;
  sources: MediaSources;
  onClose: () => void;
  /** Put the file on the film at its playhead: the part marked (null: all of it), inserted or over what is there. */
  onPlace?: (mode: 'insert' | 'overwrite', range: SourceRange | null) => void;
}

export function SourcePreview(props: SourcePreviewProps) {
  /* a web page is previewed on its own: its own timeline from 0, driven here through Studio's bridge */
  return props.file.kind === 'mg' ? <PagePreview {...props} /> : <MediaPreviewPane {...props} />;
}

function MediaPreviewPane({ file, sources, onClose, onPlace }: SourcePreviewProps) {
  const t = useT();
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
  const place = onPlace ? (mode: 'insert' | 'overwrite') => onPlace(mode, timed ? rangeOf(marks, duration) : null) : undefined;

  const toggle = React.useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) { if (media.ended || media.currentTime >= media.duration - 0.05) media.currentTime = 0; void media.play().catch(() => {}); }
    else media.pause();
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--dock-pane)]">
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
            <audio key={file.path} ref={mediaRef} src={src} preload="auto" {...mediaEvents} />
          </div>
        ) : (
          <p className="text-[12.5px] text-[var(--text-muted)]">{t('media.cannotPreview')}</p>
        )}
      </div>
      {timed ? (
        <SourceBar
          time={time}
          duration={duration}
          playing={playing}
          onToggle={toggle}
          onSeek={(v) => { const m = mediaRef.current; if (m) m.currentTime = v; setTime(v); }}
          name={file.name}
          marks={marks}
          {...(place ? { onPlace: place } : {})}
        />
      ) : (
        <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-[12px] text-[var(--text-muted)]">
          <span className="min-w-0 flex-1 truncate">{file.w && file.h ? `${file.w} × ${file.h}` : ''}</span>
          <span className="min-w-0 max-w-[30%] truncate text-[var(--text-dim)]">{file.name}</span>
          {place ? (
            <Tooltip label={t('media.insertSource')} shortcut=",">
              <button type="button" aria-label={t('media.insertSource')} onMouseDown={(e) => e.preventDefault()} onClick={() => place('insert')} className={PANE_BTN}>
                <BetweenHorizontalStart size={PANE_ICON} />
              </button>
            </Tooltip>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * One web page on its own, the way the preview plays the film: on the film's origin (a page is its author's code; on
 * the editor's origin it could reach the editor), with Studio's bridge in it, driven by messages (seek t → frame(t)).
 */
function PagePreview({ file, sources, onClose, onPlace }: SourcePreviewProps) {
  const t = useT();
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const clockRef = React.useRef({ base: 0, at: 0 });
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

  React.useEffect(() => { setSize(null); setFailed(false); setPlaying(false); setTime(0); }, [file.path]);

  const draw = React.useCallback((at: number) => {
    if (!origin) return;
    frameRef.current?.contentWindow?.postMessage({ source: 'openfilm-studio', type: 'seek', seq: ++seq.current, t: Math.max(0, at) }, origin);
  }, [origin]);

  React.useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: unknown; type?: unknown; duration?: unknown; width?: unknown; height?: unknown } | null;
      if (event.source !== frameRef.current?.contentWindow || event.origin !== origin || data?.source !== 'openfilm-film') return;
      if (data.type === 'error') { setFailed(true); return; }
      if (data.type !== 'ready') return;
      const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback);
      setSize({ w: num(data.width, 1920), h: num(data.height, 1080), duration: num(data.duration, 0) });
      draw(0);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [draw, origin]);

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
  const place = onPlace ? (mode: 'insert' | 'overwrite') => onPlace(mode, timedPage ? rangeOf(marks, duration) : null) : undefined;
  const play = React.useCallback(() => {
    if (!size) return;
    const from = time >= duration - 0.05 ? 0 : time;
    clockRef.current = { base: from, at: performance.now() };
    setPlaying(true);
  }, [time, duration, size]);
  const pause = React.useCallback(() => setPlaying(false), []);
  const toggle = React.useCallback(() => (playing ? pause() : play()), [playing, play, pause]);

  React.useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      const now = clockRef.current.base + (performance.now() - clockRef.current.at) / 1000;
      const at = Math.min(now, duration);
      setTime(at);
      draw(at);
      if (at >= duration) { setPlaying(false); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration, draw]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, toggle]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[var(--dock-pane)]">
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
        onSeek={(v) => { setPlaying(false); setTime(v); draw(v); }}
        name={file.name}
        disabled={!size}
        marks={marks}
        {...(place ? { onPlace: place } : {})}
      />
    </div>
  );
}
