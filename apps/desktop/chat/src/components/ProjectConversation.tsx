'use client';

import React from 'react';
import type { PublicProgressSnapshot, TurnAttachment } from '@openfilm/shared';
import { Check, ChevronRight, Copy, Play } from 'lucide-react';
import { AgentActivityList, formatWorkDuration, StatusLine, type AgentActivityItem } from './AgentActivityRow';
import { AgentIcon, hasAgentIcon } from './AgentIcons';
import { BrandLogo } from './BrandLogo';
import { StickToBottomContext } from './useStickToBottom';
import { answerStart, countedSteps } from '@/lib/agent-activity-runs';
import { useTurnChanges, type SceneChange, type TurnChanges } from '@/lib/turn-changes';
import {
  preferTranscript,
  toTraceLogItems,
  transcriptFromSnapshot,
  type TranscriptItem,
} from '@/lib/agent-transcript';
import type { ProjectVersion } from './project-version';
import { PromptWithPills } from './prompt-editor';
import {
  AttachmentPreview,
  AttachmentTypeIcon,
  type AttachmentPreviewItem,
} from './AttachmentPreview';
import { useT, useUiLocale } from '@/i18n';
import { relativeTime, useMinuteTick } from '@/lib/relative-time';
import { isPendingAssetId } from '@/lib/asset-lists';
import { TurnLogButton } from './TurnLog';
import { FilmChangesList } from './FilmChangesList';
import { ChatProjectContext, useDeveloperMode } from '@/lib/developer';
import { isVideoAttachment } from '@/lib/composer-attachments';

/** What past turns get as "no live process". One constant: a new array each time would defeat the memo. */
const NO_TRANSCRIPT: TranscriptItem[] = [];
const NO_ROWS: AgentActivityItem[] = [];

/**
 * For benchmarks: with `?rebuild-list` the whole list is rebuilt on every delta, the slow way.
 *
 * Kept so the improvement stays reproducible: measure with and without it rather than trust a number nobody can
 * check later.
 */
const BENCH_REBUILD_LIST = typeof window !== 'undefined'
  && window.location.search.includes('rebuild-list');

/**
 * A project's whole conversation.
 *
 * Each turn is what the user said and what the agent did for it, as in Cursor. The film plays in the viewer and
 * hot-reloads, so the conversation shows no film thumbnail and no version switcher: versions belong to the top
 * bar (undo / redo / save version).
 *
 * The running turn grows live; finished turns are read from their stored record.
 *
 * The memo is load-bearing: the playhead reports at 20Hz while the film plays, and this tree has no reason to
 * re-render with it.
 */
export const ProjectConversation = React.memo(function ProjectConversation({
  turns,
  liveAssetId,
  liveTranscript,
  liveActive,
  sessionBreakAt = null,
  sessionBreakLabel = '',
  liveActivity,
  lastTurnRef,
}: {
  turns: ProjectVersion[];
  /** The turn running now; its process comes in live, not from disk. */
  liveAssetId: string | null;
  liveTranscript: TranscriptItem[];
  liveActive: boolean;
  /** The old "new session" divider. The app no longer passes it, since sessions switch for real. */
  sessionBreakAt?: string | null;
  sessionBreakLabel?: string;
  /**
   * The line at the bottom; takes no room when null.
   *
   * Only two phrases (Planning next moves / Connecting), and null while something runs: the tool rows light up
   * and the text grows on its own, with no need to narrate it below (see useLiveActivity).
   */
  liveActivity: string | null;
  /** Measures the last turn's height, which sizes the space below it (see useTailSpacer). */
  lastTurnRef?: (node: HTMLDivElement | null) => void;
}) {
  const store = useLiveTranscriptStore(liveTranscript);
  const keyOf = useStableTurnKeys(turns);
  const liveKey = liveAssetId ? keyOf(liveAssetId) : null;

  /**
   * This list doesn't depend on the live process: liveTranscript is left out of the deps on purpose.
   *
   * It is the most expensive spot in the chat column: otherwise every delta rebuilds the elements of every
   * turn. Profiling put this line at 40% of main-thread busy time, producing output identical to the last
   * frame. Row-level memo can't help, since the waste happens when elements are built, before React decides
   * whether to re-render.
   *
   * So the list is frozen, and the live turn subscribes to what changes (see the store below).
   */
  const list = React.useMemo(() => turns.map((entry, index) => {
    const key = keyOf(entry.assetId);
    const live = liveKey != null && key === liveKey;
    const rootRef = index === turns.length - 1 ? lastTurnRef : undefined;
    return (
      <React.Fragment key={key}>
        <ConversationTurn
          entry={entry}
          live={live}
          isLast={index === turns.length - 1}
          liveActivity={live ? liveActivity : null}
          {...(rootRef ? { rootRef } : {})}
        />
        {sessionBreakAt === entry.assetId ? (
          <div className="flex items-center gap-2.5 py-0.5">
            <span className="h-px flex-1 bg-[var(--border)]" />
            <span className="text-[11px] font-medium text-[var(--text-faint)]">
              {sessionBreakLabel}
            </span>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
        ) : null}
      </React.Fragment>
    );
  }), [
    turns, keyOf, liveKey, liveActive, liveActivity,
    sessionBreakAt, sessionBreakLabel, lastTurnRef,
    ...(BENCH_REBUILD_LIST ? [liveTranscript] : []),
  ]);

  return (
    <LiveTranscriptContext.Provider value={store}>
      <div className="flex flex-col gap-5">{list}</div>
    </LiveTranscriptContext.Provider>
  );
});

