/**
 * What the agent did this turn: what it said and what it did.
 *
 * Two sources feed one shape:
 *   - the running turn: agent-text / agent-act / agent-act-done from the public SSE stream
 *   - finished turns: the server-projected PublicProgressSnapshot.steps
 * Both reduce to the same item, so the panel has one rendering path, not one for live and one for
 * history, which are two readings of the same process.
 *
 * This layer has no filtering and should not: tool names, inputs, command lines and reasoning are
 * already left out of the events on the server (see agent-activity and public-stream in
 * @openfilm/shared). Filtering again on the client would leave the raw fields in the network panel:
 * hidden, not absent.
 */
import {
  TRANSCRIPT_TEXT_MAX,
  clipTranscriptText,
  mergeStreamText,
  type AgentAct,
  type AgentActAsset,
  type AgentAsk,
  type PublicGenerationEvent,
  type PublicProgressSnapshot,
  type PublicTimelineStep,
} from '@openfilm/shared';
import type { AgentActivityItem } from '@/components/AgentActivityRow';

export interface TranscriptItem {
  /** Merge key: text by partId, acts by callId. */
  id: string;
  /**
   * `thought` / `plan` only come from an agent on the user's machine (Codex / Claude Code, see
   * local-agent-run): the built-in agent's reasoning is not sent, and it has no plan tool.
   */
  kind: 'text' | 'act' | 'notice' | 'thought' | 'plan';
  /** What it is doing (a closed set); absent for text / notice. */
  act?: AgentAct;
  /** The short visible text after the act (search query / picture description), picked by the server. */
  query?: string;
  /**
   * The short tail after a local agent's file or command act: the file name or the command. Local
   * sources only: that is the user's own agent working in the user's own folder.
   */
  detail?: string;
  /** The plan checklist (each ACP plan update is the whole list, replaced in place). */
  plan?: TranscriptPlanEntry[];
  /** The `chat.ask` row: the question and options the agent stopped to ask. */
  ask?: AgentAsk;
  /** The asset this step made (image / sound / shot), seen and heard right in the conversation. Picked by the server. */
  asset?: AgentActAsset;
  /**
   * The notice row's i18n key (the full token, resolved by t() when rendering).
   *
   * These rows are not the agent speaking but a note the platform leaves in the conversation; today
   * there is one: earlier messages were summarized. It belongs in the conversation, because what it
   * says is that the agent no longer has the original of the text above it.
   */
  noticeKey?: string;
  text?: string;
  turnNo?: number;
  /** Still running: text not final, or an act sent but not yet back. */
  pending: boolean;
  /** When the client first saw it, to time running rows; history has none. */
  startedAt?: number;
  /** When thinking ended (thought only: "Thought for 6s"). */
  endedAt?: number;
}

