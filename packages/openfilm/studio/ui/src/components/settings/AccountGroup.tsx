/**
 * Settings → General → Account, at the top: the person's OpenFilm account, the one the OpenFilm service signs in to
 * (lib/providers `openfilm`). Not signed in is a local account where everything works, and only the OpenFilm service
 * waits for a sign-in. Signing in opens the website in the browser; signed in shows the account's picture, name and
 * email as the website has them (studio/server/account-profile.mjs; the email and its initial until the service
 * says), a way to the website's account page, where they are changed (the app changes nothing of the account), and
 * Sign out (the service is disconnected with it). A key in the environment shows as such and stays there.
 */
import React from 'react';
import { ExternalLink, User } from 'lucide-react';
import { useT } from '@/i18n';
import { accountState } from '@/lib/account';
import { useProviders } from '@/lib/providers';
import { SettingsButton, SettingsGroup, SettingsLinkButton, settingsError } from './ui';

/** The account's picture, else the first letter of its name on the app's color. */
export function Avatar({ src, name, size = 40 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);
  if (src && !failed) {
    return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} style={{ width: size, height: size }} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <span style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} className="flex shrink-0 items-center justify-center rounded-full bg-[var(--primary)] font-semibold uppercase text-[var(--on-primary)]">
      {[...name][0] ?? ''}
    </span>
  );
}

export function AccountGroup() {
  const t = useT();
  const hook = useProviders();
  const own = hook.state?.providers.find((p) => p.id === 'openfilm');
  const signing = hook.state?.signingIn;
  const busy = hook.busy === 'openfilm';
  const problem = (hook.problemFor === 'openfilm' ? hook.problem : null) ?? (signing?.errorFor === 'openfilm' ? signing.error : null) ?? own?.connectionError;

  /* until Studio has said, the row keeps its place without saying either */
  if (!own) return <SettingsGroup title={t('settings.account.group')}><div className="h-[86px]" /></SettingsGroup>;

  const state = accountState(own, signing);
  const signedIn = state === 'signed-in' || state === 'env';
  const email = own.account;
  const name = own.profile?.name || email || 'OpenFilm';
  /* under the name: the email, when the name is not it */
  const line = state === 'env' ? t('settings.account.env').replace('{env}', own.env)
    : state === 'signed-in' ? (email && email !== name ? email : t('settings.account.signedIn'))
      : state === 'signing-in' ? t('settings.account.signingIn') : t('settings.account.localHint');

  return (
    <SettingsGroup title={t('settings.account.group')}>
      <div className="flex items-center gap-4 py-4">
        {signedIn ? <Avatar src={own.profile?.avatar} name={name} /> : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--bg-field)] text-[var(--text-muted)]"><User size={19} strokeWidth={1.75} /></span>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] text-[var(--text)]" title={signedIn ? name : undefined}>{signedIn ? name : t('settings.account.local')}</div>
          <div className="mt-1 text-[14px] leading-[1.55] text-[var(--text-muted)]">{line}</div>
          {problem ? <p className={`mt-1 ${settingsError}`} role="alert">{problem}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {state === 'env' ? null : state === 'signed-in' ? (
            <>
              <SettingsLinkButton href={own.keysUrl}>{t('settings.account.page')}<ExternalLink size={12} /></SettingsLinkButton>
              <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.removeKey('openfilm')}>{t('settings.account.signOut')}</SettingsButton>
            </>
          ) : state === 'signing-in' ? (
            <SettingsButton variant="quiet" disabled={busy} onClick={() => void hook.cancelSignIn('openfilm')}>{t('settings.account.cancel')}</SettingsButton>
          ) : (
            <SettingsButton variant="primary" disabled={busy} onClick={() => void hook.signIn('openfilm')}>{t('settings.account.signIn')}</SettingsButton>
          )}
        </div>
      </div>
    </SettingsGroup>
  );
}
