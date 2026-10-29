'use client';

import React from 'react';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Pencil, Pin, PinOff, Plus, Search } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Popover, keepFocus } from './Popover';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { useLocalAgentTurn } from '@/lib/local-agent-run';
import { useHoverOpen } from 'openfilm/studio-ui/lib/hover-open.ts';
import { PANE_BAR, PANE_TITLE } from './dock-pane-bar';

/** What a conversation's menus do: rename, pin, archive. */
interface SessionActions {
  onRenameSession?: (id: string, title: string) => void;
  onPinSession?: (id: string, pinned: boolean) => void;
  onArchiveSession?: (id: string, archived: boolean) => void;
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
 */
function StatusLight({ turnId, unseen }: { turnId: string | null; unseen?: 'done' | 'error' }) {
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
  if (!status) return null;
  return (
    <span aria-label={words[status]} title={words[status]} className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
      <span className={`h-1.5 w-1.5 rounded-full ${LIGHT[status]}`} />
    </span>
  );
}

const LIGHT: Record<SessionStatus, string> = {
  working: 'status-breathe bg-[var(--text-muted)]',
  asking: 'bg-[#e8a23a] shadow-[0_0_0_2px_rgba(232,162,58,0.18)]',
  done: 'bg-[#3b82f6]',
  error: 'bg-[#ef4444]',
};

/**
 * The bar at the top of the conversation: the one shown, named as the project is in the top bar, with its card while
 * the pointer rests on the name (a click keeps it; openfilm/studio-ui/lib/hover-open): New Agent, what can be done to
 * this one (rename, pin, archive), and the project's conversations, searched, each with its light (StatusLight). Any
 * of them may be at work at once; the name has the light of another while one works, waits or ended unseen. A double
 * click on the name renames it. New on a conversation where nothing was said yet makes no other: a word says so.
 */
export function ConversationBar({
  sessions,
  currentSessionId,
  running,
  unseen,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onPinSession,
  onArchiveSession,
}: SessionActions & {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  /** the conversations whose turn runs now, and that turn */
  running: Map<string, string>;
  /** the conversations that stopped while another was shown, and how, until they are shown */
  unseen: Map<string, 'done' | 'error'>;
  onSelectSession: (sessionId: string) => void;
  /** false: the one shown is new already, and no other was made */
  onNewSession: () => boolean;
}) {
  const t = useT();
  const hover = useHoverOpen();
  const untitled = t('project.untitledSession');
  const current = sessions.find((s) => s.id === currentSessionId);
  const label = current?.title.trim() || untitled;
  const said = Boolean(current?.turns);
  const [renaming, setRenaming] = React.useState(false);
  React.useEffect(() => { setRenaming(false); }, [currentSessionId]);
  /* New on a new conversation: said for a moment, under it */
  const [alreadyNew, setAlreadyNew] = React.useState(false);
  React.useEffect(() => {
    if (!alreadyNew) return undefined;
    const done = setTimeout(() => setAlreadyNew(false), 1800);
    return () => clearTimeout(done);
  }, [alreadyNew]);
  /* another conversation's light on the name: one at work (or waiting) first, else one that ended unseen */
  const otherRunning = [...running].find(([id]) => id !== currentSessionId)?.[1] ?? null;
  const otherUnseen = [...unseen].find(([id]) => id !== currentSessionId)?.[1];
  const go = (run: () => void) => { hover.setOpen(false); run(); };
  const action = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:pointer-events-none disabled:opacity-40';

  return (
    <div className={PANE_BAR}>
      {renaming ? (
        <TitleInput
          initial={current?.title.trim() ?? ''}
          placeholder={untitled}
          onDone={(title) => { setRenaming(false); if (title) onRenameSession?.(currentSessionId, title); }}
          className={`${PANE_TITLE} box-border h-[22px] w-[15rem] max-w-full bg-transparent px-1.5 text-[var(--text)] outline-none`}
        />
      ) : (
        <Popover
          open={hover.open}
          onOpenChange={hover.setOpen}
          trigger={(
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={hover.open}
              {...hover.trigger}
              onDoubleClick={() => { if (onRenameSession) { hover.setOpen(false); setRenaming(true); } }}
              className={`flex h-[22px] min-w-0 max-w-[16rem] items-center gap-1.5 rounded-md px-1.5 transition hover:bg-[var(--bg-hover)] ${hover.open ? 'bg-[var(--bg-hover)]' : ''}`}
            >
              <span title={label} className={`${PANE_TITLE} ${current?.title.trim() ? '' : 'text-[var(--text-faint)]'}`}>{label}</span>
              {otherRunning || otherUnseen ? <StatusLight turnId={otherRunning} unseen={otherUnseen} /> : null}
              <ChevronDown size={13} className="shrink-0 text-[var(--text-faint)]" />
            </button>
          )}
        >
          <div {...hover.card} className="flex w-[320px] flex-col">
            <div className="p-1">
              <button type="button" onClick={() => { if (onNewSession()) hover.setOpen(false); else setAlreadyNew(true); }}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-hover)]"><Plus size={12} strokeWidth={2} /></span>
                <span className="min-w-0 flex-1 truncate">{t('projectMenu.newSession')}</span>
                {alreadyNew ? <span role="status" className="shrink-0 text-[11.5px] text-[var(--text-faint)]">{t('project.alreadyNew')}</span> : null}
              </button>
            </div>
            {said ? (
              <div className="flex flex-wrap gap-0.5 border-t border-[var(--border)] px-1.5 py-1">
                {onRenameSession ? <button type="button" className={action} onClick={() => go(() => setRenaming(true))}><Pencil size={13} />{t('projectMenu.rename')}</button> : null}
                {onPinSession ? (
                  <button type="button" className={action} onClick={() => onPinSession(currentSessionId, !current?.pinned)}>
                    {current?.pinned ? <PinOff size={13} /> : <Pin size={13} />}{t(current?.pinned ? 'projectMenu.unpin' : 'projectMenu.pin')}
                  </button>
                ) : null}
                {onArchiveSession ? (
                  <button type="button" className={action} disabled={running.has(currentSessionId) && !current?.archived}
                    onClick={() => go(() => onArchiveSession(currentSessionId, !current?.archived))}>
                    {current?.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}{t(current?.archived ? 'projectMenu.unarchive' : 'projectMenu.archive')}
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="border-t border-[var(--border)]">
              <SessionHistory
                sessions={sessions}
                currentSessionId={currentSessionId}
                running={running}
                unseen={unseen}
                onSelectSession={(id) => go(() => onSelectSession(id))}
                onRenameSession={onRenameSession}
                onPinSession={onPinSession}
                onArchiveSession={onArchiveSession}
              />
            </div>
          </div>
        </Popover>
      )}
      <span className="min-w-0 flex-1" />
    </div>
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
    <div className="flex flex-col p-1">
      <label className="flex h-8 items-center gap-2 px-2 text-[13px] text-[var(--text)]">
        <Search size={13} strokeWidth={1.75} className="shrink-0 text-[var(--text-faint)]" />
        <input
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
