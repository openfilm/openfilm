/**
 * The timeline's record button: sound from the microphone (lib/recorder), put on the film where the playhead was when
 * recording began. While it records the button becomes the time recorded, how loud it is now, Stop (kept: into the
 * project's media and onto a sound track) and Discard (nothing kept). Beside it, Voice-over: words spoken in one of the
 * voices of the services the person connected, put on the film at the playhead the same way (its words timed, so its
 * captions come with it).
 */
import React from 'react';
import { ChevronDown, Loader2, Mic, Square, X } from 'lucide-react';
import { useT } from '@/i18n';
import { MenuSelect } from './MenuSelect';
import { Popover } from './Popover';
import { meterPosition } from '@/lib/audio-levels';
import { recordingName, startRecording, type RecordProblem, type Recording } from '@/lib/recorder';
import { Tooltip } from './Tooltip';

export interface RecordButtonProps {
  /** The playhead now (film ms): where the recording goes. */
  now: () => number;
  /** The recording, kept: imported and placed at `atMs`. Null = done, else what went wrong. */
  onSave: (file: File, atMs: number) => Promise<string | null>;
  /** One sentence for the person: the microphone refused, missing, or a save that failed. */
  onProblem: (text: string) => void;
  /** Voice-over in a voice of a service connected: the voices, and the words spoken put at `atMs` (null = done, else why not). */
  voiceOver?: {
    voices: readonly { key: string; name: string; note: string }[];
    make: (voice: string, text: string, atMs: number) => Promise<string | null>;
    /** Settings › Services, where a voice-over service is connected. */
    connect: () => void;
  };
}

const elapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function RecordButton({ now, onSave, onProblem, voiceOver }: RecordButtonProps) {
  const t = useT();
  const [state, setState] = React.useState<'idle' | 'starting' | 'recording' | 'saving'>('idle');
  const recording = React.useRef<{ rec: Recording; atMs: number; at: Date } | null>(null);
  const [seconds, setSeconds] = React.useState(0);
  const meter = React.useRef<HTMLSpanElement | null>(null);

  /* the time and the meter, each frame while recording (the meter straight on its element: no render a frame) */
  React.useEffect(() => {
    if (state !== 'recording') return undefined;
    let frame = 0;
    const tick = () => {
      const on = recording.current;
      if (!on) return;
      setSeconds(Math.floor((performance.now() - on.rec.startedAt) / 1000));
      const peak = on.rec.level();
      if (meter.current) meter.current.style.width = `${Math.round(meterPosition(peak > 0 ? 20 * Math.log10(peak) : -Infinity) * 100)}%`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [state]);
  /* leaving the edit while recording keeps nothing, and lets the microphone go */
  React.useEffect(() => () => { recording.current?.rec.cancel(); recording.current = null; }, []);

  const start = async () => {
    if (state !== 'idle') return;
    setState('starting');
    const atMs = now();
    try {
      const rec = await startRecording();
      recording.current = { rec, atMs, at: new Date() };
      setSeconds(0);
      setState('recording');
    } catch (e) {
      setState('idle');
      const problem: RecordProblem = e === 'denied' || e === 'missing' ? e : 'failed';
      onProblem(t(`timeline.record.${problem}`));
    }
  };
  const stop = async () => {
    const on = recording.current;
    if (!on) return;
    recording.current = null;
    setState('saving');
    try {
      const file = await on.rec.stop(recordingName(t('timeline.record.fileName'), on.at));
      const failed = await onSave(file, on.atMs);
      if (failed) onProblem(failed);
    } catch (e) {
      onProblem(e instanceof Error && e.message ? e.message : t('timeline.record.failed'));
    } finally {
      setState('idle');
    }
  };
  const cancel = () => {
    recording.current?.rec.cancel();
    recording.current = null;
    setState('idle');
  };

  if (state === 'recording') {
    return (
      <div data-recording="" className="flex h-[28px] shrink-0 items-center gap-1.5 rounded-[6px] bg-[color-mix(in_srgb,var(--err)_14%,transparent)] pl-2 pr-0.5">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--err)]" aria-hidden />
        <span className="text-[11px] tabular-nums text-[var(--text)]" aria-label={t('timeline.record.recording')}>{elapsed(seconds * 1000)}</span>
        <span className="relative h-[4px] w-[36px] shrink-0 overflow-hidden rounded-full bg-black/10 dark:bg-white/15" aria-hidden>
          <span ref={meter} className="absolute inset-y-0 left-0 bg-[var(--err)]" style={{ width: 0 }} />
        </span>
        <Tooltip side="bottom" label={t('timeline.record.stop')}>
          <button type="button" data-record-stop="" onClick={() => void stop()} onMouseDown={(e) => e.preventDefault()} aria-label={t('timeline.record.stop')}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-[var(--err)] outline-none hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--accent)] dark:hover:bg-white/10">
            <Square size={12} fill="currentColor" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" label={t('timeline.record.cancel')}>
          <button type="button" data-record-cancel="" onClick={cancel} onMouseDown={(e) => e.preventDefault()} aria-label={t('timeline.record.cancel')}
            className="flex h-[24px] w-[24px] items-center justify-center rounded-[5px] text-[var(--text-muted)] outline-none hover:bg-black/5 focus-visible:ring-1 focus-visible:ring-[var(--accent)] dark:hover:bg-white/10">
            <X size={14} />
          </button>
        </Tooltip>
      </div>
    );
  }
  const busy = state !== 'idle';
  const label = state === 'saving' ? t('timeline.record.saving') : t('timeline.record.start');
  const mic = (
    <Tooltip side="bottom" label={label}>
      <button type="button" data-record="" onClick={() => void start()} onMouseDown={(e) => e.preventDefault()} aria-disabled={busy} aria-label={label}
        className={`flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[6px] outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${busy ? 'cursor-default' : 'hover:bg-[var(--bg-hover)]'}`}
        style={{ color: busy ? 'var(--text-faint)' : 'var(--text-muted)' }}>
        {state === 'saving' ? <Loader2 size={15} className="animate-spin" /> : <Mic size={16} />}
      </button>
    </Tooltip>
  );
  if (!voiceOver) return mic;
  return <span className="flex shrink-0 items-center">{mic}<VoiceOver {...voiceOver} now={now} onProblem={onProblem} /></span>;
}

