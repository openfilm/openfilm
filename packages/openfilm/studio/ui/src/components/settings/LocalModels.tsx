/**
 * Local services in Settings → Services: the service of the models that run on this computer (lib/local-models), its
 * chip last, before adding one. Unlike the others it is not connected: its card lists its models by what they are for,
 * each with where it stands, in its own color: not installed (Install; its last download failed, in red), coming (how
 * far), on, or off. A model opens its
 * own page in the card: who made it, what it does, its size, memory and license, where it is used, and managing it
 * (install, turn on or off, uninstall).
 */
import React from 'react';
import { ArrowLeft, Captions, ChevronRight, Cpu, ExternalLink, Scissors } from 'lucide-react';
import { useT } from '@/i18n';
import { LOCAL_KINDS, sizeText, type LocalKind, type LocalModel, type LocalModelsHook } from '@/lib/local-models';
import { Card } from './ProvidersSection';
import { SettingsButton, SettingsSwitch, settingsError } from './ui';

const KIND_ICON: Record<LocalKind, React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = { asr: Captions, cutout: Scissors };

const chipClass = 'inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[14px] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]';

/** Its chip among the services': a dot while a model is on. */
export function LocalModelsChip({ hook, onOpen }: { hook: LocalModelsHook; onOpen: () => void }) {
  const t = useT();
  const on = hook.models?.some((m) => m.on) ?? false;
  return (
    <button type="button" onClick={onOpen}
      className={`${chipClass} ${on ? 'border-[var(--border-strong)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
      <Cpu size={15} strokeWidth={1.75} />
      {t('settings.local.name')}
      {on ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--ok)]" aria-label={t('settings.local.on')} /> : null}
    </button>
  );
}

/** How far a model coming is, from 0 to 1. */
const progressOf = (m: LocalModel) => (m.installing ? Math.min(1, m.installing.bytes / m.bytes) : 0);

/** Where a model stands, in its color: grey not installed, the accent while coming, green on, hollow grey off. */
function Status({ model }: { model: LocalModel }) {
  const t = useT();
  if (model.installing) {
    const p = progressOf(model);
    return (
      <span className="flex items-center gap-2 text-[13px] text-[var(--accent)]">
        <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--bg-pressed)]"><span className="block h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round(p * 100)}%` }} /></span>
        {t('settings.local.installing').replace('{n}', String(Math.round(p * 100)))}
      </span>
    );
  }
  if (!model.installed) return <span className={`text-[13px] ${model.failed ? 'text-[var(--err)]' : 'text-[var(--text-faint)]'}`}>{t(model.failed ? 'settings.local.failed' : 'settings.local.none')}</span>;
  return model.on
    ? <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ok)]"><span className="h-2 w-2 rounded-full bg-[var(--ok)]" />{t('settings.local.on')}</span>
    : <span className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]"><span className="h-2 w-2 rounded-full border-[1.5px] border-[var(--text-faint)]" />{t('settings.local.off')}</span>;
}

/** Its card: the models by what they are for, or one model's page. */
export function LocalModelsDialog({ hook, onClose }: { hook: LocalModelsHook; onClose: () => void }) {
  const t = useT();
  const [opened, setOpened] = React.useState<string | null>(null);
  const models = hook.models ?? [];
  const page = models.find((m) => m.id === opened);
  if (page) return <Card label={page.name} onClose={onClose}><ModelPage model={page} hook={hook} onBack={() => setOpened(null)} /></Card>;
  const installed = models.filter((m) => m.installed).length;
  return (
    <Card label={t('settings.local.name')} onClose={onClose}>
      <div className="flex items-start gap-4 pr-8">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[var(--bg-field)] text-[var(--text)]"><Cpu size={24} strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{t('settings.local.name')}</h2>
          <div className="mt-1 text-[13.5px] text-[var(--text-faint)]">
            {t('settings.local.tagline')}{installed ? ` · ${t('settings.local.count').replace('{n}', String(installed))}` : ''}
          </div>
        </div>
      </div>
      <p className="mt-5 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t('settings.local.intro')}</p>
      {LOCAL_KINDS.filter((kind) => models.some((m) => m.kind === kind)).map((kind) => {
        const Icon = KIND_ICON[kind];
        return (
          <section key={kind}>
            <h3 className="mb-1 mt-7 flex items-center gap-2 text-[13px] font-medium text-[var(--text-faint)]"><Icon size={14} strokeWidth={1.75} />{t(`settings.local.kinds.${kind}`)}</h3>
            <div className="flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {models.filter((m) => m.kind === kind).map((m) => (
                <div key={m.id} role="button" tabIndex={0} onClick={() => setOpened(m.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpened(m.id); }}
                  className="-mx-2 flex cursor-pointer items-center gap-3 rounded-[8px] px-2 py-3 outline-none transition hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]">
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[14.5px] font-medium ${m.installed ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{m.name}</div>
                    <div className="mt-0.5 truncate text-[12.5px] text-[var(--text-faint)]">{m.by} · {sizeText(m.bytes)}{m.failed ? <span className="text-[var(--err)]"> · {t('settings.local.failed')}</span> : null}</div>
                  </div>
                  {!m.installed && !m.installing
                    ? <SettingsButton onClick={(e) => { e.stopPropagation(); void hook.install(m.id); }}>{t('settings.local.install')}</SettingsButton>
                    : <Status model={m} />}
                  <ChevronRight size={16} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
                </div>
              ))}
            </div>
          </section>
        );
      })}
      {hook.problem ? <p className={settingsError}>{hook.problem}</p> : null}
    </Card>
  );
}

