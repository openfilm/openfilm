'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, ChevronRight, Clock, MessageSquare, Pencil, Pin, PinOff, Plus, Search, X } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Popover, keepFocus } from './Popover';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { useLocalAgentTurn } from '@/lib/local-agent-run';
import { chatLayer } from '@/lib/chat-layer';
import { useChatMenu } from '@/lib/chat-menu';
import { PANE_BTN, PANE_ICON } from './dock-pane-bar';

/** What a conversation's menus do: rename, pin, archive. */
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
function TitleInput({ initial, width, placeholder, className, onDone }: {
  initial: string; width?: number | null; placeholder?: string; className: string; onDone: (title: string | null) => void;
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
      placeholder={placeholder}
      style={width ? { width } : undefined}
      className={className}
    />
  );
}

/** How a conversation stands, as a dot beside its title, unless it is at rest and seen. */
export type SessionStatus = 'working' | 'asking' | 'done' | 'error';

/**
 * A conversation's light, as a chat app's sessions have one: breathing while its agent works, amber while it waits
 * for an answer, and once it has stopped where nobody was looking, blue (done) or red (failed) until it is shown.
 * In a tab it stands where its bubble is (`bubble`), which shows while it is dark.
 */
function StatusLight({ turnId, unseen, bubble = false }: { turnId: string | null; unseen?: 'done' | 'error'; bubble?: boolean }) {
  const t = useT();
  const live = useLocalAgentTurn(turnId);
  const status: SessionStatus | null = turnId
    ? (live && (live.state.question || live.state.permission) ? 'asking' : 'working')
    : unseen ?? null;
  const words: Record<SessionStatus, string> = {
    working: t('projectMenu.running'),
    asking: t('projectMenu.asking'),
    done: t('projectMenu.done'),
    error: t('projectMenu.failed'),
  };
  if (!status) return bubble ? <MessageSquare size={13} strokeWidth={1.75} className="shrink-0" /> : null;
  return (
    <span aria-label={words[status]} title={words[status]} className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
      <span className={`h-1.5 w-1.5 rounded-full ${LIGHT[status]}`} />
    </span>
  );
}

/** what a tab dragged carries (its conversation's id): nothing else takes it */
const TAB_DRAG = 'application/x-openfilm-chat-tab';

const LIGHT: Record<SessionStatus, string> = {
  working: 'status-breathe bg-[var(--text-muted)]',
  asking: 'bg-[#e8a23a] shadow-[0_0_0_2px_rgba(232,162,58,0.18)]',
  done: 'bg-[#3b82f6]',
  error: 'bg-[#ef4444]',
};

/**
 * The bar at the top of the conversation, as a code editor's agents: the open conversations as tabs, each its own
 * agent at work at once; on the right a new one and the history (search, all of them, those archived).
 *
 * A tab's title comes from its first message ("Untitled chat" until then). A right click opens its menu (rename, pin,
 * archive, close, close the others), a double click renames it in its own width, a middle click closes it. Closing a
 * tab leaves its conversation in the history, and its turn running. A tab is dragged to another place among them. Left
 * of each title its bubble, or its light while it has one (StatusLight). New on a conversation where nothing was said
 * yet makes no other: a word says so, for a moment.
 */
