/**
 * The library's New captions (SPEC §1 Captions): caption tracks made of what the film says, or of a subtitle file (SRT,
 * WebVTT). Of speech: a sound with a transcript of its words (a voice made with them timed) is used as it is, nothing
 * to choose; one with none is transcribed only when ticked, here or on its clip on the timeline (ProjectView lights
 * the clips the captions are made of while this page is open). What is made: the captions in the words said (on the
 * track of speech when there is one, made again there), a translation of them into a language on a track of its own,
 * or both. The captions of speech also make themselves and follow the cuts until changed by hand; this page says so.
 * A caption's look is the inspector's (components/CaptionInspector), on the track or the captions picked.
 */
import React from 'react';
import { Check, FileText } from 'lucide-react';
import { FILM_SUBTITLE_LANGUAGES } from '../../../../server/film-subtitle.mjs';
import { useLanguage, useT } from '@/i18n';
import { MenuSelect } from '../MenuSelect';
import { CcMark } from '../CcMark';
import { FOOT_ROOM } from './AudioList';

/** A clip of the timeline that speaks: with a transcript of its words, or none yet. */
export interface HeardClip {
  clipId: string;
  name: string;
  startMs: number;
  endMs: number;
  transcribed: boolean;
}

/** What to make: the captions in the words said, and/or their translation into `translate`. */
export interface CaptionsMake { original: boolean; translate: string | null }

export interface CaptionsActions {
  /** The clips that speak, top track first. */
  heard: readonly HeardClip[];
  /** The clips with no transcript ticked to be transcribed (the timeline ticks them too). */
  picked: ReadonlySet<string>;
  pick: (clipId: string, on: boolean) => void;
  /** This page shows the clips to choose from (they are lit on the timeline while it does). */
  choosing: (on: boolean) => void;
  /** Transcribing, or making the tracks, now. */
  making: boolean;
  /** Why the speech with no transcript could not be transcribed; `connect`: no service can transcribe. */
  problem: { text: string; connect: boolean } | null;
  /** The track of the captions of speech (its badge, V3), and whether they follow the cuts by themselves (not changed by hand). */
  speechTrack: string | null;
  speechAuto: boolean;
  /** The top caption track (a caption typed in goes there); null: none. */
  captionTrack: string | null;
  /** Captions of what the clips with a transcript and the ticked ones say. */
  make: (o: CaptionsMake) => void;
  fromFile: (file: File, o: CaptionsMake) => void;
  /** Settings › Services, where a transcriber is connected. */
  connect: () => void;
  /** A caption at the playhead, on `captionTrack` or a new track. */
  addOne: () => void;
}

