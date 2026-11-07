/**
 * A sound in a card: its waveform as bars, lit as far as it has played, a click on it heard from there; one round
 * button to play and pause, and how long it is. One sound plays at a time on the board.
 */
import React from 'react';
import { Pause, Play } from 'lucide-react';
import { loadWavePeaks, type WorkspaceResource } from '@/lib/workspace-resources';
import { normalizeWavePeaks } from '@/lib/waveform-columns';
import { useT } from '@/i18n';
import { useBoard } from './board';

const BARS = 48;
let playing: HTMLAudioElement | null = null;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function SoundCard({ file, words }: { file: WorkspaceResource; words?: string }) {
  const t = useT();
  const board = useBoard();
  const src = board.sources.file(file);
  const audio = React.useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = React.useState<number[] | null>(null);
  const [on, setOn] = React.useState(false);
  const [at, setAt] = React.useState(0);
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
    void a.play().catch(() => setOn(false));
  };
  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const a = audio.current;
    const box = event.currentTarget.getBoundingClientRect();
    if (!a || !length) return;
    a.currentTime = ((event.clientX - box.left) / box.width) * length;
    setAt(a.currentTime);
    if (a.paused) toggle();
  };
  const done = length ? at / length : 0;
  return (
    <div className="flex h-full w-full flex-col justify-center gap-4 px-5">
      <audio ref={audio} src={src} preload="metadata"
        onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => { setOn(false); setAt(0); }}
        onTimeUpdate={(event) => setAt(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => { if (Number.isFinite(event.currentTarget.duration)) setLength(event.currentTarget.duration); }} />
      {words ? <p className="line-clamp-4 text-[13px] leading-relaxed text-[var(--cv-ink-2)]">{words}</p> : null}
      {/* the waveform, mirrored round its middle; a click plays from there */}
      <div className="nodrag flex h-16 cursor-pointer items-center gap-[2px]" onClick={seek}>
        {(peaks ?? Array.from({ length: BARS }, () => 0.08)).map((p, i) => (
          <span key={i} className={`min-w-0 flex-1 rounded-full transition-colors ${i / BARS < done ? 'bg-[var(--cv-ink)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_28%,transparent)]'}`}
            style={{ height: `${Math.max(6, p * 100)}%` }} />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={(event) => { event.stopPropagation(); toggle(); }} aria-label={t(on ? 'canvas.voice.stop' : 'canvas.voice.hear')}
          className="nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90">
          {on ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="translate-x-[1px]" />}
        </button>
        <span className="text-[12px] tabular-nums text-[var(--cv-ink-3)]">{clock(at)} / {clock(Math.round(length))}</span>
      </div>
    </div>
  );
}
