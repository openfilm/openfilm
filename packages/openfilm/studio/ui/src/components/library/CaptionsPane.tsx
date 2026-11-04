/**
 * The library's captions, as its other categories are (SPEC §1 Captions): New, cards that put captions in — what is
 * said in the film made captions, a subtitle file made a caption track, one caption typed in at the playhead — and
 * Word art, the library's looks put on every caption of a track (LibraryDrawer draws those). A card says how the film
 * stands under its name: how much is said and what has no transcript yet, which track the captions of speech are on
 * (making them again puts what is said now, after cuts, in their place, their look kept). A click or its "+" does it.
 */
import React from 'react';
import { AudioLines, FileText, Plus, Type } from 'lucide-react';
import { useT } from '@/i18n';
import type { LibraryItem } from '@/lib/library';
import { ADD_HOVER, FOOT_ROOM, ROUND } from './AudioList';

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
  /** A word art of the library put on every caption of a track (the picked one's, else the speech's, else the top one). */
  look: (item: LibraryItem) => void;
}

export function CaptionsPane({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;
  const { lines, untranscribed, problem, speechTrack, captionTrack, making } = actions;
  const none = lines === 0 && untranscribed === 0;
  /* what is said: how much, and what has no transcript yet */
  const said = making ? t('timeline.captionsMaking')
    : none ? t('assetDrawer.captionsNoSpeech')
      : [lines ? t('assetDrawer.captionsSaid').replace('{n}', String(lines)) : '',
        untranscribed ? t('assetDrawer.captionsToHear').replace('{n}', String(untranscribed)) : ''].filter(Boolean).join(' · ');

  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-2.5 ${FOOT_ROOM}`}>
      {/* why some of what is said is not made captions, and where to change that */}
      {problem ? (
        <div role="status" className="mb-2.5 flex items-start gap-2 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
          <span className="min-w-0 flex-1">{problem.connect ? t('assetDrawer.captionsNoTranscriber') : t('timeline.subtitlesFailed').replace('{error}', problem.text)}</span>
          {problem.connect ? <button type="button" onClick={actions.connect} className="shrink-0 font-medium text-[var(--accent)] hover:underline">{t('assetDrawer.captionsConnect')}</button> : null}
        </div>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-x-2.5 gap-y-3">
        <ActionCard
          icon={<AudioLines size={22} strokeWidth={1.6} />}
          name={speechTrack ? t('assetDrawer.captionsRemake') : t('assetDrawer.captionsSpeech')}
          note={said}
          tip={speechTrack ? t('assetDrawer.captionsRemakeNote').replace('{track}', speechTrack) : t('assetDrawer.captionsSpeechText')}
          disabled={making || none}
          onRun={actions.fromSpeech}
        />
        <ActionCard
          icon={<FileText size={22} strokeWidth={1.6} />}
          name={t('assetDrawer.captionsFile')}
          note={t('assetDrawer.captionsFileNote')}
          tip={t('assetDrawer.captionsFileText')}
          onRun={() => input.current?.click()}
          onFile={(f) => actions.fromFile(f)}
          fileOf={fileOf}
        />
        <ActionCard
          icon={<Type size={22} strokeWidth={1.6} />}
          name={t('assetDrawer.captionsNew')}
          note={captionTrack ? t('assetDrawer.captionsOnTrack').replace('{track}', captionTrack) : t('assetDrawer.captionsNewNote')}
          tip={captionTrack ? t('assetDrawer.captionsNewOnText').replace('{track}', captionTrack) : t('assetDrawer.captionsNewText')}
          onRun={actions.addOne}
        />
      </div>
      <input ref={input} type="file" accept=".srt,.vtt" hidden
        onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) actions.fromFile(f); }} />
    </div>
  );
}

/**
 * A card that does something, drawn as the library's cards are: a tile with its mark, the "+" on it under the pointer,
 * its name under it and a line of how it stands. A subtitle file dropped on the file's card is taken as chosen.
 */
function ActionCard({ icon, name, note, tip, disabled, onRun, onFile, fileOf }: {
  icon: React.ReactNode; name: string; note: string; tip: string; disabled?: boolean; onRun: () => void;
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
        {icon}
        <span aria-hidden className={`${ROUND} ${ADD_HOVER} absolute bottom-1 right-1 hidden bg-black/55 text-white group-hover:grid group-disabled:hidden`}>
          <Plus size={12} strokeWidth={2.4} />
        </span>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[11.5px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{name}</div>
      <div className="truncate px-0.5 text-[10.5px] leading-snug text-[var(--text-faint)]" title={note}>{note}</div>
    </button>
  );
}
