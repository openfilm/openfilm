'use client';

import React from 'react';
import { Archive, ArchiveRestore, History, ChevronRight, FolderOpen, MessageCircle, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, SquarePen } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Popover, keepFocus } from './Popover';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { useClickOpen } from 'openfilm/studio-ui/lib/click-open.ts';
import menu from 'openfilm/studio-ui/components/WorkspaceMenu.module.css';

/** What a conversation's menus do: rename, pin, archive. */
interface SessionActions {
  onRenameSession?: (id: string, title: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
}

/** A title being renamed, in place: Enter or leaving keeps it, Esc lets it go (`onDone(null)`). */
function TitleInput({ initial, placeholder, className, onDone }: {
  initial: string; placeholder?: string; className: string; onDone: (title: string | null, restoreFocus?: boolean) => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState(initial);
  const done = React.useRef(false);
  const finish = (title: string | null, restoreFocus = false) => {
    if (done.current) return;
    done.current = true;
    const clean = title?.replace(/\s+/g, ' ').trim();
    onDone(clean && clean !== initial ? clean : null, restoreFocus);
  };
  return (
    <input
      autoFocus
      aria-label={t('projectMenu.rename')}
      value={draft}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => {
        const next = event.target.value;
        setDraft((event.nativeEvent as InputEvent).isComposing ? next : limitTitleWidth(next, SESSION_TITLE_MAX_WIDTH));
      }}
      onCompositionEnd={(event) => setDraft(limitTitleWidth(event.currentTarget.value, SESSION_TITLE_MAX_WIDTH))}
      onBlur={() => finish(draft)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          finish(event.key === 'Enter' ? draft : null, true);
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

const TITLE_TEXT = 'min-w-0 truncate text-[13px] font-medium';

/** The conversation's title, at the left of its title bar, renamed in place; its menu (…) at the right. */
export function ConversationTitle({ sessionId, title, pinned, running, onRename, onPin, onArchive, onNew, onReveal }: {
  sessionId: string; title: string; pinned: boolean; running: boolean;
  onRename: (id: string, next: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onArchive?: (id: string, archived: boolean) => void;
  /** a new conversation in its place */
  onNew?: () => void;
  /** the folder its record is kept in, shown in the file manager */
  onReveal?: () => void;
}) {
  const t = useT();
  const [editing, setEditing] = React.useState(false);
  const button = React.useRef<HTMLButtonElement>(null);
  const more = useClickOpen();
  const moreButton = React.useRef<HTMLButtonElement>(null);
  const menuId = React.useId();
  const placeholder = t('project.untitledSession');
  const act = (fn: () => void) => () => { more.dismiss(); fn(); };
  return (
    <div data-conversation-bar data-studio-host-panel className="flex min-w-0 flex-1 items-center gap-2">
      <div data-conversation-title={sessionId} className="relative inline-flex min-w-0 max-w-full">
        <button ref={button} type="button" aria-keyshortcuts="Enter F2" title={t('projectMenu.rename')}
          aria-hidden={editing || undefined} tabIndex={editing ? -1 : undefined}
          onClick={() => setEditing(true)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'F2') {
              event.preventDefault(); event.stopPropagation(); setEditing(true);
            }
          }}
          className={`flex h-[26px] min-w-0 max-w-full items-center rounded-md px-2 text-[var(--text)] outline-none hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${editing ? 'invisible' : ''}`}>
          <span className={TITLE_TEXT}>{title || placeholder}</span>
        </button>
        {editing && <TitleInput initial={title} placeholder={placeholder}
          onDone={(next, restoreFocus) => {
            setEditing(false);
            if (next) onRename(sessionId, next);
            if (restoreFocus) requestAnimationFrame(() => button.current?.focus());
          }}
          className={`${TITLE_TEXT} absolute inset-0 box-border h-[26px] w-full min-w-[160px] bg-transparent px-2 text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]`} />}
      </div>
      <div className="ml-auto flex shrink-0">
        <Popover bare align="end" open={more.open} onOpenChange={more.setOpen} trigger={
          <button ref={moreButton} type="button" data-conversation-more aria-haspopup="menu" aria-expanded={more.open}
            aria-controls={more.open ? menuId : undefined} aria-label={t('projectMenu.more')} title={t('projectMenu.more')}
            className="grid h-[26px] w-[26px] place-items-center rounded-md text-[var(--text-muted)] outline-none hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]">
            <MoreHorizontal size={16} aria-hidden />
          </button>}>
          {/* what is done with this conversation: a new one, its name, its place in the list, its files, put away */}
          <div id={menuId} role="menu" aria-label={t('projectMenu.more')} className={`${menu.menu} ${menu.chatMenu}`}
            onKeyDown={event => {
              if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
                event.preventDefault(); event.stopPropagation(); more.dismiss(); moreButton.current?.focus();
              }
            }}>
            {onNew && <button type="button" role="menuitem" className={menu.chatRow} data-conversation-new onClick={act(onNew)}>
              <SquarePen size={16} aria-hidden /><span>{t('projectMenu.newSession')}</span>
            </button>}
            <button type="button" role="menuitem" className={menu.chatRow} onClick={act(() => setEditing(true))}>
              <Pencil size={16} aria-hidden /><span>{t('projectMenu.rename')}</span>
            </button>
            {onPin && <button type="button" role="menuitem" className={menu.chatRow} onClick={act(() => onPin(sessionId, !pinned))}>
              {pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
              <span>{t(pinned ? 'projectMenu.unpin' : 'projectMenu.pin')}</span>
            </button>}
            {onReveal && <>
              <div role="separator" className={menu.chatSeparator} />
              <button type="button" role="menuitem" className={menu.chatRow} onClick={act(onReveal)}>
                <FolderOpen size={16} aria-hidden /><span>{t('projectMenu.revealChat')}</span>
              </button>
            </>}
            {onArchive && <>
              <div role="separator" className={menu.chatSeparator} />
              <button type="button" role="menuitem" className={menu.chatRow} disabled={running} title={running ? t('projectMenu.archiveBusy') : undefined}
                onClick={act(() => onArchive(sessionId, true))}>
                <Archive size={16} aria-hidden /><span>{t('projectMenu.archive')}</span>
              </button>
            </>}
          </div>
        </Popover>
      </div>
    </div>
  );
}

export function ConversationManager({
  sessions, currentSessionId, running, dismissSidebar,
  onSelectSession, onNewSession, onRenameSession, onPinSession, onArchiveSession,
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  running: ReadonlySet<string>;
  dismissSidebar: () => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => boolean;
}) {
  const t = useT();
  const popup = useClickOpen();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const panel = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const [alreadyNew, setAlreadyNew] = React.useState(false);
  React.useEffect(() => {
    if (!alreadyNew) return;
    const timer = setTimeout(() => setAlreadyNew(false), 1800);
    return () => clearTimeout(timer);
  }, [alreadyNew]);
  return (
    <Popover bare placement="auto" open={popup.open} onOpenChange={popup.setOpen} trigger={
      <button ref={trigger} data-navigation-manage-chats type="button" aria-haspopup="dialog" aria-expanded={popup.open}
        aria-controls={popup.open ? id : undefined} aria-label={t('projectMenu.manageSessions')} title={t('projectMenu.manageSessions')}
        onClick={event => {
          if (event.detail === 0 && !popup.open) requestAnimationFrame(() => panel.current?.querySelector('input')?.focus());
        }}
        className="grid h-6 w-[22px] place-items-center rounded-[5px] text-[var(--text-muted)] hover:bg-[var(--bg-pressed)] hover:text-[var(--text)]">
        <History size={14} aria-hidden />
      </button>}>
      <div ref={panel} id={id} data-conversation-menu role="dialog" aria-label={t('project.sessionHistory')}
        className={`${menu.menu} ${menu.chatMenu}`}
        onKeyDown={event => {
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); popup.dismiss(); trigger.current?.focus();
          }
        }}>
        <SessionHistory sessions={sessions} currentSessionId={currentSessionId} running={running}
          onSelectSession={session => { dismissSidebar(); onSelectSession(session); }}
          onRenameSession={onRenameSession} onPinSession={onPinSession} onArchiveSession={onArchiveSession}>
          <button type="button" className={menu.newButton}
            onClick={() => { if (onNewSession()) dismissSidebar(); else setAlreadyNew(true); }}>
            <Plus size={13} strokeWidth={2} aria-hidden /><span>{t('projectMenu.newSession')}</span>
          </button>
          {alreadyNew ? <div role="status" className={menu.notice}>{t('project.alreadyNew')}</div> : null}
        </SessionHistory>
      </div>
    </Popover>
  );
}

const ROW_BTN = menu.iconButton;

function SessionRow({ item, label, active, running, onSelect, onRenameSession, onPinSession, onArchiveSession }: SessionActions & {
  item: ProjectSessionItem; label: string; active: boolean; running: boolean; onSelect: () => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = React.useState(false);
  const icon = item.pinned ? <Pin size={13} className={menu.rowIcon} /> : <MessageCircle size={13} className={menu.rowIcon} />;
  return (
    <div className={`group ${menu.row} ${active ? menu.active : ''} ${renaming ? menu.editing : ''}`}>
      {renaming ? (
        <>{icon}<TitleInput
          initial={item.title.trim()}
          onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(item.id, title); }}
          className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none"
        /></>
      ) : (
        <button type="button" aria-current={active || undefined} onClick={onSelect}
          className={menu.primary}>
          {icon}<span className={menu.rowName}>{label}</span>
        </button>
      )}
      {renaming ? null : (
        <div className={menu.rowActions}>
          {onPinSession && !item.archived ? (
            <Tooltip label={t(item.pinned ? 'projectMenu.unpin' : 'projectMenu.pin')} side="bottom">
              <button type="button" aria-label={t(item.pinned ? 'projectMenu.unpin' : 'projectMenu.pin')} onMouseDown={keepFocus}
                onClick={() => onPinSession(item.id, !item.pinned)} className={ROW_BTN}>
                {item.pinned ? <PinOff size={13} /> : <Pin size={13} />}
              </button>
            </Tooltip>
          ) : null}
          {onRenameSession ? (
            <Tooltip label={t('projectMenu.rename')} side="bottom">
              <button type="button" aria-label={t('projectMenu.rename')} onClick={() => setRenaming(true)} className={ROW_BTN}>
                <Pencil size={13} />
              </button>
            </Tooltip>
          ) : null}
          {onArchiveSession ? (
            <Tooltip label={t(item.archived ? 'projectMenu.unarchive' : 'projectMenu.archive')} side="bottom">
              <button type="button" aria-label={t(item.archived ? 'projectMenu.unarchive' : 'projectMenu.archive')} onMouseDown={keepFocus}
                disabled={running && !item.archived} onClick={() => onArchiveSession(item.id, !item.archived)} className={ROW_BTN}>
                {item.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
              </button>
            </Tooltip>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The project's conversations: search, then each that said something, pinned first, then
 * the latest; those archived folded at the foot (opened by the search too).
 */
function SessionHistory({
  sessions,
  currentSessionId,
  running,
  onSelectSession,
  children,
  ...actions
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  running: ReadonlySet<string>;
  onSelectSession: (sessionId: string) => void;
  children?: React.ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  /* folded, unless the conversation shown is one of them */
  const [archivedOpen, setArchivedOpen] = React.useState(() => Boolean(sessions.find((s) => s.id === currentSessionId)?.archived));
  const untitled = t('project.untitledSession');
  const labelOf = (item: ProjectSessionItem) => item.title.trim() || untitled;
  const needle = query.trim().toLowerCase();
  const at = (s: ProjectSessionItem) => Date.parse(s.updatedAt || s.createdAt) || 0;
  const listed = sessions
    .filter((item) => item.turns > 0 && (!needle || labelOf(item).toLowerCase().includes(needle)))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || at(b) - at(a));
  const live = listed.filter((item) => !item.archived);
  const archived = listed.filter((item) => item.archived);
  const showArchived = archivedOpen || Boolean(needle);

  const row = (item: ProjectSessionItem) => (
    <SessionRow key={item.id} item={item} label={labelOf(item)} active={item.id === currentSessionId}
      running={running.has(item.id)} onSelect={() => onSelectSession(item.id)} {...actions} />
  );

  return (
    <div className="flex min-h-0 flex-col">
      <div className={menu.chatTop}>
        {children}
        <label className={menu.search}>
          <Search size={13} strokeWidth={1.75} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('project.sessionSearchPlaceholder')}
            aria-label={t('project.sessionSearchPlaceholder')}
          />
        </label>
      </div>
      <div className={menu.history}>
        {live.map(row)}
        {!listed.length ? <div className={menu.empty}><MessageCircle size={20} strokeWidth={1.5} /><span>{t(needle ? 'project.sessionHistoryEmpty' : 'project.sessionHistoryNoChats')}</span></div> : null}
        {archived.length ? (
          <>
            <button type="button" aria-expanded={showArchived} onClick={() => setArchivedOpen((open) => !open)}
              className={`${menu.row} ${menu.archivedToggle}`}>
              <ChevronRight size={13} className={`shrink-0 transition ${showArchived ? 'rotate-90' : ''}`} />
              <span className={menu.rowName}>{t('projectMenu.archived')}</span><span className="text-[11px] text-[var(--text-faint)]">{archived.length}</span>
            </button>
            {showArchived ? archived.map(row) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
