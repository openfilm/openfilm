/**
 * The large windows (settings, features, projects, export, version history): one size, one surface, one side. The side
 * is on the left in the side's color (the panels' in the dark, rgb 24), the page on the right in the raised color
 * (rgb 32); in the light, the side a quiet step darker than the white page (globals.css `--dialog-side`, `--dialog-main`).
 * Settings and Features are framed by components/LargeDialog.
 */
export const LARGE_DIALOG_SIZE = 'h-[88dvh] max-h-[1000px] w-[92vw] max-w-[1600px]';
/** Where a large window sits: over everything, the page dimmed under it. */
export const LARGE_DIALOG_BACKDROP =
  'fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3 sm:p-5 lg:p-6';
/** A large window's surface: its edge, its corners, its shadow and the page's color. */
export const LARGE_DIALOG_SURFACE =
  'rounded-[14px] border border-[var(--border)] bg-[var(--dialog-main)] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.5),0_4px_16px_rgba(0,0,0,0.14)]';
export const LARGE_DIALOG = `relative flex ${LARGE_DIALOG_SIZE} min-h-0 min-w-0 overflow-hidden ${LARGE_DIALOG_SURFACE}`;
/** A large window's side, on its left. */
export const LARGE_DIALOG_SIDE = 'flex min-h-0 w-[264px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--dialog-side)]';
/** A page of a large window: its column 920 px wide in the middle (the same as its lists), its scrollbar at the window's edge. */
export const LARGE_DIALOG_COLUMN = 'px-[max(40px,calc((100%-920px)/2))]';
