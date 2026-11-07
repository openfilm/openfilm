/**
 * A voice-over node's voice: one of the library's ready-made voices of the service its model is at (lib/library-voices),
 * heard before it is picked; a service the library has no voices of takes a voice's id as its own service names it.
 */
import React from 'react';
import { Check, Pause, Play, Search } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { languageOf, sampleUrl, voiceLook, type LibraryVoice, type LibraryVoices } from '@/lib/library-voices';
import type { Choice } from './board';

/** The service a voice-over model is at: OpenFilm names its models `<service>/<model>`. */
export const serviceOf = (choice: Pick<Choice, 'via' | 'model'> | null | undefined): string | null =>
  !choice ? null : choice.via === 'openfilm' ? choice.model?.split('/')[0] ?? null : choice.via;

/** A service's voices in the library. */
export const voicesOf = (all: LibraryVoices | null, service: string | null): LibraryVoice[] =>
  service && all ? all.voices.filter((v) => v.provider === service) : [];

/** The voice a node speaks in unless one is picked: the service's own first pick in the person's language, else any. */
export function defaultVoice(voices: readonly LibraryVoice[], language: string): LibraryVoice | null {
  const mine = (v: LibraryVoice) => languageOf(v) === language.split('-')[0];
  return voices.find((v) => v.featured && mine(v)) ?? voices.find(mine) ?? voices.find((v) => v.featured) ?? voices[0] ?? null;
}

/* one sample heard at a time, wherever it is started */
let playing: HTMLAudioElement | null = null;

const CARD = 'cv-pop rounded-[12px] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';

export function VoicePicker({ voices, picked, onPick }: { voices: readonly LibraryVoice[]; picked: string | undefined; onPick: (id: string) => void }) {
  const t = useT();
  const language = useLanguage().split('-')[0]!;
  const [query, setQuery] = React.useState('');
  const [heard, setHeard] = React.useState<string | null>(null);
  /* the languages it speaks, the person's own first, then by how many voices speak each */
  const languages = React.useMemo(() => {
    const count = new Map<string, number>();
    for (const v of voices) { const l = languageOf(v); if (l) count.set(l, (count.get(l) ?? 0) + 1); }
    return [...count.entries()].sort((a, b) => Number(b[0] === language) - Number(a[0] === language) || b[1] - a[1]).map(([l]) => l).slice(0, 6);
  }, [voices, language]);
  const [lang, setLang] = React.useState<string | null>(() => (voices.some((v) => languageOf(v) === language) ? language : null));
  React.useEffect(() => () => { playing?.pause(); playing = null; }, []);
  const q = query.trim().toLowerCase();
  const shown = voices
    .filter((v) => (!lang || languageOf(v) === lang) && (!q || `${v.name} ${v.description ?? ''} ${v.tags.join(' ')} ${v.accent ?? ''}`.toLowerCase().includes(q)))
    .sort((a, b) => Number(b.id === picked) - Number(a.id === picked) || Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || (b.uses ?? 0) - (a.uses ?? 0))
    .slice(0, 80);
  const hear = (v: LibraryVoice) => {
    const src = sampleUrl(v);
    playing?.pause();
    if (heard === v.id || !src) { playing = null; setHeard(null); return; }
    const audio = new Audio(src);
    playing = audio;
    setHeard(v.id);
    audio.onended = () => { if (playing === audio) { playing = null; setHeard(null); } };
    void audio.play().catch(() => setHeard(null));
  };
  const chip = (on: boolean) => `h-6 shrink-0 rounded-[8px] px-2 text-[12px] transition ${on ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-ink)_28%,transparent)]' : 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const name = (l: string) => { try { return new Intl.DisplayNames([language], { type: 'language' }).of(l) ?? l; } catch { return l; } };
  return (
    <div className={`flex max-h-[440px] w-[340px] flex-col ${CARD}`}>
      <label className="flex shrink-0 items-center gap-2 border-b !border-[var(--cv-float-line)] px-3 py-2 text-[var(--cv-label)]">
        <Search size={14} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('canvas.voice.search')}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]" />
      </label>
      {languages.length > 1 ? (
        <div className="flex shrink-0 flex-wrap gap-1 px-2 pt-2">
          <button type="button" className={chip(!lang)} onClick={() => setLang(null)}>{t('canvas.voice.all')}</button>
          {languages.map((l) => <button key={l} type="button" className={chip(lang === l)} onClick={() => setLang(l)}>{name(l)}</button>)}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {shown.map((v) => {
          const on = v.id === picked;
          return (
            <div key={v.id} className={`group/voice flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 hover:bg-[var(--cv-float-hover)] ${on ? 'bg-[var(--cv-float-hover)]' : ''}`}>
              {/* its sample, heard on its orb */}
              <button type="button" aria-label={t(heard === v.id ? 'canvas.voice.stop' : 'canvas.voice.hear')} disabled={!v.sample} onClick={() => hear(v)}
                className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-white" style={voiceLook(v)}>
                <span className={`flex h-full w-full items-center justify-center bg-black/30 transition ${heard === v.id ? 'opacity-100' : 'opacity-0 group-hover/voice:opacity-100'}`}>
                  {heard === v.id ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                </span>
              </button>
              <button type="button" onClick={() => onPick(v.id)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-[var(--cv-ink)]">{v.name}</span>
                  {v.gender ? <span className="shrink-0 text-[11px] text-[var(--cv-label)]">{t(`canvas.voice.gender.${v.gender}`)}</span> : null}
                </span>
                {v.description ? <span className="block truncate text-[11.5px] leading-snug text-[var(--cv-label)]">{v.description}</span> : null}
              </button>
              {on ? <Check size={14} className="shrink-0 text-[var(--cv-label)]" /> : null}
            </div>
          );
        })}
        {!shown.length ? <div className="px-2 py-2 text-[12.5px] text-[var(--cv-label)]">{t('canvas.voice.none')}</div> : null}
      </div>
    </div>
  );
}

/** A voice by its id, for a service the library has none of: written as that service names it. */
export function VoiceId({ value, onPick }: { value: string | undefined; onPick: (id: string) => void }) {
  const t = useT();
  const [draft, setDraft] = React.useState(value ?? '');
  return (
    <form className={`w-[280px] p-3 ${CARD}`} onSubmit={(event) => { event.preventDefault(); if (draft.trim()) onPick(draft.trim()); }}>
      <div className="mb-1.5 text-[11.5px] text-[var(--cv-ink-3)]">{t('canvas.voice.idHint')}</div>
      <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t('canvas.voice.idPlaceholder')}
        className="h-8 w-full rounded-[8px] bg-[var(--cv-chip)] px-2.5 text-[13px] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]" />
    </form>
  );
}