/** One model's page: who made it and what it does, managing it, and its facts. */
function ModelPage({ model, hook, onBack }: { model: LocalModel; hook: LocalModelsHook; onBack: () => void }) {
  const t = useT();
  const Icon = KIND_ICON[model.kind];
  const facts: [string, React.ReactNode][] = [
    [t('settings.local.facts.kind'), t(`settings.local.kinds.${model.kind}`)],
    [t('settings.local.facts.size'), sizeText(model.bytes)],
    [t('settings.local.facts.memory'), t('settings.local.facts.memoryValue').replace('{n}', String(model.memoryMb))],
    [t('settings.local.facts.license'), model.license],
    [t('settings.local.facts.where'), t(`settings.local.where.${model.kind}`)],
  ];
  return (
    <>
      <button type="button" onClick={onBack} className="-ml-1 mb-4 flex w-fit items-center gap-1 rounded-md px-1 py-0.5 text-[13px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
        <ArrowLeft size={14} />{t('settings.local.name')}
      </button>
      <div className="flex items-start gap-4 pr-8">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-[var(--bg-field)] text-[var(--text)]"><Icon size={22} strokeWidth={1.75} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{model.name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
            <a href={`https://${model.site}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--text-faint)] transition hover:text-[var(--text)]">
              {t('settings.local.by').replace('{who}', model.by)}<ExternalLink size={11} />
            </a>
            <Status model={model} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1">
          {model.installed ? <SettingsSwitch checked={model.on} onChange={(on) => void hook.turn(model.id, on)} label={t('settings.local.enabled')} />
            : model.installing ? null
              : <SettingsButton variant="primary" onClick={() => void hook.install(model.id)}>{t(model.failed ? 'settings.local.retry' : 'settings.local.installSize').replace('{size}', sizeText(model.bytes))}</SettingsButton>}
        </div>
      </div>
      {model.installing ? (
        <div className="mt-5">
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-pressed)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width]" style={{ width: `${Math.round(progressOf(model) * 100)}%` }} /></div>
          <p className="mt-1.5 text-[12.5px] text-[var(--text-faint)]">{t('settings.local.downloaded').replace('{done}', sizeText(model.installing.bytes)).replace('{size}', sizeText(model.bytes))}</p>
        </div>
      ) : null}
      <p className="mt-5 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t(`settings.local.about.${model.id}`)}</p>
      <div className="mt-6 flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {facts.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 py-3">
            <span className="w-[132px] shrink-0 text-[14px] text-[var(--text-faint)]">{label}</span>
            <span className="min-w-0 flex-1 text-[14px] leading-relaxed text-[var(--text)]">{value}</span>
          </div>
        ))}
      </div>
      {model.installed ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          {model.builtIn ? <p className="text-[13px] text-[var(--text-faint)]">{t('settings.local.builtIn')}</p> : (
            <SettingsButton variant="quiet" className="-ml-3.5 !text-[var(--err)]" onClick={() => void hook.remove(model.id)}>{t('settings.local.remove')}</SettingsButton>
          )}
        </div>
      ) : null}
      {hook.problem ? <p className={settingsError}>{hook.problem}</p> : null}
    </>
  );
}
