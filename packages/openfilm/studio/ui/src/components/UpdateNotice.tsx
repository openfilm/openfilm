/**
 * The app's update in the desktop sidebar, above the account: once a new version is downloaded, a card says which and
 * Restart installs it; refused while an agent works or Studio exports, it says why and stays ready. Later puts it away
 * for this version (quitting installs it anyway). Restarting, it says so.
 */
import * as React from 'react';
import { ArrowDownToLine, Loader2, X } from 'lucide-react';
import { useT } from '@/i18n';
import { useHostUpdate } from '@/lib/host';
import styles from './UpdateNotice.module.css';

const WAITING = { 'agent-busy': 'update.agentBusy', exporting: 'update.exporting', 'install-failed': 'update.installFailed' } as const;
const LATER_KEY = 'openfilm.update.later';

export function UpdateNotice() {
  const t = useT();
  const host = useHostUpdate();
  const [later, setLater] = React.useState(() => { try { return localStorage.getItem(LATER_KEY); } catch { return null; } });
  if (!host) return null;
  const { update, restart } = host;
  if (update.status === 'ready' && later === update.version) return null;
  const words = (key: string) => t(key).replace('{version}', update.version);
  const waiting = update.waiting ? words(WAITING[update.waiting]) : null;
  const installing = update.status === 'installing';
  return (
    <section className={styles.card} data-update-notice={update.status} aria-label={words('update.cardTitle')}>
      <div className={styles.head}>
        <span className={styles.mark}>{installing ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ArrowDownToLine size={14} aria-hidden />}</span>
        <div className={styles.text}>
          <strong>{words('update.cardTitle')}</strong>
          <small role={waiting ? 'status' : undefined}>{installing ? t('update.installing') : waiting ?? t('update.cardNote')}</small>
        </div>
        {!installing && <button type="button" className={styles.later} aria-label={t('update.later')} title={t('update.later')}
          onClick={() => { setLater(update.version); try { localStorage.setItem(LATER_KEY, update.version); } catch { /* private window */ } }}>
          <X size={13} aria-hidden />
        </button>}
      </div>
      {!installing && <button type="button" className={styles.restart} data-update-restart onClick={() => void restart()}>{t('update.restart')}</button>}
    </section>
  );
}
