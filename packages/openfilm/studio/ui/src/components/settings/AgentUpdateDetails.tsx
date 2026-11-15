import React from 'react';
import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgent } from '@/lib/host';
import { SettingsButton, settingsError } from './ui';

/** Program updates stay separate from connection diagnostics and from refreshing the model catalog. */
export function AgentUpdateDetails({ agent }: { agent: HostAgent }) {
  const t = useT(), host = studioHost?.agents;
  const [error, setError] = React.useState<string | null>(null);
  const [asking, setAsking] = React.useState(false);
  const internal = agent.id === 'openfilm' || agent.id === 'byok';
  if (!host?.checkUpdates || !internal && !agent.path) return null;
  const info = agent.update, status = info?.status ?? 'unchecked';
  const busy = asking || ['checking', 'updating', 'queued'].includes(status);
  const text = (key: string) => t(`settings.agents.updates.${key}`);
  const run = async (action: () => Promise<unknown>) => {
    setAsking(true); setError(null);
    try { const result = await action() as { ok?: boolean; error?: string }; if (result?.ok === false) setError(result.error ?? t('settings.agents.failed')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setAsking(false); }
  };
  return <section className="mb-6 border-b border-[var(--border)] pb-5" aria-label={text('title')}>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="font-medium text-[var(--text)]">{text('title')}</h4>
      <SettingsButton variant="quiet" disabled={busy} onClick={() => void run(() => host.checkUpdates!(agent.id))}>
        <RefreshCw size={14} className={asking || status === 'checking' ? 'animate-spin' : ''} />{text('check')}
      </SettingsButton>
    </div>
    <p role="status">{internal ? text('internal') : text(status)}</p>
    {info?.version ? <p className="mt-1 text-[13px]">{text('installed')}: <span className="font-mono">{info.version}</span>
      {info.latestVersion ? <> · {text('latest')}: <span className="font-mono">{info.latestVersion}</span></> : null}</p> : null}
    {info?.checkedAt ? <p className="mt-1 text-[12px] text-[var(--text-faint)]">{text('checked')}: {new Date(info.checkedAt).toLocaleString()}</p> : null}
    {info?.action?.command && status !== 'current' ? <code className="mt-2 block break-all rounded-[6px] bg-[var(--bg-field)] px-2.5 py-2 font-mono text-[12px] text-[var(--text)]">{info.action.command}</code> : null}
    {host.update && (internal || status === 'available' || status === 'managed' || status === 'unknown' || status === 'error') && info?.action ? <SettingsButton variant="quiet" disabled={busy}
      onClick={() => void run(() => host.update!(agent.id))}>
      {info.action.kind === 'link' ? <ExternalLink size={14} /> : <Download size={14} />}
      {text(internal ? 'desktop' : info.action.kind === 'link' ? 'official' : 'update')}
    </SettingsButton> : null}
    {error || info?.error ? <p role="alert" className={`${settingsError} mt-2`}>{error ?? info?.error}</p> : null}
    <p className="mt-2 text-[12px] text-[var(--text-faint)]">{text('modelsHint')}</p>
  </section>;
}
