/**
 * A turn the app's own agent could not finish because the service its model runs on has no balance left (lib/balance):
 * the same words for every service, as a notice on the composer, and "Manage", its own page to top it up, when the
 * app knows it.
 */
import { useT } from '@/i18n';
import type { Balance } from '@/lib/balance';
import { CardButton } from './ComposerCard';
import { Notice } from './NoticeCard';

export function BalanceNotice({ balance, onClose }: { balance: Balance; onClose: () => void }) {
  const t = useT();
  return (
    <Notice tone="warn" title={t('balance.title').replaceAll('{provider}', balance.provider)} onClose={onClose}
      actions={balance.url ? <CardButton weight="primary" onClick={() => window.open(balance.url ?? undefined, '_blank', 'noreferrer')}>{t('balance.manage')}</CardButton> : null}>
      {t('balance.body').replaceAll('{provider}', balance.provider)}
    </Notice>
  );
}
