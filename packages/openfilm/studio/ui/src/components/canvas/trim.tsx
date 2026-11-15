/**
 * A part of a clip picked to keep: its start and end dragged on the clip's track (or set at the playhead, I and O), the
 * part played over and over (Space), kept as a clip of its own (Enter) — cut on this computer, free.
 */
import React from 'react';
import { Check, LoaderCircle, Pause, Play } from 'lucide-react';
import { useT } from '@/i18n';
import { CanvasModal } from './libraries';

const MIN_PART = 0.2;
/** frames shown along a clip's track */
const STRIP = 10;

/** A clip's frames side by side along its track, so a part is picked by what is in it. */
export function Filmstrip({ length, frameAt }: { length: number; frameAt?: (ms: number) => string }) {
  if (!frameAt || !length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex overflow-hidden rounded-[inherit] opacity-70">
      {Array.from({ length: STRIP }, (_, i) => (
        <img key={i} src={frameAt(Math.round(((i + 0.5) / STRIP) * length * 1000))} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
      ))}
    </div>
  );
}
const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function TrimEditor({ src, frameAt, onClose, onDone }: { src: string; frameAt?: (ms: number) => string; onClose: () => void; onDone: (from: number, to: number) => Promise<void> | void }) {
  const t = useT();
  const video = React.useRef<HTMLVideoElement>(null);
  const track = React.useRef<HTMLDivElement>(null);
  const [length, setLength] = React.useState(0);
  const [part, setPart] = React.useState<[number, number]>([0, 0]);
  const [at, setAt] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const dragging = React.useRef<'from' | 'to' | 'head' | null>(null);
  const partNow = React.useRef(part);
  partNow.current = part;

  /* playing keeps to the part: from its start, round again at its end */
  React.useEffect(() => {
    let frame = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        if (!v.paused && v.currentTime >= partNow.current[1]) v.currentTime = partNow.current[0];
        setAt(v.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const seek = (s: number) => { const v = video.current; if (v) v.currentTime = s; setAt(s); };
  const play = () => {
    const v = video.current;
    if (!v) return;
    if (!v.paused) { v.pause(); return; }
    if (v.currentTime < part[0] || v.currentTime >= part[1] - 0.05) v.currentTime = part[0];
    void v.play();
  };
  const done = async () => {
    if (busy || part[1] - part[0] < MIN_PART) return;
    setBusy(true);
    try { await onDone(part[0], part[1]); } finally { setBusy(false); }
  };
  const secondsAt = (x: number) => {
    const box = track.current!.getBoundingClientRect();
    return Math.min(length, Math.max(0, ((x - box.left) / box.width) * length));
  };
  const move = (x: number) => {
    const s = secondsAt(x);
    const which = dragging.current;
    if (which === 'from') { const v = Math.min(s, part[1] - MIN_PART); setPart([Math.max(0, v), part[1]]); seek(Math.max(0, v)); }
    else if (which === 'to') { const v = Math.max(s, part[0] + MIN_PART); setPart([part[0], Math.min(length, v)]); seek(Math.min(length, v)); }
    else if (which === 'head') seek(s);
  };
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || (event.target as HTMLElement).closest('input, textarea')) return;
      const take = (run: () => void) => { event.preventDefault(); event.stopPropagation(); run(); };
      if (event.code === 'Space') take(play);
      else if (event.key === 'Enter') take(() => { void done(); });
      else if (event.key === 'i' || event.key === 'I') take(() => setPart(([, b]) => [Math.min(at, b - MIN_PART), b]));
      else if (event.key === 'o' || event.key === 'O') take(() => setPart(([a]) => [a, Math.max(at, a + MIN_PART)]));
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') take(() => seek(Math.min(length, Math.max(0, at + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 1 / 24)))));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  const pct = (s: number) => `${length ? (s / length) * 100 : 0}%`;
  const grip = 'absolute top-0 z-10 flex h-full w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center';

  return (
    <CanvasModal label={t('canvas.clipTools.trim')} onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <span className="text-[14px] font-semibold">{t('canvas.clipTools.trim')}</span>
        <span className="text-[12px] text-[var(--cv-ink-3)]">{t('canvas.clipTools.trimHint')}</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <video ref={video} src={src} playsInline preload="auto" className="max-h-full max-w-full rounded-[10px] bg-black"
          onLoadedMetadata={(event) => { const d = event.currentTarget.duration; if (Number.isFinite(d)) { setLength(d); setPart([0, d]); } }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onClick={play} />
      </div>
      <div className="px-5 pb-2">
        {/* the clip's track: the part kept lit between its two grips, the playhead a line */}
        <div ref={track} className="nodrag relative h-14 touch-none select-none rounded-[10px] bg-[var(--cv-chip)]"
          onPointerDown={(event) => {
            if (!length) return;
            const s = secondsAt(event.clientX);
            const near = (v: number) => Math.abs(((v - s) / length) * track.current!.getBoundingClientRect().width) < 10;
            dragging.current = near(part[0]) ? 'from' : near(part[1]) ? 'to' : 'head';
            event.currentTarget.setPointerCapture(event.pointerId);
            move(event.clientX);
          }}
          onPointerMove={(event) => { if (dragging.current && event.currentTarget.hasPointerCapture(event.pointerId)) move(event.clientX); }}
          onPointerUp={() => { dragging.current = null; }}>
          <Filmstrip length={length} frameAt={frameAt} />
          <div className="absolute inset-y-0 rounded-l-[10px] bg-black/60" style={{ left: 0, width: pct(part[0]) }} />
          <div className="absolute inset-y-0 rounded-r-[10px] bg-black/60" style={{ left: pct(part[1]), right: 0 }} />
          <div className="absolute inset-y-0 rounded-[8px] border-2 border-[#4aa3ff]" style={{ left: pct(part[0]), width: pct(part[1] - part[0]) }} />
          <span className={grip} style={{ left: pct(part[0]) }}><span className="h-6 w-1.5 rounded-full bg-[#4aa3ff]" /></span>
          <span className={grip} style={{ left: pct(part[1]) }}><span className="h-6 w-1.5 rounded-full bg-[#4aa3ff]" /></span>
          <span className="pointer-events-none absolute -top-1 bottom-[-4px] w-0.5 -translate-x-1/2 rounded-full bg-white shadow" style={{ left: pct(at) }} />
        </div>
      </div>
      <div className="flex items-center gap-3 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
        <button type="button" aria-label={t(playing ? 'canvas.clipTools.pause' : 'canvas.clipTools.play')} onClick={play}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--cv-chip)] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </button>
        <span className="text-[12.5px] tabular-nums text-[var(--cv-ink-2)]">{time(part[0])} – {time(part[1])}</span>
        <span className="text-[12.5px] tabular-nums text-[var(--cv-ink-3)]">{t('canvas.clipTools.kept').replace('{s}', (part[1] - part[0]).toFixed(1))}</span>
        <span className="flex-1" />
        <button type="button" disabled={!length} onClick={() => setPart([0, length])}
          className="flex h-8 items-center rounded-[8px] px-2.5 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] disabled:opacity-35">{t('canvas.crop.reset')}</button>
        <button type="button" title="Enter" aria-busy={busy} disabled={busy || !length || part[1] - part[0] < MIN_PART} onClick={() => { void done(); }}
          className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-60">
          {busy ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" /> : <Check size={13} />}{t('canvas.clipTools.trimApply')}
        </button>
      </div>
    </CanvasModal>
  );
}
