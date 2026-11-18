/**
 * A sound in a card, laid out as a recorder shows one: its words, if it says some, faint at the top; its waveform in the
 * middle as thin bars round a line (a quiet stretch a row of dots), lit as far as it has played, with the playhead, a
 * line topped by a dot; under it the time, large, its leading zeros dim, and a round button to play and pause. A click
 * on the waveform is heard from there; dragging along it moves the playhead. Before it is played the time says how
 * long it is. One sound plays at a time on the board.
 */
import React from 'react';
import { Pause, Play } from 'lucide-react';
import { loadWavePeaks, type WorkspaceResource } from '@/lib/workspace-resources';
import { normalizeWavePeaks } from '@/lib/waveform-columns';
import { useT } from '@/i18n';
import { useBoard } from './board';

const BARS = 64;
/** Below this a bar is a dot: the sound is quiet there. */
const QUIET = 0.06;
let playing: HTMLAudioElement | null = null;

/** The time as three pairs, hours : minutes : seconds, and how many of them lead with nothing (drawn dim). */
function timeParts(s: number): { parts: string[]; dim: number } {
  const whole = Math.max(0, Math.floor(s));
  const parts = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60].map((n) => String(n).padStart(2, '0'));
  let dim = 0;
  while (dim < parts.length - 1 && parts[dim] === '00') dim++;
  return { parts, dim };
}

export function SoundCard({ file, words }: { file: WorkspaceResource; words?: string }) {
  const t = useT();
  const board = useBoard();
  const src = board.sources.file(file);
  const audio = React.useRef<HTMLAudioElement>(null);
  const wave = React.useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = React.useState<number[] | null>(null);
  const [on, setOn] = React.useState(false);
  const [at, setAt] = React.useState(0);
  /* played (or moved along) at least once: the time says where it is, else how long it is */
  const [begun, setBegun] = React.useState(false);
  const [length, setLength] = React.useState(file.durationMs ? file.durationMs / 1000 : 0);
  React.useEffect(() => {
    let live = true;
    void loadWavePeaks(board.sources.wave(file)).then((got) => {
      if (!live || !got?.length) return;
      /* the file's peaks gathered into as many bars as are drawn, each its loudest */
      const all = normalizeWavePeaks(got);
      const per = all.length / BARS;
      setPeaks(Array.from({ length: BARS }, (_, i) => Math.max(0, ...all.slice(Math.floor(i * per), Math.max(Math.floor(i * per) + 1, Math.floor((i + 1) * per))))));
    });
    return () => { live = false; };
  }, [board.sources, file]);
  React.useEffect(() => () => { if (playing === audio.current) playing = null; }, []);
  const toggle = () => {
    const a = audio.current;
    if (!a) return;
    if (!a.paused) { a.pause(); return; }
    if (playing && playing !== a) playing.pause();
    playing = a;
    setBegun(true);
    void a.play().catch(() => setOn(false));
  };
  /* the waveform's place under the pointer, as a time */
  const timeAt = (clientX: number) => {
    const box = wave.current?.getBoundingClientRect();
    if (!box || !box.width || !length) return null;
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width)) * length;
  };
  const moveTo = (clientX: number) => {
    const a = audio.current, time = timeAt(clientX);
    if (!a || time == null) return;
    a.currentTime = time;
    setAt(time);
    setBegun(true);
  };
  /* a press on the waveform moves the playhead there, and along as it drags; one that did not drag plays from there */
  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !length) return;
    event.stopPropagation();
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    const from = event.clientX;
    let dragged = false;
    moveTo(event.clientX);
    const move = (e: PointerEvent) => { if (Math.abs(e.clientX - from) > 3) dragged = true; moveTo(e.clientX); };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (!dragged && audio.current?.paused) toggle();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const done = length ? Math.min(1, at / length) : 0;
  const shown = timeParts(begun || on ? at : length);
  return (
    <div className="flex h-full w-full flex-col px-6 pb-5 pt-5" data-sound-card="">
      <audio ref={audio} src={src} preload="metadata"
        onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setAt(0); }}
        onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setLength(event.currentTarget.duration); }} />
      {words ? <p className="line-clamp-2 text-[12.5px] leading-[18px] text-[var(--cv-ink-3)]">{words}</p> : null}

      {/* the waveform round its middle line, the playhead over it; pressed or dragged, the sound is moved there */}
      <div className="flex min-h-0 flex-1 items-center">
        <div ref={wave} onPointerDown={press} data-sound-wave=""
          className="nodrag relative flex h-[46%] min-h-[64px] w-full cursor-pointer touch-none items-center justify-between">
          {(peaks ?? Array.from({ length: BARS }, () => 0)).map((p, i) => {
            const lit = (i + 0.5) / BARS <= done;
            const tone = lit ? 'bg-[var(--cv-ink)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_30%,transparent)]';
            return p < QUIET
              ? <span key={i} className={`h-[2px] w-[2px] shrink-0 rounded-full ${tone}`} />
              : <span key={i} className={`w-[2px] shrink-0 rounded-full ${tone}`} style={{ height: `${Math.min(100, p * 100)}%` }} />;
          })}
          {begun || on ? (
            <span aria-hidden className="pointer-events-none absolute -bottom-[14%] -top-[14%] w-0" style={{ left: `${done * 100}%` }}>
              <span className="absolute inset-y-0 left-[-1px] w-[2px] rounded-full bg-[var(--cv-edge-lit)]" />
              <span className="absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full bg-[var(--cv-edge-lit)]" />
            </span>
          ) : null}
        </div>
      </div>

      {/* the time, large (its leading zeros dim), and the button that plays it */}
      <div className="flex items-end justify-between gap-3">
        <span className="whitespace-nowrap text-[30px] font-light leading-none tracking-[-0.01em] tabular-nums" aria-label={shown.parts.join(':')}>
          {shown.parts.map((part, i) => (
            <React.Fragment key={i}>
              {i ? <span className={`mx-[0.18em] ${i <= shown.dim ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)]'}`}>:</span> : null}
              <span className={i < shown.dim ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)]'}>{part}</span>
            </React.Fragment>
          ))}
        </span>
        <button type="button" onClick={(event) => { event.stopPropagation(); toggle(); }} aria-label={t(on ? 'canvas.voice.stop' : 'canvas.voice.hear')}
          className="nodrag flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--cv-ink)_10%,transparent)] text-[var(--cv-ink)] transition hover:bg-[color-mix(in_srgb,var(--cv-ink)_16%,transparent)]">
          {on ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} className="translate-x-[1.5px]" />}
        </button>
      </div>
    </div>
  );
}
