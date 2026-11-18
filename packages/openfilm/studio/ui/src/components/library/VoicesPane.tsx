/**
 * The assets drawer's voices (lib/library-voices): the ready-made voices of the voice-over services, narrowed by the
 * side bar (a service, or the starred ones), the search, a language and a gender. A click on a voice plays its
 * service's sample in the viewer's player (again: pauses it); Enter or its "+" puts it in the chat
 * as a reference, the voice
 * the agent makes the voice-over in; its "Generate" previews words typed in SpeakDialog before an explicit action
 * puts them on the film at the playhead. A voice whose service is not connected says so; its "Connect" opens Services.
 */
import React from 'react';
import { AudioLines, Loader2, Pause, Play, Plus, RotateCw, Square, Star, Trash2 } from 'lucide-react';
import { useLanguage, useT, type Language } from '@/i18n';
import { studioHost } from '@/lib/host';
import { toggleFavorite, askHere, useLibraryHere, type HereState } from '@/lib/library';
import { ADD_COLOR, ADD_HOVER, DownloadBadge, FOOT_ROOM, MiniPlayer, PANEL_ROUND, ROUND, type Player } from './AudioList';
import { Empty } from './icons';
import { SpeakDialog } from './SpeakDialog';
import { PairPicker } from './PairPicker';
import { CloneVoiceDialog } from './CloneVoiceDialog';
import { ConfirmDialog } from '../ConfirmDialog';
import { MenuSelect } from '../MenuSelect';
import { isPrivateVoice, MY_VOICES, privateVoiceAccess, refreshPrivateVoice, removePrivateVoice, usePrivateVoices, type PrivateVoice } from '@/lib/private-voices';
import { providerName } from '@/lib/providers';
import {
  languageOf, sampleUrl, useLibraryVoices, useServices, voiceAccess, voiceKey, voiceLook, voiceRef,
  type LibraryVoice, type VoiceAccess, type VoiceService, type SpeakVoice,
} from '@/lib/library-voices';

/** The side bar's line for the starred voices (as the drawer's FAVORITES). */
export const STARRED = '★';
/* rows drawn at first, and more each time the list is scrolled near its end */
const PAGE = 80;

/* the languages offered first, in this order, after the person's own */
const FIRST = ['en', 'zh', 'ja', 'ko', 'es'];

export type VoiceSample = { id: string; voice: LibraryVoice };

