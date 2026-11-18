/**
 * Recording from the microphone (lib/recorder), the library's voice-over Record line (components/library/LibraryDrawer):
 * the sound is put on the film where the playhead was when recording began. The recording itself is the edit's
 * (useRecorder, held by ProjectView), so it goes on while the drawer shows something else or is closed, and the
 * voice-over category says it is recording; leaving the edit keeps nothing and lets the microphone go.
 */
import React from 'react';
import { Loader2, Square, TriangleAlert, X } from 'lucide-react';
import { useT } from '@/i18n';
import { meterPosition } from '@/lib/audio-levels';
import { recordingName, startRecording, type RecordProblem, type Recording } from '@/lib/recorder';

export interface RecorderProps {
  /** The playhead now (film ms): where the recording goes. */
  now: () => number;
  /** The recording, kept: imported and placed at `atMs`. Null = done, else what went wrong. */
  onSave: (file: File, atMs: number) => Promise<string | null>;
}

/** A recording under way, or none: what the Record line draws and the voice-over category shows. */
export interface Recorder {
  state: 'idle' | 'starting' | 'recording' | 'saving';
  /** The one under way (its start and level), while recording. */
  current: () => Recording | null;
  /** One sentence for the person: the microphone refused, missing, or a save that failed. */
  problem: string | null;
  start: () => void;
  /** Stop, and put it on the film. */
  stop: () => void;
  /** Stop and keep nothing. */
  cancel: () => void;
}

export function useRecorder({ now, onSave }: RecorderProps): Recorder {
  const t = useT();
  const [state, setState] = React.useState<Recorder['state']>('idle');
  const [problem, setProblem] = React.useState<string | null>(null);
  const recording = React.useRef<{ rec: Recording; atMs: number; at: Date } | null>(null);
  const busy = React.useRef(false);
  /* leaving the edit while recording keeps nothing, and lets the microphone go */
  React.useEffect(() => () => { recording.current?.rec.cancel(); recording.current = null; }, []);

  const start = React.useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    setState('starting');
    const atMs = now();
    try {
      const rec = await startRecording();
      recording.current = { rec, atMs, at: new Date() };
      setState('recording');
    } catch (e) {
      busy.current = false;
      setState('idle');
      const why: RecordProblem = e === 'denied' || e === 'missing' ? e : 'failed';
      setProblem(t(`timeline.record.${why}`));
    }
  }, [now, t]);
  const stop = React.useCallback(async () => {
    const on = recording.current;
    if (!on) return;
    recording.current = null;
    setState('saving');
    try {
      const file = await on.rec.stop(recordingName(t('timeline.record.fileName'), on.at));
      setProblem(await onSave(file, on.atMs));
    } catch (e) {
      setProblem(e instanceof Error && e.message ? e.message : t('timeline.record.failed'));
    } finally {
      busy.current = false;
      setState('idle');
    }
  }, [onSave, t]);
  const cancel = React.useCallback(() => {
    recording.current?.rec.cancel();
    recording.current = null;
    busy.current = false;
    setState('idle');
  }, []);
  return React.useMemo(() => ({
    state, problem, current: () => recording.current?.rec ?? null,
    start: () => void start(), stop: () => void stop(), cancel,
  }), [state, problem, start, stop, cancel]);
}

const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** The Record line: one large button, and while recording the time, how loud it is now, Stop and Discard. */
/** `compact`: a card in My voices (the button beside its words), not the whole pane */
export function RecordPane({ recorder, compact = false }: { recorder: Recorder; compact?: boolean }) {
  const t = useT();
  const { state } = recorder;
  const [seconds, setSeconds] = React.useState(0);
  const meter = React.useRef<HTMLSpanElement | null>(null);
  /* the time and the meter, each frame while recording (the meter straight on its element: no render a frame) */
  React.useEffect(() => {
    if (state !== 'recording') { setSeconds(0); return undefined; }
    let frame = 0;
    const tick = () => {
      const rec = recorder.current();
      if (!rec) return;
      setSeconds(Math.floor((performance.now() - rec.startedAt) / 1000));
      const peak = rec.level();
      if (meter.current) meter.current.style.width = `${Math.round(meterPosition(peak > 0 ? 20 * Math.log10(peak) : -Infinity) * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state, recorder]);

  const recording = state === 'recording';
  const label = state === 'saving' ? t('timeline.record.saving') : recording ? t('timeline.record.stop') : t('timeline.record.start');
  return (
    <div data-record-pane={state} className={compact
      ? 'mx-3 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-[12px] bg-[var(--bg-field)] px-3 py-3 text-left [&>*:nth-child(n+3)]:col-start-2'
      : 'flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-6 pt-10 text-center'}>
      <button type="button" data-record={recording ? 'stop' : ''} aria-label={label} aria-disabled={state === 'starting' || state === 'saving'}
        onClick={() => { if (recording) recorder.stop(); else if (state === 'idle') recorder.start(); }}
        className={`${compact ? 'row-span-2 h-11 w-11' : 'h-16 w-16'} grid place-items-center rounded-full border-2 border-[var(--border-strong)] outline-none transition hover:border-[var(--text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]`}>
        {state === 'saving' || state === 'starting' ? <Loader2 size={compact ? 18 : 22} className="animate-spin text-[var(--text-muted)]" />
          : recording ? <Square size={compact ? 14 : 18} fill="currentColor" className="text-[var(--err)]" />
            : <span className={`${compact ? 'h-6 w-6' : 'h-9 w-9'} rounded-full bg-[var(--err)]`} />}
      </button>
      <span className={`${compact ? '' : 'mt-3'} text-[12.5px] font-medium text-[var(--text)]`}>{label}</span>
      {recording ? (
        <div className={`${compact ? 'mt-1' : 'mt-4'} flex items-center gap-2`}>
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--err)]" aria-hidden />
          <span className="text-[13px] tabular-nums text-[var(--text)]" aria-label={t('timeline.record.recording')}>{elapsed(seconds * 1000)}</span>
          <span className="relative h-[4px] w-[72px] shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" aria-hidden>
            <span ref={meter} className="absolute inset-y-0 left-0 bg-[var(--err)]" style={{ width: 0 }} />
          </span>
          <button type="button" data-record-cancel="" onClick={recorder.cancel} aria-label={t('timeline.record.cancel')} title={t('timeline.record.cancel')}
            className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--text-muted)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
            <X size={14} />
          </button>
        </div>
      ) : (
        <p className={`${compact ? 'mt-0.5' : 'mt-2 max-w-[240px]'} text-[11.5px] leading-relaxed text-[var(--text-faint)]`}>{t('timeline.record.hint')}</p>
      )}
      {recorder.problem ? (
        <p data-record-problem="" className={`${compact ? 'mt-2' : 'mt-5 max-w-[260px]'} flex items-start gap-1.5 rounded-md bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] px-2.5 py-2 text-left text-[11.5px] leading-relaxed text-[var(--text)]`}>
          <TriangleAlert size={13} className="mt-[2px] shrink-0 text-[var(--warn)]" aria-hidden />{recorder.problem}
        </p>
      ) : null}
    </div>
  );
}
