'use client';

import React from 'react';
import { ChevronDown, ChevronRight, Loader2, MoreHorizontal, Plus, Search } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Popover, keepFocus } from './Popover';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import {
  groupSessionsByRecency,
  type ProjectSessionItem,
  type SessionRecencyKey,
} from '@/lib/project-sessions';
import { PANE_BAR, PANE_BTN, PANE_ICON, PANE_TITLE } from './dock-pane-bar';

const RECENCY_I18N: Record<SessionRecencyKey, 'sidebar.searchToday' | 'sidebar.searchYesterday' | 'sidebar.searchPrevious7Days' | 'sidebar.searchEarlier'> = {
  today: 'sidebar.searchToday',
  yesterday: 'sidebar.searchYesterday',
  week: 'sidebar.searchPrevious7Days',
  earlier: 'sidebar.searchEarlier',
};

/**
 * The title cell's maximum width.
 *
 * The title itself is already capped (SESSION_TITLE_MAX_WIDTH: 15 CJK or 30 Latin characters); this only keeps it
 * from filling the bar. So it must be a little wider than those 30 characters, or a title within the cap gets cut
 * while the bar has room to spare.
 */
const TITLE_MAX = 'max-w-[15rem]';

/** A row of the history: new, search, each conversation. */
const ROW = 'flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition';

/** What a conversation's menus do: rename, pin, archive (and, in the bar's, show or hide the history). */
interface SessionActions {
  onRenameSession?: (id: string, title: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
}

type MenuEntry = { id: string; label: string; hint?: string; disabled?: boolean; onSelect: () => void } | 'separator';

/** A conversation's menu: its entries, each with its letter, which picks it while the menu is open. */
function SessionMenu({ entries, onClose }: { entries: MenuEntry[]; onClose: () => void }) {
  const latest = React.useRef({ entries, onClose });
  latest.current = { entries, onClose };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const hit = latest.current.entries.find((e) => e !== 'separator' && !e.disabled && e.hint?.toLowerCase() === event.key.toLowerCase());
      if (!hit || hit === 'separator') return;
      event.preventDefault();
      event.stopPropagation();
      latest.current.onClose();
      hit.onSelect();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div role="menu" className="min-w-[180px] p-1">
      {entries.map((entry, i) => (entry === 'separator' ? (
        <div key={`separator-${i}`} role="separator" className="mx-2 my-1 h-px bg-[var(--border)]" />
      ) : (
        <button
          key={entry.id}
          type="button"
          role="menuitem"
          disabled={entry.disabled}
          onMouseDown={keepFocus}
          onClick={() => { onClose(); entry.onSelect(); }}
          className="flex h-8 w-full items-center gap-6 rounded-lg px-2.5 text-left text-[13px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:pointer-events-none disabled:opacity-40"
        >
          <span className="min-w-0 flex-1 truncate">{entry.label}</span>
          {entry.hint ? <span className="text-[12px] text-[var(--text-faint)]">{entry.hint}</span> : null}
        </button>
      )))}
    </div>
  );
}

/** A title being renamed, in place: Enter or leaving keeps it, Esc lets it go (`onDone(null)`). */
function TitleInput({ initial, width, className, onDone }: {
  initial: string; width?: number | null; className: string; onDone: (title: string | null) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const done = React.useRef(false);
  const finish = (title: string | null) => {
    if (done.current) return;
    done.current = true;
    const clean = title?.replace(/\s+/g, ' ').trim();
    onDone(clean && clean !== initial ? clean : null);
  };
  return (
    <input
      autoFocus
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = event.target.value;
        setDraft((event.nativeEvent as InputEvent).isComposing ? next : limitTitleWidth(next, SESSION_TITLE_MAX_WIDTH));
      }}
      onCompositionEnd={(event) => setDraft(limitTitleWidth(event.currentTarget.value, SESSION_TITLE_MAX_WIDTH))}
      onBlur={() => finish(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') finish(draft);
        if (event.key === 'Escape') finish(null);
      }}
      style={width ? { width } : undefined}
      className={className}
    />
  );
}

/**
 * The bar at the top of the conversation, as a chat app's: the session's title, which renames it when clicked, and
 * beside it a menu that shows or hides the history (a pane left of the conversation: SessionHistory), renames, pins
 * and archives it.
 *
 * The title comes from the first message ("Untitled chat" until then, which can be renamed already). New is in the
 * history.
 */
