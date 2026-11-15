/**
 * Which way the person's OpenFilm account is, as Settings → General → Account shows it (components/settings/AccountGroup):
 * `local` (not signed in: everything works, only the OpenFilm service waits for a sign-in), `signing-in` (the browser
 * is open on the website), `signed-in` (the account's email), or `env` (a key in the environment, which stays there).
 */
import type { OwnProvider, ProvidersState } from './providers.ts';

export type AccountState = 'local' | 'signing-in' | 'signed-in' | 'env';

export function accountState(own: Pick<OwnProvider, 'source'>, signing: ProvidersState['signingIn'] | undefined): AccountState {
  if (own.source === 'env') return 'env';
  if (own.source) return 'signed-in';
  return signing?.provider === 'openfilm' ? 'signing-in' : 'local';
}
