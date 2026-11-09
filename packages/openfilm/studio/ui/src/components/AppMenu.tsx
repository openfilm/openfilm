/** The app menu opens on click; its community flyout opens on hover, like the model menu. */
import React from 'react';
import { ChevronRight, MessageSquare, Settings2, Star, Users } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { useClickOpen } from '@/lib/click-open';
import { studioHost } from '@/lib/host';
import { menuStep } from '@/lib/menu-position';
import { communityChannels, CREATOR_CHANNELS, CREATOR_HANDLE, PRODUCT_LINKS } from '@/lib/product-links';
import { BrandLogo } from './BrandLogo';
import { Popover } from './Popover';
import { SocialLogo, type SocialPlatform } from './SocialLogo';
import { Tooltip } from './Tooltip';
import { Toast, useToast } from './Toast';
import type { SettingsSection } from './settings/SettingsModal';
import styles from './AppMenu.module.css';

// Match the composer's side menus, including time to cross the small gap.
const SIDE_GAP = 2;
const SIDE_CLOSE_MS = 120;

export function AppMenu({ onSettings }: { onSettings: (section: SettingsSection) => void }) {
  const t = useT();
  const language = useLanguage();
  const popup = useClickOpen();
  const toast = useToast();
  const [community, setCommunity] = React.useState(false);
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const communityTrigger = React.useRef<HTMLButtonElement>(null);
  const flyout = React.useRef<HTMLDivElement>(null);
  const closeTimer = React.useRef<number | null>(null);
  const focused = React.useRef(false);
  const id = React.useId();
  const chinese = language === 'zh-CN';
  const socials = CREATOR_CHANNELS.filter(channel => chinese || channel.id === 'instagram' || channel.id === 'youtube');

  const stopTimer = React.useCallback(() => {
    if (closeTimer.current !== null) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);
  React.useEffect(() => {
    if (!popup.open) { stopTimer(); setCommunity(false); focused.current = false; }
  }, [popup.open, stopTimer]);
  React.useEffect(() => stopTimer, [stopTimer]);

  const items = (inside: HTMLElement | null) => Array.from(inside?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const focusItem = (row: HTMLElement | undefined) => { row?.focus({ preventScroll: true }); row?.scrollIntoView({ block: 'nearest' }); };
  const focus = (sub = false, last = false) => requestAnimationFrame(() => {
    const rows = items(sub ? flyout.current : panel.current);
    focusItem(rows[last ? rows.length - 1 : 0]);
  });
  const focusPanel = (sub = false) => requestAnimationFrame(() => (sub ? flyout.current : panel.current)?.focus({ preventScroll: true }));
  const dismiss = (restore = false) => {
    stopTimer(); setCommunity(false); popup.dismiss();
    if (restore) trigger.current?.focus({ preventScroll: true });
    focused.current = false;
  };
  const closeCommunity = (restore = false) => {
    stopTimer(); setCommunity(false);
    if (restore) communityTrigger.current?.focus({ preventScroll: true });
  };
  const hideCommunitySoon = () => {
    stopTimer();
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; setCommunity(false); }, SIDE_CLOSE_MS);
  };
  const openCommunity = (enter = false) => {
    stopTimer(); setCommunity(true);
    if (enter) { popup.setOpen(true); focus(true); }
  };

  React.useLayoutEffect(() => {
    if (!community || !popup.open) { setPosition(null); return; }
    const place = () => {
      const parent = panel.current?.getBoundingClientRect();
      const row = communityTrigger.current?.getBoundingClientRect();
      const child = flyout.current?.getBoundingClientRect();
      if (!parent || !row || !child) return;
      const edge = 8, gap = SIDE_GAP;
      let left = parent.right + gap;
      let top = row.top - 4;
      if (left + child.width > window.innerWidth - edge) {
        if (parent.left - gap - child.width >= edge) left = parent.left - gap - child.width;
        else { left = parent.left; top = parent.bottom + gap; }
      }
      left = Math.max(edge, Math.min(left, window.innerWidth - edge - child.width));
      top = Math.max(edge, Math.min(top, window.innerHeight - edge - child.height));
      setPosition({ left: left - parent.left, top: top - parent.top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [community, popup.open, language]);

  const onKeyDown = (event: React.KeyboardEvent, sub = false) => {
    if (event.key === 'Tab') { dismiss(); return; }
    if (sub && event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); closeCommunity(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (event.key === 'ArrowRight' && !sub) return;
    event.preventDefault(); event.stopPropagation();
    const rows = items(sub ? flyout.current : panel.current);
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : menuStep(current, event.key === 'ArrowUp' ? -1 : 1, rows.length);
    focusItem(rows[next]);
  };
  const onBlur = (event: React.FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && !panel.current?.contains(next) && !flyout.current?.contains(next) && next !== trigger.current) dismiss();
  };
  const link = (label: string, href: string, icon: React.ReactNode) => (
    <a role="menuitem" tabIndex={-1} href={href} target="_blank" rel="noreferrer" onMouseEnter={hideCommunitySoon} onFocus={() => closeCommunity()} onClick={() => dismiss(true)} className={styles.row}>
      <span className={styles.icon} aria-hidden>{icon}</span><span className={styles.label}>{t(label)}</span>
    </a>
  );
  const social = (channel: { id: SocialPlatform; href: string }) => {
    const name = channel.id === 'github' ? 'GitHub' : channel.id === 'discord' ? 'Discord' : t(`appMenu.social.${channel.id}`);
    return <Tooltip key={channel.id} label={name} side="bottom">
      <a role="menuitem" tabIndex={-1} className={styles.logo} aria-label={name} href={channel.href} target="_blank" rel="noreferrer" onClick={() => dismiss(true)}>
        <SocialLogo platform={channel.id} />
      </a>
    </Tooltip>;
  };
  const weChat = (group = false) => {
    const label = t(group ? 'appMenu.weChatGroup' : 'appMenu.weChatCopy').replace('{handle}', CREATOR_HANDLE);
    return <Tooltip label={label} side="bottom">
      <button type="button" role="menuitem" tabIndex={-1} className={styles.logo} aria-label={label} onClick={async () => {
        try {
          await navigator.clipboard.writeText(CREATOR_HANDLE);
          toast.show(t(group ? 'appMenu.weChatGroupCopied' : 'appMenu.weChatCopied').replace('{handle}', CREATOR_HANDLE));
        } catch {
          if (group) toast.show(t('appMenu.weChatGroupHint').replace('{handle}', CREATOR_HANDLE));
          else toast.showError(t('appMenu.weChatCopyFailed').replace('{handle}', CREATOR_HANDLE));
        }
      }}><SocialLogo platform="wechat" /></button>
    </Tooltip>;
  };

  return <><Popover open={popup.open} onOpenChange={(next) => { if (next) popup.setOpen(true); else dismiss(focused.current); }} layer={10060}
    onEscapeKeyDown={(event) => { event.stopPropagation(); if (community) closeCommunity(focused.current); else dismiss(focused.current); }}
    trigger={<button ref={trigger} type="button" aria-label={t('project.appMenu')} aria-haspopup="menu" aria-expanded={popup.open} aria-controls={popup.open ? id : undefined}
      onClick={(event) => { event.stopPropagation(); popup.toggle(); if (!popup.open) { if (event.detail === 0) focus(); else focusPanel(); } }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault(); event.stopPropagation(); popup.setOpen(true); focus(false, event.key === 'ArrowUp');
      }}
      className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] outline-none transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${popup.open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
      <BrandLogo size={15} />
    </button>}>
    <div ref={panel} id={id} data-app-menu role="menu" tabIndex={-1} aria-label={t('project.appMenu')}
      onMouseLeave={hideCommunitySoon} onKeyDown={(event) => onKeyDown(event)} onFocusCapture={() => { focused.current = true; }} onBlur={onBlur} className={styles.menu}>
      <button type="button" role="menuitem" tabIndex={-1} className={styles.row} onMouseEnter={hideCommunitySoon} onFocus={() => closeCommunity()} onClick={() => { dismiss(true); onSettings('general'); }}>
        <Settings2 size={15} className={styles.icon} aria-hidden /><span className={styles.label}>{t('settings.title')}</span>
      </button>
      <button ref={communityTrigger} type="button" role="menuitem" tabIndex={-1} aria-haspopup="menu" aria-expanded={community} aria-controls={community ? `${id}-community` : undefined}
        className={`${styles.row} ${community ? styles.active : ''}`}
        onMouseEnter={() => openCommunity()} onMouseLeave={hideCommunitySoon}
        onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); openCommunity(true); } }} onClick={(event) => { openCommunity(event.detail === 0); if (event.detail > 0) focusPanel(true); }}>
        <Users size={15} className={styles.icon} aria-hidden /><span className={styles.label}>{t('appMenu.community')}</span><ChevronRight size={12} className={styles.end} aria-hidden />
      </button>
      {link('appMenu.feedback', PRODUCT_LINKS.feedback, <MessageSquare size={15} />)}
      {link('appMenu.star', PRODUCT_LINKS.github, <Star size={15} />)}
    </div>
    {community ? <div ref={flyout} id={`${id}-community`} data-community-menu role="menu" tabIndex={-1} aria-label={t('appMenu.community')}
      className={styles.flyout} style={{ left: position?.left ?? `calc(100% + ${SIDE_GAP}px)`, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
      onMouseEnter={() => openCommunity()} onMouseLeave={hideCommunitySoon}
      onFocusCapture={() => { focused.current = true; popup.setOpen(true); }} onKeyDown={(event) => onKeyDown(event, true)} onBlur={onBlur}>
      <div className={styles.communityGroup} role="group" aria-label={t('appMenu.officialCommunity')}>
        <p className={styles.groupLabel}>{t('appMenu.officialCommunity')}</p>
        <div className={styles.logos}>{communityChannels(studioHost ? language : 'en').map(social)}{chinese ? weChat(true) : null}</div>
      </div>
      <div className={styles.communityGroup} role="group" aria-label={CREATOR_HANDLE}>
        <p className={styles.groupLabel}>{CREATOR_HANDLE}</p>
        <div className={styles.logos}>{chinese ? weChat() : null}{socials.map(social)}</div>
      </div>
    </div> : null}
  </Popover><Toast toast={toast.current} /></>;
}
