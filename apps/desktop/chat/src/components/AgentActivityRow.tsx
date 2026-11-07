'use client';

import * as React from 'react';
import {
  AudioLines, Captions, ChevronDown, CornerDownRight, ChevronRight, Circle, CircleCheck, CircleDot, Clapperboard, Ear, Eye, FilePen, FileSearch,
  FileText, Globe, ImagePlus, Languages, Layers, MessageCircleQuestion, Mic, Music, Pause, PenLine, Play, Search, SquareTerminal,
  UserRound, Video, type LucideIcon,
} from 'lucide-react';
import type { AgentActAsset } from '@openfilm/shared';
import { Markdown } from './Markdown';
import { AttachmentPreview } from './AttachmentPreview';
import { elapsedLabel, useTick } from './useTicker';
import { useT } from '@/i18n';
import { actGroupParts, buildRuns, EPHEMERAL_ACT_LABELS, idleStatus, pendingWork } from '@/lib/agent-activity-runs';
import { StickToBottomContext } from './useStickToBottom';
import { WaitingContext } from '@/lib/developer';

/**
 * The process the user sees: what the agent says and what it does.
 *
 * This file and `AgentConversationRow` are two renderers, not one with a switch. That one draws raw tool
 * rows (tool name, input, output, reasoning) for `/dev`; this one draws projected acts. The split is
 * deliberate: no code on the product path can render a tool name or a file path, so keeping them out of
 * sight does not depend on anyone guarding a switch.
 *
 * No expandable input / output here, no ✓/✗. One row is one plain sentence. Acts finished back to back
 * fold into one row that opens on click, including while they run, like Cursor's step summary.
 */

export interface AgentActivityItem {
  /** thought / plan only come from an agent on the user's machine (see TranscriptItem in agent-transcript). */
  kind: 'text' | 'act' | 'notice' | 'thought' | 'plan';
  /**
   * i18n token.
   *   · act    — `act.<name>`, a closed set (see AGENT_ACTS in @openfilm/shared)
   *   · notice — the note the platform leaves (empty for an agent's own notice: its words are in `text`)
   *   · text   — unused; the body is in `text`
   */
  label: string;
  /** Merge key; the React key when a group is opened. */
  id?: string;
  /** What the agent says (markdown). */
  text?: string;
  /** The short tail after the act: a search query or a picture description. Picked before it gets here; only shown. */
  query?: string;
  /** A local agent's file name or command (no quotes: it is not film content). */
  detail?: string;
  plan?: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }>;
  /** The question the agent asks the user (chat.ask). */
  ask?: { question: string; options: Array<{ label: string; description?: string }>; answer?: string; status?: 'answered' | 'skipped' | 'timeout' };
  /** The asset this step made. */
  asset?: AgentActAsset;
  turnNo?: number;
  pending?: boolean;
  /** When a running item started (live timer; live stream only, not archives). */
  startedAt?: number;
  endedAt?: number;
}

/** One folded run. Adjacent acts form a group from the start; text stands alone. */
interface ActivityRun {
  items: AgentActivityItem[];
}

/**
 * Row elements already built, keyed by row identity.
 *
 * `memo` stops the render function running again, not the element being created again, and while
 * streaming the latter dominates: 300 rows in a turn means 300 `jsx()` calls per token, some 7,000 a
 * second at twenty-odd tokens a second.
 *
 * Reusing the same element object also lets React take its earliest bail-out on
 * `oldProps === newProps`, without comparing props.
 *
 * The inner map is bucketed by key because one row has different keys in different lists (live and
 * archived). Member identities are checked too: completing any tool in a group must update its row.
 */
const ROW_ELEMENTS = new WeakMap<AgentActivityItem, Map<string, { items: AgentActivityItem[]; element: React.ReactElement }>>();

function rowElement(run: ActivityRun, key: string): React.ReactElement {
  const first = run.items[0]!;
  let byKey = ROW_ELEMENTS.get(first);
  if (!byKey) { byKey = new Map(); ROW_ELEMENTS.set(first, byKey); }
  const cacheKey = `${key}#${run.items.length}`;
  const hit = byKey.get(cacheKey);
  // A later member can finish or gain an asset while the first member and the group size stay unchanged.
  if (hit && hit.items.every((item, index) => item === run.items[index])) return hit.element;
  const made = <AgentActivityRow key={key} items={run.items} />;
  byKey.set(cacheKey, { items: run.items, element: made });
  return made;
}

