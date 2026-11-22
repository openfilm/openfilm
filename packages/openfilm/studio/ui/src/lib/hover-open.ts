/** Pointer and keyboard interaction for the project sidebar and the menus it opens in portals. */
import React from 'react';

export const PROJECT_SIDEBAR_WIDTH = 224;

const OPEN_MS = 120;
/* the sidebar docked or put away, for every project's page of the window (each tab is a page of its own) */
const DOCKED_KEY = 'openfilm.project-sidebar.docked';
const readDocked = () => { try { return localStorage.getItem(DOCKED_KEY) === '1'; } catch { return false; } };
const keepDocked = (docked: boolean) => { try { localStorage.setItem(DOCKED_KEY, docked ? '1' : '0'); } catch { /* private window */ } };
const CLOSE_MS = 220;

export function useHoverOpen() {
  const corner = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const drawer = React.useRef<HTMLElement>(null);
  const [mode, setMode] = React.useState<'preview' | 'docked' | null>(() => (readDocked() ? 'docked' : null));
  /* docked or put away in another project's page: the same here */
  React.useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== DOCKED_KEY) return;
      setMode(previous => (event.newValue === '1' ? 'docked' : previous === 'docked' ? null : previous));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const open = mode !== null;
  const docked = mode === 'docked';
  const timer = React.useRef<number | null>(null);
  const hoverSuppressed = React.useRef(false);
  const clear = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  React.useEffect(() => clear, [clear]);
  const dismiss = React.useCallback(() => {
    clear();
    hoverSuppressed.current = Boolean(corner.current?.matches(':hover'));
    setMode(null);
  }, [clear]);
  const dismissPreview = React.useCallback(() => {
    clear();
    setMode(previous => previous === 'preview' ? null : previous);
  }, [clear]);
  const showPreview = () => {
    clear();
    setMode(previous => previous ?? 'preview');
  };
  const toggle = () => {
    keepDocked(!docked);
    if (docked) dismiss();
    else {
      clear();
      setMode('docked');
    }
  };
  const hover = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.buttons || open || hoverSuppressed.current || timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (corner.current?.matches(':hover')) setMode(previous => previous ?? 'preview');
    }, OPEN_MS);
  };
  const leaveCorner = (event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    hoverSuppressed.current = false;
    if (!open) clear();
  };
  const focusFirst = () => requestAnimationFrame(() => drawer.current?.querySelector<HTMLButtonElement>('button')?.focus());

  React.useEffect(() => {
    if (!open) return;
    const ownedPanels = () => Array.from(drawer.current?.querySelectorAll('[aria-haspopup][aria-expanded="true"][aria-controls]') ?? [])
      .map(control => document.getElementById(control.getAttribute('aria-controls')!))
      .filter((panel): panel is HTMLElement => panel !== null);
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (corner.current?.contains(target) || drawer.current?.contains(target)) return true;
      // The session manager lives in a separate React root. Each menu trigger identifies the panel it opened.
      const portal = target.closest('[data-popover-panel]');
      return Boolean(portal && ownedPanels().some(panel => portal.contains(panel)));
    };
    const leave = () => {
      if (timer.current === null) timer.current = window.setTimeout(dismissPreview, CLOSE_MS);
    };
    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && inside(event.target)) clear();
    };
    const out = (event: PointerEvent) => {
      // Entering an iframe can end the event stream in this document. Schedule from the leaving side as well.
      if (event.pointerType === 'mouse' && inside(event.target) && !inside(event.relatedTarget)) leave();
    };
    const outside = (event: PointerEvent) => { if (!inside(event.target)) dismissPreview(); };
    let tabFrame = 0;
    const keyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Tab' && !docked) {
        cancelAnimationFrame(tabFrame);
        tabFrame = requestAnimationFrame(() => { if (!inside(document.activeElement)) dismissPreview(); });
      } else if (event.key === 'Escape' && (!docked || inside(document.activeElement)) && !ownedPanels().length) {
        event.preventDefault();
        if (docked) keepDocked(false);
        dismiss();
        trigger.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', keyDown);
    if (!docked) {
      window.addEventListener('pointerover', enter, true);
      window.addEventListener('pointerout', out, true);
      window.addEventListener('pointerdown', outside, true);
      window.addEventListener('blur', dismissPreview);
    }
    return () => {
      cancelAnimationFrame(tabFrame);
      window.removeEventListener('pointerover', enter, true);
      window.removeEventListener('pointerout', out, true);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', dismissPreview);
    };
  }, [open, docked, clear, dismiss, dismissPreview]);
  return { open, docked, corner, trigger, drawer, hover, leaveCorner, showPreview, toggle, dismissPreview, focusFirst };
}