/** Voice-over beside the record button: a voice, the words, made and put at the playhead. */
function VoiceOver({ voices, make, connect, now, onProblem }: NonNullable<RecordButtonProps['voiceOver']> & Pick<RecordButtonProps, 'now' | 'onProblem'>) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [voice, setVoice] = React.useState('');
  const [text, setText] = React.useState('');
  const [making, setMaking] = React.useState(false);
  const picked = voices.find((v) => v.key === voice) ?? voices[0] ?? null;
  const go = async () => {
    if (!picked || !text.trim() || making) return;
    setMaking(true);
    const why = await make(picked.key, text.trim(), now());
    setMaking(false);
    if (why) { onProblem(why); return; }
    setText('');
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen} align="start" trigger={(
      <Tooltip side="bottom" label={t('timeline.voiceOver.open')}>
        <button type="button" data-voice-over="" onClick={() => setOpen(!open)} aria-label={t('timeline.voiceOver.open')} aria-expanded={open}
          className="flex h-[28px] w-[16px] items-center justify-center rounded-[5px] text-[var(--text-muted)] outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
          <ChevronDown size={12} />
        </button>
      </Tooltip>
    )}>
      <div className="flex w-[300px] flex-col gap-2.5 rounded-lg bg-[var(--bg-raised)] p-3 shadow-[var(--shadow-lg)] ring-1 ring-[var(--border)]">
        <div className="text-[12.5px] font-semibold text-[var(--text)]">{t('timeline.voiceOver.title')}</div>
        {voices.length ? (
          <>
            <MenuSelect label={t('timeline.voiceOver.voice')} value={picked?.key ?? ''} menuWidth="content"
              groups={[{ choices: voices.map((v) => ({ value: v.key, label: `${v.name} · ${v.note}` })) }]} onPick={setVoice} />
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t('timeline.voiceOver.text')}
              className="resize-none rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]" />
            <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{t('timeline.voiceOver.note')}</p>
            <button type="button" disabled={!text.trim() || making} onClick={() => void go()}
              className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] text-[12.5px] font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)]">
              {making ? <Loader2 size={13} className="animate-spin" /> : null}{t(making ? 'timeline.voiceOver.making' : 'timeline.voiceOver.go')}
            </button>
          </>
        ) : (
          <>
            <p className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">{t('timeline.voiceOver.none')}</p>
            <button type="button" onClick={() => { setOpen(false); connect(); }}
              className="h-8 rounded-md bg-[var(--bg-field)] text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">{t('timeline.voiceOver.connect')}</button>
          </>
        )}
      </div>
    </Popover>
  );
}
