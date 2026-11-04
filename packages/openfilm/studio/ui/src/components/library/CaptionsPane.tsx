/**
 * The library's captions, as its other categories are (SPEC §1 Captions): cards that put captions in the film. New:
 * what is said made captions (which Studio makes by itself once something is said, from the transcripts as they are,
 * and keeps following the cuts until they are changed by hand), a subtitle file made a caption track, one caption
 * typed in at the playhead. Translate: a
 * card for each language, the film's captions translated into it on a track of their own just above them. A card says
 * how the film stands under its name (how much is said and what has no transcript yet, the track a caption goes onto,
 * the track a language is on already); making the captions of speech again puts what is said now, after cuts, in place
 * of theirs, their look kept. A click or its "+" does it.
 */
import React from 'react';
import { AudioLines, FileText, Loader2, Plus, Type } from 'lucide-react';
import { FILM_SUBTITLE_LANGUAGES } from '../../../../server/film-subtitle.mjs';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { ADD_HOVER, FOOT_ROOM, ROUND } from './AudioList';

export type CaptionsLine = 'new' | 'translate';

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
  /** The captions of speech are as Studio wrote them: they follow the cuts by themselves. */
  speechAuto: boolean;
  /** The caption track a translation is made of (the picked one's, else the speech's, else the top original), and each
      language a track is in already, by its code (`en` → V6). */
  translateFrom: string | null;
  translations: Readonly<Record<string, string>>;
  /** Captions of what is said: on a new track, or again on `speechTrack`. */
  fromSpeech: () => void;
  /** Settings › Services, where a transcriber is connected. */
  connect: () => void;
  fromFile: (file: File) => void;
  /** A caption at the playhead, on `captionTrack` or a new track. */
  addOne: () => void;
  /** `translateFrom`'s captions in a language, on a new track just above it: null when done, else why not. */
  translate: (language: string) => Promise<{ error: string; connect: boolean } | null>;
}

