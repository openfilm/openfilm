/**
 * The library's captions: where a caption track comes from (SPEC §1 Captions). Made of what is said in the film, from
 * an SRT or WebVTT file, or new with one caption at the playhead; each a new caption track, edited after as any track
 * is. A film has caption tracks only once one is made here (or by the agent, or from a project's subtitles of before).
 */
import React from 'react';
import { useT } from '@/i18n';

export type CaptionsLine = 'speech' | 'file' | 'new';

export interface CaptionsActions {
  /** Lines heard with a transcript, and clips heard with none yet: 0 and 0, nothing is said. */
  lines: number;
  untranscribed: number;
  /** Transcribing, or making the track, now. */
  making: boolean;
  /** Why making them failed; `connect`: no service can transcribe. */
  problem: { text: string; connect: boolean } | null;
  /** Made of what is said (with `problem.connect`: Settings › Services instead). */
  fromSpeech: () => void;
  fromFile: (file: File) => void;
  blank: () => void;
}

export function CaptionsPane({ line, actions }: { line: CaptionsLine; actions: CaptionsActions }) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;

  if (line === 'file') {
    return (
      <Box title={t('assetDrawer.captionsFile')} text={t('assetDrawer.captionsFileText')}>
        <div
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = fileOf(e.dataTransfer.files); if (f) actions.fromFile(f); }}
          className={`flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-3 py-5 ${over ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border)]'}`}
        >
          <Go onClick={() => input.current?.click()} centered>{t('assetDrawer.captionsFileGo')}</Go>
          <span className="text-[11.5px] text-[var(--text-faint)]">{t('assetDrawer.captionsFileDrop')}</span>
          <input ref={input} type="file" accept=".srt,.vtt" hidden
            onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) actions.fromFile(f); }} />
        </div>
      </Box>
    );
  }
  if (line === 'new') {
    return (
      <Box title={t('assetDrawer.captionsNew')} text={t('assetDrawer.captionsNewText')}>
        <Go onClick={actions.blank}>{t('assetDrawer.captionsNewGo')}</Go>
      </Box>
    );
  }
  const none = actions.lines === 0 && actions.untranscribed === 0;
  const state = actions.problem
    ? (actions.problem.connect ? t('timeline.subtitlesConnect') : t('timeline.subtitlesFailed').replace('{error}', actions.problem.text))
    : none ? t('timeline.captionsNone')
      : [actions.lines ? t('assetDrawer.captionsHeard').replace('{n}', String(actions.lines)) : '',
        actions.untranscribed ? t('assetDrawer.captionsToHear').replace('{n}', String(actions.untranscribed)) : ''].filter(Boolean).join(' · ');
  return (
    <Box title={t('assetDrawer.captionsSpeech')} text={t('assetDrawer.captionsSpeechText')}>
      <Go onClick={actions.fromSpeech} disabled={actions.making || (none && !actions.problem?.connect)}>
        {actions.making ? t('timeline.captionsMaking') : actions.problem?.connect ? t('assetDrawer.captionsConnect') : t('assetDrawer.captionsSpeechGo')}
      </Go>
      {state ? <p className={`text-[11.5px] leading-relaxed ${actions.problem ? 'text-[var(--warn)]' : 'text-[var(--text-faint)]'}`}>{state}</p> : null}
    </Box>
  );
}

function Box({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-2.5">
      <div className="flex flex-col gap-3 rounded-lg bg-[var(--bg-field)] p-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-[13px] font-semibold text-[var(--text)]">{title}</h3>
          <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{text}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

function Go({ onClick, disabled, centered, children }: { onClick: () => void; disabled?: boolean; centered?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`h-8 ${centered ? 'self-center' : 'self-start'} rounded-md bg-[var(--primary)] px-3.5 text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:pointer-events-none disabled:opacity-50`}>
      {children}
    </button>
  );
}
