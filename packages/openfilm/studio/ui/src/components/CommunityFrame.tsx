/**
 * The Community as the desktop sidebar's page (lib/side-page), laid out as a community of makers' work is browsed: a
 * bar at the window's top with where one is (back, forward, the way back to its first page), the search and Publish;
 * then the first page (library/CommunityHome): its banner, its places as a row of chips under it (what the person saved
 * first, then each kind; a kind with sub-levels opens a menu of them). A place is a page of its own: its name large, what
 * it is in a line, its own sub-levels as chips under them (`CommunityPageHead`), no row of places over it.
 *
 * The bar drags the window (the page has no title bar over it); what is pressed in it does not.
 */
import * as React from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Search, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { InSidePage, SidePageActions, SidePageLead, useSidePageActions } from './SidePage';
import styles from './CommunityFrame.module.css';

/** A line of a chip's menu: a sub-level to go to, a group's quiet name over the lines after it, or a rule. */
export type CommunityMenuItem = { id: string; label: string; badge?: string; onPick: () => void } | { heading: string } | { rule: true };
export interface CommunityChip { id: string; label: string; icon: React.ReactNode; on?: boolean; onPick: (from: HTMLElement) => void; /** its sub-levels, as a menu under it */ menu?: readonly CommunityMenuItem[] }

export function CommunityFrame({ home, onHome, crumbs, back, forward, search, onPublish, publishLabel, chips, trailing, children }: {
  /** the Community's own name, the first word of the way: pressed, its first page */
  home: string;
  onHome: () => void;
  /** where one is after it: a place, then one thing's page */
  crumbs: readonly string[];
  back?: (() => void) | undefined;
  forward?: (() => void) | undefined;
  search: { value: string; onChange: (value: string) => void; placeholder: string; inputRef?: React.Ref<HTMLInputElement> };
  /** Publish, at the bar's right after the search */
  onPublish: () => void;
  publishLabel: string;
  chips: readonly CommunityChip[];
  /** what the place shown adds at its head's right (Saved: adding from a folder or a link) */
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  /* the chip whose menu is open */
  const [opened, setOpened] = React.useState<string | null>(null);
  /* the places on the first page, going up with it as it is read (its banner over them); a chip with sub-levels opens
     a menu of them, as a community's top places do */
  const lead = (
    <div className={styles.chips} data-community-chips>
      {chips.map(chip => chip.menu ? (
        <ChipMenu key={chip.id} chip={chip} open={opened === chip.id} onOpen={(open) => setOpened(open ? chip.id : null)} />
      ) : (
        <button key={chip.id} type="button" className={styles.chip} data-on={chip.on || undefined} data-side-page-place={chip.id} onClick={event => chip.onPick(event.currentTarget)}>
          {chip.icon}{chip.label}
        </button>
      ))}
    </div>
  );
  return (
    <div className={styles.frame} data-side-page-frame="community" data-community-page="">
      <header className={styles.bar} data-community-bar>
        <button type="button" className={styles.step} aria-label={t('desktopNavigation.communityBack')} title={t('desktopNavigation.communityBack')} disabled={!back} onClick={back}><ArrowLeft size={15} aria-hidden /></button>
        <button type="button" className={styles.step} aria-label={t('desktopNavigation.communityForward')} title={t('desktopNavigation.communityForward')} disabled={!forward} onClick={forward}><ArrowRight size={15} aria-hidden /></button>
        <nav className={styles.way} aria-label={home}>
          <button type="button" aria-current={crumbs.length ? undefined : 'page'} onClick={onHome}>{home}</button>
          {crumbs.map((crumb, index) => <React.Fragment key={`${index}:${crumb}`}>
            <ChevronRight size={12} aria-hidden /><span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb}</span>
          </React.Fragment>)}
        </nav>
        <label className={styles.search}>
          <Search size={14} strokeWidth={1.8} aria-hidden />
          <input ref={search.inputRef} type="search" value={search.value} placeholder={search.placeholder} aria-label={search.placeholder}
            onChange={event => search.onChange(event.target.value)} />
        </label>
        <button type="button" className={styles.publish} data-community-publish onClick={onPublish}>
          <Upload size={14} strokeWidth={2} aria-hidden />{publishLabel}
        </button>
      </header>
      <InSidePage.Provider value={true}>
        <SidePageLead.Provider value={lead}>
          <SidePageActions.Provider value={trailing ?? null}>
            <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
          </SidePageActions.Provider>
        </SidePageLead.Provider>
      </InSidePage.Provider>
    </div>
  );
}

/** A chip with sub-levels: pressed, a menu of them under it (Esc or a press elsewhere closes it; ↑ ↓ step through). */
function ChipMenu({ chip, open, onOpen }: { chip: CommunityChip; open: boolean; onOpen: (open: boolean) => void }) {
  const box = React.useRef<HTMLDivElement>(null);
  const menuId = React.useId();
  React.useEffect(() => {
    if (!open) return undefined;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onOpen(false); };
    window.addEventListener('pointerdown', away, true);
    requestAnimationFrame(() => box.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus());
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open, onOpen]);
  const step = (event: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onOpen(false); box.current?.querySelector<HTMLButtonElement>('[aria-haspopup]')?.focus(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <div ref={box} className={styles.chipBox} onKeyDown={open ? step : undefined}>
      <button type="button" className={styles.chip} data-on={chip.on || undefined} data-open={open || undefined} data-side-page-place={chip.id}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => onOpen(!open)}>
        {chip.icon}{chip.label}<ChevronDown size={13} strokeWidth={2} className={styles.chev} aria-hidden />
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={chip.label} className={styles.menu} data-community-menu={chip.id}>
          {chip.menu!.map((item, i) => 'rule' in item ? <div key={`rule-${i}`} role="separator" className={styles.menuRule} />
            : 'heading' in item ? <div key={`heading-${i}`} className={styles.menuHeading}>{item.heading}</div>
              : <button key={item.id} type="button" role="menuitem" className={styles.menuItem} data-community-menu-item={item.id}
                  onClick={() => { onOpen(false); item.onPick(); }}>
                  <span>{item.label}</span>{item.badge ? <i>{item.badge}</i> : null}
                </button>)}
        </div>
      ) : null}
    </div>
  );
}

/** A place's head: its name large, what it is in a line, a word after the name (Early), what the frame adds at the right. */
export function CommunityPageHead({ title, note, badge, aside }: { title: string; note?: string | undefined; badge?: string | undefined; aside?: React.ReactNode }) {
  const actions = useSidePageActions();
  return (
    <header className={styles.head} data-community-page-head="">
      <div className={styles.headText}>
        <h1>{title}{badge ? <span className={styles.headBadge}>{badge}</span> : null}</h1>
        {note ? <p>{note}</p> : null}
      </div>
      {aside || actions ? <div className={styles.headActions}>{aside}{actions}</div> : null}
    </header>
  );
}
