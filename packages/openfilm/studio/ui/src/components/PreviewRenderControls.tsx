import { Clapperboard, Loader2, X, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';
import type { PreviewRenderControl } from '@/editor/use-preview-renders';
import { Tooltip } from './Tooltip';
export function PreviewRenderControls({ control, clipId }: { control: PreviewRenderControl; clipId?: string }) {
  const t = useT(), busy = ['waiting', 'making', 'paused'].includes(control.phase);
  return <div data-preview-render-controls className="flex flex-wrap items-center gap-1.5 text-[11px]">
    <Tooltip label={t('videoEffects.renderPreviewHint')} wrap>
      <button type="button" aria-label={t('videoEffects.renderPreview')} onClick={() => control.render(clipId)} disabled={busy}
        className="flex items-center gap-1 rounded bg-[var(--bg-field)] px-2 py-1 text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
        {busy ? <Loader2 size={12} className={control.phase === 'making' ? 'animate-spin' : ''} /> : <Clapperboard size={12} />}
        {t('videoEffects.renderPreview')}
      </button>
    </Tooltip>
    {control.total > 0 || control.phase === 'failed' ? <span role="status" data-preview-cache-state={control.phase} title={t(`videoEffects.cache_${control.phase}`)} aria-label={t(`videoEffects.cache_${control.phase}`)} className="inline-block w-[108px] shrink-0 truncate text-[var(--text-muted)]">
      {t(`videoEffects.cache_${control.phase}`)} {busy ? `${Math.round(control.progress * 100)}%` : `${control.ready}/${control.total}`}
    </span> : null}
    {busy ? <Tooltip label={t('videoEffects.cancelPreview')}><button type="button" aria-label={t('videoEffects.cancelPreview')} onClick={control.cancel} className="rounded p-1 hover:bg-[var(--bg-hover)]"><X size={12} /></button></Tooltip> : null}
    <Tooltip label={t('videoEffects.clearPreview')}><button type="button" aria-label={t('videoEffects.clearPreview')} onClick={control.clear} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><Trash2 size={12} /></button></Tooltip>
    {control.error ? <p role="alert" className="w-full break-words text-[var(--danger)]">{control.error}</p> : null}
    {busy ? <progress className="h-1 w-full accent-[var(--accent)]" aria-label={t('videoEffects.renderPreview')} value={control.progress} max={1} /> : null}
  </div>;
}
