/**
 * The update in Studio's top bar, beside the projects button. The app's (lib/host.ts `update`): once a new version is
 * downloaded, Restart to install it; refused while an agent works or Studio exports, it says why beside it and stays,
 * ready; quitting installs it too. Studio run with npm (WebUpdateButton): a newer openfilm on npm is offered, and Update
 * runs it in the background; Studio starts again on it and the page reloads.
 */
import { useCallback, useEffect, useState } from 'react';
import { CircleArrowDown, Loader2 } from 'lucide-react';

import { useT } from '@/i18n';
import { ApiError, api } from '../api';
import { studioHost, useHostUpdate } from '../lib/host';
import { refusedUpdate, webUpdateOf, type WebUpdate } from '../lib/web-update';
import { Tooltip } from './Tooltip';

const WAITING = { 'agent-busy': 'update.agentBusy', exporting: 'update.exporting', 'install-failed': 'update.installFailed' } as const;

export function UpdateButton() {
  const t = useT();
  const host = useHostUpdate();
  if (!host) return null;
  const { update, restart } = host;
  const words = (key: string) => t(key).replace('{version}', update.version);
  if (update.status === 'installing') {
    return (
      <span role="status" className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-dim)]">
        <Loader2 size={13} className="animate-spin" />
        {t('update.installing')}
      </span>
    );
  }
  const waiting = update.waiting ? words(WAITING[update.waiting]) : null;
  return (
    <>
      <Tooltip label={waiting ?? words('update.ready')} side="bottom">
        <button type="button" onClick={() => void restart()}
          className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent-soft)] px-2 text-[12px] font-medium text-[var(--accent)] transition hover:brightness-110">
          <CircleArrowDown size={14} />
          {t('update.restart')}
        </button>
      </Tooltip>
      {waiting ? <span role="status" className="min-w-0 truncate text-[12px] text-[var(--text-dim)]">{waiting}</span> : null}
    </>
  );
}

/* looked at as the page opens and every few hours (Studio asks npm at most daily); while updating, every two seconds */
const LOOK_MS = 6 * 3_600_000;
const UPDATING_MS = 2000;

/**
 * The newest openfilm for a Studio run with npm (none in the app, which updates itself, nor in a source checkout), and
 * `start` to update to it. Shared by the top bar and Settings → About.
 */
export function useWebUpdate(): { update: WebUpdate | null; start: () => void } {
  const [update, setUpdate] = useState<WebUpdate | null>(null);
  const look = useCallback(() => { void api.version().then((v) => setUpdate(webUpdateOf(v))).catch(() => {}); }, []);
  const updating = update?.status === 'updating';
  useEffect(() => {
    if (studioHost) return undefined;
    if (!updating) look();
    const timer = setInterval(look, updating ? UPDATING_MS : LOOK_MS);
    return () => clearInterval(timer);
  }, [look, updating]);
  const start = useCallback(() => {
    if (!update || update.status === 'updating') return;
    const { version } = update;
    setUpdate({ status: 'updating', version });
    void api.update().catch((e: unknown) => setUpdate(e instanceof ApiError
      ? refusedUpdate(version, e.body.code, e.message)
      : { status: 'failed', version, error: e instanceof Error ? e.message : String(e) }));
  }, [update]);
  return { update, start };
}

/** Studio run with npm: Update when npm has a newer openfilm, its progress, or why it waits or failed. */
export function WebUpdateButton() {
  const t = useT();
  const { update, start } = useWebUpdate();
  if (!update) return null;
  const words = (key: string) => t(key).replace('{version}', update.version);
  if (update.status === 'updating') {
    return (
      <span role="status" className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-dim)]">
        <Loader2 size={13} className="animate-spin" />
        {t('update.webUpdating')}
      </span>
    );
  }
  const said = update.status === 'waiting' ? t(update.reason === 'exporting' ? 'update.webExporting' : 'update.webMaking')
    : update.status === 'failed' ? t('update.webFailed').replace('{error}', update.error) : null;
  return (
    <>
      <Tooltip label={said ?? words('update.webAvailable')} side="bottom">
        <button type="button" onClick={start}
          className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md bg-[var(--accent-soft)] px-2 text-[12px] font-medium text-[var(--accent)] transition hover:brightness-110">
          <CircleArrowDown size={14} />
          {t('update.webUpdate')}
        </button>
      </Tooltip>
      {said ? <span role="status" className="min-w-0 truncate text-[12px] text-[var(--text-dim)]">{said}</span> : null}
    </>
  );
}
