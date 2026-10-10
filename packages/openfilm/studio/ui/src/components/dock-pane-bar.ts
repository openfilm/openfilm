/**
 * The shared styling for the bar at the top of each of the workspace's three panes; the side
 * pane's bar is the original, and the viewer and inspector bars follow it.
 *
 * If any one pane changes its font size, colors, button box or spacing, the three bars stop
 * lining up, so the styles live in one place.
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
