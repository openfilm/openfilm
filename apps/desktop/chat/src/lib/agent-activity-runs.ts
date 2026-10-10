import type { AgentActAsset } from '@openfilm/shared';

/**
 * How a turn's activity is laid out in rows.
 *
 * One rule: while a turn runs, a row already on screen may change in place but never disappear. If a running
 * action had its own row and merged into the group above when done, every finish would collapse a row and shift
 * everything below; with many actions in parallel the list jumps up and down.
 *
 * So:
 *   · running actions are not in the list; they live in the single status row under the turn (see pendingWork),
 *     one row high throughout, its content changing in place;
 *   · finished actions between two messages fold into one row; new ones merge in and the row updates in place;
 *   · the agent's messages, plans and notices each get a row.
 *
 * Some are only status words, not work (thinking, working, planning, reconnecting): shown in the status row
 * while current, gone when done. They are not folded with the tools nor kept as rows: "thought for 6s" between
 * "read 3 files · ran 2 commands" would read like a tool.
 */

export interface ActivityRunItem {
  kind: 'text' | 'act' | 'notice' | 'thought' | 'plan';
  pending?: boolean;
  /** The i18n key. Status rows are recognized by it and dropped when done. */
  label?: string;
  /** What this step made (audio, an image, a film check frame). */
  asset?: unknown;
}

export interface ActivityRun<T extends ActivityRunItem> {
  items: T[];
}

/** Status rows with no past tense: shown in the status row while current, gone when done, never in the summary. */
export const EPHEMERAL_ACT_LABELS = new Set([
  'act.working',
  'act.stillWorking',
  'act.thinking',
  'act.planning',
  'act.connecting',
]);

function isEphemeral(item: ActivityRunItem): boolean {
  return item.kind === 'act' && !!item.label && EPHEMERAL_ACT_LABELS.has(item.label);
}

/** A question to the person gets its own row, not folded into a summary: the question and answer must show at a glance. */
const STANDALONE_ACT_LABELS = new Set(['act.chat.ask']);

/**
 * Finished work (tool calls). It folds into one summary row, including steps that made something (voice, sound,
 * music, an image, a frame), so a turn with many of them doesn't push the answer away. Expanded, each result still
 * hangs under the row that made it.
 */
function isFinishedWork(item: ActivityRunItem): boolean {
  return item.kind === 'act' && !item.pending && !isEphemeral(item)
    && !(item.label != null && STANDALONE_ACT_LABELS.has(item.label));
}

export function buildRuns<T extends ActivityRunItem>(items: T[]): ActivityRun<T>[] {
  const runs: ActivityRun<T>[] = [];
  /* Whether the last run is finished work. Only the last run matters, so one flag is enough; this runs every frame
     while live and must not rescan the run on every merge. */
  let lastIsWork = false;
  for (const item of items) {
    /* Running actions take no row; status words (thinking, working…) vanish when done */
    if (item.kind === 'thought' || (item.kind === 'act' && (item.pending || isEphemeral(item)))) continue;
    const last = runs[runs.length - 1];
    const work = isFinishedWork(item);
    if (last && lastIsWork && work) {
      last.items.push(item);
      continue;
    }
    runs.push({ items: [item] });
    lastIsWork = work;
  }
  return runs;
}

/** Work still running now (for the status row). */
export function pendingWork<T extends ActivityRunItem>(items: readonly T[]): T[] {
  return items.filter((item) => (item.kind === 'act' || item.kind === 'thought') && item.pending && !isEphemeral(item));
}


/**
 * The folded row's summary: which kinds of things were done and how often, in order of first appearance, the same
 * order as the expanded list. Counts are ×N, avoiding plurals in five languages. The renderer decides how many
 * parts to show.
 */
export function actGroupParts<T extends ActivityRunItem>(items: readonly T[]): Array<{ label: string; count: number }> {
  const parts: Array<{ label: string; count: number }> = [];
  const at = new Map<string, number>();
  items.forEach((item) => {
    const label = item.kind === 'thought' ? 'turnFrame.thoughtShort' : item.label ?? '';
    const found = at.get(label);
    if (found === undefined) { at.set(label, parts.length); parts.push({ label, count: 1 }); }
    else parts[found]!.count += 1;
  });
  return parts.map(({ label, count }) => ({ label, count }));
}

/**
 * After a turn ends, which part is the process and which the answer.
 *
 * The answer is the messages after the last piece of work (action, thought or plan). Everything before folds into
 * one row, "Worked 3m 40s · 14 steps", expanded on click. This applies only to turns not watched live (after a
 * reload, older turns); a turn watched to its end stays as it is until the next message is sent (see
 * ProjectConversation).
 *
 * Returns the index where the answer starts. -1: the turn did no work (a question and a reply, at most some
 * thinking), so there is nothing to fold; a "Worked 5s" row with nothing inside would be empty.
 * items.length: work ran to the end with no message (stopped or cut off); the process folds and the answer is empty.
 */
export function answerStart<T extends ActivityRunItem>(items: readonly T[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    /* Status words and thoughts are not work: one popping up just before the end must not empty the answer. */
    if (isEphemeral(item) || item.kind === 'thought') continue;
    if (item.kind === 'act' || item.kind === 'plan') return i + 1;
  }
  return -1;
}

/** The "N steps" of the folded row: visible actions (status rows with no past tense don't count). */
export function countedSteps<T extends ActivityRunItem>(items: readonly T[]): number {
  let n = 0;
  for (const item of items) {
    if (item.kind === 'act' && !(item.label && EPHEMERAL_ACT_LABELS.has(item.label))) n += 1;
  }
  return n;
}

/** Film inspection documents a check; it is not produced or found media. */
export function isInspectionActivity(item: { label?: string; asset?: AgentActAsset }): boolean {
  return item.label === 'act.film.check' || item.label === 'act.film.look';
}

/** Only deliverable media stays visible outside collapsed tool/work records. */
export function activityDeliverables(items: readonly { label?: string; query?: string; asset?: AgentActAsset }[]): Array<{ asset: AgentActAsset; label?: string }> {
  return items.flatMap((item) => item.asset && !isInspectionActivity(item)
    ? [{ asset: item.asset, ...(item.query ? { label: item.query } : {}) }] : []);
}
