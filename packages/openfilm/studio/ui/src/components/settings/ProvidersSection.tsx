/**
 * Settings → Providers: the services `openfilm get` gets voices, music, sound effects, transcripts, images, video and
 * web searches from, one list in the order of their names, none put first.
 *
 * ElevenLabs, OpenAI, Google Gemini, fal.ai, Groq, Pexels, Pixabay, Brave Search and Tavily connect with the person's
 * own key, which pays that service directly when it charges (a key in the environment shows as such and stays there).
 * Which of them makes each kind of media, and with which model, is Settings → Models.
 */
import React from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import { useT } from '@/i18n';
import { useProviders, type OwnProvider, type ProviderVerb, type ProvidersHook } from '@/lib/providers';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsField, SettingsGroup, SettingsInset, SettingsItem, SettingsPage, SettingsStatus, settingsError, settingsLink } from './ui';

/** What a provider can make, in the order Models lists it (listing voices goes without saying with voice-over). */
const ABILITY_ORDER: ProviderVerb[] = ['tts', 'music', 'sfx', 'asr', 'image', 'image-search', 'video', 'translate', 'web-search'];


export function ProvidersSection() {
  const t = useT();
  const providers = useProviders();
  const rows = [...(providers.state?.providers ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <SettingsPage note={t('settings.providers.desc')}>
      <SettingsGroup footnote={t('settings.providers.keyNote')}>
        {rows.map((provider) => <KeyRow key={provider.id} provider={provider} hook={providers} />)}
      </SettingsGroup>
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
