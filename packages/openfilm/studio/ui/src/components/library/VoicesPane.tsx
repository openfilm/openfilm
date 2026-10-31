/**
 * The assets drawer's voices (lib/library-voices): the ready-made voices of the voice-over services, narrowed by the
 * side bar (a service, or the starred ones), the search, a language and a gender. A click on a voice plays its
 * service's sample (again: stops it); a double click, Enter or its "+" puts it in the chat as a reference, the voice
 * the agent makes the voice-over in. A voice whose service is not connected says so; its "Connect" opens Services.
 */
import React from 'react';
import { Pause, Play, Plus, Star } from 'lucide-react';
import { useLanguage, useT, type Language } from '@/i18n';
import { studioHost } from '@/lib/host';
import { toggleFavorite } from '@/lib/library';
import { Empty } from './icons';
import {
  languageOf, sampleUrl, useLibraryVoices, useServices, voiceAccess, voiceKey, voiceRef,
  type LibraryVoice, type VoiceAccess, type VoiceService,
} from '@/lib/library-voices';

/** The side bar's line for the starred voices (as the drawer's FAVORITES). */
export const STARRED = '★';

/* the languages offered first, in this order, after the person's own */
const FIRST = ['en', 'zh', 'ja', 'ko', 'es'];

/* the voice playing in the drawer: one at a time */
let playing: HTMLAudioElement | null = null;

export function VoicesPane({ group, query, favorites, onServices, onAll }: {
  /** '' all, STARRED, or a service's id */
  group: string;
  query: string;
  favorites: readonly string[];
  onServices: () => void;
  /** the side bar's "all", from an empty list of the starred */
  onAll: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const library = useLibraryVoices();
  const services = useServices();
  const access = React.useMemo(() => voiceAccess(library?.providers ?? [], services), [library, services]);
  const [language, setLanguage] = React.useState('');
  const [gender, setGender] = React.useState<'' | 'm' | 'f'>('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const [sounding, setSounding] = React.useState<string | null>(null);
  React.useEffect(() => () => { playing?.pause(); }, []);

  const byId = React.useMemo(() => new Map((library?.providers ?? []).map((s) => [s.id, s])), [library]);
  const shown = (library?.voices ?? []).filter((v) => (group === STARRED ? favorites.includes(voiceKey(v)) : !group || v.provider === group));
  const q = query.trim().toLowerCase();
  const voices = shown.filter((v) => (!language || languageOf(v) === language) && (!gender || v.gender === gender)
    && (!q || [v.name, v.description, v.accent, ...v.tags].some((s) => s?.toLowerCase().includes(q))));

  /* the languages the voices shown speak: the person's, then the five the app speaks, then the rest by how many */
  const languages = React.useMemo(() => {
    const count = new Map<string, number>();
    for (const v of shown) { const l = languageOf(v); if (l) count.set(l, (count.get(l) ?? 0) + 1); }
    const own = lang.split('-')[0]!;
    const rank = (l: string) => (l === own ? -1 : FIRST.includes(l) ? FIRST.indexOf(l) : FIRST.length);
    return [...count.keys()].sort((a, b) => rank(a) - rank(b) || count.get(b)! - count.get(a)! || a.localeCompare(b));
  }, [shown, lang]);
  const languageName = useLanguageName(lang);

  const play = (v: LibraryVoice) => {
    const key = voiceKey(v);
    setPicked(key);
    if (sounding === key) { playing?.pause(); return; }
    playing?.pause();
    const src = sampleUrl(v);
    if (!src) { setSounding(null); return; }
    const a = new Audio(src);
    a.onpause = () => setSounding((s) => (s === key ? null : s));
    a.onended = () => setSounding((s) => (s === key ? null : s));
    playing = a;
    setSounding(key);
    void a.play().catch(() => setSounding(null));
  };
  const use = (v: LibraryVoice) => {
    const service = byId.get(v.provider);
    if (!service) return;
    if (studioHost?.refer) studioHost.refer(voiceRef(v, service, access[v.provider]));
    else void navigator.clipboard?.writeText(v.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const v = picked ? voices.find((x) => voiceKey(x) === picked) : null;
    if (!v || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); use(v); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); playing?.pause(); setPicked(null); }
  };

  const chip = (on: boolean) => `whitespace-nowrap text-[11.5px] ${on ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`;
  return (
    /* focused by a click in it, so Enter and Esc reach it */
    <div className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1} onKeyDown={onKey}>
      <div className="flex items-center gap-3 px-3 pb-2">
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          aria-label={t('assetDrawer.language')}
          className="h-7 min-w-0 max-w-[150px] rounded-md bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text)] outline-none hover:bg-[var(--bg-hover)]"
        >
          <option value="">{t('assetDrawer.anyLanguage')}</option>
          {languages.map((l) => <option key={l} value={l}>{languageName(l)}</option>)}
        </select>
        <span className="flex items-center gap-2.5">
          <button type="button" className={chip(!gender)} aria-pressed={!gender} onClick={() => setGender('')}>{t('assetDrawer.all')}</button>
          <button type="button" className={chip(gender === 'f')} aria-pressed={gender === 'f'} onClick={() => setGender('f')}>{t('assetDrawer.female')}</button>
          <button type="button" className={chip(gender === 'm')} aria-pressed={gender === 'm'} onClick={() => setGender('m')}>{t('assetDrawer.male')}</button>
        </span>
        <span className="ml-auto whitespace-nowrap text-[10.5px] text-[var(--text-faint)]">{t('assetDrawer.voiceCount').replace('{n}', String(voices.length))}</span>
      </div>
      {/* a click on nothing lets the picked voice go */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" onClick={(e) => { if (e.target === e.currentTarget) { playing?.pause(); setPicked(null); } }}>
        {!voices.length ? (
          !library ? null
            : q || language || gender ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim() || languageName(language) || '')} />
              : group === STARRED ? <Empty icon="star" text={t('assetDrawer.noFavorites')} action={t('assetDrawer.seeAll')} onAction={onAll} /> : null
        ) : voices.map((v) => {
          const key = voiceKey(v);
          return (
            <VoiceRow
              key={key} voice={v} service={byId.get(v.provider)} access={access[v.provider]} showService={group === '' || group === STARRED}
              picked={picked === key} sounding={sounding === key} kept={favorites.includes(key)} languageName={languageName}
              onPlay={() => play(v)} onUse={() => use(v)} onServices={onServices}
            />
          );
        })}
      </div>
    </div>
  );
}

