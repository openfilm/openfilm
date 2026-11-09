import { LoaderCircle } from 'lucide-react';
import { useT } from '@/i18n';

/** The board's surface while its code, document or first fitted layout is not ready yet. */
export function CanvasLoading() {
  const t = useT();
  return (
    <div data-canvas-loading="" role="status" aria-busy="true"
      className="absolute inset-0 z-40 flex items-center justify-center gap-2 bg-[var(--cv-bg)] text-[13px] text-[var(--cv-label)]"
      style={{ backgroundImage: 'radial-gradient(circle, var(--cv-dot) 0.8px, transparent 0.8px)', backgroundSize: '20px 20px' }}>
      <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
      <span>{t('canvas.title')}</span>
    </div>
  );
}
