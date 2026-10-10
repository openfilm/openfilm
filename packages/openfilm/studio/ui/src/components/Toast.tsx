/**
 * The one-line pill at the bottom center that goes away on its own (4s): "the button did nothing, and here is why"
 * (a notice), or something failed (an error: red text, role alert).
 *
 *   const toast = useToast();
 *   toast.show('The video isn’t ready yet');   toast.showError('Rename failed. Please retry.');
 *   <Toast toast={toast.current} />
 */
import React from 'react';

export type ToastMessage = { text: string; error?: boolean };

const TOAST_MS = 4000;

export interface ToastState {
  /** What is showing now (null: nothing). */
  current: ToastMessage | null;
  /** Show a notice; replaces whatever is showing and restarts the 4s. */
  show: (text: string) => void;
  /** Show an error. */
  showError: (text: string) => void;
  clear: () => void;
}

export function useToast(): ToastState {
  const [current, setCurrent] = React.useState<ToastMessage | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const put = React.useCallback((message: ToastMessage | null) => {
    setCurrent(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = message ? setTimeout(() => setCurrent(null), TOAST_MS) : null;
  }, []);
  const show = React.useCallback((text: string) => put({ text }), [put]);
  const showError = React.useCallback((text: string) => put({ text, error: true }), [put]);
  const clear = React.useCallback(() => put(null), [put]);
  return React.useMemo(() => ({ current, show, showError, clear }), [current, show, showError, clear]);
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div
      /* keyed by the text so a new message rises again instead of swapping silently */
      key={toast.text}
      role={toast.error ? 'alert' : 'status'}
      className={`pointer-events-none fixed bottom-6 left-1/2 z-[10200] -translate-x-1/2 rounded-full border bg-[var(--surface)] px-4 py-2 text-[12.5px] font-medium shadow-[var(--shadow-lg)] ${
        toast.error ? 'border-[var(--err)]/40 text-[var(--err)]' : 'border-[var(--border)] text-[var(--text)]'
      }`}
      style={{ animation: 'openfilm-rise 0.16s ease-out both' }}
    >
      {toast.text}
    </div>
  );
}
