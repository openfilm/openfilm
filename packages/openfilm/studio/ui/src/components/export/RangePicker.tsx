import React from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, Plus, Volume2, VolumeX, X } from 'lucide-react';
import { api } from '@/api';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { Player } from '@/editor/player';
import { useT } from '@/i18n';
import { clampView, filmFrameUrl, momentAt, stepFor, STRIP_WHOLE, stripZoomMax, viewShowing, type StripView } from '@/lib/export-moments';
import { EXPORT_RANGE_MAX, parseExportTime, readExportRange, type ExportRangeDraft, type RangeDelivery } from '@/lib/export-range';
import { formatTimecode, frameMs, snapToFrame, stepFrames } from '@/lib/timecode';
import { ExportTimeInput } from './ExportTimeInput';
import { Filmstrip, FilmstripZoom, useFilmFrames } from './MomentPicker';

const CELL_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_800_000];

/** The film playing beside an ordered list of in/out selections; its controls never cover the picture. */
export function RangePicker({ projectId, totalMs, fps, stage, boundaries, value, onChange, delivery, onDelivery, error }: {
  projectId: string;
  totalMs: number;
  fps: number;
  stage: { w: number; h: number };
  boundaries: { starts: { ms: number; title: string }[]; ends: { ms: number; title: string }[] };
  value: ExportRangeDraft[];
  onChange: (parts: ExportRangeDraft[]) => void;
  delivery: RangeDelivery;
  onDelivery: (delivery: RangeDelivery) => void;
  error: string | null;
}) {
  const t = useT();
  const [folder, setFolder] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const [activeId, setActiveId] = React.useState(value[0]?.id ?? '');
  const active = value.find((part) => part.id === activeId) ?? value[0];
  const activeRange = active ? readExportRange(active.from, active.to, totalMs, fps) : null;
  const preview = React.useRef<PreviewHandle>(null);
  const [player] = React.useState(() => new Player());
  const [cursor, setCursor] = React.useState(0);
  const cursorRef = React.useRef(0);
  const [playing, setPlaying] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const sequence = React.useRef(0);
  const root = React.useRef<HTMLDivElement>(null);
  const stripRef = React.useRef<HTMLDivElement>(null);
  const [stripW, setStripW] = React.useState(0);
  const [view, setViewRaw] = React.useState<StripView>(STRIP_WHOLE);
  const setView = React.useCallback((next: StripView) => setViewRaw(clampView(next, totalMs)), [totalMs]);
  React.useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setStripW(el.clientWidth));
    observer.observe(el);
    setStripW(el.clientWidth);
    return () => observer.disconnect();
  }, []);
  const span = totalMs / view.zoom;
  const msPerPx = stripW > 0 ? span / stripW : 1;
  const cellStep = stepFor(msPerPx, 56 * stage.w / Math.max(1, stage.h), CELL_STEPS);
  const cells = React.useMemo(() => {
    const list: { at: number; ms: number }[] = [];
    if (stripW > 0) for (let k = Math.floor(view.start / cellStep); k * cellStep < Math.min(totalMs, view.start + span); k++) {
      list.push({ at: k * cellStep, ms: momentAt(k * cellStep + cellStep / 2, totalMs, fps) });
    }
    return list;
  }, [stripW, view.start, span, cellStep, totalMs, fps]);
  const picks = value.map((part) => ({ ...part, read: readExportRange(part.from, part.to, totalMs, fps) }));
  const url = (ms: number) => filmFrameUrl(projectId, ms, 480);
  const frames = useFilmFrames([
    ...(activeRange ? [url(activeRange.fromMs)] : []),
    ...[...cells].sort((a, b) => Math.abs(a.ms - cursor) - Math.abs(b.ms - cursor)).map((cell) => url(cell.ms)),
    ...picks.flatMap((part) => part.read ? [url(part.read.fromMs)] : []),
  ]);
  const now = React.useCallback(() => player.time(), [player]);
  const seek = React.useCallback((at: number) => {
    const ms = Math.max(0, Math.min(totalMs, at));
    player.pause();
    player.seek(ms / 1000);
    preview.current?.seek(Math.min(ms, Math.max(0, totalMs - 0.001)) / 1000);
    cursorRef.current = ms;
    setCursor(ms);
    setPlaying(false);
    setViewRaw((current) => viewShowing(current, ms, totalMs));
  }, [player, totalMs]);

  React.useEffect(() => {
    let live = true;
    setFolder(null);
    setReady(false);
    setFailed(false);
    void api.film(projectId).then((film) => { if (live) setFolder(film.folder); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [projectId, attempt]);
  React.useEffect(() => {
    player.onAnchor = (anchor) => preview.current?.play?.(anchor);
    return () => { player.onAnchor = null; player.close(); };
  }, [player]);
  React.useEffect(() => {
    const from = active ? parseExportTime(active.from, fps) : 0;
    seek(from ?? 0);
    // Selecting a different range starts its preview at that range's first frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, seek]);
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const end = activeRange?.toMs ?? totalMs;
    const tick = () => {
      const ms = player.time() * 1000;
      if (ms >= end) { seek(end); return; }
      cursorRef.current = ms;
      setCursor(ms);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player, activeRange?.toMs, totalMs, seek]);
  React.useEffect(() => { if (failed) seek(cursorRef.current); }, [failed, seek]);
  const onInfo = React.useCallback((info: FilmInfo) => {
    if (!folder) return;
    player.load(folder, info.sounds, info.duration);
    player.seek(cursorRef.current / 1000);
    setReady(true);
  }, [folder, player]);
  const togglePlay = () => {
    if (playing) { seek(player.time() * 1000); return; }
    const from = activeRange?.fromMs ?? 0, to = activeRange?.toMs ?? totalMs;
    if (cursor < from || cursor >= to) seek(from);
    player.play();
    setPlaying(true);
  };
  const patch = (change: Partial<ExportRangeDraft>) => {
    if (active) onChange(value.map((part) => part.id === active.id ? { ...part, ...change } : part));
  };
  const setEdge = (edge: 'from' | 'to', at: number) => {
    const step = frameMs(1, fps);
    if (edge === 'from') {
      const from = Math.max(0, Math.min(at, totalMs - step));
      const to = Math.min(totalMs, Math.max(parseExportTime(active?.to ?? '', fps) ?? totalMs, from + step));
      patch({ from: String(from / 1000), to: String(to / 1000) });
    } else {
      const to = Math.min(totalMs, Math.max(step, at));
      const from = Math.max(0, Math.min(parseExportTime(active?.from ?? '', fps) ?? 0, to - step));
      patch({ from: String(from / 1000), to: String(to / 1000) });
    }
  };
  const typeEdge = (edge: 'from' | 'to', text: string) => {
    patch({ [edge]: text });
    const at = parseExportTime(text, fps);
    if (at != null && at <= totalMs) seek(at);
  };
  const add = () => {
    if (value.length >= EXPORT_RANGE_MAX) return;
    const next = activeRange && cursor >= activeRange.fromMs && cursor < activeRange.toMs ? activeRange.toMs : cursor;
    const from = Math.max(0, snapToFrame(next < totalMs - frameMs(1, fps) ? next : 0, fps));
    const part = { id: `range-${Date.now()}-${++sequence.current}`, from: String(from / 1000), to: String(Math.min(totalMs, from + 3000) / 1000) };
    onChange([...value, part]);
    setActiveId(part.id);
  };
  const focus = () => root.current?.focus({ preventScroll: true });
  const atPointer = (clientX: number) => {
    const rect = stripRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(totalMs, snapToFrame(view.start + (clientX - rect.left) * msPerPx, fps)));
  };
  const onKey = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, button, [role="slider"]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      seek(event.shiftKey ? cursor + direction * 1000 : stepFrames(cursor, direction, fps));
    } else if (event.key === ' ' && ready && !failed) togglePlay();
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const iconButton = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40';
  const activeIndex = active ? value.findIndex((part) => part.id === active.id) : -1;
  const full = value.length >= EXPORT_RANGE_MAX;
  // Existing ranges are selected through their cards. The strip seeks freely, even where ranges overlap.
  const selectionOverlay = activeRange ? (
      <div className="pointer-events-none absolute inset-y-0 z-10 border-y-2 border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
        style={{ left: (activeRange.fromMs - view.start) / msPerPx, width: (activeRange.toMs - activeRange.fromMs) / msPerPx }}>
        {(['from', 'to'] as const).map((edge) => {
          const ms = edge === 'from' ? activeRange.fromMs : activeRange.toMs;
          return <button
            key={edge}
            type="button"
            role="slider"
            aria-label={t(edge === 'from' ? 'exportCenter.rangeDragStart' : 'exportCenter.rangeDragEnd')}
            aria-valuemin={0}
            aria-valuemax={Math.round(totalMs)}
            aria-valuenow={Math.round(ms)}
            aria-valuetext={formatTimecode(ms, { fps })}
            className={`pointer-events-auto absolute -inset-y-0.5 z-20 flex w-3 cursor-ew-resize items-center justify-center bg-[var(--accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)] ${edge === 'from' ? '-left-1.5' : '-right-1.5'}`}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              seek(ms);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const at = atPointer(event.clientX);
              setEdge(edge, at);
              seek(at);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              const at = stepFrames(ms, event.key === 'ArrowLeft' ? -1 : 1, fps);
              setEdge(edge, at);
              seek(at);
            }}
          ><span className="h-4 w-px bg-white/80" /></button>;
        })}
      </div>
  ) : null;

  return (
    <div ref={root} tabIndex={0} onKeyDown={onKey} className="mt-2 grid min-w-0 gap-6 outline-none lg:grid-cols-[minmax(0,1fr)_272px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col items-center gap-2">
          <div className="relative w-full overflow-hidden border border-[var(--border)] bg-black" aria-label={t('exportCenter.rangePreview')}
            style={{ aspectRatio: `${stage.w} / ${stage.h}`, maxWidth: `calc(min(56dvh, 620px, max(180px, 100dvh - 380px)) * ${stage.w / stage.h})` }}>
            {folder && !failed ? <Preview ref={preview} folder={folder} stage={stage} time={now} fps={fps} onInfo={onInfo} onError={(message) => { if (message) setFailed(true); }} /> : null}
            {!folder && !failed && <div className="absolute inset-0 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-white/60" /></div>}
            {failed && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-[12px] text-white/70">
              {t('exportCenter.rangePreviewFailed')}
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="rounded-lg border border-white/30 px-3 py-1">{t('exportCenter.rangeRetry')}</button>
            </div>}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <button type="button" className={iconButton} disabled={!ready || failed} onClick={togglePlay} aria-label={t(playing ? 'exportCenter.rangePause' : 'exportCenter.rangePlay')}>
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button type="button" className={iconButton} disabled={!ready || failed} onClick={() => seek(stepFrames(cursor, -1, fps))} aria-label={t('exportCenter.rangePreviousFrame')}><ChevronLeft size={15} /></button>
            <span className="px-1 font-mono text-[12px] tabular-nums text-[var(--text-muted)]">{formatTimecode(cursor, { fps })}</span>
            <button type="button" className={iconButton} disabled={!ready || failed} onClick={() => seek(stepFrames(cursor, 1, fps))} aria-label={t('exportCenter.rangeNextFrame')}><ChevronRight size={15} /></button>
            <button type="button" className={iconButton} onClick={() => { player.setMuted(!muted); setMuted(!muted); }} aria-label={t(muted ? 'exportCenter.rangeUnmute' : 'exportCenter.rangeMute')}>
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button type="button" onClick={() => add()} disabled={full}
              className="ml-2 flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
              <Plus size={14} />{t('exportCenter.rangeAdd')}
            </button>
          </div>
        </div>

        <Filmstrip
          stripRef={stripRef}
          stripW={stripW}
          view={view}
          setView={setView}
          msPerPx={msPerPx}
          cells={cells.map((cell) => ({ ...cell, src: frames.get(url(cell.ms)) }))}
          cellStep={cellStep}
          totalMs={totalMs}
          fps={fps}
          cursor={cursor}
          selected={null}
          markers={[]}
          onCursor={(at) => { seek(at); focus(); }}
          onDragSelected={seek}
          onMoveSelected={seek}
          label={t('exportCenter.rangeSeek')}
          overlay={selectionOverlay}
        />
        <div className="-mt-1 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 basis-[260px] text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('exportCenter.rangeStripHint')}</p>
          {stripZoomMax(totalMs) > 1 && <FilmstripZoom view={view} totalMs={totalMs} setView={setView} anchor={cursor >= view.start && cursor <= view.start + span ? (cursor - view.start) / span : 0.5} t={t} />}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{t('exportCenter.rangeCount').replace('{n}', String(value.length))}</span>
          {value.length > 0 && <button type="button" onClick={() => onChange([])} className="text-[12px] text-[var(--text-muted)] transition hover:text-[var(--text)]">{t('exportCenter.moments.clear')}</button>}
        </div>
        <p className="-mt-1.5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('exportCenter.rangeCardsHint')}</p>
        <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(136px, 1fr))' }}>
          {picks.map((part, index) => {
            const selected = active?.id === part.id;
            const src = part.read ? frames.get(url(part.read.fromMs)) : undefined;
            return <div key={part.id} className="group relative flex min-w-0 flex-col gap-1">
              <button type="button" aria-pressed={selected} onClick={() => { setActiveId(part.id); seek(part.read?.fromMs ?? 0); focus(); }} aria-label={t('exportCenter.rangeSegment').replace('{n}', String(index + 1))}
                className={`relative overflow-hidden border-2 bg-black transition ${selected ? 'border-[var(--accent)]' : 'border-transparent hover:border-[var(--border)]'}`} style={{ aspectRatio: `${stage.w} / ${stage.h}` }}>
                {src && <img src={src} alt="" draggable={false} className="h-full w-full object-contain" />}
              </button>
              <div className="flex min-w-0 items-start gap-1.5 text-[11px] tabular-nums">
                <span className={`min-w-5 shrink-0 rounded-md px-1 py-0.5 text-center text-[10px] font-medium ${selected ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>{index + 1}</span>
                <span className={`min-w-0 flex-1 leading-5 ${selected ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
                  {part.read ? <><span className="block truncate">{formatTimecode(part.read.fromMs, { fps })}</span><span className="block truncate text-[var(--text-faint)]">{formatTimecode(part.read.toMs, { fps })}</span></> : t('exportCenter.rangeInvalidSegment')}
                </span>
                <button type="button" className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-muted)] opacity-0 transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:opacity-100 group-hover:opacity-100" aria-label={t('exportCenter.rangeRemove').replace('{n}', String(index + 1))} onClick={() => onChange(value.filter((other) => other.id !== part.id))}><X size={13} /></button>
              </div>
            </div>;
          })}
          {!full && <button type="button" onClick={() => add()} aria-label={t('exportCenter.rangeAdd')} className="flex items-center justify-center self-start border border-dashed border-[var(--border)] text-[var(--text-faint)] transition hover:border-[var(--text-faint)] hover:text-[var(--text)]" style={{ aspectRatio: `${stage.w} / ${stage.h}` }}><Plus size={18} /></button>}
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-5">
        {active && <div className="flex flex-col gap-3">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{t('exportCenter.rangeSegment').replace('{n}', String(activeIndex + 1))}</span>
          <div className="flex flex-col gap-1.5">
            <ExportTimeInput compact label={t('exportCenter.rangeFrom')} boundaryLabel={t('exportCenter.rangeBoundary')} value={active.from} fps={fps} marks={boundaries.starts} invalid={!activeRange} onChange={(from) => typeEdge('from', from)} />
            <button type="button" onClick={() => setEdge('from', snapToFrame(cursor, fps))} className="self-start text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">{t('exportCenter.rangeSetStart')}</button>
          </div>
          <div className="flex flex-col gap-1.5">
            <ExportTimeInput compact label={t('exportCenter.rangeTo')} boundaryLabel={t('exportCenter.rangeBoundary')} value={active.to} fps={fps} marks={boundaries.ends} invalid={!activeRange} onChange={(to) => typeEdge('to', to)} />
            <button type="button" onClick={() => setEdge('to', Math.min(snapToFrame(cursor, fps), totalMs))} className="self-start text-[11.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">{t('exportCenter.rangeSetEnd')}</button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('exportCenter.rangeHint')}</p>
        </div>}
        {error && <p role="alert" className="text-[12px] text-[var(--warn)]">{error}</p>}
        <div className="flex flex-col gap-2">
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--text-faint)]">{t('exportCenter.rangeDelivery')}</span>
          <div className="grid gap-2" role="group" aria-label={t('exportCenter.rangeDelivery')}>
            {(['separate', 'merged'] as const).map((mode) => <button key={mode} type="button" aria-pressed={delivery === mode} onClick={() => onDelivery(mode)}
              className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition ${delivery === mode ? 'border-[var(--text)] bg-[var(--bg-hover)]' : 'border-[var(--border)] hover:border-[var(--text-faint)]'}`}>
              <span className="text-[12.5px] font-medium text-[var(--text)]">{t(mode === 'separate' ? 'exportCenter.rangeSeparate' : 'exportCenter.rangeMerged')}</span>
              <span className="text-[11px] leading-snug text-[var(--text-faint)]">{t(mode === 'separate' ? 'exportCenter.rangeSeparateHint' : 'exportCenter.rangeMergedHint')}</span>
            </button>)}
          </div>
        </div>
      </aside>
    </div>
  );
}
