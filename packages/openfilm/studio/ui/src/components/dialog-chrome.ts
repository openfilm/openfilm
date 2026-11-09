/** The large windows' size: export, version history, projects, settings and the community. */
export const LARGE_DIALOG_SIZE = 'h-[88dvh] max-h-[1000px] w-[92vw] max-w-[1600px]';
/** The export and version-history windows share their size, placement and surface. */
export const LARGE_DIALOG_BACKDROP =
  'fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-3 sm:p-5 lg:p-6';
export const LARGE_DIALOG =
  `flex ${LARGE_DIALOG_SIZE} min-h-0 min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-topbar-popover)] shadow-[var(--shadow-lg)]`;