/**
 * Each turn's React key, kept when its pending id is replaced by the real one.
 *
 * A sent message appears at once under a pending id (pending:…) and gets its real id when the request returns.
 * If the key followed the id, the turn would remount: the bubble, status line and height observer would start
 * over, and for a frame it wouldn't count as running, flashing "Loading conversation". So the real id takes over
 * the pending id's key: a pending entry gone and a new one in its place is the same turn renamed. The pending id
 * maps to the same key, so the turn still knows it is running if asset.id switches a frame late.
 */
function useStableTurnKeys(turns: ProjectVersion[]): (id: string) => string {
  const keys = React.useRef(new Map<string, string>());
  const previous = React.useRef<string[]>([]);
  return React.useMemo(() => {
    const map = keys.current;
    const ids = turns.map((entry) => entry.assetId);
    const present = new Set(ids);
    const vacated = previous.current.filter((id) => isPendingAssetId(id) && !present.has(id) && map.has(id));
    for (const id of ids) {
      if (map.has(id)) continue;
      const from = isPendingAssetId(id) ? undefined : vacated.shift();
      map.set(id, from ? map.get(from)! : id);
    }
    previous.current = ids;
    return (id: string) => map.get(id) ?? id;
  }, [turns]);
}

/**
 * The process growing right now, kept in a small store that the one component needing it reads.
 *
 * Two simpler approaches were too slow:
 *
 *   · Props: every token rebuilt the elements of every turn. The waste happens when elements are built, before
 *     React decides whether to re-render, so row-level memo can't help.
 *   · The value in context: elements weren't rebuilt, but every context change makes React walk the whole tree
 *     for consumers, eighteen thousand fibers per token, which profiled even worse.
 *
 * Both hung the changing value at the top of a large tree, so the cost grew with the conversation. Here the
 * context carries the store itself, whose identity never changes, so that walk never happens; only the turn
 * subscribed to its contents wakes up. The cost no longer depends on how many turns came before.
 */
type LiveTranscriptStore = {
  get: () => TranscriptItem[];
  subscribe: (onChange: () => void) => () => void;
};

const LiveTranscriptContext = React.createContext<LiveTranscriptStore>({
  get: () => NO_TRANSCRIPT,
  subscribe: () => () => {},
});

const NOOP_SUBSCRIBE = () => () => {};
const GET_EMPTY = () => NO_TRANSCRIPT;

function useLiveTranscriptStore(items: TranscriptItem[]): LiveTranscriptStore {
  const store = React.useMemo(() => {
    let latest: TranscriptItem[] = NO_TRANSCRIPT;
    const listeners = new Set<() => void>();
    return {
      get: () => latest,
      subscribe: (onChange: () => void) => {
        listeners.add(onChange);
        return () => { listeners.delete(onChange); };
      },
      put: (next: TranscriptItem[]) => { latest = next; },
      flush: () => { for (const onChange of listeners) onChange(); },
    };
  }, []);

  /* Render only records the value; subscribers are notified after commit. React forbids waking other components
     mid-render, and they would read content not yet on screen. */
  store.put(items);
  React.useEffect(() => { store.flush(); }, [items, store]);

  return store;
}

/**
 * One turn.
 *
 * `memo` here works with the list's: while streaming only the last turn changes, and the earlier ones must not
 * re-render. A turn can have over two hundred rows, so dozens of turns are thousands, identical to the last frame.
 *
 * A running and a finished turn are the same component, as in ChatGPT: the streamed message is the final one.
 * Switching component types would unmount it, and the process would vanish, show "Loading process", then return.
 */
