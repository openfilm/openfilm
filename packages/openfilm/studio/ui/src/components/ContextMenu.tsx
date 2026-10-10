/**
 * Context menu: a menu that pops up at the pointer.
 *
 * A few things that are not obvious but required:
 *   · **Portal to body.** An ancestor of the menu has `overflow: hidden` (the timeline's track
 *     area must clip whatever scrolls out of view); left in place, the menu would be half cut off.
 *   · **Flip to avoid the edge.** Pressed near the bottom-right corner of the screen, a menu
 *     growing toward the bottom right would be half off screen, and that corner is exactly
 *     where the timeline gets right-clicked most (the blocks at the end). Position after
 *     measuring the real size instead of guessing.
 *   · **Keyboard works.** Up/Down arrows, Home/End for the ends, Enter to run, Esc to close (only the menu: an Esc
 *     meant for it must not also close the dialog it was opened in). Right (or Enter) on an item with a submenu
 *     opens it and moves focus into it; Left or Esc closes it and comes back.
 *     The context menu is the only entry point for several things on the timeline; if it only
 *     worked with a mouse, those actions would not exist for keyboard users.
 *   · **Disabled items stay in place** and can say why (`hint`). If they vanished, the same
 *     spot would be "Delete" this time and "Duplicate" the next, and muscle memory could not keep up.
 *   · **Submenus** open as a separate panel so they do not stretch the parent's width.
 *     Clicking inside a submenu does not count as "clicking outside".
 */
import * as React from 'react';
import { createPortal } from 'react-dom';

import { MENU_EDGE, menuPosition, menuStep } from '@/lib/menu-position';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Destructive action (delete). Red text. */
  danger?: boolean;
  disabled?: boolean;
  /** Why it cannot be clicked. A grayed-out item must give a reason, otherwise users just keep clicking it. */
  hint?: string;
  /** Shortcut, drawn on the right. */
  shortcut?: string;
  /** Currently selected (the check mark in a sort list). `false` still reserves the space, to line up with checked items. */
  checked?: boolean;
  /** An item with a submenu does not run anything itself; it only opens the next panel. */
  submenu?: readonly ContextMenuEntry[];
  onSelect?: () => void;
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

