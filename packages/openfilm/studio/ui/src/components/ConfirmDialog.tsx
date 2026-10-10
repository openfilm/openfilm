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
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const cancelButtonRef = React.useRef<HTMLButtonElement>(null);
  const confirmButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    /* focus starts on the confirm button, so Enter confirms: the person already chose once. It is safe because
       focus must be inside the dialog; Esc, or Tab to Cancel and Enter, backs out. */
    const previouslyFocused = document.activeElement as HTMLElement | null;
    confirmButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter') {
        const target = e.target as Node | null;
        if (target && dialogRef.current?.contains(target)) {
          // Enter on the Cancel button presses Cancel
          if (target === cancelButtonRef.current) return;
          e.preventDefault();
          onConfirm();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
  }, [open, onCancel, onConfirm]);

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
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <Card title={title} body={description} onClose={onCancel}>
          <CardActions>
            <CardButton ref={cancelButtonRef} weight="quiet" onClick={onCancel}>
              {cancelLabel ?? t('confirm.cancel')}
            </CardButton>
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
