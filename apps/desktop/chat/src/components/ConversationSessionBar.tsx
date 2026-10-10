'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { History, Plus } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import {
  groupSessionsByRecency,
  type ProjectSessionItem,
  type SessionRecencyKey,
} from '@/lib/project-sessions';
import { PANE_BAR, PANE_BTN, PANE_BTN_ON, PANE_ICON, PANE_TITLE } from './dock-pane-bar';
import { chatLayer } from '@/lib/chat-layer';

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

/**
 * The bar at the top of the conversation: the session's title on the left (none drawn without one), new and
 * history on the right.
 *
 * The title comes from the first message, so it appears once something has been said. Clicking it renames, no
 * separate pencil. The history popover has search on top and groups for today, yesterday, the past 7 days and
 * earlier.
 */
export function ConversationSessionBar({
  sessions,
  currentSessionId,
  onNewSession,
  onSelectSession,
  onRenameSession,
  busy = false,
}: {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  /**
   * A turn is running. A project runs one conversation at a time, so new and switch are off meanwhile; otherwise
   * two agents would edit the same film.json in the same project folder. Both work again once the turn ends.
   */
  busy?: boolean;
  onNewSession?: () => void;
  onSelectSession?: (sessionId: string) => void;
  onRenameSession?: (title: string) => Promise<void>;
}) {
  const t = useT();
  const current = sessions.find((item) => item.id === currentSessionId);
  const label = current?.title.trim() ?? '';
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(label);
  const [historyPos, setHistoryPos] = React.useState<{ x: number; y: number } | null>(null);
  const [query, setQuery] = React.useState('');
  const searchRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setDraft(label);
    setRenaming(false);
  }, [label, currentSessionId]);

  React.useEffect(() => {
    if (!historyPos) return;
    const close = () => setHistoryPos(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryPos(null);
    };
    const onScroll = (event: Event) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    const focus = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focus);
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [historyPos]);

  React.useEffect(() => {
    if (!historyPos) setQuery('');
  }, [historyPos]);

  /* A turn started while history is open: close it, none of its rows can be picked now. */
  React.useEffect(() => {
    if (busy) setHistoryPos(null);
  }, [busy]);

  const titleBoxRef = React.useRef<HTMLButtonElement | null>(null);
  const [titleEditWidth, setTitleEditWidth] = React.useState<number | null>(null);

  function startRename() {
    if (!onRenameSession || !label) return;
    const width = titleBoxRef.current?.getBoundingClientRect().width;
    setTitleEditWidth(width && width > 0 ? width : null);
    setDraft(label);
    setRenaming(true);
  }

  async function commitRename() {
    if (!onRenameSession) {
      setRenaming(false);
      return;
    }
    const clean = draft.replace(/\s+/g, ' ').trim();
    setRenaming(false);
    if (!clean || clean === label) {
      setDraft(label);
      return;
    }
    await onRenameSession(clean);
  }

  const listed = sessions.filter((item) => item.turns > 0);
  const untitled = t('project.untitledSession');
  const labelOf = (item: ProjectSessionItem) => item.title.trim() || untitled;
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? listed.filter((item) => labelOf(item).toLowerCase().includes(needle))
    : listed;
  const groups = groupSessionsByRecency(visible);

  return (
    <div className={PANE_BAR}>
      {label ? (
        renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => {
              const next = event.target.value;
              if ((event.nativeEvent as InputEvent).isComposing) {
                setDraft(next);
                return;
              }
              setDraft(limitTitleWidth(next, SESSION_TITLE_MAX_WIDTH));
            }}
            onCompositionEnd={(event) => {
              setDraft(limitTitleWidth(event.currentTarget.value, SESSION_TITLE_MAX_WIDTH));
            }}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void commitRename();
              if (event.key === 'Escape') {
                setDraft(label);
                setRenaming(false);
              }
            }}
            style={titleEditWidth ? { width: titleEditWidth } : undefined}
            className={`${TITLE_MAX} ${PANE_TITLE} box-border h-[22px] max-w-[min(15rem,calc(100%-52px))] bg-transparent px-1 outline-none`}
          />
        ) : onRenameSession ? (
          <Tooltip label={t('projectMenu.rename')} side="bottom">
            <button
              ref={titleBoxRef}
              type="button"
              onClick={startRename}
              className={`${TITLE_MAX} flex h-[22px] w-fit min-w-0 items-center rounded-md px-1 text-left transition hover:bg-[var(--bg-hover)]`}
            >
              <span title={label} className={PANE_TITLE}>
                {label}
              </span>
            </button>
          </Tooltip>
        ) : (
          <span
            title={label}
            className={`${TITLE_MAX} ${PANE_TITLE} px-1`}
          >
            {label}
          </span>
        )
      ) : null}
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-1">
        {/* These buttons sit at the top edge, so tooltips open downwards. */}
        {onNewSession ? (
          <Tooltip label={busy ? t('project.sessionBusy') : t('projectMenu.newSession')} side="bottom">
            <button
              type="button"
              aria-label={t('projectMenu.newSession')}
              aria-disabled={busy || undefined}
              onClick={busy ? undefined : onNewSession}
              className={`${PANE_BTN} ${busy ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <Plus size={PANE_ICON} />
            </button>
          </Tooltip>
        ) : null}
        {onSelectSession ? (
          <Tooltip label={busy ? t('project.sessionBusy') : t('project.sessionHistory')} side="bottom">
            <button
              type="button"
              aria-label={t('project.sessionHistory')}
              aria-expanded={historyPos != null}
              aria-disabled={busy || undefined}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (busy) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setHistoryPos((cur) => (cur ? null : { x: rect.right, y: rect.bottom + 4 }));
              }}
              className={`${PANE_BTN} ${historyPos ? PANE_BTN_ON : ''} ${busy ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <History size={PANE_ICON} />
            </button>
          </Tooltip>
        ) : null}
      </div>

      {historyPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed z-[110] w-[216px] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
            style={{
              right: Math.max(window.innerWidth - historyPos.x, 12),
              top: historyPos.y,
              animation: 'openfilm-rise 0.14s ease-out both',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-2 pt-1">
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('project.sessionSearchPlaceholder')}
                className="h-5 w-full bg-transparent text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
              />
            </div>
            <div className="max-h-[min(320px,50vh)] overflow-y-auto pb-1">
              {groups.length === 0 ? (
                <div className="px-2 py-5 text-left text-[11px] text-[var(--text-faint)]">
                  {t('project.sessionHistoryEmpty')}
                </div>
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <div className="px-2 pb-0.5 pt-1 text-left text-[10px] font-medium text-[var(--text-faint)]">
                      {t(RECENCY_I18N[group.key])}
                    </div>
                    {group.items.map((item) => {
                      const active = item.id === currentSessionId;
                      const name = labelOf(item);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setHistoryPos(null);
                            if (!active) onSelectSession?.(item.id);
                          }}
                          className={`mx-1 flex w-[calc(100%-8px)] items-center rounded-md px-1 py-[5px] text-left text-[12px] leading-tight transition hover:bg-[var(--bg-hover)] ${
                            active ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)]'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>,
          chatLayer(),
        )}
    </div>
  );
}
