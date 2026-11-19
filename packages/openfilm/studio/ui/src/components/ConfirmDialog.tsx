import React from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { Card, CardActions, CardButton } from './Card';

/** A centered confirmation, in the card shell. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  initialFocus = 'confirm',
  altLabel,
  onAlt,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  initialFocus?: 'confirm' | 'cancel';
  /** a second answer besides confirming, between Cancel and the confirm button */
  altLabel?: string;
  onAlt?: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);
  const actions = React.useRef({ onCancel, onConfirm });
  actions.current = { onCancel, onConfirm };

  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initialFocus === 'cancel' ? cancelButtonRef : confirmButtonRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        actions.current.onCancel();
        return;
      }
      if (e.key === 'Enter') {
        const target = e.target as Node | null;
        if (target && dialogRef.current?.contains(target)) {
          // Enter on another button (Cancel, the second answer) presses that button
          if (target instanceof HTMLButtonElement && target !== confirmButtonRef.current) return;
          e.preventDefault();
          actions.current.onConfirm();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, initialFocus]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-[420px]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <Card title={title} body={description} onClose={onCancel}>
          <CardActions>
            <CardButton ref={cancelButtonRef} weight="quiet" onClick={onCancel}>
              {cancelLabel ?? t('confirm.cancel')}
            </CardButton>
            {altLabel && onAlt ? <CardButton onClick={onAlt}>{altLabel}</CardButton> : null}
            <CardButton ref={confirmButtonRef} weight={danger ? 'danger' : 'primary'} onClick={onConfirm}>
              {confirmLabel ?? t('confirm.ok')}
            </CardButton>
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