function isItem(e: ContextMenuEntry): e is ContextMenuItem {
  return !('separator' in e);
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  dense = false,
  align = 'start',
  flipTo,
  trigger,
}: {
  /** Where it opens: the pointer, or the corner of the button it hangs from. */
  x: number;
  y: number;
  items: readonly ContextMenuEntry[];
  onClose: () => void;
  /**
   * One step tighter.
   *
   * A context menu answers "what can I do with this big area", with many items and long
   * labels, so roomy spacing is right. The toolbar buttons instead open a short single-choice
   * list (sort order, filter by type); at the same size, three or four short words would pop
   * up something several times larger than the button itself, which looks like a misclick.
   */
  dense?: boolean;
  /** 'end': its right edge at `x` (a "⋯" at the right of a card); see menuPosition. */
  align?: 'start' | 'end';
  /** Opened from a button: when it does not fit below, it flips to end here (the button's top). See menuPosition. */
  flipTo?: number;
  /** The button that opened it: a press on it is not an outside click (the button toggles the menu itself). */
  trigger?: React.RefObject<HTMLElement | null>;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const subRef = React.useRef<HTMLDivElement | null>(null);
  const itemEls = React.useRef(new Map<string, HTMLButtonElement>());
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [openSub, setOpenSub] = React.useState<string | null>(null);
  const openSubRef = React.useRef(openSub);
  openSubRef.current = openSub;
  const [subPos, setSubPos] = React.useState<{ left: number; top: number } | null>(null);
  /* Which item the keyboard is on. -1 = the keyboard has not been used yet; no item should be
     highlighted then, or mouse users would think that item is selected. */
  const [active, setActive] = React.useState(-1);
  /* The keyboard's item in the open submenu; -1 = focus is not in it (it was opened by the mouse, or not yet). */
  const [subActive, setSubActive] = React.useState(-1);
  /* `enter`: the keyboard opened it, so focus goes in, on its first item */
  const showSub = React.useCallback((id: string | null, enter = false) => {
    setOpenSub(id);
    setSubActive(enter && id ? 0 : -1);
  }, []);

  const usable = React.useMemo(
    () => items.filter((e): e is ContextMenuItem => isItem(e) && !e.disabled),
    [items],
  );
  const subItems = openSub
    ? (items.find((e) => isItem(e) && e.id === openSub) as ContextMenuItem | undefined)?.submenu
    : undefined;
  const subUsable = React.useMemo(
    () => (subItems ?? []).filter((e): e is ContextMenuItem => isItem(e) && !e.disabled),
    [subItems],
  );
  const inSub = subActive >= 0;

  /* Position after measuring the real size. If it does not fit, grow the other way (flip); if
     neither side fits, pin to the edge. Uses a layout effect: it is settled after layout and
     before the browser paints, otherwise it would flash for one frame in the wrong place. */
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const at = menuPosition({
      at: { x, y },
      size: { width, height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      align,
      flipTo,
    });
    setPos({ left: at.left, top: at.top });
    /* Pull focus in so arrow keys drive this menu rather than the timeline underneath. */
    el.focus({ preventScroll: true });
  }, [x, y, items, align, flipTo]);

  React.useLayoutEffect(() => {
    if (!openSub || !subRef.current) {
      setSubPos(null);
      return;
    }
    const anchor = itemEls.current.get(openSub)?.getBoundingClientRect();
    if (!anchor) return;
    const { width, height } = subRef.current.getBoundingClientRect();
    const gap = 4;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    let left = anchor.right + gap;
    if (left + width > viewport.width - 8) left = anchor.left - width - gap;
    let top = anchor.top;
    if (top + height > viewport.height - 8) top = Math.max(8, viewport.height - height - 8);
    setSubPos({ left: Math.max(8, left), top });
  }, [openSub, subItems]);

  /* Into the submenu once it is placed (hidden until then, and a hidden element cannot take focus). */
  React.useEffect(() => {
    if (inSub && subPos) subRef.current?.focus({ preventScroll: true });
  }, [inSub, subPos]);

  React.useEffect(() => {
    const close = (e: Event): void => {
      /* A press inside the menu itself is not an outside click. Scrolling closes it (except the
         menu's own, when it is taller than the window): the menu is pinned to screen coordinates,
         and once what is underneath scrolls away it no longer points at what it was opened for. */
      const node = e.target as Node;
      if ((e.type === 'pointerdown' || e.type === 'scroll')
        && (ref.current?.contains(node) || subRef.current?.contains(node))) return;
      if (e.type === 'pointerdown' && trigger?.current?.contains(node)) return;
      onClose();
    };
    /* Esc is the menu's wherever focus is (right after a right-click from the stage iframe it is not
       inside the menu), and only the menu's: caught on the way down and stopped there, so the dialog
       or editor under it does not take the same press (the Projects window would close). An open
       submenu collapses first. */
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (openSubRef.current) { showSub(null); ref.current?.focus({ preventScroll: true }); }
      else onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onEsc, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onEsc, true);
    };
  }, [onClose, trigger, showSub]);

  const run = React.useCallback((item: ContextMenuItem) => {
    if (item.disabled || item.submenu) return;
    onClose();
    item.onSelect?.();
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!usable.length) return;
    const step = (d: number): void => {
      e.preventDefault();
      setActive((i) => {
        const next = menuStep(i, d, usable.length);
        const item = usable[next];
        showSub(item?.submenu ? item.id : null);
        return next;
      });
    };
    if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(usable.length - 1); }
    else if (e.key === 'ArrowRight') {
      const item = usable[active];
      if (item?.submenu) {
        e.preventDefault();
        showSub(item.id, true);
      }
    } else if (e.key === 'ArrowLeft') {
      if (openSub) {
        e.preventDefault();
        showSub(null);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = usable[active];
      if (item) {
        e.preventDefault();
        if (item.submenu) showSub(item.id, true);
        else run(item);
      }
    }
  };

  /* The submenu's own keys, while focus is in it; Left goes back to the item it hangs from. */
  const onSubKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setSubActive((i) => menuStep(i, e.key === 'ArrowDown' ? 1 : -1, subUsable.length));
    } else if (e.key === 'Home') { e.preventDefault(); setSubActive(subUsable.length ? 0 : -1); }
    else if (e.key === 'End') { e.preventDefault(); setSubActive(subUsable.length - 1); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      showSub(null);
      ref.current?.focus({ preventScroll: true });
    } else if (e.key === 'Enter' || e.key === ' ') {
      const item = subUsable[subActive];
      if (item) {
        e.preventDefault();
        run(item);
      }
    }
  };

  if (typeof document === 'undefined') return null;

  /* Focus stays on the container (the arrow keys belong to it), so "which item is current"
     must be announced separately; otherwise a screen reader would just announce a menu without
     saying which entry it is on. */
  const activeId = active >= 0 && usable[active] ? `ctxmenu-${usable[active]!.id}` : undefined;
  const subActiveId = subActive >= 0 && subUsable[subActive] ? `ctxmenu-sub-${subUsable[subActive]!.id}` : undefined;

  const panel = dense
    ? 'min-w-[136px] rounded-lg py-[3px]'
    : 'min-w-[184px] rounded-xl py-1';
  const row = dense
    ? 'gap-2 px-2.5 py-[5px] text-[12px]'
    : 'gap-2.5 px-3 py-[7px] text-[13px]';

  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        aria-orientation="vertical"
        {...(activeId ? { 'aria-activedescendant': activeId } : {})}
        onKeyDown={onKeyDown}
        /* above every dialog it can be opened in (the Projects window is z-10050); taller than the window, it scrolls */
        className={`fixed z-[10060] overflow-y-auto overflow-x-hidden border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] outline-none ${panel}`}
        style={{
          left: pos?.left ?? x,
          top: pos?.top ?? y,
          maxHeight: `calc(100vh - ${2 * MENU_EDGE}px)`,
          /* Hidden until measured: the first frame would be painted at the un-adjusted position, and it would be seen flashing off screen. */
          visibility: pos ? 'visible' : 'hidden',
          animation: pos ? 'openfilm-rise 0.12s ease-out both' : undefined,
        }}
      >
        {items.map((entry) => {
          if (!isItem(entry)) {
            return <div key={entry.id} className={`h-px bg-[var(--border)] ${dense ? 'my-[3px]' : 'my-1'}`} />;
          }
          const idx = usable.indexOf(entry);
          const hasCheck = entry.checked !== undefined;
          return (
            <button
              key={entry.id}
              id={`ctxmenu-${entry.id}`}
              ref={(el) => {
                if (el) itemEls.current.set(entry.id, el);
                else itemEls.current.delete(entry.id);
              }}
              type="button"
              role="menuitem"
              disabled={entry.disabled}
              title={entry.disabled ? entry.hint : undefined}
              aria-disabled={entry.disabled}
              aria-haspopup={entry.submenu ? 'menu' : undefined}
              aria-expanded={entry.submenu ? openSub === entry.id : undefined}
              /* Moving the mouse over an item moves the keyboard position there too: if the two
                 pointers drifted apart, Enter would run a different item (the eye sees this one
                 lit while the keyboard sits elsewhere). */
              onPointerEnter={() => {
                setActive(idx);
                if (openSub === entry.id) return;
                /* the submenu the keyboard was in goes: focus back here, not lost with it */
                if (inSub) ref.current?.focus({ preventScroll: true });
                showSub(entry.submenu ? entry.id : null);
              }}
              onClick={() => {
                if (entry.submenu) showSub(entry.id);
                else run(entry);
              }}
              className={`flex w-full items-center text-left transition ${row} ${
                entry.disabled
                  ? 'cursor-default text-[var(--text-faint)]'
                  : entry.danger
                    ? 'text-[var(--err)]'
                    : 'text-[var(--text)]'
              } ${idx >= 0 && idx === active && !entry.disabled ? 'bg-[var(--bg-hover)]' : ''}`}
            >
              {hasCheck ? (
                <span
                  className={`flex shrink-0 justify-center text-[var(--brand-wind-mid)] ${
                    dense ? 'w-[11px] text-[11px]' : 'w-[14px] text-[12px]'
                  }`}
                  aria-hidden
                >
                  {entry.checked ? '✓' : ''}
                </span>
              ) : entry.icon ? (
                <span className={`flex shrink-0 justify-center ${dense ? 'w-[13px]' : 'w-[15px]'}`}>
                  {entry.icon}
                </span>
              ) : null}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.shortcut ? (
                <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{entry.shortcut}</span>
              ) : null}
              {entry.submenu ? (
                <span className="shrink-0 text-[12px] text-[var(--text-faint)]" aria-hidden>›</span>
              ) : null}
            </button>
          );
        })}
      </div>
      {subItems ? (
        <div
          ref={subRef}
          role="menu"
          tabIndex={-1}
          aria-orientation="vertical"
          {...(subActiveId ? { 'aria-activedescendant': subActiveId } : {})}
          onKeyDown={onSubKeyDown}
          className="fixed z-[10061] min-w-[168px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lg)] outline-none"
          style={{
            left: subPos?.left ?? 0,
            top: subPos?.top ?? 0,
            visibility: subPos ? 'visible' : 'hidden',
          }}
        >
          {subItems.map((entry) => {
            if (!isItem(entry)) {
              return <div key={entry.id} className="my-1 h-px bg-[var(--border)]" />;
            }
            const idx = subUsable.indexOf(entry);
            return (
              <button
                key={entry.id}
                id={`ctxmenu-sub-${entry.id}`}
                type="button"
                role="menuitem"
                disabled={entry.disabled}
                title={entry.disabled ? entry.hint : undefined}
                onPointerEnter={() => { if (inSub && idx >= 0) setSubActive(idx); }}
                onClick={() => run(entry)}
                className={`flex w-full items-center gap-2.5 px-3 py-[7px] text-left text-[13px] transition ${
                  entry.disabled
                    ? 'cursor-default text-[var(--text-faint)]'
                    : 'text-[var(--text)] hover:bg-[var(--bg-hover)]'
                } ${inSub && idx >= 0 && idx === subActive ? 'bg-[var(--bg-hover)]' : ''}`}
              >
                {entry.checked !== undefined ? (
                  <span
                    className="flex w-[14px] shrink-0 justify-center text-[12px] text-[var(--brand-wind-mid)]"
                    aria-hidden
                  >
                    {entry.checked ? '✓' : ''}
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </>,
    document.body,
  );
}