const ConversationTurn = React.memo(function ConversationTurn({
  entry,
  live,
  liveActivity,
  rootRef,
  isLast,
}: {
  entry: ProjectVersion;
  live: boolean;
  isLast: boolean;
  liveActivity: string | null;
  rootRef?: (node: HTMLDivElement | null) => void;
}) {
  const t = useT();
  const developer = useDeveloperMode();
  /* A past turn's stored record is fetched when the turn scrolls near the viewport, not up front, so it is
     there by the time it is read. */
  const store = React.useContext(LiveTranscriptContext);
  const liveTranscript = React.useSyncExternalStore(
    live ? store.subscribe : NOOP_SUBSCRIBE,
    live ? store.get : GET_EMPTY,
    GET_EMPTY,
  );
  const shell = React.useRef<HTMLDivElement | null>(null);
  const near = useNearViewport(shell, live);
  const stored = useStoredTranscript(entry.assetId, !live && near && !isPendingAssetId(entry.assetId));
  const lastLive = React.useRef<TranscriptItem[] | null>(null);
  if (live && liveTranscript.length > 0) lastLive.current = liveTranscript;
  /* When the turn finishes (live turns false) its process goes into the cache, so later renders read it there,
     with no fetch and no "loading". A turn unmounted while still running is recorded then too. */
  const assetIdRef = React.useRef(entry.assetId);
  assetIdRef.current = entry.assetId;
  const wasLive = React.useRef(live);
  React.useEffect(() => {
    if (wasLive.current && !live && lastLive.current?.length) {
      primeStoredTranscript(assetIdRef.current, lastLive.current, 'live');
    }
    wasLive.current = live;
  }, [live]);
  React.useEffect(() => () => {
    if (wasLive.current && lastLive.current?.length) {
      primeStoredTranscript(assetIdRef.current, lastLive.current, 'live');
    }
  }, []);
  const storedItems = stored.items;
  /* Finished (not live, not still running): the changes card and footer go below */
  const settled = !live && entry.status !== 'active';
  /* A finished turn folds, as in Codex / Claude Code: the process becomes one line ("Worked 3m 40s · 14 steps")
     and the answer stands out. For the turn you watched, folding must not move the answer you are reading: draw
     one frame unfolded, note the answer's bottom edge in the viewport, then fold and restore the scroll, so the
     answer stays put and the process above it shrinks. Turns you didn't watch (after a reload, older turns)
     start folded. */
  const watched = React.useRef(live);
  if (live) watched.current = true;
  const [folded, setFolded] = React.useState(false);
  const collapsed = settled && (!(watched.current && isLast) || folded);
  const thread = React.useContext(StickToBottomContext);
  const tailRef = React.useRef<HTMLDivElement | null>(null);
  const foldAnchor = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    if (!settled || collapsed) return;
    const tail = tailRef.current;
    foldAnchor.current = tail ? tail.getBoundingClientRect().top : null;
    setFolded(true);
  }, [settled, collapsed]);
  React.useLayoutEffect(() => {
    const top = foldAnchor.current;
    foldAnchor.current = null;
    const tail = tailRef.current;
    const scroller = thread?.viewport ?? null;
    if (!folded || top == null || !tail || !scroller) return;
    const delta = tail.getBoundingClientRect().top - top;
    if (delta !== 0) scroller.scrollTop += delta;
  }, [folded, thread]);
  const changes = useTurnChanges(entry.assetId);
  const items = React.useMemo(
    () => (live ? liveTranscript : preferTranscript(lastLive.current ?? [], storedItems ?? [])),
    // lastLive only changes while live, and live is in the deps.
    [live, liveTranscript, storedItems],
  );
  /* Converts two hundred-odd objects once. Without the memo it reruns on every render with new identities, which
     defeats the memo of the whole list below (see toTraceLogItems). */
  const rows = React.useMemo(() => (items.length ? toTraceLogItems(items) : null), [items]);
  /* "The picture changed" comes from the film's code fingerprint, but an agent starting up can touch code in the
     workspace the user never sees (a turn that only answered a question showed as a picture change). So say it
     only when this turn edited the picture (wrote scenes, edited files); if nothing else changed, no card. */
  const shownChanges = React.useMemo(() => {
    if (!changes) return null;
    if (!changes.picture) return changes;
    const edited = (items ?? []).some((item) => item.kind === 'act' && item.act != null && (
      PICTURE_ACTS.has(item.act)
      /* a local agent's file edits count only for picture code (mg/*.tsx and the like); film.json only moves things */
      || (item.act === 'files.edit' && /\.(tsx?|jsx?|css)\b/.test(item.detail ?? ''))
    ));
    if (edited) return changes;
    const rest = { ...changes, picture: false };
    const any = rest.scenes.length > 0 || rest.captions
      || rest.sounds.added + rest.sounds.removed + rest.sounds.edited > 0
      || Math.abs(rest.durationMs.before - rest.durationMs.after) > 1;
    return any ? rest : null;
  }, [changes, items]);
  /* Two users need this node: one measures its distance from the viewport (whether to fetch the process), the
     other the last turn's height (the space below). One callback rather than a wrapper div, which would change
     the flex gaps. */
  const attach = React.useCallback((node: HTMLDivElement | null) => {
    shell.current = node;
    rootRef?.(node);
  }, [rootRef]);

  return (
    <div
      ref={attach}
      className="group/turn flex min-w-0 flex-col gap-2"
      /**
       * Turns scrolled out of view skip layout.
       *
       * The chat column's last bottleneck, and it isn't in JS: each token in the bottom line re-lays out the whole
       * flex column (sixty turns, eighteen thousand rows) along with it.
       *
       * `content-visibility: auto` lets the browser skip layout and paint for off-screen turns; the `auto` size
       * hint means "assume this height until measured, then remember the real one". Without it off-screen content
       * counts as zero height and the scrollbar keeps resizing while scrolling.
       *
       * Not for the newest turn or those already near: an estimate of 30px per process row squeezes a long answer
       * into a few lines, the overflow container thinks it has reached the bottom, and the rest is clipped. Only
       * off-screen turns not yet fetched need the skip.
       *
       * The nodes stay in the DOM (not a virtual list): find-in-page, screen readers and copy-paste all still
       * work, the three things a virtual list loses and then works hard to restore.
       */
      style={(rootRef || live || near) ? undefined : ({
        contentVisibility: 'auto',
        containIntrinsicSize: `auto ${guessHeight(items)}px`,
      } as React.CSSProperties)}
    >
      {/* What the user said: a bubble on the right, apart from the agent's full-width, left-aligned side.

          The border is a hairline: the background is already half a step off the panel, and the border only
          sharpens that edge so two close tones don't blur. Any heavier and it becomes a card, for what is
          only a sentence. */}
      <div className="group/ask flex min-w-0 flex-col gap-1">
      <div className="flex justify-end">
        <div className="flex max-w-[88%] flex-col gap-1.5 rounded-[12px] border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
          {entry.attachments.length > 0 && <TurnAttachments items={entry.attachments} />}
          {/* The sent message must look like it did in the composer: an asset picked there is a pill, and turning
              it into a bare workspace path after Enter would disown what the user saw. With the original text,
              render the pills; otherwise the expanded prompt, which is the same for plain text and is all that
              older messages have. */}
          {entry.promptDisplay || entry.prompt.trim() ? (
            <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.65] text-[var(--chat-text)]">
              {entry.promptDisplay
                ? <PromptWithPills display={entry.promptDisplay} />
                : entry.prompt}
            </p>
          ) : null}
        </div>
      </div>
      <PromptFooter entry={entry} />
      </div>

      {/* The agent's side is a block of its own: hovering it (not the whole turn) shows the line below */}
      <div className="group/reply flex min-w-0 flex-col gap-2 empty:hidden">
      {/* What the agent did. Fully open while running; for turns you didn't watch, the process folds to one line and the answer stands out. */}
      <TurnBody rows={rows} collapsed={collapsed} {...(entry.durationMs ? { durationMs: entry.durationMs } : {})} />
      {/* The answer's bottom edge, the anchor for folding (see folded above). */}
      {rows?.length ? <div ref={tailRef} aria-hidden className="-mt-2 h-0" /> : null}
      {/* Only for older turns you didn't watch (after a reload, scrolling back). The turn you watched has its
          process in hand, even with no rows (stopped right after sending), and never says "loading": that line
          appearing and vanishing made the conversation jump on send and on finish. */}
      {settled && !watched.current && items.length === 0 && (stored.items === null || stored.error) && (
        <div className="min-h-20 py-2 text-[12px] text-[var(--text-muted)]" aria-busy={!stored.error}>
          {stored.error ? (
            <div role="status" className="flex items-center gap-2">
              <span>{t('project.messagesLoadFailed')}</span>
              <button type="button" onClick={stored.retry} className="underline underline-offset-2">{t('project.retry')}</button>
            </div>
          ) : (
            <div role="status">
              <span>{t('project.loadingMessages')}</span>
              <div aria-hidden className="mt-3 space-y-2 motion-safe:animate-pulse">
                <div className="h-2 w-4/5 rounded bg-[var(--surface-2)]" />
                <div className="h-2 w-3/5 rounded bg-[var(--surface-2)]" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* What this turn changed in the film. No "version N · switch to it" link: every small edit is a version,
          and going back to one belongs to the top bar's history. */}
      {settled && shownChanges ? <TurnChangesCard changes={shownChanges} /> : null}
      {/* what it changed in film.html, line by line: for finding out what an agent did, so developer mode's */}
      {settled && developer && entry.filmChanges?.length ? <FilmChangesList changes={entry.filmChanges} /> : null}

      {settled ? <TurnFooter entry={entry} items={items} /> : null}

      {/* Still running: one status line below, always one line high, only its text changes (see StatusLine). An
          interruption doesn't show Failed here: the reason and Resume appear above the composer, as in Cursor. */}
      {entry.status === 'active' ? <StatusLine items={rows ?? NO_ROWS} fallback={liveActivity} /> : null}
      </div>
    </div>
  );
});

/**
 * Roughly how tall this turn is, used only before it has been laid out (see content-visibility above).
 *
 * Estimated from the rows rather than one number for every turn: a turn can be three rows or three hundred,
 * and a uniform guess makes the scrollbar jerk when scrolling past unseen parts, the worst habit of virtual lists.
 *
 * A wrong guess breaks nothing, since the browser remembers the real height once measured; a good one keeps the
 * scrollbar honest from the start.
 */
function guessHeight(items: TranscriptItem[] | null): number {
  const bubble = 72;
  /* Turns not fetched yet can only be guessed. Guess high: too low and they pile up at the viewport's edge, a
     dozen turns count as "about to enter" at once and paging is wasted; and the scrollbar jumps when the real
     content arrives. */
  if (!items) return bubble + 600;
  let height = bubble;
  for (const item of items) {
    if (item.kind === 'text') {
      const chars = (item.text ?? '').length;
      /* About 26 CJK characters per line in the column (14px, ~23px line height). A long reply can't count as one
         process row, or an off-screen turn jumps in height as it enters and stick-to-bottom pins to the wrong
         scrollHeight. */
      height += Math.max(46, Math.ceil(Math.max(chars, 1) / 26) * 23 + 16);
    } else {
      // Rows carrying a result are taller: an image thumbnail is 72px, a sound pill 28px.
      height += item.asset?.kind === 'image' ? 110 : item.asset ? 64 : 30;
    }
  }
  return height;
}

/**
 * What the message was sent with.
 *
 * Only a receipt: the files themselves are already in the agent's workspace; this keeps each name and a 96px
 * thumbnail. Without a thumbnail (encoding failed, or an older turn) it falls back to an icon and the name:
 * saying which file beats an empty square.
 *
 * Laid out left to right. The bubble sits on the right, but these are a list, and its first item belongs where
 * reading starts. Right-aligned, the first picture would shift with the count, while in the composer it was the
 * first from the left.
 */
function TurnAttachments({ items }: { items: TurnAttachment[] }) {
  const t = useT();
  const [open, setOpen] = React.useState<AttachmentPreviewItem | null>(null);

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => {
        /* Opening shows the original: the stored 320px copy only fills this 32px square and would blur full
           screen, suggesting that is what was sent. The original is fetched by its content hash.
           Messages without a hash fall back to the thumbnail, marked thumbOnly: the preview keeps its own size
           and says it is a thumbnail. */
        const origin = item.sha256
          ? `/api/uploads/blob/${item.sha256}?name=${encodeURIComponent(item.name)}`
          : null;
        /* Only squares with something to show open: one that opens blank looks more broken than one that
           doesn't open. */
        const preview: AttachmentPreviewItem | null = origin
          ? { name: item.name, kind: item.kind, url: origin }
          : (item.thumb
            ? { name: item.name, kind: item.kind, url: item.thumb, thumbOnly: true }
            : null);
        /* 32px squares: a receipt, not a gallery. Enough to recognize what was sent; open one to see it. The
           smaller they are, the higher the text sits, and the bubble reads as a sentence, not an attachment list. */
        const shell = item.thumb
          ? 'relative h-8 w-8 overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)]'
          : 'flex h-8 min-w-0 max-w-[132px] items-center gap-1 overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--surface)] px-1.5';
        /* a video's thumbnail is a frame of it: a play mark says it is not a picture */
        const inner = item.thumb ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.thumb} alt={item.name} className="h-full w-full object-cover" />
            {isVideoAttachment(item) ? (
              <span aria-hidden className="pointer-events-none absolute inset-0 m-auto flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/55">
                <Play size={7} className="translate-x-[0.5px] fill-white text-white" />
              </span>
            ) : null}
          </>
        ) : (
          <>
            <AttachmentTypeIcon file={item} size={11} className="shrink-0 text-[var(--chat-hint)]" />
            <span className="truncate text-[11px] text-[var(--chat-hint)]">{item.name}</span>
          </>
        );

        return preview ? (
          <button
            key={`${item.name}-${index}`}
            type="button"
            title={item.name}
            aria-label={t('composer.openAttachment').replace('{name}', item.name)}
            onClick={() => setOpen(preview)}
            className={`${shell} transition hover:border-[var(--border-strong)]`}
          >
            {inner}
          </button>
        ) : (
          <div key={`${item.name}-${index}`} title={item.name} className={shell}>
            {inner}
          </div>
        );
      })}
      {open && <AttachmentPreview item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/**
 * The agent's side of a turn.
 *
 * Fully open while running: watching it work is part of the product. Once finished it folds, as in Codex /
 * Claude Code: everything before the last piece of work (actions, narration, thinking, plans) becomes one line,
 * "Worked 3m 40s · 14 steps", opened on click; its final paragraphs are the answer and stay out as text.
 * Unfolded, a two-minute turn is thirty or forty rows with the conclusion at the bottom, and scrolling back
 * means reading each turn top to bottom to find what it said.
 */
function TurnBody({
  rows,
  collapsed,
  durationMs,
}: {
  rows: AgentActivityItem[] | null;
  collapsed: boolean;
  durationMs?: number;
}) {
  const split = React.useMemo(() => (rows && collapsed ? answerStart(rows) : -1), [rows, collapsed]);
  const work = React.useMemo(() => (rows && split >= 0 ? rows.slice(0, split) : null), [rows, split]);
  const answer = React.useMemo(() => (rows && split >= 0 ? rows.slice(split) : null), [rows, split]);
  // Loading/error feedback is separate and never hides an existing reply.
  if (!rows || rows.length === 0) return null;

  /* No vertical rule: the process is part of the conversation. A line would say "this is something else", but
     it is the same thing as what the agent says. */
  if (!work || !answer) {
    /* empty:hidden: as a turn starts the list holds only things not drawn yet (empty text, a running action); if
       this wrapper still took a slot, the column would gain a gap and push the status line down 8px. */
    return (
      <div className="min-w-0 w-full empty:hidden">
        <AgentActivityList items={rows} keyPrefix="turn" />
      </div>
    );
  }
  return (
    <div className="min-w-0 w-full">
      <WorkSummary items={work} {...(durationMs ? { durationMs } : {})} />
      {answer.length ? <AgentActivityList items={answer} keyPrefix="answer" /> : null}
    </div>
  );
}

/**
 * The folded process: one line saying how long it worked and how many steps. Media shows only in its tool's row.
 *
 * Opening changes the height: as in ActGroup, the clicked row is pinned so the column isn't pulled to the bottom.
 */
function WorkSummary({ items, durationMs }: { items: AgentActivityItem[]; durationMs?: number }) {
  const t = useT();
  const thread = React.useContext(StickToBottomContext);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const anchorTop = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const steps = countedSteps(items);
  const label = [
    durationMs ? t('turnFrame.worked').replace('{t}', formatWorkDuration(durationMs)) : null,
    steps === 1 ? t('turnFrame.oneStep') : steps > 1 ? t('turnFrame.steps').replace('{n}', String(steps)) : null,
  ].filter(Boolean).join(' · ') || t('turnFrame.thoughtShort');

  const toggle = () => {
    const node = rootRef.current;
    if (node) {
      thread?.skipNextPin();
      anchorTop.current = node.getBoundingClientRect().top;
    }
    setOpen((value) => !value);
  };
  React.useLayoutEffect(() => {
    const node = rootRef.current;
    const top = anchorTop.current;
    const scroller = thread?.viewport ?? null;
    anchorTop.current = null;
    if (node == null || top == null || scroller == null) return;
    const delta = node.getBoundingClientRect().top - top;
    if (delta !== 0) scroller.scrollTop += delta;
  }, [open, thread]);

  return (
    <div ref={rootRef} className="min-w-0 py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        className="flex items-center gap-1 text-[14px] leading-relaxed text-[var(--chat-hint)] transition-colors hover:text-[var(--chat-text)]"
      >
        <span>{label}</span>
        <ChevronRight size={14} aria-hidden className={`transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open ? (
        <div className="mt-1 border-l border-[var(--border)] pl-3">
          <AgentActivityList items={items} keyPrefix="work" />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Clicking a scene on the changes card moves the playhead there and selects it on the timeline. Without a
 * provider the card is just a card.
 * `has` says whether the scene is still in the film: removed ones, or ones changed away since, can't be clicked.
 */
export const TurnSceneFocusContext = React.createContext<{
  focus: (id: string) => void;
  has: (id: string) => boolean;
} | null>(null);

/** A scene's current thumbnail on the changes card (the timeline's images); null without a provider or a frame. */
export const TurnSceneThumbContext = React.createContext<((id: string) => string | null) | null>(null);

const CHANGE_CHIPS_MAX = 6;
const CHANGE_TILES_MAX = 4;

/** Actions that write picture code (see shownChanges). Moving things or adding sound isn't "the picture changed"; those have their own lines. */
const PICTURE_ACTS = new Set<string>(['scene.write', 'scene.edit']);

/**
 * What this turn changed in the film (see lib/turn-changes): like Codex's "3 files changed" card, but in scenes,
 * since our users look at scenes, not files.
 *
 * Reading the conversation should land somewhere: you said something, watched it work, and got these changes.
 * Every scene can be clicked.
 */
function TurnChangesCard({ changes }: { changes: TurnChanges }) {
  const t = useT();
  const focus = React.useContext(TurnSceneFocusContext);
  const thumbOf = React.useContext(TurnSceneThumbContext);
  /* The reply should show the film: changed and added scenes with a thumbnail make a row of small pictures (click
     to jump); the rest are text pills, as are removed scenes, which have no picture. */
  const tiles = thumbOf
    ? changes.scenes.filter((scene) => scene.change !== 'removed').map((scene) => ({ scene, url: thumbOf(scene.id) })).filter((x): x is { scene: SceneChange; url: string } => !!x.url).slice(0, CHANGE_TILES_MAX)
    : [];
  const tiled = new Set(tiles.map((x) => x.scene));
  const rest = changes.scenes.filter((scene) => !tiled.has(scene));
  /* one chip per name: eight cuts of one source video read "+ talk.mp4 ×8", not the same chip eight times */
  const groups: Array<{ scene: SceneChange; count: number }> = [];
  for (const scene of rest) {
    const same = groups.find((g) => g.scene.label === scene.label && g.scene.change === scene.change);
    if (same) same.count += 1; else groups.push({ scene, count: 1 });
  }
  const chips = groups.slice(0, CHANGE_CHIPS_MAX);
  const more = groups.length - chips.length;
  const soundTotal = changes.sounds.added + changes.sounds.edited;
  const extras = [
    soundTotal === 1 ? t('turnFrame.oneSound') : soundTotal > 1 ? t('turnFrame.sounds').replace('{n}', String(soundTotal)) : null,
    changes.captions ? t('turnFrame.captions') : null,
    changes.picture ? t('turnFrame.picture') : null,
  ].filter(Boolean);
  const lengthChanged = Math.abs(changes.durationMs.before - changes.durationMs.after) > 1;
  const clock = (ms: number) => formatClock(ms);

  return (
    <div className="flex w-full max-w-[26rem] flex-col gap-2 self-start rounded-[10px] border border-[var(--border)] p-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium text-[var(--chat-text)]">{t('turnFrame.changes')}</span>
          <span className="truncate text-[12px] text-[var(--chat-hint)]">
            {lengthChanged
              ? t('turnFrame.length').replace('{from}', clock(changes.durationMs.before)).replace('{to}', clock(changes.durationMs.after))
              : clock(changes.durationMs.after)}
            {extras.length ? ` · ${extras.join(' · ')}` : ''}
          </span>
        </div>
      </div>
      {tiles.length ? (
        <div className="grid grid-cols-4 gap-1.5">
          {/* two clips can carry one id (the same source cut twice): the index keeps the keys apart */}
          {tiles.map(({ scene, url }, i) => <SceneTile key={`${scene.id}:${scene.change}:${i}`} scene={scene} url={url} focus={focus} />)}
        </div>
      ) : null}
      {chips.length ? (
        <div className="flex flex-wrap gap-1">
          {chips.map(({ scene, count }, i) => <SceneChip key={`${scene.kind}:${scene.id}:${scene.change}:${i}`} scene={scene} count={count} focus={focus} />)}
          {more > 0 ? <span className="px-1 py-0.5 text-[12px] text-[var(--chat-hint)]">+{more}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function SceneChip({
  scene,
  count = 1,
  focus,
}: {
  scene: SceneChange;
  /** how many clips of this one name the chip stands for */
  count?: number;
  focus: React.ContextType<typeof TurnSceneFocusContext>;
}) {
  const t = useT();
  const mark = scene.change === 'added' ? '+' : scene.change === 'removed' ? '−' : '~';
  const tone = scene.change === 'added'
    ? 'text-[var(--ok)]'
    : scene.change === 'removed' ? 'text-[var(--err)]' : 'text-[var(--chat-hint)]';
  const word = t(`turnFrame.${scene.change}`);
  const body = (
    <>
      <span aria-hidden className={`font-mono text-[11px] ${tone}`}>{mark}</span>
      <span className={`truncate ${scene.change === 'removed' ? 'line-through' : ''}`}>{scene.label}</span>
      {count > 1 ? <span className="shrink-0 tabular-nums text-[var(--chat-hint)]">×{count}</span> : null}
    </>
  );
  const shell = 'inline-flex h-6 max-w-[12rem] items-center gap-1 rounded-md border border-[var(--border)] px-1.5 text-[12px] text-[var(--chat-text)]';
  const live = scene.change !== 'removed' && focus?.has(scene.id);
  if (!live || !focus) return <span className={`${shell} opacity-80`} title={`${word} · ${scene.label}`}>{body}</span>;
  return (
    <button
      type="button"
      onClick={() => focus.focus(scene.id)}
      title={`${word} · ${t('turnFrame.jump')}`}
      className={`${shell} transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]`}
    >
      {body}
    </button>
  );
}

function SceneTile({
  scene,
  url,
  focus,
}: {
  scene: SceneChange;
  url: string;
  focus: React.ContextType<typeof TurnSceneFocusContext>;
}) {
  const t = useT();
  const live = focus?.has(scene.id);
  const mark = scene.change === 'added' ? '+' : '~';
  const body = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" loading="lazy" decoding="async" className="aspect-video w-full rounded-[6px] object-cover" />
      <span className="mt-1 flex min-w-0 items-center gap-1 text-[11.5px] text-[var(--chat-hint)]">
        <span aria-hidden className={`font-mono text-[10.5px] ${scene.change === 'added' ? 'text-[var(--ok)]' : ''}`}>{mark}</span>
        <span className="truncate">{scene.label}</span>
      </span>
    </>
  );
  const shell = 'flex min-w-0 flex-col text-left';
  if (!live || !focus) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={() => focus.focus(scene.id)}
      title={`${t(`turnFrame.${scene.change}`)} · ${t('turnFrame.jump')}`}
      className={`${shell} rounded-[7px] outline-none transition hover:opacity-85 focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]`}
    >
      {body}
    </button>
  );
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const AGENT_NAMES: Record<string, string> = {
  codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', copilot: 'GitHub Copilot', cursor: 'Cursor',
  opencode: 'OpenCode', codebuddy: 'CodeBuddy', qwen: 'Qwen Code', kimi: 'Kimi',
};

/** The hover-only line: transparent but keeping its space (nothing jumps as the mouse moves); always shown on devices without hover. */
/* Kept visible by keyboard focus only (:focus-visible): after a click on copy the focus stays on the button,
   and with focus-within the line would never hide again. */
const HOVER_LINE = 'opacity-0 transition-opacity duration-150 has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100';

/** Copy button: shows a tick once copied. */
function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t('turnFrame.copied') : t('turnFrame.copy')}
      title={copied ? t('turnFrame.copied') : t('turnFrame.copy')}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition hover:bg-[var(--bg-hover)] hover:text-[var(--chat-text)]"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/**
 * The line under a reply: copy, who answered (icon only) · the model · how long ago, and how it stopped if it
 * didn't finish normally.
 *
 * Several agents can answer in one project and their replies look alike, so the footer says which one. A stopped
 * turn says so, or a reply cut short leaves the reader unsure whether it finished, broke or was stopped.
 *
 * As in Claude, it appears on hover over the reply and keeps its space (h-6, as tall as the status line while
 * running, so the bottom edge stays put when one replaces the other). The time is how long ago; how long it
 * worked is in the "Worked …" line.
 */
function TurnFooter({ entry, items }: { entry: ProjectVersion; items: TranscriptItem[] | null }) {
  const t = useT();
  const locale = useUiLocale();
  const now = useMinuteTick();
  const answer = React.useMemo(() => {
    if (!items?.length) return '';
    const from = Math.max(0, answerStart(items));
    return items.slice(from).filter((item) => item.kind === 'text').map((item) => item.text ?? '').join('\n\n').trim();
  }, [items]);
  const when = relativeTime(entry.settledAt, locale, now);
  const outcome = entry.outcome === 'stopped' ? t('turnFrame.stopped')
    : entry.outcome === 'failed' ? t('turnFrame.failed')
      : entry.outcome === 'balance' && entry.balance ? t('turnFrame.balance').replaceAll('{provider}', entry.balance.provider)
        : null;

  const developer = useDeveloperMode();
  const project = React.useContext(ChatProjectContext);

  return (
    /* -mt-1.5: the footer belongs to the reply above it — close to it, not a row of its own */
    <div className={`-mt-1.5 flex h-6 min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--chat-hint)] group-hover/reply:opacity-100 ${HOVER_LINE}`}>
      {answer ? <CopyButton text={answer} /> : null}
      {/* developer mode (Settings → Developer): the turn as it happened, every event */}
      {developer && project ? <TurnLogButton project={project} turnId={entry.assetId} /> : null}
      {entry.agent ? (
        <span className="flex min-w-0 items-center gap-1.5">
          {/* the icon says which agent (its name on hover); written out it would only repeat it */}
          <span className="flex w-3.5 shrink-0 justify-center opacity-80" title={entry.agent === 'byok' ? t('composer.agentOwnKey') : AGENT_NAMES[entry.agent] ?? entry.agent}>
            {hasAgentIcon(entry.agent)
              ? <AgentIcon id={entry.agent} size={12} />
              : <BrandLogo size={11} />}
          </span>
          <span className="truncate">{[entry.model, when].filter(Boolean).join(' · ')}</span>
        </span>
      ) : when ? <span>{when}</span> : null}
      {outcome ? (
        <span className={entry.outcome === 'stopped' ? '' : 'text-[var(--warn)]'}>
          {entry.agent || when ? '· ' : ''}{outcome}
        </span>
      ) : null}
      {/* no balance left: the service's own page to top it up */}
      {entry.outcome === 'balance' && entry.balance?.url ? (
        <a href={entry.balance.url} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-[var(--chat-text)]">{t('balance.manage')}</a>
      ) : null}
    </div>
  );
}

/** Under the sent message: how long ago, and copy. Also shown on hover, with its space kept. */
function PromptFooter({ entry }: { entry: ProjectVersion }) {
  const locale = useUiLocale();
  const now = useMinuteTick();
  const when = relativeTime(entry.createdAt, locale, now);
  const text = entry.prompt.trim();
  return (
    <div className={`flex h-6 min-w-0 items-center justify-end gap-1 text-[11.5px] text-[var(--chat-hint)] group-hover/ask:opacity-100 ${HOVER_LINE}`}>
      {when ? <span className="px-1">{when}</span> : null}
      {text ? <CopyButton text={text} /> : null}
    </div>
  );
}

/**
 * Turns already fetched, kept at module level by assetId.
 *
 * Outside the component on purpose: component state is lost on unmount, and the chat column unmounts and
 * remounts on scrolling and switching away, which would refetch and reparse the same turn each time. These are
 * reduced rows with their identities kept, so the memos still hold on scrolling back.
 *
 * No cap: a project's process records are bounded (each text is already truncated), and a cap means choosing
 * what to evict; a wrong choice is another fetch on scrolling back.
 */
const STORED_TRANSCRIPTS = new Map<string, TranscriptItem[]>();
/** Turns checked against the stored record. The live cache doesn't count. */
const FETCHED_TRANSCRIPTS = new Set<string>();

/**
 * Puts a turn's ready process into that table, saving its own fetch.
 *
 * The app fills this with the saved turns before the chat column mounts, so its first frame can draw what the
 * agent said without waiting for /progress.
 *
 * `live` is what the stream was still writing: it may have stopped midway and isn't a checked final copy.
 */
export function primeStoredTranscript(
  assetId: string,
  items: TranscriptItem[],
  source: 'ssr' | 'live' = 'ssr',
): void {
  STORED_TRANSCRIPTS.set(assetId, preferTranscript(STORED_TRANSCRIPTS.get(assetId) ?? [], items));
  if (source === 'live') FETCHED_TRANSCRIPTS.delete(assetId);
  else FETCHED_TRANSCRIPTS.add(assetId);
}

const PENDING_TRANSCRIPTS = new Map<string, Promise<TranscriptItem[]>>();

function fetchStoredTranscript(assetId: string): Promise<TranscriptItem[]> {
  const pending = PENDING_TRANSCRIPTS.get(assetId);
  if (pending) return pending;
  const request = fetch(`/api/turns/${encodeURIComponent(assetId)}/progress`, {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  }).then(async response => {
    if (!response.ok) throw new Error(`Progress HTTP ${response.status}`);
    const json = await response.json() as { snapshot?: PublicProgressSnapshot | null };
    const next = preferTranscript(STORED_TRANSCRIPTS.get(assetId) ?? [], transcriptFromSnapshot(json.snapshot));
    STORED_TRANSCRIPTS.set(assetId, next);
    FETCHED_TRANSCRIPTS.add(assetId);
    return next;
  }).finally(() => { PENDING_TRANSCRIPTS.delete(assetId); });
  PENDING_TRANSCRIPTS.set(assetId, request);
  return request;
}

/**
 * How far this turn is from the viewport; its process is fetched only when near.
 *
 * Fetching every past turn on mount would mean a twenty-turn project sends twenty requests, twenty JSON.parse
 * calls and twenty setStates, for eighteen turns the user never scrolls to.
 *
 * The margin is wide (a screen and a half): fetching only on arrival would show a "loading" block sliding by.
 * Wide enough to finish before the turn enters, narrow enough not to fetch the whole project at once.
 */
const NEAR_VIEWPORT_PX = 1200;

function useNearViewport(ref: React.RefObject<HTMLElement | null>, skip: boolean): boolean {
  const [near, setNear] = React.useState(skip);
  React.useEffect(() => {
    if (skip) { setNear(true); return undefined; }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setNear(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      /* Only the first entry counts, then observing stops: what was fetched stays valid after scrolling away,
         and toggling would refetch a turn jittering at the edge. */
      if (entries.some((entry) => entry.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: `${NEAR_VIEWPORT_PX}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, skip]);
  return near;
}

