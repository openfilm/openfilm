/**
 * Cutting a picture out when nothing here does it yet: the model that does it on this computer (Local services,
 * BiRefNet Lite), fetched with one press, free and offline, and the cut-out made as soon as it is in. Another service
 * that cuts out is connected in Settings instead.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Cpu, Scissors, X } from 'lucide-react';
import { useT } from '@/i18n';
import { sizeText, useLocalModels } from '@/lib/local-models';
import { useProviders } from '@/lib/providers';

/** the model that cuts out on this computer */
const MODEL = 'birefnet-lite';

export function CutoutSetup({ onReady, onClose, onSettings }: {
  /** the cut-out can be made now */
  onReady: () => void;
  onClose: () => void;
  /** another service, in Settings → Services */
  onSettings: () => void;
}) {
  const t = useT();
  const local = useLocalModels();
  const providers = useProviders();
  const model = local.models?.find((m) => m.id === MODEL) ?? null;
  const [asked, setAsked] = React.useState(false);
  const done = React.useRef(false);
  const ready = Boolean(model?.installed && model.on && providers.state?.use.cutout);

  /* installed but off: on; once Studio says it cuts out with it, the cut-out is made */
  React.useEffect(() => {
    if (!asked || !model?.installed) return;
    if (!model.on) { void local.turn(MODEL, true); return; }
    if (!providers.state?.use.cutout) { void providers.reload(); return; }
  }, [asked, model?.installed, model?.on, providers.state?.use.cutout]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!ready || !asked || done.current) return;
    done.current = true;
    onReady();
  }, [ready, asked]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);

  const start = () => {
    setAsked(true);
    if (model && !model.installed && !model.installing) void local.install(MODEL);
  };
  const coming = model?.installing;
  const share = coming && model.bytes ? Math.min(1, coming.bytes / model.bytes) : asked && model?.installed ? 1 : 0;
  const busy = asked && !model?.failed;

  return createPortal(
    <div className="cv-fade fixed inset-0 z-[2010] flex items-center justify-center bg-black/45 p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={t('canvas.cutout.title')}
        className="cv-grow relative w-[min(440px,100%)] overflow-hidden rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
        <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--cv-ink-3)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={15} /></button>
        <div className="px-6 pb-5 pt-6">
          <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-[12px] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--cv-edge-lit)_30%,var(--cv-chip)),var(--cv-chip))] text-[var(--cv-ink)]">
            <Scissors size={20} strokeWidth={1.75} />
          </div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{t('canvas.cutout.title')}</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--cv-ink-2)]">{t('canvas.cutout.body')}</p>
          {/* the model: what it is, how large, under which license */}
          <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-[var(--cv-chip)] px-3.5 py-3">
            <Cpu size={16} className="shrink-0 text-[var(--cv-ink-3)]" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{model?.name ?? 'BiRefNet Lite'}</div>
              <div className="mt-0.5 truncate text-[11.5px] text-[var(--cv-ink-3)]">
                {[model?.bytes ? sizeText(model.bytes) : null, model?.license, model?.by].filter(Boolean).join(' · ')}
              </div>
            </div>
            {model?.installed ? <span className="shrink-0 text-[11.5px] text-[var(--cv-ink-3)]">{t('canvas.cutout.here')}</span> : null}
          </div>
          {busy ? (
            <div className="mt-4">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--cv-chip)]">
                <div className="h-full rounded-full bg-[var(--cv-edge-lit)] transition-[width] duration-500" style={{ width: `${Math.max(4, share * 100)}%` }} />
              </div>
              <div className="mt-1.5 text-[11.5px] tabular-nums text-[var(--cv-ink-3)]">
                {coming ? t('canvas.cutout.installing').replace('{n}', String(Math.round(share * 100))) : t('canvas.cutout.preparing')}
              </div>
            </div>
          ) : null}
          {model?.failed || local.problem ? (
            <p className="mt-3 text-[12px] leading-relaxed text-red-400">{t('canvas.cutout.failed').replace('{error}', model?.error ?? local.problem ?? '')}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t !border-[var(--cv-float-line)] px-5 py-3.5">
          <button type="button" onClick={onSettings}
            className="h-9 rounded-full px-3.5 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{t('canvas.cutout.other')}</button>
          <button type="button" disabled={busy || !local.models} onClick={start}
            className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-40">
            <Scissors size={13} />{t(model?.installed ? 'canvas.cutout.go' : model?.failed ? 'canvas.cutout.retry' : 'canvas.cutout.install')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
