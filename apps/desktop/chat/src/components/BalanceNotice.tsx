/**
 * A turn the app's own agent could not finish because the service its model runs on has no balance left (lib/balance):
 * the same words for every service, and "Manage", its own page to top it up, when the app knows it.
 */
import { useT } from '@/i18n';
import type { Balance } from '@/lib/balance';

export function BalanceNotice({ balance }: { balance: Balance }) {
  const t = useT();
  return (
    <p role="status" className="text-xs text-[var(--warn)]">
      <b className="font-medium">{t('balance.title').replaceAll('{provider}', balance.provider)}</b>{' '}
      {t('balance.body').replaceAll('{provider}', balance.provider)}
      {balance.url ? (
        <>
          {' '}
          <a href={balance.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[var(--text)]">{t('balance.manage')}</a>
        </>
      ) : null}
    </p>
  );
}
