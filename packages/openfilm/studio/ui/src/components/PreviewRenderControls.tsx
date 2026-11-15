import { Clapperboard, Loader2, X, Trash2 } from 'lucide-react';
import { useT } from '@/i18n';
import type { PreviewRenderControl } from '@/editor/use-preview-renders';
import { Tooltip } from './Tooltip';
export function PreviewRenderControls({ control, clipId, compact = false }: { control: PreviewRenderControl; clipId?: string; compact?: boolean }) {
  const t = useT(), busy = ['waiting', 'making', 'paused'].includes(control.phase);
  return <div data-preview-render-controls className={`flex items-center gap-1.5 ${compact ? 'text-[10px]' : 'flex-wrap text-[11px]'}`}>
    <Tooltip label={t('videoEffects.renderPreviewHint')} wrap>
      <button type="button" aria-label={t('videoEffects.renderPreview')} onClick={() => control.render(clipId)} disabled={busy}
        className="flex items-center gap-1 rounded bg-[var(--bg-field)] px-2 py-1 text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
        {busy ? <Loader2 size={12} className={control.phase === 'making' ? 'animate-spin' : ''} /> : <Clapperboard size={12} />}
        {compact ? <span className="hidden @[900px]:inline">{t('videoEffects.previewShort')}</span> : t('videoEffects.renderPreview')}
      </button>
    </Tooltip>
    {control.total > 0 || control.phase === 'failed' ? <span role="status" data-preview-cache-state={control.phase} title={t(`videoEffects.cache_${control.phase}`)} aria-label={t(`videoEffects.cache_${control.phase}`)} className={`inline-block shrink-0 truncate text-[var(--text-muted)] ${compact ? 'w-[48px]' : 'w-[108px]'}`}>
      {compact ? (busy ? `${control.phase === 'paused' ? 'Ⅱ ' : ''}${Math.round(control.progress * 100)}%` : `${control.ready}/${control.total}`) : <>{t(`videoEffects.cache_${control.phase}`)} {busy ? `${Math.round(control.progress * 100)}%` : `${control.ready}/${control.total}`}</>}
    </span> : null}
    {busy ? <Tooltip label={t('videoEffects.cancelPreview')}><button type="button" aria-label={t('videoEffects.cancelPreview')} onClick={control.cancel} className="rounded p-1 hover:bg-[var(--bg-hover)]"><X size={12} /></button></Tooltip> : null}
    {!compact ? <Tooltip label={t('videoEffects.clearPreview')}><button type="button" aria-label={t('videoEffects.clearPreview')} onClick={control.clear} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><Trash2 size={12} /></button></Tooltip> : null}
    {control.error && !compact ? <p role="alert" className="w-full break-words text-[var(--danger)]">{control.error}</p> : null}
    {busy && !compact ? <progress className="h-1 w-full accent-[var(--accent)]" aria-label={t('videoEffects.renderPreview')} value={control.progress} max={1} /> : null}
  </div>;
}
