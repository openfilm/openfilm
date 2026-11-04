/**
 * The library's captions, one page (SPEC §1 Captions): what is said in the film made captions, a subtitle file made a
 * caption track, or a caption typed in at the playhead. Each says how the film stands first: how much is said and
 * whether all of it has a transcript, and which caption track the captions of speech are on, which making them again
 * replaces (its look kept), so they follow the film after it was cut. A film has caption tracks only once one is made
 * here (or by the agent, by a subtitle file dropped on the timeline, or from a project's subtitles of before).
 */
import React from 'react';
import { useT } from '@/i18n';

export interface CaptionsActions {
  /** Lines said with a transcript, and clips heard with none yet: 0 and 0, nothing is said. */
  lines: number;
  untranscribed: number;
  /** Transcribing, or making the track, now. */
  making: boolean;
  /** Why the speech with no transcript could not be transcribed; `connect`: no service can transcribe. */
  problem: { text: string; connect: boolean } | null;
  /** The caption track the captions of speech go onto again (its badge, V3), and the one a caption is added to; null: none yet. */
  speechTrack: string | null;
  captionTrack: string | null;
  /** Captions of what is said: on a new track, or again on `speechTrack`. */
  fromSpeech: () => void;
  /** Settings › Services, where a transcriber is connected. */
  connect: () => void;
  fromFile: (file: File) => void;
  /** A caption at the playhead, on `captionTrack` or a new track. */
  addOne: () => void;
}

export function CaptionsPane({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;
  const { lines, untranscribed, problem, speechTrack, captionTrack } = actions;
  const none = lines === 0 && untranscribed === 0;
  /* what is said: how much, what has no transcript yet (and why it stays so), where the captions are */
  const said = none ? t('timeline.captionsNone')
    : [lines ? t('assetDrawer.captionsSaid').replace('{n}', String(lines)) : '',
      untranscribed ? t('assetDrawer.captionsToHear').replace('{n}', String(untranscribed)) : ''].filter(Boolean).join(' · ');

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-2.5">
      <div className="flex flex-col gap-2.5">
        <Box title={t('assetDrawer.captionsSpeech')} text={t('assetDrawer.captionsSpeechText')}>
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{said}</p>
          {speechTrack ? <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.captionsOnTrack').replace('{track}', speechTrack)}</p> : null}
          {problem ? (
            <p className="text-[11.5px] leading-relaxed text-[var(--warn)]">
              {problem.connect ? t('assetDrawer.captionsNoTranscriber') : t('timeline.subtitlesFailed').replace('{error}', problem.text)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Go onClick={actions.fromSpeech} disabled={actions.making || none || (!lines && Boolean(problem?.connect))}>
              {actions.making ? t('timeline.captionsMaking') : speechTrack ? t('assetDrawer.captionsRemake') : t('assetDrawer.captionsSpeechGo')}
            </Go>
            {problem?.connect ? <Quiet onClick={actions.connect}>{t('assetDrawer.captionsConnect')}</Quiet> : null}
          </div>
          {speechTrack && !actions.making ? (
            <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('assetDrawer.captionsRemakeNote').replace('{track}', speechTrack)}</p>
          ) : null}
        </Box>
        <Box title={t('assetDrawer.captionsFile')} text={t('assetDrawer.captionsFileText')}>
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = fileOf(e.dataTransfer.files); if (f) actions.fromFile(f); }}
            className={`flex items-center gap-2 rounded-md border border-dashed px-3 py-2.5 ${over ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border-strong)]'}`}
          >
            <Quiet onClick={() => input.current?.click()}>{t('assetDrawer.captionsFileGo')}</Quiet>
            <span className="min-w-0 text-[11.5px] leading-snug text-[var(--text-faint)]">{t('assetDrawer.captionsFileDrop')}</span>
            <input ref={input} type="file" accept=".srt,.vtt" hidden
              onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) actions.fromFile(f); }} />
          </div>
        </Box>
        <Box title={t('assetDrawer.captionsNew')}
          text={captionTrack ? t('assetDrawer.captionsNewOnText').replace('{track}', captionTrack) : t('assetDrawer.captionsNewText')}>
          <Quiet onClick={actions.addOne}>{t('assetDrawer.captionsNewGo')}</Quiet>
        </Box>
      </div>
    </div>
  );
}

function Box({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-lg bg-[var(--bg-field)] p-3.5">
      <div className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold text-[var(--text)]">{title}</h3>
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{text}</p>
      </div>
      {children}
    </section>
  );
}

function Go({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="h-8 self-start rounded-md bg-[var(--primary)] px-3.5 text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:pointer-events-none disabled:opacity-50">
      {children}
    </button>
  );
}

function Quiet({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="h-8 shrink-0 self-start rounded-md bg-[var(--bg-raised)] px-3 text-[12.5px] font-medium text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border)] transition hover:bg-[var(--bg-hover)]">
      {children}
    </button>
  );
}
