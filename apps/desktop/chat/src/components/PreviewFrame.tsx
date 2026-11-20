'use client';

/** A stable, contained preview workspace for video, audio and documents (pictures have their own light viewer). */
import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { previewTop } from '@/lib/preview-top';
import { escTaken } from '@/lib/esc-stop';

/** A button in the top bar. The lightbox is black, so these use shades of white rather than the UI tokens. */
export const PREVIEW_BTN =
  'flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[12px] '
  + 'font-medium text-white/70 transition hover:bg-white/10 hover:text-white';

/** Query the actual preview viewport, including when its window is resized. */
const AREA_STYLE = {
  '--preview-w': '100cqw',
  '--preview-h': '100cqh',
} as React.CSSProperties;

/**
 * In `fit` mode, the size of a video's own box, `w`×`h` its frame (or a guess until its metadata arrives).
 *
 * A `<video>` reports 300×150 until then, and the box hugs it, so without a width it flashes a small box before
 * jumping to size. The width is computed as contain up front and the height follows from aspect-ratio, so the first
 * frame is final.
 */
export function previewMediaFit(w: number, h: number): React.CSSProperties {
  return {
    maxWidth: 'var(--preview-w)',
    maxHeight: 'var(--preview-h)',
    aspectRatio: `${w} / ${h}`,
    width: `min(var(--preview-w), calc(var(--preview-h) * ${w} / ${h}))`,
  };
}

export function PreviewFrame({
  name,
  title,
  icon,
  actions,
  bodyClassName,
  fit = false,
  footer,
  onClose,
  children,
}: {
  name: string;
  /** Fuller text when hovering the name (usually the path). */
  title?: string;
  icon?: React.ReactNode;
  /** Buttons at the top right. The close button is added here, no need to pass it. */
  actions?: React.ReactNode;
  /** The content box's classes: black behind video, paper behind text. */
  bodyClassName?: string;
  /** Keep naturally sized content centered; documents and resource players fill the viewport. */
  fit?: boolean;
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();

  const box = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        /* it leaves the video's full screen, and is the viewer's all the same */
        if (document.fullscreenElement) { escTaken(event); return; }
        event.preventDefault();
        event.stopPropagation();
        escTaken(event);
        closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const targets = Array.from(box.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, textarea, iframe, [tabindex="0"]') ?? [])
        .filter(el => el.getClientRects().length > 0);
      const first = targets[0];
      const last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm sm:p-8"
      style={{ paddingTop: previewTop(navigator.platform), WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={onClose}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={name}
        className="relative isolate flex h-[min(900px,92dvh)] min-h-0 w-full max-w-[1480px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#191919] shadow-2xl outline-none"
        style={AREA_STYLE} onClick={event => event.stopPropagation()}>
        <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-white/10 px-4">
          {icon}
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/90" title={title ?? name}>{name}</h3>
          {actions}
          <span className="mx-1 h-5 w-px bg-white/10" />
          <Tooltip label={t('assets.close')} side="bottom">
            <button type="button" onClick={onClose} aria-label={t('assets.close')} className={`${PREVIEW_BTN} w-8 px-0`}><X size={16} /></button>
          </Tooltip>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-5" style={{ containerType: 'size' }}>
          <div className={`relative isolate flex min-h-0 max-h-full min-w-0 flex-col overflow-hidden rounded-lg ${fit ? 'max-w-full' : 'h-full w-full'} ${bodyClassName ?? ''}`}>
            {children}
          </div>
        </div>
        {footer}
      </div>
    </div>, chatLayer(),
  );
}