export function CaptionsPane({ line, actions }: { line: CaptionsLine; actions: CaptionsActions }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-2.5 ${FOOT_ROOM}`}>
      {line === 'translate' ? <Translate actions={actions} /> : <New actions={actions} />}
    </div>
  );
}

function New({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;
  const { lines, untranscribed, problem, speechTrack, captionTrack, making, speechAuto } = actions;
  const none = lines === 0 && untranscribed === 0;
  /* what is said: how much, and what has no transcript yet */
  const said = making ? t('timeline.captionsMaking')
    : none ? t('assetDrawer.captionsNoSpeech')
      : [lines ? t('assetDrawer.captionsSaid').replace('{n}', String(lines)) : '',
        untranscribed ? t('assetDrawer.captionsToHear').replace('{n}', String(untranscribed)) : ''].filter(Boolean).join(' · ');
  return (
    <>
      {/* why some of what is said is not made captions, and where to change that */}
      {problem ? (
        <Notice text={problem.connect ? t('assetDrawer.captionsNoTranscriber') : t('timeline.subtitlesFailed').replace('{error}', problem.text)}
          action={problem.connect ? { label: t('assetDrawer.captionsConnect'), run: actions.connect } : undefined} />
      ) : null}
      <Grid>
        <ActionCard
          tile={<AudioLines size={22} strokeWidth={1.6} />}
          name={!speechTrack ? t('assetDrawer.captionsSpeech') : speechAuto ? t('assetDrawer.captionsAuto') : t('assetDrawer.captionsRemake')}
          note={!speechTrack || making ? said : speechAuto ? t('assetDrawer.captionsAutoNote').replace('{track}', speechTrack) : t('assetDrawer.captionsTouched')}
          tip={speechTrack ? t('assetDrawer.captionsRemakeNote').replace('{track}', speechTrack) : t('assetDrawer.captionsSpeechText')}
          disabled={making || none}
          onRun={actions.fromSpeech}
        />
        <ActionCard
          tile={<FileText size={22} strokeWidth={1.6} />}
          name={t('assetDrawer.captionsFile')}
          note={t('assetDrawer.captionsFileNote')}
          tip={t('assetDrawer.captionsFileText')}
          onRun={() => input.current?.click()}
          onFile={(f) => actions.fromFile(f)}
          fileOf={fileOf}
        />
        <ActionCard
          tile={<Type size={22} strokeWidth={1.6} />}
          name={t('assetDrawer.captionsNew')}
          note={captionTrack ? t('assetDrawer.captionsOnTrack').replace('{track}', captionTrack) : t('assetDrawer.captionsNewNote')}
          tip={captionTrack ? t('assetDrawer.captionsNewOnText').replace('{track}', captionTrack) : t('assetDrawer.captionsNewText')}
          onRun={actions.addOne}
        />
      </Grid>
      <input ref={input} type="file" accept=".srt,.vtt" hidden
        onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) actions.fromFile(f); }} />
    </>
  );
}

/** A card for each language: the captions translated into it, one at a time; a language on a track already says where. */
function Translate({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const ui = useLanguage();
  /* a language named in the person's own (the tile says it in its own) */
  const named = React.useMemo(() => { try { return new Intl.DisplayNames([ui], { type: 'language' }); } catch { return null; } }, [ui]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<{ error: string; connect: boolean } | null>(null);
  const from = actions.translateFrom;
  const run = async (language: string) => {
    setBusy(language);
    setFailed(null);
    const why = await actions.translate(language);
    setBusy(null);
    setFailed(why);
  };
  const failure = failed?.connect ? (studioHost?.agents ? 'timeline.subtitleTranslateAgent' : 'timeline.subtitleTranslateConnect') : 'timeline.subtitleTranslateFailed';
  return (
    <>
      {!from ? <Notice text={t('assetDrawer.captionsNeedTrack')} />
        : failed ? <Notice text={t(failure)} tip={failed.error} />
          : <p className="mb-2.5 px-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.captionsTranslateFrom').replace('{track}', from)}</p>}
      <Grid>
        {FILM_SUBTITLE_LANGUAGES.map((lang) => {
          const on = actions.translations[lang.code];
          return (
            <ActionCard
              key={lang.code}
              tile={busy === lang.code ? <Loader2 size={18} className="animate-spin" /> : <span className="px-1 text-center text-[14px] font-medium leading-tight">{lang.native}</span>}
              name={named?.of(lang.code) ?? lang.english}
              note={busy === lang.code ? t('assetDrawer.captionsTranslating') : on ? t('assetDrawer.captionsTranslated').replace('{track}', on) : ''}
              tip={from ? t('assetDrawer.captionsTranslateTip').replace('{track}', from).replace('{lang}', lang.native) : t('assetDrawer.captionsNeedTrack')}
              disabled={!from || busy != null}
              onRun={() => void run(lang.code)}
            />
          );
        })}
      </Grid>
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-2.5 gap-y-3">{children}</div>;
}

/** A line over the cards: why something is not done, and where to change that. */
function Notice({ text, tip, action }: { text: string; tip?: string; action?: { label: string; run: () => void } }) {
  return (
    <div role="status" title={tip} className="mb-2.5 flex items-start gap-2 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
      <span className="min-w-0 flex-1">{text}</span>
      {action ? <button type="button" onClick={action.run} className="shrink-0 font-medium text-[var(--accent)] hover:underline">{action.label}</button> : null}
    </div>
  );
}

/**
 * A card that does something, drawn as the library's cards are: a tile with its mark, the "+" on it under the pointer,
 * its name under it and a line of how it stands. A subtitle file dropped on the file's card is taken as chosen.
 */
function ActionCard({ tile, name, note, tip, disabled, onRun, onFile, fileOf }: {
  tile: React.ReactNode; name: string; note: string; tip: string; disabled?: boolean; onRun: () => void;
  onFile?: (file: File) => void; fileOf?: (files: FileList | null) => File | null;
}) {
  const [over, setOver] = React.useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onRun}
      title={tip}
      onDragOver={onFile ? (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } } : undefined}
      onDragLeave={onFile ? () => setOver(false) : undefined}
      onDrop={onFile && fileOf ? (e) => { e.preventDefault(); setOver(false); const f = fileOf(e.dataTransfer.files); if (f) onFile(f); } : undefined}
      className="group relative min-w-0 cursor-default select-none text-left disabled:opacity-50"
    >
      <div className={`relative grid aspect-video place-items-center overflow-hidden rounded-md bg-[var(--bg-field)] text-[var(--text-muted)] group-hover:text-[var(--text)] ${over ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        {tile}
        <span aria-hidden className={`${ROUND} ${ADD_HOVER} absolute bottom-1 right-1 hidden bg-black/55 text-white group-hover:grid group-disabled:hidden`}>
          <Plus size={12} strokeWidth={2.4} />
        </span>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[11.5px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{name}</div>
      <div className="truncate px-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]" title={note}>{note || '\u00a0'}</div>
    </button>
  );
}