export function CaptionsPane({ actions }: { actions: CaptionsActions }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-2.5 ${FOOT_ROOM}`}>
      <New actions={actions} />
    </div>
  );
}

const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function New({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const ui = useLanguage();
  const input = React.useRef<HTMLInputElement>(null);
  const [source, setSource] = React.useState<'speech' | 'file'>('speech');
  const [original, setOriginal] = React.useState(true);
  const [translate, setTranslate] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [over, setOver] = React.useState(false);
  const named = React.useMemo(() => { try { return new Intl.DisplayNames([ui], { type: 'language' }); } catch { return null; } }, [ui]);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;
  const { heard, picked, making, problem, speechTrack, speechAuto, choosing } = actions;
  /* the timeline lights the clips chosen while the clips are shown here */
  React.useEffect(() => { choosing(source === 'speech'); return () => choosing(false); }, [source, choosing]);
  const ready = heard.filter((h) => h.transcribed);
  const wanting = heard.filter((h) => !h.transcribed);
  const ticked = wanting.filter((h) => picked.has(h.clipId));
  const languages = FILM_SUBTITLE_LANGUAGES.map((l) => ({ value: l.code, label: named?.of(l.code) ?? l.native }));
  /* the language a translation is into: the one picked, else English (Chinese for a person reading English) */
  const [language, setLanguage] = React.useState(() => (ui.startsWith('en') ? 'zh' : 'en'));
  const languageName = languages.find((l) => l.value === language)?.label ?? language;
  const translating = translate != null;
  const what: CaptionsMake = { original, translate };
  const has = source === 'speech' ? ready.length + ticked.length > 0 : file != null;
  /* what the button will do, said under it */
  const into = source === 'speech' && speechTrack ? t('assetDrawer.captionsIntoTrack').replace('{track}', speechTrack) : t('assetDrawer.captionsIntoNew');
  const steps = [
    original ? (source === 'speech' && speechTrack ? t('assetDrawer.captionsPlanUpdate').replace('{track}', speechTrack) : t('assetDrawer.captionsPlanNew')) : null,
    translating ? t('assetDrawer.captionsPlanTranslate').replace('{lang}', languageName) : null,
  ].filter(Boolean);
  const plan = steps.length ? `${t('assetDrawer.captionsPlanLead')}${steps.join(t('assetDrawer.captionsPlanAnd'))}${t('assetDrawer.captionsPlanEnd')}` : '';
  const go = () => { if (source === 'speech') actions.make(what); else if (file) actions.fromFile(file, what); };
  return (
    <div className="flex flex-col gap-4">
      {/* the captions of speech made by themselves: where they are, and whether they still follow the cuts */}
      {speechTrack ? (
        <Notice text={speechAuto ? t('assetDrawer.captionsAutoOn').replace('{track}', speechTrack) : t('assetDrawer.captionsAutoOff').replace('{track}', speechTrack)} />
      ) : null}
      <Field label={t('assetDrawer.captionsSource')}>
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-md bg-[var(--bg-field)] p-0.5">
          {(['speech', 'file'] as const).map((id) => (
            <button key={id} type="button" role="radio" aria-checked={source === id} onClick={() => setSource(id)}
              className={`h-7 rounded-[5px] text-[12px] font-medium ${source === id ? 'bg-[var(--bg-picked)] text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
              {t(id === 'speech' ? 'assetDrawer.captionsFromSpeech' : 'assetDrawer.captionsFromFile')}
            </button>
          ))}
        </div>
      </Field>
      {source === 'speech' ? (
        heard.length ? (
          <>
            {/* what has its words already: nothing to choose, used as it is */}
            {ready.length ? (
              <Field label={t('assetDrawer.captionsReady')} note={t('assetDrawer.captionsReadyNote')}>
                <div data-captions-ready="" className="flex flex-col overflow-hidden rounded-md bg-[var(--bg-field)] py-0.5">
                  {ready.map((h) => (
                    <div key={h.clipId} className="flex h-7 items-center gap-2 px-2.5 text-[12px]">
                      <CcMark className="shrink-0 text-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate text-[var(--text)]">{h.name}</span>
                      <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--text-faint)]">{mmss(h.startMs)}–{mmss(h.endMs)}</span>
                    </div>
                  ))}
                </div>
              </Field>
            ) : null}
            {/* what would have to be heard first: only what is ticked, here or on its clip */}
            <Field label={t('assetDrawer.captionsWanting')} note={wanting.length ? t('assetDrawer.captionsWantingNote') : undefined}>
              {wanting.length ? (
                <div data-captions-wanting="" className="flex flex-col overflow-hidden rounded-md bg-[var(--bg-field)]">
                  {wanting.map((h) => {
                    const on = picked.has(h.clipId);
                    return (
                      <button key={h.clipId} type="button" role="checkbox" aria-checked={on} onClick={() => actions.pick(h.clipId, !on)}
                        className="flex h-8 items-center gap-2 px-2.5 text-left text-[12px] hover:bg-[var(--bg-hover)]">
                        <Box on={on} />
                        <span className="min-w-0 flex-1 truncate text-[var(--text)]">{h.name}</span>
                        <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--text-faint)]">{mmss(h.startMs)}–{mmss(h.endMs)}</span>
                      </button>
                    );
                  })}
                </div>
              ) : <p className="text-[11.5px] text-[var(--text-faint)]">{t('assetDrawer.captionsNoneWanting')}</p>}
            </Field>
          </>
        ) : <p className="text-[12px] text-[var(--text-faint)]">{t('assetDrawer.captionsNoSpeech')}</p>
      ) : (
        <Field label={t('assetDrawer.captionsFile')} note={t('assetDrawer.captionsFileText')}>
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = fileOf(e.dataTransfer.files); if (f) setFile(f); }}
            className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-5 ${over ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border-strong)]'}`}
          >
            <FileText size={20} strokeWidth={1.6} className={file ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
            {file ? <span data-captions-file="" className="max-w-full truncate text-[12px] text-[var(--text)]">{file.name}</span> : null}
            <Quiet onClick={() => input.current?.click()}>{t(file ? 'assetDrawer.captionsFileOther' : 'assetDrawer.captionsFileGo')}</Quiet>
            <span className="text-[11px] text-[var(--text-faint)]">{t('assetDrawer.captionsFileDrop')}</span>
          </div>
          <input ref={input} type="file" accept=".srt,.vtt" hidden
            onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) setFile(f); }} />
        </Field>
      )}
      {/* what is made: each its own track */}
      <Field label={t('assetDrawer.captionsMakeWhat')}>
        <div className="flex flex-col overflow-hidden rounded-md bg-[var(--bg-field)]">
          <Tick on={original} onClick={() => setOriginal(!original)} label={t('assetDrawer.captionsOriginal')} where={into} />
          <Tick on={translating} onClick={() => setTranslate(translating ? null : language)} label={t('assetDrawer.captionsTranslated')} where={t('assetDrawer.captionsIntoNew')}>
            <div className="w-[108px]" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              <MenuSelect label={t('assetDrawer.captionsTranslateTo')} value={language} groups={[{ choices: languages }]}
                onPick={(v) => { setLanguage(v); setTranslate(v); }} />
            </div>
          </Tick>
        </div>
      </Field>
      {problem ? (
        <Notice warn text={problem.connect ? t('assetDrawer.captionsNoTranscriber') : t('timeline.subtitlesFailed').replace('{error}', problem.text)}
          action={problem.connect ? { label: t('assetDrawer.captionsConnect'), run: actions.connect } : undefined} />
      ) : null}
      <div className="flex flex-col gap-1.5">
        <button type="button" data-captions-go="" disabled={making || !has || (!original && !translating)} onClick={go}
          className="h-8 rounded-md bg-[var(--primary)] text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">
          {making ? t('timeline.captionsMaking') : t('assetDrawer.captionsGo')}
        </button>
        {plan && has ? <p data-captions-plan="" className="text-[11px] leading-relaxed text-[var(--text-faint)]">{plan}</p> : null}
      </div>
      <button type="button" onClick={actions.addOne} className="self-start text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline">
        {actions.captionTrack ? t('assetDrawer.captionsAddOneOn').replace('{track}', actions.captionTrack) : t('assetDrawer.captionsAddOne')}
      </button>
    </div>
  );
}

