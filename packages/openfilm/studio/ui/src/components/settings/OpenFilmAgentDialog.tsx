import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgent, type HostOpenFilmModel } from '@/lib/host';
import { PROVIDER_SITES } from '@/lib/providers';
import { ProviderMark } from './ProviderMark';
import { DialogClose, DialogIdentity } from './DialogIdentity';
import { ReorderList } from './ReorderList';
import { SettingsButton, SettingsSwitch, settingsError } from './ui';
import { mergeModelMenu } from '@/lib/agent-model-menu';
import { AgentUpdateDetails } from './AgentUpdateDetails';

/** A model's maker's mark, by its id's maker (Anthropic's is Claude's); a maker with none has its letter. */
const makerMark = (id: string) => { const maker = id.split('/')[0]!; return maker === 'anthropic' ? 'claude' : maker; };

/** Account information and this computer's model menu, edited together and saved explicitly. */
export function OpenFilmAgentDialog({ agent, onClose, actions, connectionStatus, connectionError }: {
  agent: HostAgent;
  onClose: () => void;
  actions?: React.ReactNode;
  connectionStatus?: React.ReactNode;
  connectionError?: string;
}) {
  const t = useT();
  const dialog = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const [models, setModels] = React.useState<HostOpenFilmModel[]>(() => agent.openfilm?.models ?? []);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = React.useRef(false);
  const snapshot = JSON.stringify(agent.openfilm?.models ?? []);
  React.useEffect(() => {
    const next = JSON.parse(snapshot) as HostOpenFilmModel[];
    setModels((was) => dirty.current ? mergeModelMenu(was, next) : next);
  }, [snapshot]);
  const change = (next: HostOpenFilmModel[]) => { dirty.current = true; setModels(next); };
  React.useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; };
  }, []);
  const save = studioHost?.agents?.saveOpenFilmModels;
  const refreshModels = studioHost?.agents?.refreshModels;
  const submit = async () => {
    if (!save || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await save({ order: models.map((m) => m.id), hidden: models.filter((m) => !m.shown).map((m) => m.id) });
      if (result.ok) onClose(); else setError(result.error ?? t('settings.agents.failed'));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const visible = models.filter((m) => m.shown).length;
  const pendingService = agent.status === 'ready' && models.some((model) => !model.available);
  const modelWords = (key: string, name: string) => t(`settings.agents.${key}`).replace('{name}', name);
  return createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-modal="true"
      className="m-auto max-h-[85vh] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-raised)] p-0 text-[var(--text)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5)] backdrop:bg-black/50 open:flex open:flex-col"
      style={{ width: 'min(640px, calc(100vw - 32px))' }}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) onClose();
      }}>
      <DialogClose label={t('settings.agents.close')} onClose={onClose} />
      <div className="shrink-0 px-7 pt-7">
        <DialogIdentity titleId={titleId} name="OpenFilm" mark={<ProviderMark id="openfilm" size={24} />}
          website={{ href: `https://${PROVIDER_SITES.openfilm}`, label: PROVIDER_SITES.openfilm! }} actions={actions} status={connectionStatus} />
      </div>
      <div className="min-h-0 overflow-y-auto px-7 py-5">
        <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">{t('settings.agents.openfilmShared')}</p>
        {connectionError ? <p role="alert" className={`${settingsError} mt-3`}>{connectionError}</p> : null}
        <div className="mt-5"><AgentUpdateDetails agent={agent} /></div>
        <div className="mb-1 mt-6 flex items-center justify-between gap-3">
          <h4 className="text-[15px] font-medium">{t('settings.agents.openfilmModels')}</h4>
          {refreshModels ? <SettingsButton variant="quiet" onClick={() => void refreshModels('openfilm', { fresh: true })}>
            <RefreshCw size={14} />{t('settings.agents.modelsRefresh')}
          </SettingsButton> : null}
        </div>
        <p className="mb-2 text-[12px] text-[var(--text-faint)]">{t('settings.agents.modelsBackgroundHint')}</p>
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--text-muted)]">{t(pendingService ? 'settings.agents.openfilmModelsPendingInfo' : 'settings.agents.openfilmModelsHint')}</p>
        <ReorderList items={models} onChange={change} label={t('settings.agents.openfilmModels')} disabled={busy}
          itemAttribute="data-model-id" dragLabel={(model) => modelWords('openfilmModelDrag', model.name)}>
          {(model) => (
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-muted)]"><ProviderMark id={makerMark(model.id)} size={17} /></span>
              <span className={`min-w-0 flex-1 text-[14px] ${model.shown ? '' : 'text-[var(--text-faint)]'}`}>{model.name}</span>
              {pendingService && !model.available ? <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{t('settings.agents.openfilmModelsPending')}</span> : null}
              <SettingsSwitch checked={model.shown} disabled={busy || model.shown && visible === 1} label={modelWords('openfilmModelShow', model.name)}
                onChange={(shown) => change(models.map((m) => m.id === model.id ? { ...m, shown } : m))} />
            </>
          )}
        </ReorderList>
        {error ? <p role="alert" className={`${settingsError} mt-3`}>{error}</p> : null}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-7 py-4">
        <SettingsButton variant="quiet" disabled={busy} onClick={() => change((agent.openfilm?.defaultOrder ?? []).flatMap((id) => models.filter((m) => m.id === id)))}>{t('settings.agents.openfilmModelsReset')}</SettingsButton>
        <div className="flex gap-2">
          <SettingsButton variant="quiet" onClick={onClose}>{t('settings.agents.cancel')}</SettingsButton>
          <SettingsButton variant="primary" disabled={busy || !save || !visible} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{t('settings.agents.openfilmModelsSave')}</SettingsButton>
        </div>
      </footer>
    </dialog>, document.body,
  );
}
