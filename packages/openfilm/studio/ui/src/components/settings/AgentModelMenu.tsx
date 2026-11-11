import React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgent, type HostAgentCatalog } from '@/lib/host';
import { mergeModelMenu } from '@/lib/agent-model-menu';
import { ReorderList } from './ReorderList';
import { SettingsButton, SettingsSwitch, settingsError } from './ui';

/** The same menu controls for every native agent and for the person's own key. */
export function AgentModelMenu({ agent }: { agent: HostAgent }) {
  const t = useT();
  const catalog = agent.catalog;
  const [models, setModels] = React.useState<HostAgentCatalog['models']>(catalog?.models ?? []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const snapshot = JSON.stringify(catalog?.models ?? []);
  React.useEffect(() => {
    const next = JSON.parse(snapshot) as HostAgentCatalog['models'];
    setModels((was) => dirty ? mergeModelMenu(was, next) : next);
  }, [snapshot, dirty]);
  const host = studioHost?.agents;
  const change = (next: HostAgentCatalog['models']) => { setDirty(true); setModels(next); };
  const visible = models.filter((m) => m.shown).length;
  const save = async () => {
    if (!host?.saveAgentModels || busy) return;
    setBusy(true); setError(null);
    try {
      const result = await host.saveAgentModels(agent.id, { order: models.map((m) => m.id), hidden: models.filter((m) => !m.shown).map((m) => m.id) });
      if (result.ok) setDirty(false); else setError(result.error ?? t('settings.agents.failed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  if (!host?.saveAgentModels) return null;
  return <section className="mb-6 border-b border-[var(--border)] pb-5" aria-label={t('settings.agents.openfilmModels')}>
    <div className="mb-2 flex items-center justify-between gap-3">
      <h4 className="font-medium text-[var(--text)]">{t('settings.agents.openfilmModels')}</h4>
      {host.refreshModels && agent.id !== 'byok' ? <SettingsButton variant="quiet" disabled={catalog?.refreshing || agent.status !== 'ready'}
        onClick={() => void host.refreshModels!(agent.id, { fresh: true })}>
        <RefreshCw size={14} className={catalog?.refreshing ? 'animate-spin' : ''} />{t('settings.agents.modelsRefresh')}
      </SettingsButton> : null}
    </div>
    <p className="mb-2 text-[13px]">{t('settings.agents.openfilmModelsHint')}</p>
    <p className="mb-2 text-[12px] text-[var(--text-faint)]">{t(agent.id === 'byok' ? 'settings.agents.modelsOwnKeyHint' : 'settings.agents.modelsBackgroundHint')}</p>
    {!models.length ? <p role="status" className="py-3 text-[13px]">{t(catalog?.refreshing ? 'settings.agents.modelsUpdating' : 'settings.agents.modelsEmpty')}</p> : null}
    <ReorderList items={models} onChange={change} label={t('settings.agents.openfilmModels')} itemAttribute="data-model-id"
      dragLabel={(m) => t('settings.agents.openfilmModelDrag').replace('{name}', m.name)} disabled={busy}>
      {(model) => <>
        <span className={`min-w-0 flex-1 text-[14px] ${model.shown ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>{model.name}</span>
        <SettingsSwitch checked={model.shown} disabled={busy || model.shown && visible === 1}
          label={t('settings.agents.openfilmModelShow').replace('{name}', model.name)}
          onChange={(shown) => change(models.map((m) => m.id === model.id ? { ...m, shown } : m))} />
      </>}
    </ReorderList>
    {error || catalog?.error ? <p role="alert" className={`${settingsError} mt-2`}>{error ?? catalog?.error}</p> : null}
    {models.length ? <div className="mt-3 flex items-center justify-between gap-2">
      <SettingsButton variant="quiet" disabled={busy} onClick={() => change((catalog?.defaultOrder ?? []).flatMap((id) => models.filter((m) => m.id === id)))}>{t('settings.agents.openfilmModelsReset')}</SettingsButton>
      <SettingsButton variant="primary" disabled={busy || !dirty || !visible} onClick={() => void save()}>{busy ? <Loader2 size={14} className="animate-spin" /> : null}{t('settings.agents.openfilmModelsSave')}</SettingsButton>
    </div> : null}
  </section>;
}
