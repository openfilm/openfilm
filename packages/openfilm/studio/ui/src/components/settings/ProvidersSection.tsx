/**
 * The services at the top of Settings → Services (ServicesBar): what `openfilm get` gets voices, music, sound
 * effects, transcripts, images, video and web searches from, each a chip, the connected ones first, then the
 * recommended ones (lib/providers RECOMMENDED_PROVIDERS), the rest and adding one behind "N more".
 *
 * A chip opens the service's card (ProviderDialog): who it is, Connect (or how it is connected, its account page for one
 * signed in to, and Disconnect), how it is paid, and every kind it could make with the models it makes it with.
 * Connect is the same for every service:
 * ElevenLabs, OpenAI, Google, Microsoft Azure, fal.ai, OpenRouter, Groq, Pexels, Pixabay, Brave Search and Tavily then
 * take the person's own key, which pays that service directly (a key in the environment shows as such and stays
 * there); OpenFilm signs in to the person's OpenFilm account in their browser; Keenable connects at once and takes a
 * key afterwards, for higher limits.
 * Each links its own pricing page; what is free and what is paid is the service's to say.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AudioWaveform, Captions, ChevronRight, Clapperboard, createLucideIcon, ExternalLink, Globe, Image, Mic, Music, Plus, ScanSearch, Scissors } from 'lucide-react';
import { useT } from '@/i18n';
import { AZURE_SERVICES, PROVIDER_SITES, SERVICE_VERBS, azureKey, providerOrder, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { customProblem } from './CustomServices';
import { ProviderMark } from './ProviderMark';
import { DialogClose, DialogIdentity } from './DialogIdentity';
import { SettingsButton, SettingsField, SettingsLinkButton, settingsError, settingsLink } from './ui';

/** Where a new built-in provider is proposed, and what it needs. */
const ADDING_PROVIDERS = 'https://github.com/openfilm/openfilm/blob/main/CONTRIBUTING.md#adding-a-media-provider';

/** Video search: a clip's frame with its play mark, found with a magnifier (as image search finds a picture). */
const VideoSearch = createLucideIcon('video-search', [
  ['path', { d: 'M13 17H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v5', key: 'frame' }],
  ['path', { d: 'M8 8.5v5l4-2.5z', key: 'play' }],
  ['circle', { cx: '17', cy: '17', r: '3', key: 'lens' }],
  ['path', { d: 'm22 22-2.8-2.8', key: 'handle' }],
]);

/** Each kind's picture, wherever kinds are listed. */
export const KIND_ICON: Partial<Record<ProviderVerb, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>>> = {
  tts: Mic, music: Music, sfx: AudioWaveform, asr: Captions, cutout: Scissors, image: Image, 'image-search': ScanSearch, video: Clapperboard, 'video-search': VideoSearch, 'web-search': Globe,
};

const chipClass = 'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[14px] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]';

/**
 * Every service as a chip: OpenFilm's own first, then the connected ones (with a dot), the recommended ones, and the
 * rest behind "N more", each part in the default order (lib/providers providerOrder); last `local` (Local services),
 * just before adding one. A chip opens the service's card (`onOpen` with its id, or 'add').
 */