export interface TranscriptPlanEntry {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/**
 * Merges one public stream event into the record.
 *
 * Pure, returning a new array: on an SSE reconnect the server replays from the start, so this must be
 * idempotent; the same partId / callId again updates in place rather than adding a row.
 */
export function reduceTranscript(
  items: TranscriptItem[],
  event: PublicGenerationEvent,
  now: number = Date.now(),
): TranscriptItem[] {
  switch (event.type) {
    case 'agent-text': {
      const id = `text:${event.partId ?? event.turnNo}`;
      const at = items.findIndex((item) => item.id === id);
      // No partId (older servers) means the whole text came at once: final.
      const pending = event.partId != null && event.done !== true;
      if (at >= 0) {
        const next = [...items];
        next[at] = {
          ...next[at]!,
          text: mergeStreamText(next[at]!.text ?? '', event.text),
          pending,
        };
        return next;
      }
      return [...items, {
        id,
        kind: 'text',
        text: event.text,
        turnNo: event.turnNo,
        pending,
        startedAt: now,
      }];
    }

    case 'agent-act': {
      const id = `act:${event.callId}`;
      const at = items.findIndex((item) => item.id === id);
      if (at >= 0) {
        const next = [...items];
        next[at] = {
          ...next[at]!,
          act: event.act,
          ...(event.query !== undefined ? { query: event.query } : {}),
          ...(event.ask ? { ask: event.ask } : {}),
        };
        return next;
      }
      return [...items, {
        id,
        kind: 'act',
        act: event.act,
        ...(event.query ? { query: event.query } : {}),
        ...(event.ask ? { ask: event.ask } : {}),
        turnNo: event.turnNo,
        pending: true,
        startedAt: now,
      }];
    }

    /* Only stops that row.
       A callId with no match is normal: the server sends this for every tool_result, and most of those
       acts (read / grep / glob) drew no row. Then do nothing; never stop another row instead. */
    case 'agent-act-done': {
      const at = event.callId
        ? items.findIndex((item) => item.id === `act:${event.callId}`)
        : findLastPendingAct(items);
      if (at < 0 || items[at]!.kind !== 'act') return items;
      const next = [...items];
      next[at] = { ...next[at]!, pending: false, ...(event.asset ? { asset: event.asset } : {}) };
      return next;
    }

    /* Thinking only drives the status line underneath. Drafts are not sent and vanish when done: not in the conversation, not in the summary. */
    case 'agent-thinking':
      return items;

    /* The agent's question settled (answered / skipped / timed out): write it back to its row, so the conversation
       reads "asked what · answered what". The question's id is not the tool call's callId, so match the latest
       unsettled question; a turn asks at most once. */
    case 'ask-settled': {
      for (let at = items.length - 1; at >= 0; at -= 1) {
        const item = items[at]!;
        if (item.kind !== 'act' || item.act !== 'chat.ask' || !item.ask || item.ask.status) continue;
        const next = [...items];
        next[at] = { ...item, ask: { ...item.ask, status: event.status, ...(event.answer ? { answer: event.answer } : {}) } };
        return next;
      }
      return items;
    }

    /* Most context events only update the percentage (the caller reads it) and leave the record alone.
       Only "just compacted" leaves a mark in the conversation, with a fixed id so a replay never adds a second. */
    case 'context': {
      if (!event.compacted) return items;
      const id = 'notice:context-compacted';
      if (items.some((item) => item.id === id)) return items;
      return [...items, {
        id,
        kind: 'notice',
        noticeKey: 'agent.contextCompacted',
        pending: false,
        startedAt: now,
      }];
    }

    default:
      return items;
  }
}

function findLastPendingAct(items: TranscriptItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]!.kind === 'act' && items[index]!.pending) return index;
  }
  return -1;
}

/**
 * Server-projected snapshot → the same items. History has no timing, so no startedAt.
 *
 * No second trim here: it was projected before it was sent (publicProgressSnapshot), and the shape
 * this function receives has no tool name or input fields to cut.
 */
export function transcriptFromSteps(
  steps: PublicTimelineStep[] | undefined,
): TranscriptItem[] {
  if (!steps?.length) return [];
  return steps.map((step) => {
    if (step.kind === 'act') {
      return {
        id: step.id,
        kind: 'act' as const,
        act: step.act,
        ...(step.query ? { query: step.query } : {}),
        ...(step.asset ? { asset: step.asset } : {}),
        ...(step.ask ? { ask: step.ask } : {}),
        ...(step.turnNo != null ? { turnNo: step.turnNo } : {}),
        pending: step.running === true,
      };
    }
    return {
      id: step.id,
      kind: 'text' as const,
      text: clipTranscriptText(step.text, TRANSCRIPT_TEXT_MAX),
      ...(step.turnNo != null ? { turnNo: step.turnNo } : {}),
      pending: step.running === true,
    };
  });
}

export function transcriptFromSnapshot(
  snapshot: PublicProgressSnapshot | null | undefined,
): TranscriptItem[] {
  return transcriptFromSteps(snapshot?.steps);
}

/**
 * Rows already mapped, keyed by source object identity.
 *
 * This is what lets the whole list memoize. `reduceTranscript` replaces only the row a delta touched
 * and passes the rest through, so which rows did not change is already exact in the data. If this step
 * built new objects every time, that would be lost: two hundred rows with new identities, `React.memo`
 * stops none, and every token is a full re-render.
 *
 * A WeakMap rather than a Map: the keys are the rows themselves, so the cache is collected with them.
 */