function actCopyKey(label: string, pending?: boolean): string {
  if (pending || EPHEMERAL_ACT_LABELS.has(label) || !label.startsWith('act.')) return label;
  return `actDone.${label.slice(4)}`;
}

export const AgentActivityList = React.memo(function AgentActivityList({
  items,
  keyPrefix = 'row',
}: {
  items: AgentActivityItem[];
  keyPrefix?: string;
}) {
  /* Folding depends only on the list. While streaming, every delta gives the list a new identity and this
     loop reruns, but its nodes take row objects cached per item (see toTraceLogItems), so the memoized rows
     below all bail out: a rerun costs one O(n) fold, not n renders. */
  /* Agent text is always laid out as body text, running or finished. Whether a paragraph closes the turn is
     only known once the next act arrives, so styling asides differently would make each paragraph flash and
     jump. Answer and process are told apart by collapsing (turns you did not watch show only the answer). */
  const nodes = React.useMemo(
    () => {
      const runs = buildRuns(items);
      return runs.map((run, index) => rowElement(
        run,
        `${keyPrefix}-${run.items[0]?.id ?? index}`,
      ));
    },
    [items, keyPrefix],
  );
  return <>{nodes}</>;
});

/**
 * One row, or a folded group.
 *
 * `memo` is load-bearing here: a run has hundreds of rows and while streaming only the growing row
 * changes. Every other row's `item` is the same object (toTraceLogItems caches by source identity), so
 * they all skip re-rendering.
 */
const AgentActivityRow = React.memo(function AgentActivityRow({
  items,
}: {
  items: AgentActivityItem[];
}) {
  const t = useT();
  const item = items[0];
  if (!item) return null;

  /* A note the platform leaves in the conversation (today only "earlier messages were summarized").
     Drawn as a labeled divider: it marks that the agent no longer sees the original text above it. */
  if (item.kind === 'notice') {
    /* A local agent's own notice (a Codex warning): its words, quiet, apart from what it says to the person */
    if (item.text) return <p className="break-words py-1 text-[12px] leading-relaxed text-[var(--text-faint)]">{item.text}</p>;
    return (
      <div className="flex items-center gap-2.5 py-1.5">
        <span className="h-px flex-1 bg-[var(--border)]" />
        <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{t(item.label)}</span>
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>
    );
  }

  if (item.kind === 'text') {
    /* Agent text is markdown. As plain text, `**bold**`, `###` and `>` would show raw and paragraphs would
       need splitting by hand; block parsing also drops extra blank lines. */
    const text = item.text ?? '';
    if (!text.trim()) return null;
    return (
      <div className="py-1.5">
        <Markdown text={text} />
      </div>
    );
  }

  if (item.kind === 'plan') return <PlanRow item={item} />;
  /* A lone act that made something folds too: its player would otherwise vanish the moment a second act
     joins the run and the row turns into a closed group (a live row may change, never disappear). */
  if (items.length > 1 || (item.kind === 'act' && item.asset)) return <ActGroup items={items} />;
  if (item.kind === 'thought') return <ThoughtRow item={item} />;
  return <ActRow item={item} />;
});

/** "3m 40s", "48s". Readable in every language and never widens a row. */
export function formatWorkDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/**
 * The agent thought for a while (only a local Codex / Claude Code reports this).
 *
 * While thinking, one shimmering row; then "Thought for 6s", which opens to the agent's own reasoning in
 * muted gray. That text is written for itself, so it starts closed, as Codex and Claude Code show it.
 */
