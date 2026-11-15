/** The app menu opens on click: Settings, the Community window (what people make, and where they talk), feedback, a star. */
import React from 'react';
import { MessageSquare, Settings2, Star } from 'lucide-react';
import { COMMUNITY_ICON as Community } from './feature-kinds';
import { useT } from '@/i18n';
import { useClickOpen } from '@/lib/click-open';
import { menuStep } from '@/lib/menu-position';
import { openPlugins } from '@/lib/plugins-window';
import { PRODUCT_LINKS } from '@/lib/product-links';
import { BrandLogo } from './BrandLogo';
import { Popover } from './Popover';
import type { SettingsSection } from './settings/SettingsModal';
import styles from './AppMenu.module.css';

export function AppMenu({ onSettings }: { onSettings: (section: SettingsSection) => void }) {
  const t = useT();
  const popup = useClickOpen();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const focused = React.useRef(false);
  const id = React.useId();
  React.useEffect(() => { if (!popup.open) focused.current = false; }, [popup.open]);

  const items = (inside: HTMLElement | null) => Array.from(inside?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const focusItem = (row: HTMLElement | undefined) => { row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' }); };
  const focus = (last = false) => requestAnimationFrame(() => {
    const rows = items(panel.current);
    focusItem(rows[last ? rows.length - 1 : 0]);
  });
  const focusPanel = () => requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
  const dismiss = (restore = false) => {
    popup.dismiss();
    if (restore) trigger.current?.focus({ preventScroll: true });
    focused.current = false;
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') { dismiss(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const rows = items(panel.current);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : menuStep(current, event.key === 'ArrowUp' ? -1 : 1, rows.length);
    focusItem(rows[next]);
  };
  const onBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.current?.contains(next) && next !== trigger.current) dismiss();
  };
  const link = (label: string, href: string, icon: React.ReactNode) => (
    <a role="menuitem" tabIndex={-1} href={href} target="_blank" rel="noreferrer" onClick={() => dismiss(true)} className={styles.row}>
      <span className={styles.icon} aria-hidden>{icon}</span><span className={styles.label}>{t(label)}</span>
    </a>
  );

  return <Popover open={popup.open} onOpenChange={(next) => { if (next) popup.setOpen(true); else dismiss(focused.current); }} layer={10060}
    onEscapeKeyDown={(event) => { event.stopPropagation(); dismiss(focused.current); }}
    trigger={<button ref={trigger} type="button" aria-label={t('project.appMenu')} aria-haspopup="menu" aria-expanded={popup.open} aria-controls={popup.open ? id : undefined}
      onClick={(event) => { event.stopPropagation(); popup.toggle(); if (!popup.open) { if (event.detail === 0) focus(); else focusPanel(); } }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault(); event.stopPropagation(); popup.setOpen(true); focus(event.key === 'ArrowUp');
      }}
      className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] outline-none transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${popup.open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
      <BrandLogo size={15} />
    </button>}>
    <div ref={panel} id={id} data-app-menu role="menu" tabIndex={-1} aria-label={t('project.appMenu')}
      onKeyDown={onKeyDown} onFocusCapture={() => { focused.current = true; }} onBlur={onBlur} className={styles.menu}>
      <button type="button" role="menuitem" tabIndex={-1} className={styles.row} onClick={() => { dismiss(true); onSettings('general'); }}>
        <Settings2 size={15} className={styles.icon} aria-hidden /><span className={styles.label}>{t('settings.title')}</span>
      </button>
      <button type="button" role="menuitem" tabIndex={-1} className={styles.row} onClick={() => { dismiss(true); openPlugins(); }}>
        <Community size={15} className={styles.icon} aria-hidden /><span className={styles.label}>{t('assetDrawer.pluginsWindow')}</span>
      </button>
      {link('appMenu.feedback', PRODUCT_LINKS.feedback, <MessageSquare size={15} />)}
      {link('appMenu.star', PRODUCT_LINKS.github, <Star size={15} />)}
    </div>
  </Popover>;
}
