'use client';

import React from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, MessageCircle, Pencil, Pin, PinOff, Plus, Search } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Popover, keepFocus } from './Popover';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { PANE_BAR, PANE_TITLE } from './dock-pane-bar';
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
  initial: string; placeholder?: string; className: string; onDone: (title: string | null) => void;
}) {
  const t = useT();
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
          finish(event.key === 'Enter' ? draft : null);
        }
      }}
      placeholder={placeholder}
      className={className}
    />
  );
}

/** The current conversation's title opens the new-chat action and searchable history. */
export function ConversationBar({
  sessions, currentSessionId, running,
  onSelectSession, onNewSession, onRenameSession, onPinSession, onArchiveSession,
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  running: ReadonlySet<string>;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => boolean;
}) {
  const t = useT();
  const popup = useClickOpen();
  const untitled = t('project.untitledSession');
  const name = sessions.find((session) => session.id === currentSessionId)?.title.trim();
  const label = name || untitled;
  const [renaming, setRenaming] = React.useState(false);
  React.useEffect(() => { setRenaming(false); popup.dismiss(); }, [currentSessionId, popup.dismiss]);
  const [alreadyNew, setAlreadyNew] = React.useState(false);
  React.useEffect(() => {
    if (!alreadyNew) return;
    const timer = setTimeout(() => setAlreadyNew(false), 1800);
    return () => clearTimeout(timer);
  }, [alreadyNew]);
  const go = (action: () => void) => { popup.dismiss(); action(); };

  return (
    <div className={PANE_BAR} data-conversation-bar="">
      <div data-conversation-title={currentSessionId} className="relative inline-flex min-w-0 max-w-full">
        <Popover open={popup.open && !renaming} onOpenChange={(open) => { if (open) popup.setOpen(true); else popup.dismiss(); }} bare
          trigger={(
            <button type="button" aria-haspopup="dialog" aria-expanded={popup.open && !renaming}
              aria-hidden={renaming || undefined} tabIndex={renaming ? -1 : undefined} title={label}
              onClick={(event) => { event.stopPropagation(); popup.toggle(); }}
              onDoubleClick={() => { if (onRenameSession) { popup.dismiss(); setRenaming(true); } }}
              className={`flex h-[22px] min-w-0 max-w-[16rem] items-center gap-1.5 rounded px-1.5 outline-none transition-colors hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] ${renaming ? 'invisible' : ''}`}>
              <span className={`${PANE_TITLE} ${name ? '' : 'text-[var(--text-faint)]'}`}>{label}</span>
              <ChevronDown size={12} className="shrink-0 text-[var(--text-faint)]" aria-hidden />
            </button>
          )}>
          <div data-conversation-menu role="dialog" aria-label={t('project.sessionHistory')} className={`${menu.menu} ${menu.chatMenu}`}>
            <SessionHistory sessions={sessions} currentSessionId={currentSessionId} running={running}
              onSelectSession={(id) => go(() => onSelectSession(id))}
              onRenameSession={onRenameSession} onPinSession={onPinSession} onArchiveSession={onArchiveSession}>
              <button type="button" className={menu.newButton}
                onClick={() => { if (onNewSession()) popup.dismiss(); else setAlreadyNew(true); }}>
                <Plus size={13} strokeWidth={2} aria-hidden /><span>{t('projectMenu.newSession')}</span>
              </button>
              {alreadyNew ? <div role="status" className={menu.notice}>{t('project.alreadyNew')}</div> : null}
            </SessionHistory>
          </div>
        </Popover>
        {renaming ? (
          <TitleInput initial={name ?? ''} placeholder={untitled}
            onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(currentSessionId, title); }}
            className={`${PANE_TITLE} absolute inset-0 box-border h-[22px] w-full bg-transparent py-0 pl-1.5 pr-6 leading-[18px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]`} />
        ) : null}
      </div>
    </div>
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
