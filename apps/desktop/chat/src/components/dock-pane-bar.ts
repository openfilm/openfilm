/**
 * One style for the top bar of the workspace's three panes; the conversation pane's is the original.
 *
 * If one pane changed its type, button boxes or spacing, the three would stop lining up, so it lives in one place.
 */
export const PANE_BAR = 'flex h-8 shrink-0 items-center gap-1 px-1.5';
export const PANE_TITLE = 'min-w-0 truncate text-[12px] font-medium text-[var(--text-muted)]';
export const PANE_BTN =
  'flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
export const PANE_BTN_ON = 'bg-[var(--bg-hover)] text-[var(--text)]';
export const PANE_ICON = 14;
/** The viewer's two panel switches (assets, inspector): the buttons a person reaches for most, one size up. */
export const PANE_TOGGLE = PANE_BTN.replace('h-[22px] w-[22px]', 'h-7 w-7');
export const PANE_TOGGLE_ICON = 16;
