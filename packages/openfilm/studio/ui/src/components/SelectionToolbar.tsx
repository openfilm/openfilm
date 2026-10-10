/**
 * The small bar that comes up beside what is selected (clips on the timeline, a layer or a clip on the picture, a
 * range or a moment on the ruler): a row of icon buttons for what can be done to it there, the first always
 * "Add to chat" when the app around Studio has one. The actions are the ones the menus already have; the bar only
 * puts the usual few a click away.
 *
 *   · **Beside it, never over it** (lib/selection-toolbar placeToolbar): above, else below, inside the area it belongs
 *     to, and clear of what its owner says it must not cover (the other clips on the timeline); placed again on every
 *     render of its owner, so it follows a scroll or a moved frame.
 *   · **Once the selection settles.** It waits SETTLE_MS after the selection last changed (a marquee, a click that
 *     becomes a drag) and stays away while `hidden` (dragging, trimming, cropping, typing, playing).
 *   · **Esc puts it away** until the selection changes.
 *   · **On body**, like the menus: the timeline and the picture clip what spills out of them. Presses on it reach
 *     neither (they would select or drag what is under it in the component tree), and take no focus (Space plays).
 *   · `data-capture-hide`: the app hides it when it takes a picture of the viewer for a reference.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Tooltip } from '@/components/Tooltip';
import { placeToolbar, type ScreenBox, type ToolbarPlacement } from '@/lib/selection-toolbar';

/** How long the selection must stay the same before the bar shows. */
const SETTLE_MS = 180;

export interface SelectionTool {
  id: string;
  label: string;
  icon: React.ReactNode;
  /** Its key, already formatted by shortcutHint. */
  shortcut?: string;
  disabled?: boolean;
  /** Why it cannot be pressed (said in its tooltip). */
  hint?: string;
  danger?: boolean;
  /** `button`: where a menu it opens hangs from. */
  onSelect: (button: HTMLButtonElement) => void;
}

export type SelectionToolEntry = SelectionTool | { id: string; separator: true };

export function SelectionToolbar({
  selection, measure, hidden = false, lead, label, tools, ariaLabel,
}: {
  /** What is selected, as a key (null: nothing). A new key waits to settle again; Esc hides the bar until it changes. */
  selection: string | null;
  /**
   * Where the selection is on screen and the area the bar stays in (and the room between, when not the usual; what it
   * must not cover); null when it cannot be seen.
   */
  measure: () => { anchor: ScreenBox; bounds: ScreenBox; gap?: number; avoid?: readonly ScreenBox[] } | null;
  /** Kept away for now (a drag, playback): shown again once it settles after. */
  hidden?: boolean;
  /** The first button, always: "Add to chat" (none without a chat). */
  lead?: SelectionTool | null;
  /** Said after the first button: how many are selected ("3 clips"). */
  label?: string;
  /** The rest, after a separator. */
  tools: readonly SelectionToolEntry[];
  ariaLabel: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  const [pos, setPos] = React.useState<ToolbarPlacement | null>(null);
  const [, setTick] = React.useState(0);

  React.useEffect(() => {
    setReady(false);
    if (!selection || hidden) return undefined;
    const timer = window.setTimeout(() => setReady(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [selection, hidden]);
  React.useEffect(() => { if (dismissed && dismissed !== selection) setDismissed(null); }, [dismissed, selection]);

  const shown = ready && !hidden && selection != null && dismissed !== selection && (Boolean(lead) || tools.length > 0);

  React.useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDismissed(selection); };
    const again = () => setTick((n) => n + 1);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', again);
    window.addEventListener('scroll', again, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', again);
      window.removeEventListener('scroll', again, true);
    };
  }, [shown, selection]);

  /* placed after every render (the owner re-renders as what it is about moves), measured first */
  React.useLayoutEffect(() => {
    if (!shown) { setPos(null); return; }
    const m = measure();
    const el = ref.current;
    const next = m ? placeToolbar({
      anchor: m.anchor, size: { width: el?.offsetWidth ?? 0, height: el?.offsetHeight ?? 0 }, bounds: m.bounds,
      ...(m.gap != null ? { gap: m.gap } : {}), ...(m.avoid ? { avoid: m.avoid } : {}),
    }) : null;
    setPos((cur) => (cur && next && cur.left === next.left && cur.top === next.top && cur.side === next.side ? cur : next));
  });

  if (!shown || typeof document === 'undefined') return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const side = pos?.side === 'below' ? 'bottom' : 'top';
  const sep = (key: string) => <span key={key} aria-hidden className="mx-[3px] h-4 w-px shrink-0 bg-[var(--border)]" />;

  return createPortal(
    <div
      ref={ref}
      role="toolbar"
      aria-label={ariaLabel}
      data-selection-toolbar=""
      data-capture-hide=""
      onPointerDown={stop}
      onPointerUp={stop}
      onPointerMove={stop}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); }}
      /* above the panes and the picture, under the menus (z-10060) and the dialogs (z-10050) */
      className="fixed z-[10040] flex h-[28px] items-center gap-px rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-[2px] shadow-[var(--shadow-lg)]"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
        animation: pos ? 'openfilm-rise 0.12s ease-out both' : undefined,
      }}
    >
      {lead ? <ToolbarButton tool={lead} side={side} /> : null}
      {label ? <span className="shrink-0 whitespace-nowrap px-1.5 text-[11.5px] tabular-nums text-[var(--text-muted)]">{label}</span> : null}
      {(lead || label) && tools.length ? sep('lead-sep') : null}
      {tools.map((entry) => ('separator' in entry ? sep(entry.id) : <ToolbarButton key={entry.id} tool={entry} side={side} />))}
    </div>,
    document.body,
  );
}

function ToolbarButton({ tool, side }: { tool: SelectionTool; side: 'top' | 'bottom' }) {
  const tip = tool.disabled && tool.hint ? `${tool.label} · ${tool.hint}` : tool.label;
  return (
    <Tooltip label={tip} side={side} {...(tool.shortcut ? { shortcut: tool.shortcut } : {})}>
      <button
        type="button"
        aria-label={tool.label}
        /* aria-disabled, not disabled: a disabled button gets no hover, and its tooltip says why it cannot be pressed */
        aria-disabled={tool.disabled || undefined}
        data-tool={tool.id}
        /* no focus from a click: the next Space plays instead of pressing this again */
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { if (!tool.disabled) tool.onSelect(e.currentTarget); }}
        className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[6px] outline-none transition focus-visible:ring-1 focus-visible:ring-[var(--border-strong)] ${
          tool.disabled
            ? 'cursor-default text-[var(--text-faint)]'
            : tool.danger
              ? 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--err)]'
              : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
        }`}
      >
        {tool.icon}
      </button>
    </Tooltip>
  );
}