/** A language's name in the app's language (`zh` → 中文), from the browser's own names. */
function useLanguageName(lang: Language) {
  return React.useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try { names = new Intl.DisplayNames([lang], { type: 'language' }); } catch { /* an old browser: the code itself */ }
    return (code: string) => (code ? names?.of(code) ?? code : '');
  }, [lang]);
}

/** A press on a row's own button: not a play, nor a double click's use. */
const own = { onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

function VoiceRow({ voice, service, access, showService, picked, sounding, kept, languageName, onPlay, onUse, onServices }: {
  voice: LibraryVoice; service: VoiceService | undefined; access: VoiceAccess | undefined; showService: boolean;
  picked: boolean; sounding: boolean; kept: boolean; languageName: (code: string) => string;
  onPlay: () => void; onUse: () => void; onServices: () => void;
}) {
  const t = useT();
  const facts = [
    voice.gender === 'f' ? t('assetDrawer.female') : voice.gender === 'm' ? t('assetDrawer.male') : null,
    voice.age ? t(`assetDrawer.age_${voice.age}`) : null,
    voice.language ? languageName(languageOf(voice) ?? '') : null,
    showService ? service?.name : null,
  ].filter(Boolean).join(' · ');
  const useTip = access ? t('assetDrawer.useVoice') : t('assetDrawer.connectFirst').replace('{service}', service?.name ?? voice.provider);
  return (
    <div
      className={`group relative grid cursor-default select-none grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-2 ${picked ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}
      onClick={onPlay}
      onDoubleClick={onUse}
      title={[voice.name, voice.description, voice.tags.join(', ')].filter(Boolean).join('\n')}
    >
      <span
        aria-label={sounding ? t('assetDrawer.stop') : t('assetDrawer.play')}
        className={`grid h-10 w-10 place-items-center rounded-full bg-[var(--bg-hover)] ${picked ? 'text-[var(--tl-accent)]' : voice.sample ? 'text-[var(--text-muted)] group-hover:text-[var(--text)]' : 'text-[var(--text-faint)] opacity-50'}`}
      >
        {sounding ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={`truncate text-[12.5px] font-medium ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text)]'}`}>{voice.name}</span>
          <span className="truncate text-[11px] text-[var(--text-faint)]">{facts}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]">{voice.description ?? voice.tags.join(', ')}</span>
      </span>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')}
          aria-pressed={kept}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(voiceKey(voice)); }}
          {...own}
          className={kept ? 'text-[#ffd35a]' : 'invisible text-[var(--text-faint)] hover:text-[var(--text)] group-hover:visible'}
        >
          <Star size={13} fill="currentColor" strokeWidth={0} />
        </button>
        {access ? (
          <button type="button" title={useTip} aria-label={useTip} onClick={(e) => { e.stopPropagation(); onUse(); }} {...own}
            className="invisible grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--tl-accent)] text-black group-hover:visible">
            <Plus size={12} strokeWidth={3} />
          </button>
        ) : (
          <button type="button" title={useTip} onClick={(e) => { e.stopPropagation(); onServices(); }} {...own}
            className="invisible whitespace-nowrap text-[11px] text-[var(--tl-accent)] hover:underline group-hover:visible">
            {t('assetDrawer.connect')}
          </button>
        )}
      </span>
    </div>
  );
}
