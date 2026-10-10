/**
 * Edit history — the ⌘Z record, not version history.
 *
 * Version history is git: saved, restorable, there tomorrow. Edit history is this session's hand edits (drag a clip,
 * change a color, remove a track), cleared on exit, at most a hundred steps. People look for them at different
 * moments — "back to yesterday's version" vs "what did I just do, and how far back" — so this one sits next to undo.
 *
 * A step can be clicked: the film goes back to just after that step (like pressing ⌘Z / ⇧⌘Z a few times). To go
 * further back, use version history.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { User } from 'lucide-react';
import { useT } from '@/i18n';
import { shortcutHint } from '@/lib/shortcut-hint';

/** One step of the session. */
export interface SessionOp {
  /** What to show: an i18n key, or `key|name` for a step on one track (see trackFlagStep) or on named clips. */
  label?: string;
  at: number;
}

export interface SessionTimeline {
  /** Oldest first. */
  steps: readonly SessionOp[];
  /** Steps before the cursor are applied, after it undone. */
  cursor: number;
}

const PANEL_W = 268;

const FLAG_STEP = {
  locked: ['history.stepLocked', 'history.stepUnlocked'],
  hidden: ['history.stepHid', 'history.stepShowed'],
  muted: ['history.stepMuted', 'history.stepUnmuted'],
} as const;

/**
 * The label of a track toggle, by what was done to which track: `Locked V1`, `Muted A1`. `track` is the badge the
 * timeline shows (P1 / V1 / A1).
 */
export function trackFlagStep(flag: keyof typeof FLAG_STEP, on: boolean, track: string): string {
  return `${FLAG_STEP[flag][on ? 0 : 1]}|${track}`;
}

/** A step's words: its key looked up, the track or the clips named in it filled in. */
function stepText(t: (key: string) => string, label: string): string {
  const [key = label, name] = label.split('|');
  return name == null ? t(key) : t(key).replace('{track}', name).replace('{clip}', name);
}

export interface OperationHistoryProps {
  ops: SessionTimeline;
  /** The opening button's box (viewport coordinates); the panel opens below it. */
  anchor: DOMRect;
  /** Go back to just after step n (n = cursor value). */
  onRollback: (cursor: number) => void;
  /**
   * The opening button itself. A press on it is not "outside": otherwise pressing closes the panel and the click
   * opens it again, and it can never be closed by the button.
   */
  trigger?: HTMLElement | null;
  onClose: () => void;
}

export function OperationHistory({
  ops,
  anchor,
  trigger,
  onRollback,
  onClose,
}: OperationHistoryProps): React.ReactElement | null {
  const t = useT();
  const panel = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const at = e.target as Node;
      if (panel.current?.contains(at) || trigger?.contains(at)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    /* pointerdown, in the capture phase: the timeline's gestures preventDefault on pointerdown (so no mousedown
       follows) and stopPropagation */
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    /* a click into the preview iframe sends the parent no pointer event, only moves focus there: that counts as
       outside. Focus leaving the window (another app) does not. */
    const onBlur = (): void => {
      if (document.activeElement?.tagName === 'IFRAME') onClose();
    };
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose, trigger]);

  if (typeof document === 'undefined') return null;

  /* newest first: the step just done is what people look for */
  const rows = ops.steps.map((step, index) => ({ step, index })).reverse();
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - PANEL_W - 8));
  const below = window.innerHeight - anchor.bottom;

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={t('history.opsTitle')}
      className="fixed z-[120] flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      style={{
        left,
        top: anchor.bottom + 6,
        maxHeight: Math.max(0, below - 18),
        width: PANEL_W,
        animation: 'openfilm-rise 0.14s ease-out both',
      }}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 py-2">
        <span className="text-[12px] font-medium text-[var(--text)]">{t('history.opsTitle')}</span>
        <span className="text-[10px] text-[var(--text-faint)]">{t('history.opsHint')}</span>
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
          {t('history.sessionEmpty')}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto p-1">
          {rows.map(({ step, index }) => (
            <OpRow
              key={`${step.at}-${index}`}
              step={step}
              /* after the cursor = undone, redo brings it back */
              undone={index >= ops.cursor}
              /* the step the next ⌘Z undoes */
              next={index === ops.cursor - 1}
              t={t}
              onPick={() => { onRollback(index + 1); onClose(); }}
            />
          ))}
        </ol>
      )}
    </div>,
    document.body,
  );
}

function OpRow({
  step, undone, next, t, onPick,
}: {
  step: SessionOp;
  undone: boolean;
  next: boolean;
  t: (key: string) => string;
  onPick: () => void;
}) {
  const tone = undone ? 'text-[var(--text-faint)]' : 'text-[var(--text-dim)]';
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-[3px] text-left text-[12px] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${tone}`}
      >
        <User size={12} className="shrink-0 text-[var(--text-faint)]" />
        <span className={`min-w-0 flex-1 truncate ${undone ? 'line-through' : ''}`}>
          {stepText(t, step.label ?? 'history.stepEdit')}
        </span>
        {next ? (
          <span className="shrink-0 rounded-full bg-[var(--accent)]/15 px-1.5 py-px text-[10px] font-medium text-[var(--accent)]">
            {shortcutHint('Z', { mod: true })}
          </span>
        ) : null}
      </button>
    </li>
  );
}