export function ConversationSessionBar({
  sessions,
  currentSessionId,
  onRenameSession,
  onPinSession,
  onArchiveSession,
  historyOpen = false,
  onToggleHistory,
  busy = false,
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  /** A turn is running: the conversation shown cannot be archived meanwhile. */
  busy?: boolean;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
}) {
  const t = useT();
  const current = sessions.find((item) => item.id === currentSessionId);
  const label = current?.title.trim() ?? '';
  const said = Boolean(current?.turns);
  const [renaming, setRenaming] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  React.useEffect(() => { setRenaming(false); }, [currentSessionId]);

  const titleBoxRef = React.useRef<HTMLButtonElement | null>(null);
  const [titleEditWidth, setTitleEditWidth] = React.useState<number | null>(null);
  function startRename() {
    if (!onRenameSession) return;
    const width = titleBoxRef.current?.getBoundingClientRect().width;
    setTitleEditWidth(width && width > 0 ? width : null);
    setRenaming(true);
  }

  const entries: MenuEntry[] = [
    ...(onToggleHistory ? [{ id: 'history', label: t(historyOpen ? 'projectMenu.hideChats' : 'projectMenu.showChats'), onSelect: onToggleHistory }, 'separator' as const] : []),
    ...(onRenameSession ? [{ id: 'rename', label: t('projectMenu.rename'), hint: 'R', onSelect: startRename }] : []),
    ...(onPinSession ? [{ id: 'pin', label: t(current?.pinned ? 'projectMenu.unpin' : 'projectMenu.pin'), hint: 'P', disabled: !said, onSelect: () => onPinSession(currentSessionId, !current?.pinned) }] : []),
    ...(onArchiveSession ? ['separator' as const, { id: 'archive', label: t(current?.archived ? 'projectMenu.unarchive' : 'projectMenu.archive'), hint: 'A', disabled: !said || (busy && !current?.archived), onSelect: () => onArchiveSession(currentSessionId, !current?.archived) }] : []),
  ];

  return (
    <div className={PANE_BAR}>
      {renaming ? (
        <TitleInput
          initial={label}
          width={titleEditWidth}
          onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(currentSessionId, title); }}
          className={`${TITLE_MAX} ${PANE_TITLE} box-border h-[22px] max-w-[min(15rem,calc(100%-52px))] bg-transparent px-1.5 text-[var(--text)] outline-none`}
        />
      ) : (
        <Tooltip label={onRenameSession ? t('projectMenu.rename') : undefined} side="bottom">
          <button
            ref={titleBoxRef}
            type="button"
            onClick={startRename}
            className={`${TITLE_MAX} flex h-[22px] w-fit min-w-0 items-center rounded-md px-1.5 text-left transition hover:bg-[var(--bg-hover)]`}
          >
            <span title={label || undefined} className={`${PANE_TITLE} ${label ? '' : 'text-[var(--text-faint)]'}`}>
              {label || t('project.untitledSession')}
            </span>
          </button>
        </Tooltip>
      )}
      {entries.length ? (
        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          trigger={(
            <button type="button" aria-label={t('projectMenu.more')} aria-haspopup="menu" aria-expanded={menuOpen}
              className={`${PANE_BTN} ${menuOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
              <ChevronDown size={PANE_ICON} strokeWidth={1.75} />
            </button>
          )}
        >
          <SessionMenu entries={entries} onClose={() => setMenuOpen(false)} />
        </Popover>
      ) : null}
      <span className="min-w-0 flex-1" />
    </div>
  );
}

/** One conversation in the history: its title, and on hover (or a right click) its menu; a running one turns. */
function SessionRow({ item, label, active, blocked, running, onSelect, onRenameSession, onPinSession, onArchiveSession }: SessionActions & {
  item: ProjectSessionItem; label: string; active: boolean; blocked: boolean; running: boolean; onSelect: () => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const entries: MenuEntry[] = [
    ...(onPinSession ? [{ id: 'pin', label: t(item.pinned ? 'projectMenu.unpin' : 'projectMenu.pin'), hint: 'P', onSelect: () => onPinSession(item.id, !item.pinned) }] : []),
    ...(onRenameSession ? [{ id: 'rename', label: t('projectMenu.rename'), hint: 'R', onSelect: () => setRenaming(true) }] : []),
    ...(onArchiveSession ? ['separator' as const, { id: 'archive', label: t(item.archived ? 'projectMenu.unarchive' : 'projectMenu.archive'), hint: 'A', disabled: running && !item.archived, onSelect: () => onArchiveSession(item.id, !item.archived) }] : []),
  ];
  return (
    <div
      onContextMenu={entries.length ? (event) => { event.preventDefault(); setMenuOpen(true); } : undefined}
      className={`group flex h-8 min-w-0 items-center rounded-lg transition ${
        active || menuOpen || renaming ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
      } ${blocked ? 'opacity-50' : ''}`}
    >
      {renaming ? (
        <TitleInput
          initial={item.title.trim()}
          onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(item.id, title); }}
          className="mx-2 h-full min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none"
        />
      ) : (
        <button
          type="button"
          aria-current={active || undefined}
          aria-disabled={blocked || undefined}
          title={label}
          onClick={onSelect}
          className={`flex h-full min-w-0 flex-1 items-center pl-2 text-left text-[13px] ${blocked ? 'cursor-not-allowed' : ''}`}
        >
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      )}
      {running && !menuOpen ? (
        <span title={t('projectMenu.running')} className="mr-2 flex shrink-0 text-[var(--text-faint)] group-hover:hidden">
          <Loader2 size={12} className="animate-spin" />
        </span>
      ) : null}
      {entries.length && !renaming ? (
        <div className={`mr-1 shrink-0 ${menuOpen ? 'flex' : 'hidden group-hover:flex'}`}>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            align="end"
            trigger={(
              <button type="button" aria-label={t('projectMenu.more')} aria-haspopup="menu" aria-expanded={menuOpen}
                className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-active)] hover:text-[var(--text)]">
                <MoreHorizontal size={14} />
              </button>
            )}
          >
            <SessionMenu entries={entries} onClose={() => setMenuOpen(false)} />
          </Popover>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The project's conversations, left of the one shown (the bar's menu opens it), laid out as a chat app's sidebar:
 * new and search on top, then those pinned, then groups for today, yesterday, the past 7 days and earlier, and those
 * archived at the foot, folded. Each row has its menu (pin, rename, archive). While a turn runs neither new nor
 * another conversation can be had (`busy`); its row turns.
 */
export function SessionHistory({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  busy = false,
  ...actions
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession?: () => void;
  busy?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [archivedOpen, setArchivedOpen] = React.useState(false);
  const untitled = t('project.untitledSession');
  const labelOf = (item: ProjectSessionItem) => item.title.trim() || untitled;
  const needle = query.trim().toLowerCase();
  const listed = sessions.filter((item) => item.turns > 0 && (!needle || labelOf(item).toLowerCase().includes(needle)));
  const pinned = listed.filter((item) => item.pinned && !item.archived);
  const archived = listed.filter((item) => item.archived);
  const groups = groupSessionsByRecency(listed.filter((item) => !item.pinned && !item.archived));

  const row = (item: ProjectSessionItem) => {
    const active = item.id === currentSessionId;
    const blocked = busy && !active;
    return (
      <SessionRow
        key={item.id}
        item={item}
        label={labelOf(item)}
        active={active}
        blocked={blocked}
        running={busy && active}
        onSelect={() => { if (!active && !blocked) onSelectSession(item.id); }}
        {...actions}
      />
    );
  };
  const heading = (words: string) => <div className="px-2 pb-1.5 text-[11.5px] text-[var(--text-faint)]">{words}</div>;

  return (
    <nav aria-label={t('project.sessionHistory')} className="flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0 px-1.5 pt-1.5">
        {onNewSession ? (
          <button
            type="button"
            aria-disabled={busy || undefined}
            title={busy ? t('project.sessionBusy') : undefined}
            onClick={busy ? undefined : onNewSession}
            className={`${ROW} text-[var(--text)] ${busy ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--bg-hover)]'}`}
          >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)]">
              <Plus size={12} strokeWidth={2} />
            </span>
            <span className="truncate">{t('projectMenu.newSession')}</span>
          </button>
        ) : null}
        <label className={`${ROW} cursor-text text-[var(--text)] focus-within:bg-[var(--bg-hover)] hover:bg-[var(--bg-hover)]`}>
          <span className="flex w-[18px] shrink-0 justify-center"><Search size={14} strokeWidth={1.75} /></span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Escape') setQuery(''); }}
            placeholder={t('project.sessionSearchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text)]"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {listed.length === 0 ? (
          <div className="px-2 pt-5 text-[12px] text-[var(--text-faint)]">{t('project.sessionHistoryEmpty')}</div>
        ) : null}
        {pinned.length ? (
          <div className="pt-5">
            {heading(t('projectMenu.pinned'))}
            {pinned.map(row)}
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.key} className="pt-5">
            {heading(t(RECENCY_I18N[group.key]))}
            {group.items.map(row)}
          </div>
        ))}
        {archived.length ? (
          <div className="pt-5">
            <button
              type="button"
              aria-expanded={archivedOpen || Boolean(needle)}
              onClick={() => setArchivedOpen((open) => !open)}
              className="flex items-center gap-1 px-2 pb-1.5 text-[11.5px] text-[var(--text-faint)] transition hover:text-[var(--text-muted)]"
            >
              {t('projectMenu.archived')}
              <ChevronRight size={11} className={`transition ${archivedOpen || needle ? 'rotate-90' : ''}`} />
            </button>
            {archivedOpen || needle ? archived.map(row) : null}
          </div>
        ) : null}
      </div>
    </nav>
  );
}