const TRACE_ITEMS = new WeakMap<TranscriptItem, AgentActivityItem>();

/**
 * Render adapter: AgentActivityList already draws these rows; this only maps the field names.
 *
 * The output must be cacheable: the same TranscriptItem must always give the same object (see the map
 * above). So this depends only on its input, never on the clock or randomness, which would quietly
 * corrupt the cache.
 */
export function toTraceLogItems(items: TranscriptItem[]): AgentActivityItem[] {
  return items.map((item) => {
    const cached = TRACE_ITEMS.get(item);
    if (cached) return cached;
    const mapped = traceLogItem(item);
    TRACE_ITEMS.set(item, mapped);
    return mapped;
  });
}

function traceLogItem(item: TranscriptItem): AgentActivityItem {
  if (item.kind === 'notice') {
    return { kind: 'notice' as const, id: item.id, label: item.noticeKey ?? '' };
  }
  if (item.kind === 'thought') {
    return {
      kind: 'thought' as const,
      id: item.id,
      label: 'thought',
      text: item.text ?? '',
      pending: item.pending,
      ...(item.startedAt != null ? { startedAt: item.startedAt } : {}),
      ...(item.endedAt != null ? { endedAt: item.endedAt } : {}),
    };
  }
  if (item.kind === 'plan') {
    return { kind: 'plan' as const, id: item.id, label: 'plan', plan: item.plan ?? [], pending: item.pending };
  }
  if (item.kind === 'act') {
    return {
      kind: 'act' as const,
      id: item.id,
      // The copy key is the act itself. An unknown key renders an empty row, and acts are a closed set,
      // so a missing line of copy is a slip tests can catch, not a leak in production.
      label: `act.${item.act ?? 'working'}`,
      ...(item.query ? { query: item.query } : {}),
      ...(item.detail ? { detail: item.detail } : {}),
      ...(item.ask ? { ask: item.ask } : {}),
      ...(item.asset ? { asset: item.asset } : {}),
      ...(item.turnNo != null ? { turnNo: item.turnNo } : {}),
      pending: item.pending,
      ...(item.startedAt != null ? { startedAt: item.startedAt } : {}),
    };
  }
  return {
    kind: 'text' as const,
    id: item.id,
    label: 'text',
    text: item.text ?? '',
    ...(item.turnNo != null ? { turnNo: item.turnNo } : {}),
    pending: item.pending,
    ...(item.startedAt != null ? { startedAt: item.startedAt } : {}),
  };
}

/**
 * Whether the line underneath should show.
 *
 * Do not give each activity its own caption. While an act runs, its row is lit with its own label;
 * while text streams, the words appear on screen. A caption underneath would repeat what the user
 * already sees.
 *
 * The one case that needs the line is when nothing runs: the message is sent and the model has not
 * started. Then the screen really is empty, and without a word it looks frozen.
 *
 * Returns true when something is running, so no line is needed.
 */
export function transcriptBusy(items: TranscriptItem[]): boolean {
  return items.some((item) => item.pending);
}

/**
 * Whether the agent has finished talking this turn: is the last item a finished paragraph.
 *
 * A turn does not end with the agent's last sentence: the platform still wraps up for some seconds,
 * with the transcript still and the task still running. Without this check a "planning the next step"
 * line would hang there after the agent has signed off; the work left is the platform's and not worth
 * announcing.
 *
 * When the last item is a finished act (or there is none), the model is about to speak, and that really
 * is waiting for it.
 */
export function transcriptDoneTalking(items: TranscriptItem[]): boolean {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    // Marks such as dividers are not the agent's doing: look at the item before.
    if (item.kind === 'notice') continue;
    return item.kind === 'text' && !item.pending;
  }
  return false;
}

/**
 * Reconciles the live cache with the saved transcript, keeping what is more complete.
 *
 * Comparing counts alone fails in one concrete case: a Q&A turn is usually one paragraph; if SSE stops
 * mid-way, the live copy is half a sentence and the saved one the full text, both with a count of 1, so
 * keeping the live copy leaves the client stopped mid-sentence. Merge by id instead, text through
 * mergeStreamText: a longer prefix wins.
 *
 * The ids must be aligned too: live uses `text:4:1` / `act:call`, saved uses `text-4:1` / `tool-call`.
 * Unaligned, they never merge and the half and the full text show side by side.
 */