function ThoughtRow({ item }: { item: AgentActivityItem }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  if (item.pending) {
    return <div className="py-1 text-[14px] leading-relaxed"><span className="text-sweep">{t('agent.thinking')}</span></div>;
  }
  const ms = item.startedAt != null && item.endedAt != null ? item.endedAt - item.startedAt : null;
  const label = ms != null && ms >= 1000
    ? t('turnFrame.thought').replace('{t}', formatWorkDuration(ms))
    : t('turnFrame.thoughtShort');
  const text = (item.text ?? '').trim();
  if (!text) return <div className="py-1 text-[14px] leading-relaxed text-[var(--text-faint)]">{label}</div>;
  return (
    <div className="min-w-0 py-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-[14px] leading-relaxed text-[var(--text-faint)] hover:text-[var(--text)]"
      >
        {label}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="mt-1 border-l border-[var(--border)] pl-3">
          <Markdown text={text} muted />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The plan the agent sets itself (ACP's plan: Codex's update_plan, Claude Code's todos). Ticked off in
 * place, not a new card per change. The current item is in text color, the rest gray, so progress shows
 * at a glance.
 */
function PlanRow({ item }: { item: AgentActivityItem }) {
  const t = useT();
  const plan = item.plan ?? [];
  if (!plan.length) return null;
  const done = plan.filter((entry) => entry.status === 'completed').length;
  return (
    <div className="min-w-0 py-1.5">
      <div className="mb-1 text-[13px] text-[var(--text-faint)]">
        {t('turnFrame.plan').replace('{done}', String(done)).replace('{total}', String(plan.length))}
      </div>
      <ul className="flex flex-col gap-0.5">
        {plan.map((entry, index) => {
          const Icon = entry.status === 'completed' ? CircleCheck : entry.status === 'in_progress' ? CircleDot : Circle;
          return (
            <li key={`${index}-${entry.content}`} className="flex min-w-0 items-start gap-2 text-[14px] leading-relaxed">
              <Icon
                size={13}
                aria-hidden
                className={`mt-[5px] shrink-0 ${entry.status === 'in_progress' ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}
              />
              <span className={entry.status === 'in_progress' ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}>
                {entry.content}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Asset URLs. The chat panel does not know the project; the project page provides a function that turns
 * `assets/…` into a fetchable URL. Without one (the bench, other reuse) no preview is drawn.
 */
export const ActAssetUrlContext = React.createContext<((src: string) => string) | null>(null);

/**
 * One icon per act, so pictures, sound and checks are told apart at a glance; a column of equally
 * gray text can only be read line by line.
 */
const ACT_ICONS: Record<string, LucideIcon> = {
  'act.film.review': Eye,
  'act.film.frames': Eye,
  'act.film.hear': Ear,
  'act.film.check': CircleCheck,
  'act.film.arrange': Clapperboard,
  'act.scene.write': PenLine,
  'act.scene.edit': PenLine,
  'act.audio.transcribe': Captions,
  'act.audio.voice': UserRound,
  'act.audio.narrate': Mic,
  'act.audio.sfx': AudioLines,
  'act.audio.music': Music,
  'act.audio.translate': Languages,
  'act.asset.searchImage': Search,
  'act.asset.genImage': ImagePlus,
  'act.asset.genVideo': Video,
  'act.research.search': Globe,
  'act.research.read': FileText,
  'act.files.read': FileText,
  'act.files.search': FileSearch,
  'act.files.edit': FilePen,
  'act.command.run': SquareTerminal,
  'act.chat.ask': MessageCircleQuestion,
};

/**
 * A folded group of adjacent acts, running or finished.
 *
 * Closed by default. Only the acts that finished fold: the summary says which kinds ran and how many of each
 * (see actGroupParts), and the pictures and sounds they made stay in the rows of the acts that made them. An
 * act still running stands under the group, in full, with its clock; once it finishes it joins the count.
 *
 * Opening changes the content height. The asset drawer pins the bottom (pinIfFollowing in the same
 * frame); here the clicked row must stay put instead: skip the next bottom pin and, in the same frame,
 * put the row back where it was when clicked. Otherwise the observer drags the panel back to the bottom
 * and the reply below scrolls away.
 */
const GROUP_PARTS_MAX = 3;

function ActGroup({ items }: { items: AgentActivityItem[] }) {
  const t = useT();
  const thread = React.useContext(StickToBottomContext);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const anchorTop = React.useRef<number | null>(null);
  /* Closed until the user opens it — also while the turn runs. The summary counts up in place without
     unrolling a wall of rows or moving a tool from the status line when it finishes. */
  const [picked, setPicked] = React.useState<boolean | null>(null);
  const open = picked ?? false;
  /* what finished folds; what runs stays in sight under it */
  const done = React.useMemo(() => items.filter((item) => !item.pending), [items]);
  const running = items.filter((item) => item.pending);
  const parts = React.useMemo(() => actGroupParts(done), [done]);
  /* At most three kinds, the rest as a count: seven or eight cut off by an ellipsis tell the reader nothing. */
  const shown = parts.slice(0, GROUP_PARTS_MAX);
  const rest = parts.slice(GROUP_PARTS_MAX).reduce((n, part) => n + part.count, 0);
  const full = parts.map((part) => `${t(actCopyKey(part.label))}${part.count > 1 ? ` ×${part.count}` : ''}`).join(' · ');
  const summary = shown.map((part) => `${t(actCopyKey(part.label))}${part.count > 1 ? ` ×${part.count}` : ''}`).join(' · ');
  const Icon = ACT_ICONS[parts[0]?.label ?? ''] ?? Layers;

  const toggle = () => {
    const node = rootRef.current;
    if (node) {
      thread?.skipNextPin();
      anchorTop.current = node.getBoundingClientRect().top;
    }
    setPicked(!open);
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

  const row = (item: AgentActivityItem, index: number) => (item.kind === 'thought'
    ? <ThoughtRow key={item.id ?? `thought-${index}`} item={item} />
    : <ActRow key={item.id ?? `${item.label}-${index}`} item={item} />);
  const live = running.map(row);
  if (!done.length) return <div ref={rootRef} className="min-w-0">{live}</div>;
  return (
    <div ref={rootRef} className="min-w-0 py-1">
      {/* The chevron follows the text and shows on hover: a dozen groups with a column of chevrons read like a table */}
      <button
        type="button"
        aria-expanded={open}
        onClick={toggle}
        title={full}
        data-activity-header=""
        data-activity-id={items[0]?.id}
        className="group/act flex h-6 w-full min-w-0 items-center gap-2 text-left text-[14px] leading-6 text-[var(--text-faint)] hover:text-[var(--text)]"
      >
        <Icon size={13} aria-hidden className="shrink-0" />
        <span data-activity-label="" className="min-w-0 truncate">{summary}</span>
        {rest ? <span className="shrink-0 tabular-nums opacity-80">+{rest}</span> : null}
        <span className="ml-auto w-12 shrink-0" />
        <ChevronRight
          size={13}
          aria-hidden
          className={`shrink-0 transition-[transform,opacity] ${open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/act:opacity-100 group-focus-visible/act:opacity-100'}`}
        />
      </button>
      {open ? (
        <div className="ml-[6px] mt-0.5 border-l border-[var(--border)] pl-3">
          {done.map(row)}
        </div>
      ) : null}
      {live}
    </div>
  );
}

/**
 * One thing the agent is doing or has done.
 *
 * Finished rows just sit there: no tick, no red. A failed step means nothing actionable to someone who
 * does not code; the agent usually fixes it next, and a red cross only suggests the film is broken. When
 * the turn really fails, a generic message shows above the composer.
 *
 * The same row stays in place from start to finish. Only its label and clock change; typography, icon,
 * spacing stay the same. The description follows the visible label, without invisible text reserving a gap.
 *
 * The description (a narration line, a sound or picture description) is film content: it gets quotes and
 * reads apart from the act name. What the act made hangs under the row: images as thumbnails, sounds play
 * on click.
 */
function ActRow({ item }: { item: AgentActivityItem }) {
  const Icon = ACT_ICONS[item.label];
  return (
    <div className="flex min-w-0 items-start gap-2 py-1 text-[14px] leading-6">
      {Icon ? (
        <Icon size={13} aria-hidden className="mt-[5px] shrink-0 text-[var(--text-faint)]" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div
          data-activity-header=""
          data-activity-id={item.id}
          aria-busy={!!item.pending}
          className="flex h-6 max-w-full min-w-0 items-center gap-1.5 text-left"
        >
          <ActivityLabel label={item.label} pending={!!item.pending} />
          {item.query ? (
            <span className="min-w-0 truncate text-[var(--text-faint)] opacity-80" title={item.query}>
              “{item.query}”
            </span>
          ) : null}
          {/* File name or command: not film content, so no quotes, monospace */}
          {item.detail ? (
            <span className="min-w-0 truncate font-mono text-[12.5px] text-[var(--text-faint)] opacity-80" title={item.detail}>
              {item.detail}
            </span>
          ) : null}
          {/* Reserve the clock's width after completion so long commands keep the same truncation. */}
          <span className="ml-auto flex w-12 shrink-0 justify-end">
            {item.pending ? <PendingElapsed startedAt={item.startedAt} /> : null}
          </span>
        </div>
        {item.asset ? <AssetPreview asset={item.asset} /> : null}
        {item.ask?.status ? <AskOutcome ask={item.ask} /> : null}
      </div>
    </div>
  );
}

/** Keep both states in the same type style, using only the visible words' width. */
function ActivityLabel({ label, pending }: { label: string; pending: boolean }) {
  const t = useT();
  return (
    <span data-activity-label="" className="min-w-0 shrink-0 truncate text-[var(--text-faint)]">
      {t(actCopyKey(label, pending))}
    </span>
  );
}

/** After a question: the answer (verbatim), or skipped / timed out, in which case the agent went on with its own judgment. */
function AskOutcome({ ask }: { ask: NonNullable<AgentActivityItem['ask']> }) {
  const t = useT();
  if (ask.status === 'answered' && ask.answer) {
    return (
      <div className="mt-1 flex min-w-0 items-start gap-1.5 text-[var(--text-faint)]">
        <CornerDownRight size={13} aria-hidden className="mt-[5px] shrink-0 text-[var(--text-faint)]" />
        <span className="min-w-0 whitespace-pre-wrap break-words">{ask.answer}</span>
      </div>
    );
  }
  return (
    <div className="mt-1 flex items-center gap-1.5 text-[var(--text-faint)]">
      <CornerDownRight size={13} aria-hidden className="shrink-0" />
      <span>{t(ask.status === 'timeout' ? 'turnAsk.timedOut' : 'turnAsk.skipped')}</span>
    </div>
  );
}

function AssetPreview({ asset }: { asset: AgentActAsset }) {
  const toUrl = React.useContext(ActAssetUrlContext);
  if (!toUrl) return null;
  return (
    <div className="mt-1.5">
      {asset.kind === 'image' ? <ImageThumb asset={asset} />
        /* The description is already on the row; the pill only needs play and duration. */
        : asset.kind === 'audio' ? <AudioChip asset={asset} label="" />
          : <MediaLink asset={asset} />}
    </div>
  );
}

/**
 * A generated image. `loading="lazy"`: a long conversation has dozens, and off-screen ones should not load.
 * A click opens the original enlarged on this page (not a new tab: this page may be running a generation).
 * If it cannot load (a review frame evicted from cache, a deleted asset), nothing is drawn, not a broken image.
 */
function ImageThumb({ asset }: { asset: AgentActAsset }) {
  const t = useT();
  const toUrl = React.useContext(ActAssetUrlContext)!;
  const url = toUrl(asset.src);
  const [gone, setGone] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  if (gone) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('actGroup.openImage')}
        className="block shrink-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg-field)] transition-opacity hover:opacity-85"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setGone(true)}
          className="max-h-48 max-w-full object-contain"
        />
      </button>
      {open ? (
        <AttachmentPreview
          item={{ name: asset.src.split('/').pop() ?? asset.src, kind: 'image', url }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MediaLink({ asset }: { asset: AgentActAsset }) {
  const toUrl = React.useContext(ActAssetUrlContext)!;
  return (
    <a
      href={toUrl(asset.src)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--border)] px-2.5 text-[12px] text-[var(--text-faint)] hover:text-[var(--text)]"
    >
      <Video size={12} aria-hidden />
      {asset.dur ? formatDur(asset.dur) : null}
    </a>
  );
}

/**
 * One sound. The panel shares one `<audio>`, so playing one stops the last: several sound effects at once
 * are just noise, and a player per row means dozens of decoders and prefetches.
 */
function AudioChip({ asset, label }: { asset: AgentActAsset; label?: string }) {
  const t = useT();
  const toUrl = React.useContext(ActAssetUrlContext)!;
  const url = toUrl(asset.src);
  const [missing, setMissing] = React.useState(false);
  React.useEffect(() => {
    const controller = new AbortController();
    setMissing(false);
    void fetch(url, { headers: { range: 'bytes=0-0' }, signal: controller.signal })
      .then(async response => { setMissing(response.status === 404 || response.status === 410); await response.body?.cancel(); })
      .catch(() => {});
    return () => controller.abort();
  }, [url]);
  /* "Which one is playing" is tied to this button, not the URL: the agent can redo a file under the same
     name (a redone sound effect is still pop-soft), so several buttons can point at one URL. */
  const owner = React.useId();
  const playing = React.useSyncExternalStore(subscribePlayer, () => playerOwner === owner, () => false);
  const failed = React.useSyncExternalStore(subscribePlayer, () => playerFailedOwner === owner, () => false);
  /* A sound is named by its description (the narration line, what the effect is); the file name is the
     agent's internal name (s1, s2), used only when there is no description. */
  const name = label ?? asset.src.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') ?? '';
  if (missing) return null;
  return (
    <button
      type="button"
      onClick={() => togglePlayer(url, owner)}
      aria-label={playing ? t('actGroup.pause') : t('actGroup.play')}
      title={failed ? t('assets.previewFailed') : undefined}
      className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors ${
        playing
          ? 'border-[var(--accent)] text-[var(--text)]'
          : 'border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text)]'
      }`}
    >
      {playing ? <Pause size={12} aria-hidden className="shrink-0" /> : <Play size={12} aria-hidden className="shrink-0" />}
      {name ? <span className="min-w-0 max-w-[11rem] truncate">{name}</span> : null}
      {asset.dur ? <span className="shrink-0 tabular-nums opacity-70">{formatDur(asset.dur)}</span> : null}
    </button>
  );
}

function formatDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ── The one player the panel shares ── */
let player: HTMLAudioElement | null = null;
/** The button now playing (its useId). */
let playerOwner: string | null = null;
let playerFailedOwner: string | null = null;
const playerListeners = new Set<() => void>();

function notifyPlayer(): void {
  for (const listener of playerListeners) listener();
}

function subscribePlayer(listener: () => void): () => void {
  playerListeners.add(listener);
  return () => { playerListeners.delete(listener); };
}

function togglePlayer(url: string, owner: string): void {
  if (typeof Audio === 'undefined') return;
  if (!player) {
    player = new Audio();
    player.preload = 'none';
    player.addEventListener('ended', () => { playerOwner = null; notifyPlayer(); });
    player.addEventListener('error', () => { playerFailedOwner = playerOwner; playerOwner = null; notifyPlayer(); });
  }
  if (playerOwner === owner) {
    player.pause();
    playerOwner = null;
  } else {
    playerFailedOwner = null;
    player.src = url;
    playerOwner = owner;
    void player.play().catch((e: unknown) => {
      /* Switching sounds interrupts the previous play() with an AbortError: a switch, not a failure.
         Reset only when this button itself cannot play. */
      if ((e as { name?: string } | null)?.name === 'AbortError' || playerOwner !== owner) return;
      playerOwner = null;
      notifyPlayer();
    });
  }
  notifyPlayer();
}

/**
 * While a turn runs, the single row underneath: what is happening now.
 *
 * A visible status has its own row above the hover actions. When there is nothing to say, render nothing
 * rather than an empty row separating the reply from its copy button and model name.
 *
 *   · work running: nothing, because the tool already has its row in the conversation;
 *   · thinking: "Thinking";
 *   · neither: the caller's text (reconnecting and the like), else "Thinking".
 *
 * `ownAgent`: the turn runs on the app's own agent (see IdleStatus).
 */
export function StatusLine({ items, fallback, ownAgent = false }: { items: AgentActivityItem[]; fallback?: string | null; ownAgent?: boolean }) {
  const t = useT();
  const running = React.useMemo(() => pendingWork(items), [items]);
  /* The last time anything happened: each new item (text, an act starting or finishing) gives the list a new identity */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const changedAt = React.useMemo(() => Date.now(), [items]);
  /* something waits for the person's answer (a question, a permission, a spend, above the composer): what else runs
     meanwhile is not what holds the turn up — no clock, no sweep */
  const waitingForYou = React.useContext(WaitingContext);
  if (waitingForYou) return <StatusShell Icon={MessageCircleQuestion} label={t('act.waitingForYou')} since={changedAt} waiting />;
  const acts = running.filter((item) => item.kind === 'act');
  if (acts.length) {
    return null;
  }
  if (running.length || fallback) {
    return <StatusShell label={running.length ? t('act.thinking') : fallback!} since={changedAt} />;
  }
  /* The agent is speaking (text still streaming): no "Working" underneath, the text itself moves. Just after a
     paragraph, say nothing for a while (the seconds spent wrapping up a turn, or an act about to start)
     and say "Working" only once it is quiet. */
  let last: AgentActivityItem | undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) if (items[i]!.kind !== 'notice') { last = items[i]; break; }
  if (last?.kind === 'text' && last.pending) return null;
  return <IdleStatus since={changedAt} quietFirst={last?.kind === 'text'} ownAgent={ownAgent} />;
}

/** How long after a paragraph before saying "Working". */
const AFTER_TEXT_MS = 5_000;

/**
 * The stretch where nothing is reported.
 *
 * When a local Codex / Claude Code writes a whole scene file, the command is reported only once it is
 * written, which can be two minutes of silence. With only a stop button showing, that looks frozen. So
 * the row stays: "Working" plus the seconds since the last activity, "Still working" after half a minute
 * of quiet. A moving clock shows it is alive.
 *
 * The app's own agent says "Waiting for the model" after two minutes, with why as the row's faint words: some
 * models think for minutes before the first word. Those words go in the row, not on a line of their own, so it
 * stays one row high.
 */
function IdleStatus({ since, quietFirst = false, ownAgent = false }: { since: number; quietFirst?: boolean; ownAgent?: boolean }) {
  const t = useT();
  const tick = useTick();
  const idle = (tick ?? Date.now()) - since;
  if (quietFirst && idle < AFTER_TEXT_MS) return null;
  const label = idleStatus(idle, ownAgent);
  return <StatusShell label={t(label)} extra={label === 'act.waitingForModel' ? t('act.waitingForModelHint') : undefined} plain since={since} />;
}

/* Status row: the act's icon while an act runs; thinking / working is text only, flush left. The shimmer
   already says "in progress", so no spinner and no empty slot pushing the text right. */
function StatusShell({ Icon, label, extra, plain = false, since, waiting = false }: { Icon?: LucideIcon | undefined; label: string; extra?: string | undefined; plain?: boolean; since: number; waiting?: boolean }) {
  return (
    <div role="status" className="flex h-6 min-w-0 items-center gap-2 text-[14px]">
      {Icon ? <Icon size={13} aria-hidden className="shrink-0 text-[var(--text-faint)]" /> : null}
      <span className={`${waiting ? '' : 'text-sweep '}min-w-0 truncate ${extra ? 'max-w-[60%] shrink-0' : ''}`}>{label}</span>
      {extra ? (
        <span className={`min-w-0 truncate text-[var(--text-faint)] opacity-80 ${plain || extra.startsWith('“') ? '' : 'font-mono text-[12.5px]'}`} title={extra}>
          {extra}
        </span>
      ) : null}
      {waiting ? null : <PendingElapsed startedAt={since} />}
    </div>
  );
}

/**
 * The running row's clock. The once-a-second subscription lives only here, so finished rows (hundreds
 * in a long conversation) do not re-render every second.
 */
function PendingElapsed({ startedAt }: { startedAt: AgentActivityItem['startedAt'] }) {
  const tick = useTick();
  const elapsed = elapsedLabel(startedAt, tick);
  if (!elapsed) return null;
  return (
    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[var(--text-faint)]">
      {elapsed}
    </span>
  );
}
