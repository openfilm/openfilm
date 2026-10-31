/**
 * The services at the top of Settings → Services (ServicesBar): what `openfilm get` gets voices, music, sound
 * effects, transcripts, images, video and web searches from, each a chip, the connected ones first, then the
 * recommended ones (lib/providers RECOMMENDED_PROVIDERS), the rest behind "N more". A chip opens the service's card:
 * connecting it, how it is paid, and what it makes with which models.
 *
 * ElevenLabs, OpenAI, Google, Microsoft Azure, fal.ai, OpenRouter, Groq, Pexels, Pixabay, Brave Search and Tavily connect with the person's
 * own key, which pays that service directly when it charges (a key in the environment shows as such and stays there).
 * OpenFilm connects by signing in to the person's OpenFilm account in their browser (SignInRow).
 * Keenable also works without one: Connect connects it at once, and a key can be added after, for higher limits.
 * A service can also be connected from a kind of media's menu, by picking one of its models (ModelsSection).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, CircleHelp, ExternalLink, LogIn, Plus, X } from 'lucide-react';
import { useT } from '@/i18n';
import { AZURE_SERVICES, azureKey, providerGroups, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { Tooltip } from '../Tooltip';
import { customProblem } from './CustomServices';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsField, SettingsInset, SettingsItem, SettingsStatus, settingsError, settingsLink } from './ui';

/** What a provider can make, in the order Services lists it (listing voices goes without saying with voice-over). */
const ABILITY_ORDER: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search'];

/**
 * Every service as a chip at the top of Services: the connected ones first (with a dot), then the recommended ones,
 * then the rest behind "N more". A chip opens the service's card (ProviderDialog).
 */