export function ConversationTabs({
  sessions,
  tabs,
  currentSessionId,
  running,
  unseen,
  onSelectSession,
  onNewSession,
  onCloseTab,
  onCloseOtherTabs,
  onMoveTab,
  onRenameSession,
  onPinSession,
  onArchiveSession,
}: SessionActions & {
  sessions: ProjectSessionItem[];
  /** the open conversations, in their order */
  tabs: string[];
  currentSessionId: string;
  /** the conversations whose turn runs now, and that turn */
  running: Map<string, string>;
  /** the conversations that stopped while another was shown, and how, until they are shown */
  unseen: Map<string, 'done' | 'error'>;
  /** shows it, as a tab (opened if it was not) */
  onSelectSession: (sessionId: string) => void;
  /** false: the one shown is new already, and no other was made */
  onNewSession: () => boolean;
  onCloseTab: (sessionId: string) => void;
  onCloseOtherTabs: (sessionId: string) => void;
  /** a tab dragged to where another one is */
  onMoveTab: (sessionId: string, to: number) => void;
}) {
  const t = useT();
  const untitled = t('project.untitledSession');
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const labelOf = (id: string) => byId.get(id)?.title.trim() || untitled;
  /* renamed in place, the tab keeping the width it had */
  const [renaming, setRenaming] = React.useState<{ id: string; width: number } | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  /* New on a new conversation: said for a moment, under the button */
  const [alreadyNew, setAlreadyNew] = React.useState(false);
  React.useEffect(() => {
    if (!alreadyNew) return undefined;
    const done = setTimeout(() => setAlreadyNew(false), 1800);
    return () => clearTimeout(done);
  }, [alreadyNew]);
  /** the tab being dragged */
  const dragged = React.useRef<string | null>(null);
  /** a tab's menu, where it was right-clicked */
  const [menu, setMenu] = React.useState<{ id: string; x: number; y: number } | null>(null);

  /* the tab shown kept in sight in a row of many */
  const stripRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentSessionId, tabs.length]);

  const startRename = (id: string) => {
    if (!onRenameSession) return;
    const tab = stripRef.current?.querySelector<HTMLElement>(`[data-session="${CSS.escape(id)}"]`);
    setRenaming({ id, width: tab?.getBoundingClientRect().width ?? 0 });
  };
  const entriesFor = (id: string): MenuEntry[] => {
    const item = byId.get(id);
    const said = Boolean(item?.turns);
    return [
      ...(onRenameSession ? [{ id: 'rename', label: t('projectMenu.rename'), hint: 'R', onSelect: () => startRename(id) }] : []),
      ...(onPinSession ? [{ id: 'pin', label: t(item?.pinned ? 'projectMenu.unpin' : 'projectMenu.pin'), hint: 'P', disabled: !said, onSelect: () => onPinSession(id, !item?.pinned) }] : []),
      ...(onArchiveSession ? [{ id: 'archive', label: t(item?.archived ? 'projectMenu.unarchive' : 'projectMenu.archive'), hint: 'A', disabled: !said || (running.has(id) && !item?.archived), onSelect: () => onArchiveSession(id, !item?.archived) }] : []),
      'separator',
      { id: 'close', label: t('projectMenu.closeTab'), onSelect: () => onCloseTab(id) },
      { id: 'close-others', label: t('projectMenu.closeOtherTabs'), disabled: tabs.length < 2, onSelect: () => onCloseOtherTabs(id) },
    ];
  };

  return (
    <div className="relative flex h-8 shrink-0 items-stretch bg-[var(--dock-shell)]">
      {/* the line under the bar, which the tab shown stands over */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--dock-line)]" />
      {/* the tabs keep their width; more than fit scroll sideways, by the wheel too */}
      <div ref={stripRef} role="tablist"
        onWheel={(event) => { if (!event.deltaX && event.deltaY) event.currentTarget.scrollLeft += event.deltaY; }}
        className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((id) => {
          const shown = id === currentSessionId;
          const label = labelOf(id);
          return (
            <div
              key={id}
              role="tab"
              data-session={id}
              aria-selected={shown}
              title={label}
              onClick={() => { if (!shown) onSelectSession(id); }}
              onDoubleClick={() => startRename(id)}
              onAuxClick={(event) => { if (event.button === 1) onCloseTab(id); }}
              onContextMenu={(event) => { event.preventDefault(); setMenu({ id, x: event.clientX, y: event.clientY }); }}
              draggable={renaming?.id !== id}
              onDragStart={(event) => {
                dragged.current = id;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(TAB_DRAG, id);
              }}
              onDragOver={(event) => {
                const from = dragged.current;
                if (!from) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                if (from !== id) onMoveTab(from, tabs.indexOf(id));
              }}
              onDrop={(event) => event.preventDefault()}
              onDragEnd={() => { dragged.current = null; }}
              style={renaming?.id === id && renaming.width ? { width: renaming.width, minWidth: renaming.width, maxWidth: renaming.width } : undefined}
              className={`group relative flex max-w-[200px] shrink-0 cursor-default items-center gap-1.5 border-r border-[var(--dock-line)] pl-2.5 pr-1 text-[12px] transition ${
                shown ? 'z-[1] bg-[var(--dock-pane)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'
              }`}
            >
              <StatusLight turnId={running.get(id) ?? null} unseen={unseen.get(id)} bubble />
              {renaming?.id === id ? (
                <TitleInput
                  initial={byId.get(id)?.title.trim() ?? ''}
                  placeholder={untitled}
                  onDone={(title) => { setRenaming(null); if (title) onRenameSession?.(id, title); }}
                  className="h-[22px] w-0 min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{label}</span>
              )}
              <button
                type="button"
                aria-label={t('projectMenu.closeTab')}
                onClick={(event) => { event.stopPropagation(); onCloseTab(id); }}
                onDoubleClick={(event) => event.stopPropagation()}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${shown ? '' : 'invisible group-hover:visible'}`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 px-1.5">
        <Tooltip label={t('projectMenu.newSession')} side="bottom">
          <button type="button" aria-label={t('projectMenu.newSession')} onClick={() => { if (!onNewSession()) setAlreadyNew(true); }} className={PANE_BTN}>
            <Plus size={PANE_ICON} strokeWidth={1.75} />
          </button>
        </Tooltip>
        <Popover
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          align="end"
          trigger={(
            <button type="button" aria-label={t('project.sessionHistory')} aria-haspopup="dialog" aria-expanded={historyOpen}
              className={`${PANE_BTN} ${historyOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}>
              <Clock size={PANE_ICON} strokeWidth={1.75} />
            </button>
          )}
        >
          <SessionHistory
            sessions={sessions}
            currentSessionId={currentSessionId}
            running={running}
            unseen={unseen}
            onSelectSession={(id) => { setHistoryOpen(false); onSelectSession(id); }}
            onRenameSession={onRenameSession}
            onPinSession={onPinSession}
            onArchiveSession={onArchiveSession}
          />
        </Popover>
      </div>
      {alreadyNew ? (
        <div role="status" className="pointer-events-none absolute right-1.5 top-[calc(100%+6px)] z-20 whitespace-nowrap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text-muted)] shadow-[0_4px_14px_rgba(0,0,0,0.18)]">
          {t('project.alreadyNew')}
        </div>
      ) : null}
      {menu ? <TabMenu at={menu} entries={entriesFor(menu.id)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

/** A tab's menu, where it was right-clicked: closed by a click elsewhere, Esc, or the window losing focus. */
function TabMenu({ at, entries, onClose }: { at: { x: number; y: number }; entries: MenuEntry[]; onClose: () => void }) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  useChatMenu(true);
  const latest = React.useRef(onClose);
  latest.current = onClose;
  React.useEffect(() => {
    const close = (event: Event) => {
      if (event.type === 'pointerdown' && panelRef.current?.contains(event.target as Node)) return;
      latest.current();
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') latest.current(); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return createPortal(
    <div
      ref={panelRef}
      data-popover-panel="true"
      style={{
        position: 'fixed',
        left: Math.max(6, Math.min(at.x, window.innerWidth - 200)),
        top: at.y + 2,
        zIndex: 10000,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: 16,
        boxShadow: '0 16px 40px -8px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.18)',
      }}
    >
      <SessionMenu entries={entries} onClose={onClose} />
    </div>,
    chatLayer(),
  );
}

/** A conversation's own buttons in the history, on hover: pin, rename, archive. */
const ROW_BTN = 'flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40';

/** One conversation in the history: its title, a running one turning; on hover its buttons. */
function SessionRow({ item, label, active, turnId, unseen, onSelect, onRenameSession, onPinSession, onArchiveSession }: SessionActions & {
  item: ProjectSessionItem; label: string; active: boolean; turnId: string | null; unseen?: 'done' | 'error'; onSelect: () => void;
}) {
  const running = Boolean(turnId);
  const t = useT();
  const [renaming, setRenaming] = React.useState(false);
  return (
    <div className={`group flex h-8 min-w-0 items-center rounded-lg transition ${
      active || renaming ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
    }`}>
      {renaming ? (
        <TitleInput
          initial={item.title.trim()}
          onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(item.id, title); }}
          className="mx-2 h-full min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none"
        />
      ) : (
        <button type="button" aria-current={active || undefined} title={label} onClick={onSelect}
          className="flex h-full min-w-0 flex-1 items-center pl-2 text-left text-[13px]">
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </button>
      )}
      {turnId || unseen ? (
        <span className="mr-2 flex shrink-0 group-hover:hidden"><StatusLight turnId={turnId} unseen={unseen} /></span>
      ) : null}
      {renaming ? null : (
        <div className="mr-1 hidden shrink-0 items-center group-hover:flex">
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
 * The project's conversations, from the bar's clock: a search on top, then each that said something, pinned first, then
 * the latest; those archived folded at the foot (opened by the search too). Picking one shows it, as a tab.
 */
function SessionHistory({
  sessions,
  currentSessionId,
  running,
  unseen,
  onSelectSession,
  ...actions
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  running: Map<string, string>;
  unseen: Map<string, 'done' | 'error'>;
  onSelectSession: (sessionId: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [archivedOpen, setArchivedOpen] = React.useState(false);
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
      turnId={running.get(item.id) ?? null} unseen={unseen.get(item.id)} onSelect={() => onSelectSession(item.id)} {...actions} />
  );

  return (
    <div className="flex w-[300px] flex-col p-1">
      <label className="flex h-8 items-center gap-2 px-2 text-[13px] text-[var(--text)]">
        <Search size={13} strokeWidth={1.75} className="shrink-0 text-[var(--text-faint)]" />
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('project.sessionSearchPlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </label>
      <div className="max-h-[360px] overflow-y-auto">
        {live.length ? live.map(row) : (
          <div className="flex h-8 items-center justify-center text-[12.5px] text-[var(--text-faint)]">{t('project.sessionHistoryEmpty')}</div>
        )}
        {archived.length ? (
          <>
            <button type="button" aria-expanded={showArchived} onClick={() => setArchivedOpen((open) => !open)}
              className="flex h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <ChevronRight size={13} className={`shrink-0 transition ${showArchived ? 'rotate-90' : ''}`} />
              {t('projectMenu.archived')}
            </button>
            {showArchived ? archived.map(row) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
