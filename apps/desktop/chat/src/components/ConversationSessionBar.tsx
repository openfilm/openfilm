'use client';

import React from 'react';
import { PanelLeft, Plus } from 'lucide-react';
import { limitTitleWidth, SESSION_TITLE_MAX_WIDTH } from '@openfilm/shared';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import {
  groupSessionsByRecency,
  type ProjectSessionItem,
  type SessionRecencyKey,
} from '@/lib/project-sessions';
import { PANE_BAR, PANE_BTN, PANE_BTN_ON, PANE_ICON, PANE_TITLE } from './dock-pane-bar';

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
 * The bar at the top of the conversation: the history's switch and the session's title on the left (none drawn
 * without one), new on the right.
 *
 * The title comes from the first message, so it appears once something has been said. Clicking it renames, no
 * separate pencil. The switch opens the history as a pane left of the conversation (SessionHistory).
 */
export function ConversationSessionBar({
  sessions,
  currentSessionId,
  onNewSession,
  onRenameSession,
  historyOpen = false,
  onToggleHistory,
  busy = false,
}: {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  /**
   * A turn is running. A project runs one conversation at a time, so new is off meanwhile; otherwise two agents
   * would edit the same film.json in the same project folder. It works again once the turn ends.
   */
  busy?: boolean;
  onNewSession?: () => void;
  onRenameSession?: (title: string) => Promise<void>;
  historyOpen?: boolean;
  onToggleHistory?: () => void;
}) {
  const t = useT();
  const current = sessions.find((item) => item.id === currentSessionId);
  const label = current?.title.trim() ?? '';
  const [renaming, setRenaming] = React.useState(false);
  const [draft, setDraft] = React.useState(label);

  React.useEffect(() => {
    setDraft(label);
    setRenaming(false);
  }, [label, currentSessionId]);

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

  return (
    <div className={PANE_BAR}>
      {/* These buttons sit at the top edge, so tooltips open downwards. */}
      {onToggleHistory ? (
        <Tooltip label={t('project.sessionHistory')} side="bottom">
          <button
            type="button"
            aria-label={t('project.sessionHistory')}
            aria-expanded={historyOpen}
            onClick={onToggleHistory}
            className={`${PANE_BTN} ${historyOpen ? PANE_BTN_ON : ''}`}
          >
            <PanelLeft size={PANE_ICON} />
          </button>
        </Tooltip>
      ) : null}
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
    </div>
  );
}

/**
 * The project's conversations, left of the one shown (the bar's switch opens it): search on top, then groups for
 * today, yesterday, the past 7 days and earlier. While a turn runs another cannot be switched to (`busy`).
 */
export function SessionHistory({
  sessions,
  currentSessionId,
  onSelectSession,
  busy = false,
}: {
  sessions: ProjectSessionItem[];
  currentSessionId: string;
  onSelectSession: (sessionId: string) => void;
  busy?: boolean;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const untitled = t('project.untitledSession');
  const labelOf = (item: ProjectSessionItem) => item.title.trim() || untitled;
  const listed = sessions.filter((item) => item.turns > 0);
  const needle = query.trim().toLowerCase();
  const groups = groupSessionsByRecency(needle ? listed.filter((item) => labelOf(item).toLowerCase().includes(needle)) : listed);

  return (
    <nav aria-label={t('project.sessionHistory')} className="flex h-full min-h-0 w-full flex-col">
      <div className={PANE_BAR}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('project.sessionSearchPlaceholder')}
          className="h-[22px] min-w-0 flex-1 bg-transparent px-1 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length === 0 ? (
          <div className="px-2.5 py-3 text-[12px] text-[var(--text-faint)]">{t('project.sessionHistoryEmpty')}</div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-medium text-[var(--text-faint)]">{t(RECENCY_I18N[group.key])}</div>
              {group.items.map((item) => {
                const active = item.id === currentSessionId;
                const blocked = busy && !active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active || undefined}
                    aria-disabled={blocked || undefined}
                    title={blocked ? t('project.sessionBusy') : undefined}
                    onClick={() => { if (!active && !blocked) onSelectSession(item.id); }}
                    className={`mx-1.5 flex w-[calc(100%-12px)] items-center rounded-md px-1.5 py-[6px] text-left text-[12.5px] leading-tight transition ${
                      active ? 'bg-[var(--bg-active)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
                    } ${blocked ? 'cursor-not-allowed opacity-50 hover:bg-transparent' : ''}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{labelOf(item)}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </nav>
  );
}