export function ServicesBar({ hook }: { hook: ProvidersHook }) {
  const t = useT();
  const rows = hook.state?.providers ?? [];
  const isOn = (p: OwnProvider) => Boolean(p.source) || hook.state?.signingIn.provider === p.id;
  const connected = rows.filter(isOn).sort((a, b) => a.name.localeCompare(b.name));
  const groups = providerGroups(rows.filter((p) => !isOn(p)));
  const [all, setAll] = React.useState(false);
  const [shown, setShown] = React.useState<string | null>(null);
  const showing = rows.find((p) => p.id === shown) ?? null;
  const chip = (p: OwnProvider) => (
    <button key={p.id} type="button" onClick={() => setShown(p.id)}
      className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[14px] transition hover:border-[var(--border-strong)] hover:text-[var(--text)] ${isOn(p) ? 'border-[var(--border-strong)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
      <ProviderMark id={p.id} size={15} />
      {p.name}
      {isOn(p) ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-label={t('settings.providers.connected')} /> : null}
    </button>
  );
  if (!hook.state) return null;
  return (
    <div className="mb-10">
      <div className="flex flex-wrap gap-2">
        {connected.map(chip)}
        {groups.recommended.map(chip)}
        {all ? groups.more.map(chip) : null}
        {groups.more.length ? (
          <button type="button" aria-expanded={all} onClick={() => setAll(!all)}
            className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[14px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
            {all ? t('settings.providers.fewer') : t('settings.providers.moreCount').replaceAll('{n}', String(groups.more.length))}
            <ChevronRight size={14} className={`transition-transform ${all ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        ) : null}
      </div>
      {/* a key that was refused says why under its own field, in its card; a custom service's under its form */}
      {hook.problem && !rows.some((p) => p.id === hook.problemFor) && !customProblem(hook) ? <p className={settingsError}>{hook.problem}</p> : null}
      {showing ? <ProviderDialog provider={showing} hook={hook} onClose={() => setShown(null)} /> : null}
    </div>
  );
}

/**
 * A service's card, over Settings: connecting it (or how it is connected, and disconnecting), how it is paid, and each
 * kind of media it makes with its models. Esc or a click beside it closes it, not Settings.
 */
function ProviderDialog({ provider, hook, onClose }: { provider: OwnProvider; hook: ProvidersHook; onClose: () => void }) {
  const t = useT();
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    /* a field's own Esc (a key being pasted) closes only that field */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const kinds = ABILITY_ORDER.filter((v) => provider.verbs.includes(v));
  const paid = provider.signIn ? t('settings.providers.balanceNote').replaceAll('{name}', provider.name) : t('settings.providers.keyNote');

  return createPortal(
    <div className="fixed inset-0 z-[10070] grid place-items-center bg-black/40 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={provider.name}
        className="relative flex max-h-[80dvh] w-[600px] max-w-full flex-col overflow-y-auto rounded-[14px] border border-[var(--border)] bg-[var(--dock-pane)] px-6 pb-6 pt-3 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)]">
        <button type="button" onClick={onClose} aria-label={t('settings.done')}
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <X size={16} />
        </button>
        <div className="pr-8"><ProviderRow provider={provider} hook={hook} /></div>
        <p className="text-[13.5px] leading-relaxed text-[var(--text-faint)]">{paid}</p>
        {kinds.length ? (
          <div className="mt-5">
            <h3 className="mb-1 text-[15px] font-semibold text-[var(--text)]">{t('settings.providers.makes')}</h3>
            <div className="flex flex-col divide-y divide-[var(--border)]">
              {kinds.map((verb) => (
                <div key={verb} className="flex gap-4 py-3">
                  <span className="w-[150px] shrink-0 text-[14.5px] text-[var(--text)]">{t(`settings.providers.verbs.${verb}`)}</span>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {(provider.models[verb] ?? []).map((m) => (
                      <span key={m.id} className="rounded-md bg-[var(--fill-tsp)] px-2 py-0.5 text-[13.5px] text-[var(--text-muted)]">{m.name}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/** A provider in the list: its mark, its name (and what is next to it), a line about it, and what can be done. */
function Row({ id, name, badge, children, action, below }: {
  id: string;
  name: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  action: React.ReactNode;
  below?: React.ReactNode;
}) {
  return (
    <SettingsItem mark={<ProviderMark id={id} size={17} />} title={name} badge={badge} description={children} control={action}>
      {below}
    </SettingsItem>
  );
}

/** Shown beside a connected provider's name, with whatever tells which connection it is (a key's last four). */
function Connected({ children }: { children?: React.ReactNode }) {
  const t = useT();
  return <SettingsStatus>{t('settings.providers.connected')}{children}</SettingsStatus>;
}

/** What a provider makes, as a phrase: "Voice-over, music, sound effects and transcription". */
function abilityPhrase(verbs: readonly ProviderVerb[], t: (key: string) => string) {
  const words = verbs.map((v, i) => (i ? t(`settings.providers.verbs.${v}`).toLowerCase() : t(`settings.providers.verbs.${v}`)));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} ${t('settings.providers.and')} ${words.at(-1)}` : words[0] ?? '';
}

/**
 * A provider, connected the way it is: by signing in on its website, or with a key. `asking`: its key's field open from
 * the start (connecting it from a kind of media's menu), and `onClose` when it closes unsaved.
 */
export function ProviderRow({ provider, hook, asking = false, onClose }: { provider: OwnProvider; hook: ProvidersHook; asking?: boolean; onClose?: () => void }) {
  return provider.signIn && provider.source !== 'env'
    ? <SignInRow provider={provider} hook={hook} />
    : <KeyRow provider={provider} hook={hook} asking={asking} onClose={onClose} />;
}

/**
 * A provider connected by signing in to the person's account on its website, in their browser: signed in as their
 * email, waiting for the browser (with a way to stop waiting), or not yet.
 */
function SignInRow({ provider, hook }: { provider: OwnProvider; hook: ProvidersHook }) {
  const t = useT();
  const busy = hook.busy === provider.id;
  const signing = hook.state?.signingIn;
  const waiting = signing?.provider === provider.id;
  const problem = (hook.problemFor === provider.id ? hook.problem : null) ?? (signing?.errorFor === provider.id ? signing.error : null);
  return (
    <Row
      id={provider.id}
      name={provider.name}
      badge={provider.source ? <Connected>{provider.account ? <span className="text-[var(--text-faint)]">{provider.account}</span> : null}</Connected> : null}
      action={provider.source ? (
        <div className="flex items-center gap-1">
          <a href={provider.keysUrl} target="_blank" rel="noreferrer" className={`${settingsLink} text-[14px]`}>
            {t('settings.providers.manageAccount')}<ExternalLink size={12} />
          </a>
          <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.removeKey(provider.id)}>{t('settings.providers.signOut')}</SettingsButton>
        </div>
      ) : waiting ? (
        <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.cancelSignIn(provider.id)}>{t('settings.providers.cancel')}</SettingsButton>
      ) : (
        <SettingsButton disabled={busy} onClick={() => void hook.signIn(provider.id)}>
          <LogIn size={15} strokeWidth={2} />{t('settings.providers.signIn')}
        </SettingsButton>
      )}
      below={problem && !provider.source ? <p className={`${settingsError} pl-[34px]`} role="alert">{problem}</p> : null}
    >
      {waiting ? t('settings.providers.signingIn') : abilityPhrase(ABILITY_ORDER.filter((v) => provider.verbs.includes(v)), t)}
    </Row>
  );
}

/**
 * A service paid with the person's own key: connected by pasting one (kept here, or read from the environment). One that
 * works without a key (`keyless`) connects with one click, and takes a key afterwards.
 */
function KeyRow({ provider, hook, asking, onClose }: { provider: OwnProvider; hook: ProvidersHook; asking: boolean; onClose?: () => void }) {
  const t = useT();
  const [adding, setAdding] = React.useState(asking);
  const [draft, setDraft] = React.useState('');
  /* Microsoft Azure: each service its own region and key (AZURE_SERVICES), kept as `<region>:<key>` */
  const azure = provider.id === 'azure';
  const [region, setRegion] = React.useState('');
  const saving = hook.busy === provider.id;
  const key = azure ? azureKey(region, draft) : draft.trim() ? draft : null;
  /* a key can be pasted while there is none: not connected, or connected without one */
  const keyless = Boolean(provider.keyless);
  const keyWanted = !provider.source || (keyless && !provider.last4);

  const close = (saved = false) => { setAdding(false); setDraft(''); setRegion(''); if (!saved) onClose?.(); };
  const save = async () => {
    if (!key || saving) return;
    if (await hook.saveKey(provider.id, key)) close(true);
  };
  const pasteLabel = azure ? t('settings.providers.key') : t('settings.providers.pasteKey').replaceAll('{name}', provider.name);

  return (
    <Row
      id={provider.id}
      name={provider.name}
      badge={provider.source ? (
        <Connected>
          {provider.last4 ? (
            <span className="font-mono tabular-nums text-[var(--text-faint)]" aria-label={t('settings.providers.keyEnding').replaceAll('{last4}', provider.last4)}>
              •••• {provider.last4}
            </span>
          ) : null}
        </Connected>
      ) : null}
      action={provider.source ? (
        <>
          {keyWanted && !adding ? <SettingsButton variant="quiet" onClick={() => setAdding(true)}>{t('settings.providers.addKey')}</SettingsButton> : null}
          <SettingsButton variant="quiet" disabled={saving} onClick={() => void hook.removeKey(provider.id)}>{t('settings.providers.disconnect')}</SettingsButton>
        </>
      ) : adding ? null : (
        <SettingsButton disabled={saving} onClick={() => (keyless ? void hook.saveKey(provider.id, '') : setAdding(true))}>
          <Plus size={15} strokeWidth={2} />{t('settings.providers.connect')}
        </SettingsButton>
      )}
      below={adding && keyWanted ? (
        <form className="pl-[34px]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <SettingsInset>
            {azure ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[var(--text)]">{AZURE_SERVICES[0]!.name}</span>
                <span className="text-[13px] text-[var(--text-faint)]">{t('settings.providers.azureNote')}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              {azure ? (
                <div className="w-[160px] shrink-0">
                  <SettingsField
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
                    placeholder={t('settings.providers.region')}
                    aria-label={t('settings.providers.region')}
                    className="font-mono placeholder:font-sans"
                  />
                </div>
              ) : null}
              <SettingsField
                type="password"
                autoFocus={!azure}
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
                placeholder={pasteLabel}
                aria-label={pasteLabel}
                className="flex-1 font-mono placeholder:font-sans"
              />
              <SettingsButton variant="quiet" onClick={() => close()}>{t('settings.providers.cancel')}</SettingsButton>
              <SettingsButton type="submit" variant="primary" disabled={!key || saving}>{t('settings.providers.save')}</SettingsButton>
            </div>
            {hook.problem && hook.problemFor === provider.id ? <p className={settingsError} role="alert">{hook.problem}</p> : null}
            {/* the environment has a key for it: connect with that one, nothing to paste */}
            {provider.envKey ? (
              <button type="button" disabled={saving} onClick={() => void hook.useEnvKey(provider.id).then((ok) => { if (ok) close(true); })} className={`${settingsLink} self-start text-[14.5px]`}>
                {t('settings.providers.useEnv').replaceAll('{env}', provider.env)}
              </button>
            ) : null}
            <a href={provider.keysUrl} target="_blank" rel="noreferrer" className={`${settingsLink} text-[14.5px]`}>
              {t('settings.providers.getKey').replaceAll('{name}', provider.name)}<ExternalLink size={12} />
            </a>
          </SettingsInset>
        </form>
      ) : null}
    >
      {keyless ? (
        <span className="inline-flex items-center gap-1">
          {abilityPhrase(ABILITY_ORDER.filter((v) => provider.verbs.includes(v)), t)}
          {/* what goes to a service connected with no key, a point away, before it is connected and after */}
          <Tooltip label={t('settings.providers.keyless').replaceAll('{name}', provider.name)} wrap>
            <span tabIndex={0} aria-label={t('settings.providers.keyless').replaceAll('{name}', provider.name)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <CircleHelp size={14} aria-hidden />
            </span>
          </Tooltip>
        </span>
      ) : abilityPhrase(ABILITY_ORDER.filter((v) => provider.verbs.includes(v)), t)}
    </Row>
  );
}
