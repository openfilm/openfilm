/**
 * Settings → Providers: the services `openfilm get` gets voices, music, sound effects, transcripts, images, video and
 * web searches from, one list in the order of their names, none put first.
 *
 * The OpenFilm account connects by signing in in the person's browser; plan, billing and the account itself are on the
 * website ("Manage account"), never on this localhost page. ElevenLabs, OpenAI, Google Gemini, fal.ai, Groq, Pexels,
 * Pixabay, Brave Search and Tavily connect with the person's own key, which pays that service directly when it charges
 * (a key in the environment shows as such and stays there).
 * Which of them makes each kind of media, and with which model, is Settings → Models.
 */
import React from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import type { OpenFilmAccountState } from '@/lib/openfilm-account';
import { useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsField, SettingsGroup, SettingsInset, SettingsItem, SettingsPage, SettingsStatus, settingsError, settingsLink } from './ui';

/** What a provider can make, in the order Models lists it (listing voices goes without saying with voice-over). */
const ABILITY_ORDER: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search'];


export function ProvidersSection({ state }: { state: OpenFilmAccountState }) {
  const t = useT();
  const providers = useProviders(state.account?.connected);
  const rows = [
    /* a build with no account service (run from source, or a release without one) doesn't list it */
    ...(state.account?.configured === false ? [] : [{ name: 'OpenFilm', row: <OpenFilmRow key="openfilm" state={state} /> }]),
    ...(providers.state?.providers ?? []).map((provider) => ({ name: provider.name, row: <KeyRow key={provider.id} provider={provider} hook={providers} /> })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SettingsPage note={t('settings.providers.desc')}>
      <SettingsGroup footnote={t('settings.providers.keyNote')}>
        {rows.map((r) => r.row)}
      </SettingsGroup>
      {state.problem ? <p className={settingsError}>{state.problem}</p> : null}
      {providers.problem ? <p className={settingsError}>{providers.problem}</p> : null}
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

/**
 * The OpenFilm account: connected by signing in in the browser; connected, who it is and where it is managed (what it
 * has left is there, never here). It makes every kind of media.
 */
function OpenFilmRow({ state }: { state: OpenFilmAccountState }) {
  const t = useT();
  const { account, busy } = state;
  const connected = Boolean(account?.connected);
  const waiting = Boolean(account?.pending);

  return (
    <Row
      id="openfilm"
      name="OpenFilm"
      action={connected ? (
        <SettingsButton variant="quiet" disabled={busy} onClick={() => void state.disconnect()}>{t('settings.providers.disconnect')}</SettingsButton>
      ) : (
        <SettingsButton disabled={busy || waiting || !state.loaded} onClick={() => void state.connect()}>
          {busy || waiting ? t('settings.providers.connecting') : <><Plus size={15} strokeWidth={2} />{t('settings.providers.connect')}</>}
        </SettingsButton>
      )}
    >
      {connected && account ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>{t('settings.providers.connectedAs').replaceAll('{email}', account.email || '—')}</span>
          <a href={account.manageUrl} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); state.manage(); }} className={settingsLink}>
            {t('settings.providers.manage')}<ExternalLink size={12} />
          </a>
        </span>
      ) : abilityPhrase(ABILITY_ORDER, t)}
      {waiting ? (
        <span className="mt-1 block">
          {t('settings.providers.waitingHint')}{' '}
          <button type="button" onClick={() => void state.connect()} className="underline underline-offset-2 hover:text-[var(--text)]">
            {t('settings.providers.startAgain')}
          </button>
        </span>
      ) : null}
    </Row>
  );
}

/** A service paid with the person's own key: connected by pasting one (kept here, or read from the environment). */
function KeyRow({ provider, hook }: { provider: OwnProvider; hook: ProvidersHook }) {
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const saving = hook.busy === provider.id;

  const close = () => { setAdding(false); setDraft(''); };
  const save = async () => {
    if (!draft.trim() || saving) return;
    if (await hook.saveKey(provider.id, draft)) close();
  };
  const pasteLabel = t('settings.providers.pasteKey').replaceAll('{name}', provider.name);

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
      action={provider.source === 'env' ? (
        <span className="text-[15px] text-[var(--text-muted)]">{t('settings.providers.fromEnv').replaceAll('{env}', provider.env)}</span>
      ) : provider.source === 'file' ? (
        <SettingsButton variant="quiet" disabled={saving} onClick={() => void hook.removeKey(provider.id)}>{t('settings.providers.disconnect')}</SettingsButton>
      ) : adding ? null : (
        <SettingsButton onClick={() => setAdding(true)}>
          <Plus size={15} strokeWidth={2} />{t('settings.providers.connect')}
        </SettingsButton>
      )}
      below={adding && !provider.source ? (
        <form className="pl-[34px]" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <SettingsInset>
            <div className="flex items-center gap-2">
              <SettingsField
                type="password"
                autoFocus
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
              <SettingsButton type="submit" variant="primary" disabled={!draft.trim() || saving}>{t('settings.providers.save')}</SettingsButton>
            </div>
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