export function preferTranscript(live: TranscriptItem[], disk: TranscriptItem[]): TranscriptItem[] {
  if (live.length === 0) return disk;
  if (disk.length === 0) return live;
  /* Order follows the saved copy (written in the order things happened), so steps the live copy missed
     land where they belong, not at the end. Items only in the live copy follow the item before them there. */
  const liveByKey = new Map<string, TranscriptItem>();
  for (const item of live) {
    const key = transcriptMergeKey(item);
    const prev = liveByKey.get(key);
    liveByKey.set(key, prev ? pickRicherTranscript(prev, item) : item);
  }
  const diskKeys = new Set(disk.map(transcriptMergeKey));
  const trailing = new Map<string | null, TranscriptItem[]>();
  let anchor: string | null = null;
  const placed = new Set<string>();
  for (const item of live) {
    const key = transcriptMergeKey(item);
    if (diskKeys.has(key)) { anchor = key; continue; }
    if (placed.has(key)) continue;
    placed.add(key);
    const list = trailing.get(anchor) ?? [];
    list.push(liveByKey.get(key)!);
    trailing.set(anchor, list);
  }
  const out: TranscriptItem[] = [...(trailing.get(null) ?? [])];
  const seen = new Set<string>();
  for (const item of disk) {
    const key = transcriptMergeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    const prev = liveByKey.get(key);
    out.push(prev ? pickRicherTranscript(prev, item) : item);
    out.push(...(trailing.get(key) ?? []));
  }
  return out;
}

function transcriptMergeKey(item: TranscriptItem): string {
  if (item.kind === 'text') return item.id.replace(/^text[-:]/, 'text:');
  if (item.kind === 'act') return item.id.replace(/^(?:act:|tool-)/, 'act:');
  return item.id;
}

function pickRicherTranscript(a: TranscriptItem, b: TranscriptItem): TranscriptItem {
  /* Same content: return the original. Downstream memoizes by object identity (each row, each run), so a new object with the same content re-renders the whole turn. */
  if (a === b) return a;
  if (a.kind === 'text' && b.kind === 'text') {
    if ((a.text ?? '') === (b.text ?? '') && Boolean(a.pending) === Boolean(b.pending)) return a;
    const text = mergeStreamText(a.text ?? '', b.text ?? '');
    const base = (b.text ?? '').length > (a.text ?? '').length ? b : a;
    return { ...base, text, pending: a.pending && b.pending };
  }
  if (a.kind === 'act' && b.kind === 'act') {
    if (a.pending && !b.pending) return b;
    if (b.pending && !a.pending) return a;
    // The live copy often lacks the asset (its receipt was missed); the saved copy has it.
    if (!a.asset && b.asset) return { ...a, asset: b.asset };
  }
  return a;
}

/**
 * Finalizes the text when the turn ends.
 *
 * `replied.text` is the agent's whole last message. Snapshots stream in 80-byte steps and the last
 * cumulative one may miss the live cache, but the final event carries the full text. An empty string
 * must not overwrite: a reply the server rebuilds from storage is often empty, which means the text is
 * in the process record, not that the agent said nothing.
 */
export function sealTranscriptText(items: TranscriptItem[], text: string): TranscriptItem[] {
  const sealed = items.some((item) => item.pending)
    ? items.map((item) => (item.pending ? { ...item, pending: false } : item))
    : items;
  if (!text.trim()) return sealed;
  for (let i = sealed.length - 1; i >= 0; i -= 1) {
    const item = sealed[i]!;
    if (item.kind !== 'text') continue;
    const merged = mergeStreamText(item.text ?? '', text);
    if (merged === (item.text ?? '')) return sealed;
    const next = [...sealed];
    next[i] = { ...item, text: merged, pending: false };
    return next;
  }
  return [...sealed, { id: 'text:reply', kind: 'text', text, pending: false }];
}
