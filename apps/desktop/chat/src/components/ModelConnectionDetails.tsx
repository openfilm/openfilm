import React from 'react';
import { useT, useUiLocale } from '@/i18n';
import type { ModelConnectionFailure } from '@/lib/desktop-bridge';

export function ModelConnectionDetails({ failure, legacyError, model }: {
  failure?: ModelConnectionFailure;
  legacyError: string;
  model?: string | null;
}) {
  const t = useT();
  const locale = useUiLocale();
  const phase = failure?.phase ?? (legacyError === 'terminated' ? 'streaming' : 'unknown');
  const elapsed = failure?.elapsedMs == null ? null : new Intl.NumberFormat(locale, {
    style: 'unit', unit: 'second', unitDisplay: 'short', maximumFractionDigits: 1,
  }).format(failure.elapsedMs / 1000);
  const code = failure?.code ?? (legacyError === 'terminated' || legacyError === 'Connection error.' ? legacyError : null);
  const rows = [
    [t('composer.modelFailureStage'), t(`composer.modelFailurePhase.${phase}`)],
    [t('composer.modelFailureModel'), model],
    [t('composer.modelFailureService'), failure?.host],
    [t('composer.modelFailureElapsed'), elapsed],
    [t('composer.modelFailureRetries'), failure?.retries],
    [t('composer.modelFailureHttpStatus'), failure?.status],
    [t('composer.modelFailureCode'), code],
    [t('composer.modelFailureRequestId'), failure?.requestId],
  ];
  return (
    <details className="mt-1.5 text-[12px]">
      <summary className="w-fit cursor-pointer rounded-sm text-[var(--text)]">{t('composer.modelFailureDetails')}</summary>
      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        {rows.map(([label, value]) => value == null || value === '' ? null : (
          <React.Fragment key={label}>
            <dt className="text-[var(--text-faint)]">{label}</dt>
            <dd className="break-all">{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      {failure?.partial ? <p className="mt-1.5">{t('composer.modelFailurePartial')}</p> : null}
    </details>
  );
}