function Box({ on }: { on: boolean }) {
  return (
    <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] ${on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'shadow-[inset_0_0_0_1px_var(--border-strong)]'}`}>
      {on ? <Check size={10} strokeWidth={3} /> : null}
    </span>
  );
}

/** One thing to make, ticked or not, with where it goes (and a field of its own, the translation's language). */
function Tick({ on, onClick, label, where, children }: { on: boolean; onClick: () => void; label: string; where: string; children?: React.ReactNode }) {
  return (
    <div role="checkbox" aria-checked={on} tabIndex={0} data-captions-make="" onClick={onClick} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onClick(); } }}
      className="flex min-h-9 cursor-default items-center gap-2 px-2.5 py-1 text-[12px] outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--accent)]">
      <Box on={on} />
      <span className="shrink-0 text-[var(--text)]">{label}</span>
      {children}
      <span className="ml-auto shrink-0 text-[10.5px] text-[var(--text-faint)]">{where}</span>
    </div>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[12px] font-semibold text-[var(--text)]">{label}</h3>
      {children}
      {note ? <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">{note}</p> : null}
    </section>
  );
}

/** A line over the form: how the captions stand, or why something is not done and where to change that. */
function Notice({ text, warn, action }: { text: string; warn?: boolean; action?: { label: string; run: () => void } }) {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-md bg-[var(--bg-field)] px-2.5 py-2 text-[11.5px] leading-relaxed ${warn ? 'text-[var(--warn)]' : 'text-[var(--text-muted)]'}`}>
      <span className="min-w-0 flex-1">{text}</span>
      {action ? <button type="button" onClick={action.run} className="shrink-0 font-medium text-[var(--accent)] hover:underline">{action.label}</button> : null}
    </div>
  );
}

function Quiet({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="h-8 shrink-0 rounded-md bg-[var(--bg-raised)] px-3 text-[12.5px] font-medium text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border)] transition hover:bg-[var(--bg-hover)]">
      {children}
    </button>
  );
}
