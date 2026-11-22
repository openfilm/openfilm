/**
 * The frame the desktop sidebar's pages are drawn in (the projects, the Community, the library; lib/side-page). A page
 * runs to the window's top (no bar over it: the strip there still drags the window), in the editor's panel colour.
 *
 * The three are different kinds of place, so the frame has a head for each (`layout`):
 *   `gallery`  the person's own work, looked through: its name large at the left, its places as pills under it;
 *   `store`    things to find and take: its name, a wide search and its places in the middle, as a storefront's top;
 *   `manager`  files looked after: a low head (name, a line, the things to do at the right), the room left to the files.
 *
 * What a page puts in it may have a title of its own (a window's page): inside a side page it leaves that out, the
 * frame says it (`useInSidePage`).
 */
import * as React from 'react';
import { Search } from 'lucide-react';
import './SidePage.css';

const InSidePage = React.createContext(false);
/** Whether this is drawn in a side page, whose frame names it already. */
export const useInSidePage = () => React.useContext(InSidePage);

/** The page's room either side: a column in the middle of the window, as wide as the kind of page reads best at. */
const COLUMN = { gallery: 1360, store: 1160, manager: 0 } as const;

export interface SidePagePlace { id: string; label: string; count?: number }

export function SidePage({ layout, title, note, places, place, onPlace, search, actions, bare = false, children, data }: {
  layout: keyof typeof COLUMN;
  /** no head (one thing's own page, which has its own): only the room at the window's top */
  bare?: boolean;
  title: string;
  note?: string;
  /** the page's places, as pills under its head (none: one place) */
  places?: readonly SidePagePlace[];
  /** the place shown (none of them: a page reached from one, as a thing's own page) */
  place?: string | null;
  onPlace?: (id: string) => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement> };
  actions?: React.ReactNode;
  children: React.ReactNode;
  data?: Record<string, string>;
}) {
  const x = COLUMN[layout] ? `max(40px, calc((100% - ${COLUMN[layout]}px) / 2))` : '32px';
  const pills = places && places.length > 1 ? (
    <div role="tablist" className={`flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] ${layout === 'store' ? 'justify-center' : '-mx-1 px-1'}`}>
      {places.map(item => {
        const on = item.id === place;
        return <button key={item.id} type="button" role="tab" aria-selected={on} data-side-page-place={item.id} onClick={() => onPlace?.(item.id)}
          className={`flex h-[34px] shrink-0 items-center gap-1.5 rounded-[9px] px-3.5 text-[14px] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
            on ? 'bg-[color-mix(in_srgb,var(--text)_11%,transparent)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
          {item.label}
          {item.count != null ? <span className="text-[12px] font-normal tabular-nums text-[var(--text-faint)]">{item.count}</span> : null}
        </button>;
      })}
    </div>
  ) : null;
  const field = search ? (
    <label className={`flex items-center gap-2.5 rounded-full bg-[color-mix(in_srgb,var(--text)_8%,transparent)] text-[var(--text-muted)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--border-strong)] ${
      layout === 'store' ? 'mx-auto h-[50px] w-full max-w-[620px] px-5' : 'h-9 w-[240px] px-3.5'}`}>
      <Search size={layout === 'store' ? 19 : 15} strokeWidth={1.7} className="shrink-0" aria-hidden />
      <input ref={search.inputRef} type="search" value={search.value} placeholder={search.placeholder} aria-label={search.placeholder}
        onChange={event => search.onChange(event.target.value)}
        className={`min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] [&::-webkit-search-cancel-button]:hidden ${layout === 'store' ? 'text-[15px]' : 'text-[13px]'}`} />
    </label>
  ) : null;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--bg-panel)] text-[var(--text)] [--dialog-main:var(--bg-panel)]"
      style={{ '--page-x': x } as React.CSSProperties} data-side-page-frame={layout} {...data}>
      {bare ? <div aria-hidden className="h-[38px] shrink-0" /> : layout === 'store' ? (
        <header className="relative shrink-0 pb-6 pt-[72px] text-center" style={{ paddingInline: x }}>
          {actions ? <div className="absolute right-8 top-[46px] flex items-center gap-2">{actions}</div> : null}
          <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-0.03em]">{title}</h1>
          {note ? <p className="mx-auto mt-2 max-w-[560px] text-[14px] leading-[21px] text-[var(--text-muted)]">{note}</p> : null}
          {field ? <div className="mt-7">{field}</div> : null}
          {pills ? <div className="mt-5">{pills}</div> : null}
        </header>
      ) : layout === 'manager' ? (
        <header className="shrink-0 pb-4 pt-[46px]" style={{ paddingInline: x }}>
          <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[24px] font-semibold leading-[30px] tracking-[-0.02em]">{title}</h1>
              {note ? <p className="mt-1 truncate text-[13px] leading-5 text-[var(--text-muted)]">{note}</p> : null}
            </div>
            {field || actions ? <div className="flex shrink-0 items-center gap-2">{field}{actions}</div> : null}
          </div>
          {pills ? <div className="mt-4">{pills}</div> : null}
        </header>
      ) : (
        /* the list under it keeps room for its scrollbar (9 px): the head's column is counted without that room too */
        <header className="shrink-0 pb-2 pt-[52px]" style={{ paddingLeft: `max(40px, calc((100% - ${COLUMN.gallery + 9}px) / 2))`, paddingRight: `max(49px, calc((100% - ${COLUMN.gallery - 9}px) / 2))` }}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-[30px] font-semibold leading-[38px] tracking-[-0.025em]">{title}</h1>
              {note ? <p className="mt-1 truncate text-[13.5px] leading-5 text-[var(--text-muted)]">{note}</p> : null}
            </div>
            {field || actions ? <div className="flex shrink-0 items-center gap-2">{field}{actions}</div> : null}
          </div>
          {pills ? <div className="mt-6">{pills}</div> : null}
        </header>
      )}
      <InSidePage.Provider value={true}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
      </InSidePage.Provider>
    </div>
  );
}

/** A button at a side page's head: quiet, or `primary` (the page's one main thing to do). */
export function SidePageButton({ primary = false, icon, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; icon?: React.ReactNode }) {
  return (
    <button type="button" {...rest}
      className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${
        primary ? 'bg-[var(--text)] text-[var(--bg-panel)] hover:opacity-90' : 'bg-[color-mix(in_srgb,var(--text)_7%,transparent)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_11%,transparent)]'} ${rest.className ?? ''}`}>
      {icon}{children}
    </button>
  );
}