/**
 * A past turn's stored process, fetched once when it scrolls near.
 * Kept once fetched (see STORED_TRANSCRIPTS): re-renders and remounts shouldn't hit the server again.
 *
 * Except a turn that was just live: the stream may have stopped midway and the cache holds part of it, so it is
 * read once more. Comparing by row count isn't enough: a question-and-answer turn is often one row whether
 * partial or whole, so the text is compared.
 */
function useStoredTranscript(assetId: string, enabled: boolean) {
  const [items, setItems] = React.useState<TranscriptItem[] | null>(
    () => STORED_TRANSCRIPTS.get(assetId) ?? null,
  );
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const retry = React.useCallback(() => { setError(false); setAttempt(n => n + 1); }, []);

  React.useEffect(() => {
    setItems(STORED_TRANSCRIPTS.get(assetId) ?? null);
  }, [assetId]);

  React.useEffect(() => {
    if (!enabled) return undefined;
    const cached = STORED_TRANSCRIPTS.get(assetId);
    if (cached) setItems(cached);
    if (FETCHED_TRANSCRIPTS.has(assetId)) return undefined;

    let alive = true;
    setLoading(true);
    setError(false);
    fetchStoredTranscript(assetId)
      .then((next) => {
        if (alive) setItems(next);
      })
      .catch(() => {
        // A failed request is not an empty conversation and must remain retryable.
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [assetId, enabled, attempt]);

  return { items, loading, error, retry };
}
