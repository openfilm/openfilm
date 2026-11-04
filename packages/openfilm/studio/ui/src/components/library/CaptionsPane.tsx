/**
 * The library's captions (SPEC §1 Captions). New captions: a caption track made of what chosen clips on the timeline
 * say (a clip with a transcript, as a voice made with its words timed has, is taken as it is; one with none is
 * transcribed first), or of a subtitle file (SRT, WebVTT); either translated into a language too, on a track just above
 * it. Caption templates: a look put on every caption of a track, on the ones given a look of their own too when asked.
 * The captions of what is said also make themselves (ProjectView, server caption-tracks sync) and follow the cuts until
 * changed by hand; this page says so.
 */
import React from 'react';
import { Check, FileText } from 'lucide-react';
import { FILM_SUBTITLE_DEFAULT, FILM_SUBTITLE_LANGUAGES, FILM_SUBTITLE_LOOKS, subtitleStyleVtt } from '../../../../server/film-subtitle.mjs';
import { useLanguage, useT } from '@/i18n';
import { cueRule } from '@/lib/caption-edits';
import { lookVars, varsOf } from '@/lib/caption-look';
import { readVtt } from '../../../../../src/captions.mjs';
import { MenuSelect } from '../MenuSelect';
import { FOOT_ROOM } from './AudioList';

export type CaptionsLine = 'new' | 'templates';

/** A clip of the timeline that speaks: with a transcript of its words, or none yet. */
export interface HeardClip {
  clipId: string;
  name: string;
  startMs: number;
  endMs: number;
  transcribed: boolean;
}

export interface CaptionsActions {
  /** The clips that speak, top track first. */
  heard: readonly HeardClip[];
  /** Transcribing, or making the track, now. */
  making: boolean;
  /** Why the speech with no transcript could not be transcribed; `connect`: no service can transcribe. */
  problem: { text: string; connect: boolean } | null;
  /** The track of the captions of speech (its badge, V3), and whether they follow the cuts by themselves (not changed by hand). */
  speechTrack: string | null;
  speechAuto: boolean;
  /** The track a template goes on (the picked one, else the speech's, else the top one), and one typed in; null: none. */
  templateTrack: string | null;
  captionTrack: string | null;
  /** Captions of what these clips say (made again on `speechTrack` when there is one), translated into `translate` too. */
  make: (o: { clips: readonly string[]; translate: string | null }) => void;
  fromFile: (file: File, translate: string | null) => void;
  /** Settings › Services, where a transcriber is connected. */
  connect: () => void;
  /** A caption at the playhead, on `captionTrack` or a new track. */
  addOne: () => void;
  /** A template (one of FILM_SUBTITLE_LOOKS) on every caption of `templateTrack`; `edited`: on those with their own look too. */
  template: (id: string, edited: boolean) => void;
}

export function CaptionsPane({ line, actions }: { line: CaptionsLine; actions: CaptionsActions }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-2.5 ${FOOT_ROOM}`}>
      {line === 'templates' ? <Templates actions={actions} /> : <New actions={actions} />}
    </div>
  );
}

const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function New({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const ui = useLanguage();
  const input = React.useRef<HTMLInputElement>(null);
  const [source, setSource] = React.useState<'speech' | 'file'>('speech');
  const [off, setOff] = React.useState<ReadonlySet<string>>(() => new Set());
  const [translate, setTranslate] = React.useState<string | null>(null);
  const [over, setOver] = React.useState(false);
  const named = React.useMemo(() => { try { return new Intl.DisplayNames([ui], { type: 'language' }); } catch { return null; } }, [ui]);
  const fileOf = (files: FileList | null) => [...(files ?? [])].find((f) => /\.(srt|vtt)$/i.test(f.name)) ?? null;
  const { heard, making, problem, speechTrack, speechAuto } = actions;
  const chosen = heard.filter((h) => !off.has(h.clipId)).map((h) => h.clipId);
  const toggle = (id: string) => setOff((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const languages = [{ value: '', label: t('assetDrawer.captionsNoTranslate') }, ...FILM_SUBTITLE_LANGUAGES.map((l) => ({ value: l.code, label: named?.of(l.code) ?? l.native }))];
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
        <Field label={t('assetDrawer.captionsPick')} note={t('assetDrawer.captionsPickNote')}>
          {heard.length ? (
            <div className="flex flex-col overflow-hidden rounded-md bg-[var(--bg-field)]">
              {heard.map((h) => {
                const on = !off.has(h.clipId);
                return (
                  <button key={h.clipId} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(h.clipId)}
                    className="flex h-8 items-center gap-2 px-2.5 text-left text-[12px] hover:bg-[var(--bg-hover)]">
                    <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] ${on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'shadow-[inset_0_0_0_1px_var(--border-strong)]'}`}>
                      {on ? <Check size={10} strokeWidth={3} /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--text)]">{h.name}</span>
                    <span className="shrink-0 tabular-nums text-[10.5px] text-[var(--text-faint)]">{mmss(h.startMs)}–{mmss(h.endMs)}</span>
                    <span className={`shrink-0 rounded px-1.5 py-px text-[10.5px] ${h.transcribed ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-[var(--bg-hover)] text-[var(--text-muted)]'}`}>
                      {t(h.transcribed ? 'assetDrawer.captionsHasWords' : 'assetDrawer.captionsToTranscribe')}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <p className="text-[12px] text-[var(--text-faint)]">{t('assetDrawer.captionsNoSpeech')}</p>}
        </Field>
      ) : (
        <Field label={t('assetDrawer.captionsFile')} note={t('assetDrawer.captionsFileText')}>
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = fileOf(e.dataTransfer.files); if (f) actions.fromFile(f, translate); }}
            className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-5 ${over ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]' : 'border-[var(--border-strong)]'}`}
          >
            <FileText size={20} strokeWidth={1.6} className="text-[var(--text-muted)]" />
            <Quiet onClick={() => input.current?.click()}>{t('assetDrawer.captionsFileGo')}</Quiet>
            <span className="text-[11px] text-[var(--text-faint)]">{t('assetDrawer.captionsFileDrop')}</span>
          </div>
          <input ref={input} type="file" accept=".srt,.vtt" hidden
            onChange={(e) => { const f = fileOf(e.target.files); e.target.value = ''; if (f) actions.fromFile(f, translate); }} />
        </Field>
      )}
      <Field label={t('assetDrawer.captionsTranslate')} note={t('assetDrawer.captionsTranslateNote')}>
        <MenuSelect label={t('assetDrawer.captionsTranslate')} value={translate ?? ''} groups={[{ choices: languages }]} onPick={(v) => setTranslate(v || null)} />
      </Field>
      {problem ? (
        <Notice warn text={problem.connect ? t('assetDrawer.captionsNoTranscriber') : t('timeline.subtitlesFailed').replace('{error}', problem.text)}
          action={problem.connect ? { label: t('assetDrawer.captionsConnect'), run: actions.connect } : undefined} />
      ) : null}
      {source === 'speech' ? (
        <button type="button" disabled={making || !chosen.length} onClick={() => actions.make({ clips: chosen, translate })}
          className="h-8 rounded-md bg-[var(--primary)] text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">
          {making ? t('timeline.captionsMaking') : speechTrack ? t('assetDrawer.captionsRemakeOn').replace('{track}', speechTrack) : t('assetDrawer.captionsSpeechGo')}
        </button>
      ) : null}
      <button type="button" onClick={actions.addOne} className="self-start text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text)] hover:underline">
        {actions.captionTrack ? t('assetDrawer.captionsAddOneOn').replace('{track}', actions.captionTrack) : t('assetDrawer.captionsAddOne')}
      </button>
    </div>
  );
}