export function ServicesBar({ hook, onOpen, local }: { hook: ProvidersHook; onOpen: (id: string) => void; local?: React.ReactNode }) {
  const t = useT();
  const rows = hook.state?.providers ?? [];
  /* OpenFilm's own first, then the others */
  const own = rows.find((p) => p.id === 'openfilm');
  /* Local services has its own chip (`local`) */
  const order = providerOrder(rows.filter((p) => p !== own && p.id !== 'local'));
  const [all, setAll] = React.useState(false);
  const chip = (p: OwnProvider) => (
    <button key={p.id} type="button" onClick={() => onOpen(p.id)}
      className={`${chipClass} ${p.source ? 'border-[var(--border-strong)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
      <ProviderMark id={p.id} size={15} />
      {p.name}
      {p.source ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-label={t('settings.providers.connected')} /> : null}
    </button>
  );
  if (!hook.state) return null;
  return (
    <div className="mb-10">
      <div className="flex flex-wrap gap-2">
        {own ? chip(own) : null}
        {order.connected.map(chip)}
        {order.recommended.map(chip)}
        {all ? order.more.map(chip) : null}
        {local}
        {all ? (
          <button type="button" onClick={() => onOpen('add')} className={`${chipClass} border-dashed border-[var(--border)] text-[var(--text-muted)]`}>
            <Plus size={15} aria-hidden />{t('settings.providers.addProvider')}
          </button>
        ) : null}
        <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
          className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[14px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
          {all ? t('settings.providers.fewer') : t('settings.providers.moreCount').replaceAll('{n}', String(order.more.length))}
          <ChevronRight size={14} className={`transition-transform ${all ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {/* a key that was refused says why in its card; a custom service's under its form */}
      {hook.problem && !rows.some((p) => p.id === hook.problemFor) && !customProblem(hook) ? <p className={settingsError}>{hook.problem}</p> : null}
    </div>
  );
}

/** A card over Settings. Esc or a click beside it closes it, not Settings; a field's own Esc closes only that field. */
export function Card({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const t = useT();
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[10070] grid place-items-center bg-black/45 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={label}
        className="relative flex max-h-[86dvh] w-[640px] max-w-full flex-col overflow-y-auto rounded-[16px] border border-[var(--border)] bg-[var(--bg-raised)] p-7 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]">
        <DialogClose label={t('settings.done')} onClose={onClose} />
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The provider's own pricing page, a link after how it is paid. */
function PricingLink({ provider }: { provider: OwnProvider }) {
  const t = useT();
  return (
    <>
      <span aria-hidden className="text-[var(--text-faint)]">·</span>
      <a href={provider.pricingUrl} target="_blank" rel="noreferrer" className={settingsLink}
        aria-label={t('settings.providers.pricingOf').replaceAll('{name}', provider.name)}>
        {t('settings.providers.pricing')}
      </a>
    </>
  );
}

/**
 * A service's card: its mark, name and website, with Connect (or how it is connected, and Disconnect); who it is; and
 * every kind it could make, with its models or a dash; at the foot, how it is paid.
 */
export function ProviderDialog({ provider, hook, onClose }: { provider: OwnProvider; hook: ProvidersHook; onClose: () => void }) {
  const t = useT();
  const site = PROVIDER_SITES[provider.id];
  const kinds = SERVICE_VERBS;
  const paid = provider.signIn ? t('settings.providers.balanceNote').replaceAll('{name}', provider.name)
    : provider.keyless ? t('settings.providers.keyless').replaceAll('{name}', provider.name)
      : t('settings.providers.keyNote');
  return (
    <Card label={provider.name} onClose={onClose}>
      <Connection provider={provider} hook={hook} header={(status, action) => (
        /* the status line runs on under the buttons, which are no taller than the name and website */
        <DialogIdentity name={provider.name} mark={<ProviderMark id={provider.id} size={24} />}
          website={site ? { href: `https://${site}`, label: site } : undefined} actions={action} status={status} />
      )} />
      <p className="mt-5 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t(`settings.providers.about.${provider.id}`)}</p>
      <h3 className="mb-1 mt-7 text-[13px] font-medium text-[var(--text-faint)]">{t('settings.providers.makes')}</h3>
      <div className="flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {kinds.map((verb) => {
          const models = provider.verbs.includes(verb) ? provider.models[verb] ?? [] : [];
          const makes = provider.verbs.includes(verb);
          const Icon = KIND_ICON[verb] ?? Globe;
          return (
            <div key={verb} className="flex items-start gap-3 py-3">
              <Icon size={16} strokeWidth={1.75} className={`mt-[3px] shrink-0 ${makes ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)] opacity-60'}`} />
              <span className={`w-[132px] shrink-0 text-[14.5px] ${makes ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>{t(`settings.providers.verbs.${verb}`)}</span>
              {models.length ? (
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {models.map((m) => <span key={m.id} className="rounded-[6px] bg-[var(--bg-field)] px-2 py-0.5 text-[13.5px] text-[var(--text-muted)]">{m.name}</span>)}
                </div>
              ) : <span className="text-[14px] text-[var(--text-faint)]">{makes ? t('settings.providers.included') : '—'}</span>}
            </div>
          );
        })}
      </div>
      <p className="mt-5 inline-flex flex-wrap items-center gap-x-1.5 text-[13px] leading-relaxed text-[var(--text-faint)]">{paid}{provider.pricingUrl ? <PricingLink provider={provider} /> : null}</p>
    </Card>
  );
}

/**
 * How a provider is connected, and connecting it: `header` lays out its status beside the name and its action; under
 * it, the key's field while one is being pasted, and why the last try failed. Connect signs in (OpenFilm), connects at
 * once (a keyless one), or asks for the key; Microsoft Azure's key comes with its region (`<region>:<key>`).
 */
function Connection({ provider, hook, header }: {
  provider: OwnProvider;
  hook: ProvidersHook;
  header: (status: React.ReactNode, action: React.ReactNode) => React.ReactNode;
}) {
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [region, setRegion] = React.useState('');
  const azure = provider.id === 'azure';
  const busy = hook.busy === provider.id;
  const signing = hook.state?.signingIn;
  const waiting = signing?.provider === provider.id;
  const signIn = provider.signIn && provider.source !== 'env';
  /* a key can be pasted while there is none: not connected, or a keyless one connected without one */
  const keyWanted = !signIn && (!provider.source || (Boolean(provider.keyless) && !provider.last4));
  const key = azure ? azureKey(region, draft) : draft.trim() ? draft : null;
  const close = () => { setAdding(false); setDraft(''); setRegion(''); };
  const save = async () => { if (key && !busy && await hook.saveKey(provider.id, key)) close(); };
  const problem = (hook.problemFor === provider.id ? hook.problem : null) ?? (signing?.errorFor === provider.id ? signing.error : null) ?? provider.connectionError;
  const pasteLabel = azure ? t('settings.providers.key') : t('settings.providers.pasteKey').replaceAll('{name}', provider.name);
  const escape = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };

  /* one line, never broken: the dot, Connected, and as whom (an account's email, or a key's last four); cut short when
     the card is too narrow for it */
  const status = provider.source ? (
    <span className="min-w-0 max-w-full truncate text-[var(--text-muted)]" title={provider.account || undefined}>
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)] align-middle" aria-hidden />
      {t('settings.providers.connected')}
      {provider.account ? <span className="text-[var(--text-faint)]"> · {provider.account}</span> : null}
      {!provider.account && provider.last4 ? <span className="font-mono tabular-nums text-[var(--text-faint)]" aria-label={t('settings.providers.keyEnding').replaceAll('{last4}', provider.last4)}> · •••• {provider.last4}</span> : null}
    </span>
  ) : waiting ? <span className="text-[var(--text-muted)]">{t('settings.providers.signingIn')}</span> : null;

  const action = provider.source ? (
    <>
      {/* signed in: the account's own page, where its balance, usage and computers are */}
      {signIn ? <SettingsLinkButton href={provider.keysUrl}>{t('settings.providers.account')}<ExternalLink size={12} /></SettingsLinkButton> : null}
      {keyWanted && !adding ? <SettingsButton variant="quiet" onClick={() => setAdding(true)}>{t('settings.providers.addKey')}</SettingsButton> : null}
      <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.removeKey(provider.id)}>{t('settings.providers.disconnect')}</SettingsButton>
    </>
  ) : waiting ? (
    <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.cancelSignIn(provider.id)}>{t('settings.providers.cancel')}</SettingsButton>
  ) : adding ? null : (
    <SettingsButton variant="primary" disabled={busy}
      onClick={() => (signIn ? void hook.signIn(provider.id) : provider.keyless ? void hook.saveKey(provider.id, '') : setAdding(true))}>
      {t('settings.providers.connect')}
    </SettingsButton>
  );

  return (
    <>
      {header(status, action)}
      {adding && keyWanted ? (
        <form className="mt-5 flex flex-col gap-3 rounded-[12px] border border-[var(--border)] p-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {azure ? (
            <p className="text-[13.5px] leading-relaxed text-[var(--text-faint)]"><span className="font-medium text-[var(--text)]">{AZURE_SERVICES[0]!.name}</span> · {t('settings.providers.azureNote')}</p>
          ) : null}
          <div className="flex items-center gap-2">
            {azure ? (
              <div className="w-[150px] shrink-0">
                <SettingsField autoFocus autoComplete="off" spellCheck={false} value={region} onChange={(e) => setRegion(e.target.value)} onKeyDown={escape}
                  placeholder={t('settings.providers.region')} aria-label={t('settings.providers.region')} className="font-mono placeholder:font-sans" />
              </div>
            ) : null}
            <SettingsField type="password" autoFocus={!azure} autoComplete="off" spellCheck={false} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={escape}
              placeholder={pasteLabel} aria-label={pasteLabel} className="flex-1 font-mono placeholder:font-sans" />
            <SettingsButton variant="quiet" onClick={close}>{t('settings.providers.cancel')}</SettingsButton>
            <SettingsButton type="submit" variant="primary" disabled={!key || busy}>{t('settings.providers.save')}</SettingsButton>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={provider.keysUrl} target="_blank" rel="noreferrer" className={`${settingsLink} text-[14px]`}>
              {t('settings.providers.getKey').replaceAll('{name}', provider.name)}<ExternalLink size={12} />
            </a>
            {/* the environment has a key for it: connect with that one, nothing to paste */}
            {provider.envKey ? (
              <button type="button" disabled={busy} onClick={() => void hook.useEnvKey(provider.id).then((ok) => { if (ok) close(); })} className={`${settingsLink} text-[14px]`}>
                {t('settings.providers.useEnv').replaceAll('{env}', provider.env)}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
      {problem && (adding || !provider.source) ? <p className={`${settingsError} mt-3`} role="alert">{problem}</p> : null}
    </>
  );
}

/** Adding a provider: what a built-in one has to be, and the custom services every other one works through today. */
export function AddProviderDialog({ onCustom, onClose }: { onCustom: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Card label={t('settings.providers.addTitle')} onClose={onClose}>
      <div className="flex items-start gap-4 pr-8">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] border border-dashed border-[var(--border-strong)] text-[var(--text-muted)]"><Plus size={22} strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{t('settings.providers.addTitle')}</h2>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t('settings.providers.addIntro')}</p>
        </div>
      </div>
      <ol className="mt-6 flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {(['addKnown', 'addOther', 'addCustom'] as const).map((key, i) => (
          <li key={key} className="flex gap-4 py-4">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--bg-field)] text-[12.5px] font-medium text-[var(--text-muted)]">{i + 1}</span>
            <span className="text-[14.5px] leading-relaxed text-[var(--text)]">{t(`settings.providers.${key}`)}</span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <SettingsButton variant="primary" onClick={onCustom}>{t('settings.providers.addCustomAction')}</SettingsButton>
        <a href={ADDING_PROVIDERS} target="_blank" rel="noreferrer" className={`${settingsLink} text-[14.5px]`}>
          {t('settings.providers.addHow')}<ExternalLink size={12} />
        </a>
      </div>
    </Card>
  );
}