export function VoicesPane({ group, query, favorites, onServices, onAll, onMyVoices, speak, player, previewBar, picked, onPick, onClosePreview, projectId }: {
  /** '' all stock voices, STARRED, MY_VOICES, or a service's id */
  group: string;
  query: string;
  favorites: readonly string[];
  onServices: () => void;
  /** the side bar's "all", from an empty list of the starred */
  onAll: () => void;
  onMyVoices: () => void;
  /** Words spoken in a voice, put on the film at the playhead: null, or why not. */
  speak?: SpeakVoice;
  projectId?: string | null;
  player: Player<VoiceSample>;
  previewBar: HTMLDivElement | null;
  picked: string | null;
  onPick: (id: string) => void;
  onClosePreview: () => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const library = useLibraryVoices();
  const services = useServices();
  const access = React.useMemo(() => voiceAccess(library?.providers ?? [], services), [library, services]);
  const [language, setLanguage] = React.useState('');
  /* `pair`: the pairs of voices that speak a dialogue, listed only here */
  const [gender, setGender] = React.useState<'' | 'm' | 'f' | 'pair'>('');
  const [choosing, setChoosing] = React.useState(false);
  const [speaking, setSpeaking] = React.useState<LibraryVoice | null>(null);
  const mine = usePrivateVoices();
  const [dialog, setDialog] = React.useState(false);
  const [removing, setRemoving] = React.useState<PrivateVoice | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setLanguage(''); setGender(''); setProblem(null); }, [group]);
  const hereOf = useLibraryHere();
  const sounding = player.playing || player.loading ? player.item?.id ?? null : null;

  const byId = React.useMemo(() => new Map((library?.providers ?? []).map((s) => [s.id, s])), [library]);
  const shown = React.useMemo(() => (group === MY_VOICES ? mine.voices : group === STARRED
    ? [...(library?.voices ?? []), ...mine.voices].filter((v) => favorites.includes(voiceKey(v)))
    : (library?.voices ?? []).filter((v) => !group || v.provider === group)), [library, group, favorites, mine.voices]);
  const accessOf = (v: LibraryVoice) => isPrivateVoice(v) ? privateVoiceAccess(v) : access[v.provider];
  const q = query.trim().toLowerCase();
  const pairs = shown.some((v) => v.pair);
  const voices = React.useMemo(() => shown.filter((v) => (!language || languageOf(v) === language) && (gender === 'pair' ? v.pair : !v.pair && (!gender || v.gender === gender))
    && (!q || [v.name, v.description, v.accent, ...v.tags].some((s) => s?.toLowerCase().includes(q)))), [shown, language, gender, q]);

  /* the languages the voices shown speak: the person's, then the five the app speaks, then the rest by how many */
  const languages = React.useMemo(() => {
    const count = new Map<string, number>();
    for (const v of shown) { const l = languageOf(v); if (l) count.set(l, (count.get(l) ?? 0) + 1); }
    const own = lang.split('-')[0]!;
    const rank = (l: string) => (l === own ? -1 : FIRST.includes(l) ? FIRST.indexOf(l) : FIRST.length);
    return [...count.keys()].sort((a, b) => rank(a) - rank(b) || count.get(b)! - count.get(a)! || a.localeCompare(b));
  }, [shown, lang]);
  const languageName = useLanguageName(lang);
  /* a long list is drawn a page at a time, from its top again when what it lists changes */
  const [drawn, setDrawn] = React.useState(PAGE);
  React.useEffect(() => setDrawn(PAGE), [group, query, language, gender]);
  React.useEffect(() => { askHere(voices.slice(0, drawn).flatMap((v) => v.sample ? [v.sample] : [])); }, [voices, drawn]);

  const play = (v: LibraryVoice) => {
    const src = sampleUrl(v);
    setProblem(src ? null : t('assetDrawer.voiceNoSample'));
    if (!src) player.close();
    onPick(voiceKey(v));
    if (src) player.toggle({ id: voiceKey(v), voice: v }, src);
  };
  const use = (v: LibraryVoice) => {
    const service = byId.get(v.provider);
    if (!service) return;
    /* not connected yet: where to connect it */
    if (!accessOf(v)) { if (!isPrivateVoice(v) || !v.available) onServices(); return; }
    if (studioHost?.refer) studioHost.refer(voiceRef(v, service, accessOf(v)));
    else void navigator.clipboard?.writeText(v.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const v = picked ? voices.find((x) => voiceKey(x) === picked) : null;
    if (!v || (e.target as HTMLElement).closest('button, input, select, [role="slider"]')) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); use(v); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClosePreview(); }
  };

  const chip = (on: boolean) => `whitespace-nowrap text-[11.5px] ${on ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`;
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setProblem(null);
    try { await operation(); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  /* voices are made with OpenFilm's service: signed out, Settings → Services opens to sign in */
  const openDialog = () => {
    if (!mine.services.some((s) => s.connected)) { onServices(); return; }
    player.pause(); setDialog(true);
  };
  return (
    /* focused by a click in it, so Enter and Esc reach it */
    <div className="flex min-h-0 flex-1 flex-col outline-none" tabIndex={-1} onKeyDown={onKey}>
      {group === MY_VOICES && mine.voices.length ? <div className="flex items-center gap-2 px-3 pb-2" data-my-voices-actions="">
        <button type="button" disabled={busy || mine.loading} onClick={() => openDialog()} className="flex h-7 items-center gap-1.5 rounded-lg bg-[var(--bg-field)] px-2.5 text-[12px] text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50"><Plus size={13} />{t('myVoices.clone')}</button>
      </div> : null}
      {problem || (group === MY_VOICES && mine.error) ? <p role="alert" className="px-3 pb-2 text-[11.5px] text-[var(--err)]">{problem ?? mine.error}</p> : null}
      <div className={`flex items-center gap-3 px-3 pb-2 ${group === MY_VOICES ? 'hidden' : ''}`}>
        <div className="min-w-0 max-w-[150px] flex-1">
          <MenuSelect label={t('assetDrawer.language')} value={language} onPick={setLanguage}
            groups={[{ choices: [{ value: '', label: t('assetDrawer.anyLanguage') }, ...languages.map((l) => ({ value: l, label: languageName(l) }))] }]}
            className="text-[12px]" />
        </div>
        <span className={`flex items-center gap-2.5 ${group === MY_VOICES ? 'hidden' : ''}`}>
          <button type="button" className={chip(!gender)} aria-pressed={!gender} onClick={() => setGender('')}>{t('assetDrawer.all')}</button>
          <button type="button" className={chip(gender === 'f')} aria-pressed={gender === 'f'} onClick={() => setGender('f')}>{t('assetDrawer.female')}</button>
          <button type="button" className={chip(gender === 'm')} aria-pressed={gender === 'm'} onClick={() => setGender('m')}>{t('assetDrawer.male')}</button>
          {pairs ? <>
            <span aria-hidden="true" className="h-3 w-px bg-[var(--border-strong)]" />
            <button type="button" data-voice-pairs="" className={chip(gender === 'pair')} aria-pressed={gender === 'pair'} onClick={() => setGender('pair')}>{t('assetDrawer.pair')}</button>
          </> : null}
        </span>
        <span className="ml-auto whitespace-nowrap text-[10.5px] text-[var(--text-faint)]">{t(gender === 'pair' ? 'assetDrawer.pairCount' : 'assetDrawer.voiceCount').replace('{n}', String(voices.length))}</span>
      </div>
      {/* a click on nothing lets the picked voice go */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto px-3 ${!previewBar && player.item ? 'pb-3' : FOOT_ROOM}`}
        onClick={(e) => { if (e.target === e.currentTarget) onClosePreview(); }}
        onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && drawn < voices.length) setDrawn(drawn + PAGE); }}
      >
        {!voices.length ? (
          !library ? null
            : q || language || gender ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim() || languageName(language) || '')} />
              : group === STARRED ? <Empty icon="star" text={t('assetDrawer.noFavorites')} action={t('assetDrawer.seeAll')} onAction={onAll} />
                : group === MY_VOICES ? <div className="flex flex-col items-center gap-2 py-12 text-center"><p className="text-[12.5px] text-[var(--text-muted)]">{t(mine.loading ? 'myVoices.loading' : 'myVoices.empty')}</p><button type="button" disabled={mine.loading} onClick={() => openDialog()} className="rounded-lg bg-[var(--primary)] px-3 py-2 text-[12px] text-[var(--on-primary)] disabled:opacity-50">{t('myVoices.clone')}</button></div> : null
        ) : voices.slice(0, drawn).map((v) => {
          const key = voiceKey(v);
          const loading = player.item?.id === key && player.downloading;
          const here = v.sample ? hereOf(v.sample) : 'here';
          return (
            <VoiceRow
              key={key} voice={v} service={byId.get(v.provider)} access={accessOf(v)} showService={group === '' || group === STARRED || group === MY_VOICES}
              picked={picked === key} sounding={sounding === key} kept={favorites.includes(key)} languageName={languageName}
              here={isPrivateVoice(v) ? 'here' : loading ? 'fetching' : player.item?.id === key && player.error != null ? 'failed' : here}
              onPlay={() => play(v)} onUse={() => use(v)} onServices={onServices}
              onSpeak={speak && accessOf(v) ? () => { player.pause(); setSpeaking(v); } : undefined}
              onRefresh={isPrivateVoice(v) && v.available ? () => { void run(() => refreshPrivateVoice(v.uid)); } : undefined}
              onRemove={isPrivateVoice(v) ? () => setRemoving(v) : undefined}
            />
          );
        })}
        {gender === 'pair' && speak ? (
          <button type="button" data-voice-pair-choose="" onClick={() => setChoosing(true)}
            className="grid w-full grid-cols-[40px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[12.5px] text-[var(--text-muted)] hover:bg-[var(--bg-field)] hover:text-[var(--text)]">
            <span className="grid h-10 w-10 place-items-center"><Plus size={16} /></span>{t('assetDrawer.pairChoose')}
          </button>
        ) : null}
      </div>
      {choosing ? <PairPicker voices={(library?.voices ?? []).filter((v) => !v.pair && v.provider === 'doubao' && accessOf(v))} languageName={languageName}
        onClose={() => setChoosing(false)} onPick={(pair) => { setChoosing(false); player.pause(); setSpeaking(pair); }} /> : null}
      <MiniPlayer target={previewBar} player={player} name={player.item?.voice.name ?? ''} />
      {speaking && speak && accessOf(speaking) ? (
        <SpeakDialog voice={speaking} service={byId.get(speaking.provider)?.name ?? speaking.provider} onClose={() => { setSpeaking(null); void mine.reload(); }}
          onSpeak={(text) => speak(speaking, accessOf(speaking)!, text)} />
      ) : null}
      {dialog ? <CloneVoiceDialog services={mine.services} projectId={projectId} onClose={() => { setDialog(false); void mine.reload(); }} onSaved={(v, useNow) => { setDialog(false); setLanguage(''); setGender(''); onMyVoices(); onPick(voiceKey(v)); if (useNow && speak) setSpeaking(v); }} /> : null}
      <ConfirmDialog open={!!removing} title={t('myVoices.remove')} description={t('myVoices.removeNote')} danger onCancel={() => setRemoving(null)} onConfirm={() => { if (removing) void run(async () => { await removePrivateVoice(removing.uid); setRemoving(null); player.close(); }); }} />
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

/** What the words fade into under a row's buttons: the row's own color (its field over the drawer), so solid */
const SHADE_FIELD = 'bg-[linear-gradient(to_right,transparent,var(--bg-field)_36px),linear-gradient(to_right,transparent,var(--bg-panel)_36px)]';
const SHADE_PANEL = 'bg-[linear-gradient(to_right,transparent,var(--bg-panel)_36px)]';
const SHADE_HOVER = 'group-hover:bg-[linear-gradient(to_right,transparent,var(--bg-field)_36px),linear-gradient(to_right,transparent,var(--bg-panel)_36px)]';

function VoiceRow({ voice, service, access, showService, picked, sounding, here, kept, languageName, onPlay, onUse, onServices, onSpeak, onRefresh, onRemove }: {
  voice: LibraryVoice; service: VoiceService | undefined; access: VoiceAccess | undefined; showService: boolean;
  picked: boolean; sounding: boolean; here: HereState; kept: boolean; languageName: (code: string) => string;
  onPlay: () => void; onUse: () => void; onServices: () => void; onSpeak?: () => void;
  onRefresh?: () => void; onRemove?: () => void;
}) {
  const t = useT();
  const loading = here === 'fetching';
  const own = isPrivateVoice(voice) ? voice : null;
  const state = own ? !own.available ? 'disconnected' : own.status : null;
  const facts = [
    voice.gender === 'f' ? t('assetDrawer.female') : voice.gender === 'm' ? t('assetDrawer.male') : null,
    voice.age ? t(`assetDrawer.age_${voice.age}`) : null,
    voice.language ? languageName(languageOf(voice) ?? '') : null,
    showService && service ? providerName(service) : null,
  ].filter(Boolean).join(' · ');
  const useTip = access ? t('assetDrawer.useVoice') : t('assetDrawer.connectFirst').replace('{service}', service ? providerName(service) : voice.provider);
  return (
    <div
      data-library-voice=""
      aria-busy={loading}
      className={`group relative grid cursor-default select-none grid-cols-[40px_minmax(0,1fr)] items-center gap-2.5 rounded-lg px-2 py-2 ${picked ? 'bg-[var(--bg-field)]' : 'hover:bg-[var(--bg-field)]'}`}
      onClick={(e) => { if (e.detail < 2) onPlay(); }}
      aria-label={voice.name}
    >
      <VoiceAvatar voice={voice} sounding={sounding} loading={loading} label={!sampleUrl(voice) ? t('assetDrawer.voiceNoSample') : loading ? t('assetDrawer.previewCancel') : sounding ? t('assetDrawer.stop') : t('assetDrawer.play')} />
      {/* the words take the whole row; only a star kept holds a little room at its end */}
      <span className={`min-w-0 ${kept ? 'pr-7' : ''}`}>
        <span className="flex min-w-0 items-baseline gap-1.5">
          {/* the name keeps its room; the facts after it give theirs up first */}
          <span className={`shrink-[0.2] truncate text-[12.5px] font-medium ${picked ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{voice.name}</span>
          <span className="min-w-0 shrink-[5] truncate text-[11px] text-[var(--text-faint)]">{facts}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--text-muted)]">{state ? t(`myVoices.status.${state}`) : voice.description ?? voice.tags.join(', ')}</span>
      </span>
      {/* what it offers, over the row's end under the pointer, the words fading out under the row's own color; else a
          star kept */}
      {/* a button shown at rest (to download, a picked row's "+", one's own voice's) has the words fade under it then too */}
      <span className={`absolute inset-y-0 right-0 flex items-center gap-1.5 rounded-r-lg pl-10 pr-2 ${picked ? SHADE_FIELD : here !== 'here' || own ? SHADE_PANEL : ''} ${SHADE_HOVER}`}>
        {own ? <>
          {state === 'creating' || state === 'training' ? <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" /> : null}
          {onRefresh ? <button type="button" aria-label={t('myVoices.refresh')} disabled={state === 'creating'} onClick={(e) => { e.stopPropagation(); onRefresh(); }} className={`${PANEL_ROUND} text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40`}><RotateCw size={12} /></button> : null}
          {onRemove ? <button type="button" aria-label={t('myVoices.remove')} onClick={(e) => { e.stopPropagation(); onRemove(); }} className={`${PANEL_ROUND} text-[var(--text-muted)] hover:text-[var(--err)]`}><Trash2 size={12} /></button> : null}
        </> : null}
        <button
          type="button"
          aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')}
          aria-pressed={kept}
          onClick={(e) => { e.stopPropagation(); toggleFavorite(voiceKey(voice)); }}

          className={`${PANEL_ROUND} ${kept ? 'grid text-[#ffd35a]' : 'hidden text-[var(--text)] group-hover:grid'}`}
        >
          <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
        </button>
        {access && onSpeak ? (
          <button type="button" data-voice-speak="" aria-label={t('voiceSpeak.open')} onClick={(e) => { e.stopPropagation(); onSpeak(); }}
            className={`${PANEL_ROUND} ${ADD_HOVER} hidden text-[var(--text)] group-hover:grid`}>
            <AudioLines size={12} strokeWidth={2.4} />
          </button>
        ) : null}
        {here !== 'here' ? (
          <DownloadBadge state={here} onDownload={onPlay} onRetry={onPlay} className={PANEL_ROUND} />
        ) : access ? (
          <button type="button" aria-label={useTip} onClick={(e) => { e.stopPropagation(); onUse(); }}
            className={`${ROUND} ${ADD_COLOR} ${picked ? 'grid' : 'hidden group-hover:grid'}`}>
            <Plus size={12} strokeWidth={2.6} />
          </button>
        ) : !own || !own.available ? (
          <button type="button" aria-label={useTip} onClick={(e) => { e.stopPropagation(); onServices(); }}
            className="hidden whitespace-nowrap text-[11px] text-[var(--accent)] hover:underline group-hover:inline">
            {t('assetDrawer.connect')}
          </button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * A voice's picture (lib/library-voices voiceLook): a soft orb in its kind's colors;
 * under the pointer, or while it plays, it is the button that plays it.
 */
function VoiceAvatar({ voice, sounding, loading = false, label }: { voice: LibraryVoice; sounding: boolean; loading?: boolean; label: string }) {
  const look = React.useMemo(() => voiceLook(voice), [voice]);
  /* a pair: its two voices, one over the other */
  if (voice.pair && voice.members?.length === 2) return (
    <span aria-label={label} className="relative h-10 w-10 shrink-0">
      {voice.members.map((m, i) => (
        <span key={m.id} className={`absolute top-1.5 h-7 w-7 overflow-hidden rounded-full ring-2 ring-[var(--bg-panel)] ${i ? 'left-3' : 'left-0'}`}>
          <span className="absolute -inset-1 blur-[2px]" style={voiceLook({ provider: voice.provider, id: m.id, gender: m.gender, age: null })} />
        </span>
      ))}
    </span>
  );
  return (
    <span aria-label={label} className="relative grid h-10 w-10 shrink-0 place-items-center">
      <span className="absolute inset-0 overflow-hidden rounded-full">
        <span className="absolute -inset-1 blur-[3px]" style={look} />
      </span>
      {sampleUrl(voice) ? <span className={`absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white ${sounding || loading ? '' : 'opacity-0 group-hover:opacity-100'}`}>
        {loading ? <Square size={12} fill="currentColor" /> : sounding ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
      </span> : null}
    </span>
  );
}
