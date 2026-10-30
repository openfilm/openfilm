/**
 * Settings → Providers: the services `openfilm get` gets voices, music, sound effects, transcripts, images, video and
 * web searches from. The recommended ones first (lib/providers RECOMMENDED_PROVIDERS), the rest under More, folded
 * until opened (open from the start when one of them is connected).
 *
 * ElevenLabs, OpenAI, Google, Microsoft Azure, fal.ai, Groq, Pexels, Pixabay, Brave Search and Tavily connect with the person's
 * own key, which pays that service directly when it charges (a key in the environment shows as such and stays there).
 * OpenFilm connects by signing in to the person's OpenFilm account in their browser (SignInRow).
 * Which of them makes each kind of media, and with which model, is Settings → Services, with the person's own custom
 * services (CustomServices).
 */
import React from 'react';
import { ChevronRight, ExternalLink, LogIn, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { AZURE_SERVICES, azureKey, providerGroups, useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { customProblem } from './CustomServices';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsField, SettingsGroup, SettingsInset, SettingsItem, SettingsPage, SettingsStatus, settingsError, settingsLink } from './ui';

/** What a provider can make, in the order Models lists it (listing voices goes without saying with voice-over). */
const ABILITY_ORDER: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search'];


export function ProvidersSection() {
  const t = useT();
  const providers = useProviders();
  const rows = providers.state?.providers ?? [];
  const groups = providerGroups(rows);
  /* folded until opened; a refused key under More opens it, so its reason shows */
  const [moreOpen, setMoreOpen] = React.useState<boolean | null>(null);
  const showMore = moreOpen ?? (groups.open || groups.more.some((p) => p.id === providers.problemFor));

  return (
    <SettingsPage note={t('settings.providers.desc')}>
      <SettingsGroup title={t('settings.providers.groupRecommended')} footnote={t('settings.providers.keyNote')}>
        {groups.recommended.map((provider) => <ProviderRow key={provider.id} provider={provider} hook={providers} />)}
      </SettingsGroup>
      {groups.more.length ? (
        <SettingsGroup title={(
          <button type="button" aria-expanded={showMore} onClick={() => setMoreOpen(!showMore)}
            className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 transition hover:text-[var(--text)]">
            <ChevronRight size={14} className={`transition-transform ${showMore ? 'rotate-90' : ''}`} aria-hidden />
            {t('settings.providers.groupMore')}
            <span className="text-[var(--text-faint)]">{groups.more.length}</span>
          </button>
        )}>
          {showMore ? groups.more.map((provider) => <ProviderRow key={provider.id} provider={provider} hook={providers} />) : null}
        </SettingsGroup>
      ) : null}
      {/* a key that was refused says why under its own field (KeyRow), not down here past the list; a custom service's
          under its form (Settings → Services) */}
      {providers.problem && !rows.some((p) => p.id === providers.problemFor) && !customProblem(providers) ? <p className={settingsError}>{providers.problem}</p> : null}
    </SettingsPage>
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

/** A provider, connected the way it is: by signing in on its website, or with a key. */
function ProviderRow({ provider, hook }: { provider: OwnProvider; hook: ProvidersHook }) {
  return provider.signIn && provider.source !== 'env' ? <SignInRow provider={provider} hook={hook} /> : <KeyRow provider={provider} hook={hook} />;
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

/** A service paid with the person's own key: connected by pasting one (kept here, or read from the environment). */
function KeyRow({ provider, hook }: { provider: OwnProvider; hook: ProvidersHook }) {
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  /* Microsoft Azure: each service its own region and key (AZURE_SERVICES), kept as `<region>:<key>` */
  const azure = provider.id === 'azure';
  const [region, setRegion] = React.useState('');
  const saving = hook.busy === provider.id;
  const key = azure ? azureKey(region, draft) : draft.trim() ? draft : null;

  const close = () => { setAdding(false); setDraft(''); setRegion(''); };
  const save = async () => {
    if (!key || saving) return;
    if (await hook.saveKey(provider.id, key)) close();
  };
  const pasteLabel = azure ? t('settings.providers.key') : t('settings.providers.pasteKey').replaceAll('{name}', provider.name);

  return (
    <Row
      id={provider.id}
      name={provider.name}
      badge={provider.source ? (
        <Connected>
          <span className="font-mono tabular-nums text-[var(--text-faint)]" aria-label={t('settings.providers.keyEnding').replaceAll('{last4}', provider.last4 ?? '')}>
            •••• {provider.last4}
          </span>
        </Connected>
      ) : null}
      action={provider.source ? (
        <SettingsButton variant="quiet" disabled={saving} onClick={() => void hook.removeKey(provider.id)}>{t('settings.providers.disconnect')}</SettingsButton>
      ) : adding ? null : (
        <SettingsButton onClick={() => setAdding(true)}>
          <Plus size={15} strokeWidth={2} />{t('settings.providers.connect')}
        </SettingsButton>
      )}
      below={adding && !provider.source ? (
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
              <SettingsButton variant="quiet" onClick={close}>{t('settings.providers.cancel')}</SettingsButton>
              <SettingsButton type="submit" variant="primary" disabled={!key || saving}>{t('settings.providers.save')}</SettingsButton>
            </div>
            {hook.problem && hook.problemFor === provider.id ? <p className={settingsError} role="alert">{hook.problem}</p> : null}
            {/* the environment has a key for it: connect with that one, nothing to paste */}
            {provider.envKey ? (
              <button type="button" disabled={saving} onClick={() => void hook.useEnvKey(provider.id).then((ok) => { if (ok) close(); })} className={`${settingsLink} self-start text-[14.5px]`}>
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
      {abilityPhrase(ABILITY_ORDER.filter((v) => provider.verbs.includes(v)), t)}
    </Row>
  );
}
