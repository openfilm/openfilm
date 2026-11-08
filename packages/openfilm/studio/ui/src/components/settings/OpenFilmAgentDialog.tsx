import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgent, type HostOpenFilmModel } from '@/lib/host';
import { PROVIDER_SITES } from '@/lib/providers';
import { ProviderMark } from './ProviderMark';
import { DialogClose, DialogIdentity } from './DialogIdentity';
import { ReorderList } from './ReorderList';
import { SettingsButton, SettingsSwitch, settingsError } from './ui';

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
  React.useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return undefined;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.showModal();
    return () => { node.close(); document.body.style.overflow = overflow; };
  }, []);
  const save = studioHost?.agents?.saveOpenFilmModels;
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
        <h4 className="mb-1 mt-6 text-[15px] font-medium">{t('settings.agents.openfilmModels')}</h4>
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--text-muted)]">{t(pendingService ? 'settings.agents.openfilmModelsPendingInfo' : 'settings.agents.openfilmModelsHint')}</p>
        <ReorderList items={models} onChange={setModels} label={t('settings.agents.openfilmModels')} disabled={busy}
          itemAttribute="data-model-id" dragLabel={(model) => modelWords('openfilmModelDrag', model.name)}>
          {(model) => (
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-[var(--text-muted)]"><ProviderMark id={model.id.startsWith('anthropic/') ? 'claude' : model.id.startsWith('openai/') ? 'openai' : 'deepseek'} size={17} /></span>
              <span className={`min-w-0 flex-1 text-[14px] ${model.shown ? '' : 'text-[var(--text-faint)]'}`}>{model.name}</span>
              {pendingService && !model.available ? <span className="shrink-0 text-[12px] text-[var(--text-muted)]">{t('settings.agents.openfilmModelsPending')}</span> : null}
              <SettingsSwitch checked={model.shown} disabled={busy || model.shown && visible === 1} label={modelWords('openfilmModelShow', model.name)}
                onChange={(shown) => setModels((was) => was.map((m) => m.id === model.id ? { ...m, shown } : m))} />
            </>
          )}
        </ReorderList>
        {error ? <p role="alert" className={`${settingsError} mt-3`}>{error}</p> : null}
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--border)] px-7 py-4">
        <SettingsButton variant="quiet" disabled={busy} onClick={() => setModels((was) => (agent.openfilm?.defaultOrder ?? []).flatMap((id) => was.filter((m) => m.id === id)))}>{t('settings.agents.openfilmModelsReset')}</SettingsButton>
        <div className="flex gap-2">
          <SettingsButton variant="quiet" onClick={onClose}>{t('settings.agents.cancel')}</SettingsButton>
          <SettingsButton variant="primary" disabled={busy || !save || !visible} onClick={() => void submit()}>{busy ? <Loader2 size={15} className="animate-spin" /> : null}{t('settings.agents.openfilmModelsSave')}</SettingsButton>
        </div>
      </footer>
    </dialog>, document.body,
  );
}