/** Each of the caption looks, as a card of words in it; one put on every caption of the track. */
function Templates({ actions }: { actions: CaptionsActions }) {
  const t = useT();
  const [edited, setEdited] = React.useState(false);
  const target = actions.templateTrack;
  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--text)]">
        <input type="checkbox" checked={edited} onChange={(e) => setEdited(e.target.checked)} className="accent-[var(--accent)]" />
        {t('assetDrawer.captionsTemplateEdited')}
      </label>
      <p className="text-[11.5px] leading-relaxed text-[var(--text-muted)]">
        {target ? t('assetDrawer.captionsTemplateOn').replace('{track}', target) : t('assetDrawer.captionsNeedTrack')}
      </p>
      <CaptionLookCards disabled={!target} onPick={(id) => actions.template(id, edited)} />
    </div>
  );
}

/** A card for each caption look (FILM_SUBTITLE_LOOKS), its words drawn in it: the library's templates, the inspector's presets. */
export function CaptionLookCards({ onPick, disabled, small }: { onPick: (id: string) => void; disabled?: boolean; small?: boolean }) {
  const t = useT();
  return (
    <div className={`grid gap-x-2 gap-y-2.5 ${small ? 'grid-cols-[repeat(auto-fill,minmax(72px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]'}`}>
      {Object.keys(FILM_SUBTITLE_LOOKS).map((id) => (
        <button key={id} type="button" disabled={disabled} onClick={() => onPick(id)} title={t(`assetDrawer.captionLook_${id}`)}
          className="group min-w-0 cursor-default select-none text-left disabled:opacity-50">
          <div className="grid aspect-video place-items-center overflow-hidden rounded-md bg-[#2b2b30] ring-1 ring-transparent group-hover:ring-[var(--text-faint)]">
            <span style={{ ...lookStyle(id), ...(small ? { fontSize: 12 } : {}) }}>{t('assetDrawer.captionsSample')}</span>
          </div>
          <div className="mt-1 truncate px-0.5 text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{t(`assetDrawer.captionLook_${id}`)}</div>
        </button>
      ))}
    </div>
  );
}

/** A caption look's variables (lib/caption-look), from its CSS as film-subtitle writes it. */
export function captionLookVars(id: string): Record<string, string> {
  const look = FILM_SUBTITLE_LOOKS[id as keyof typeof FILM_SUBTITLE_LOOKS];
  return look ? lookVars(subtitleStyleVtt({ ...FILM_SUBTITLE_DEFAULT, ...look } as never).css) : {};
}

/** How a look draws a few words on its card: its own CSS, at the card's size. */
function lookStyle(id: string): React.CSSProperties {
  const css = subtitleStyleVtt({ ...FILM_SUBTITLE_DEFAULT, ...FILM_SUBTITLE_LOOKS[id as keyof typeof FILM_SUBTITLE_LOOKS] } as never).css;
  const rule = cueRule(readVtt(`WEBVTT\n\nSTYLE\n${css}\n`), '::cue');
  const v = varsOf(rule);
  return {
    fontSize: 15, lineHeight: 1.2, fontWeight: Number(v['--weight'] ?? 500), fontFamily: v['--font'],
    color: rule.color, background: rule.background === 'none' ? undefined : rule.background, padding: rule.padding, borderRadius: rule['border-radius'],
    WebkitTextStroke: rule['-webkit-text-stroke'], paintOrder: rule['paint-order'], textShadow: rule['text-shadow'],
    letterSpacing: rule['letter-spacing'], textTransform: rule['text-transform'] as React.CSSProperties['textTransform'],
  };
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
