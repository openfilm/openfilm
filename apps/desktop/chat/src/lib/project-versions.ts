import type { Turn, LibraryVideo, PromptDisplay, TurnAttachment } from '@openfilm/shared';
import { readFilmChanges, type ClipChange, type TurnFilmChanges } from './film-changes';
import { readBalance, type Balance, type TurnBalance } from './balance';

/**
 * A project's conversation: each of its turns, in time order.
 *
 * Not every turn makes a film: a turn can be only talk, or stop before a film. So the list is every turn of the
 * conversation; a film only decides whether a row has a poster and counts as a version, not whether it exists.
 */
export interface ProjectVersionEntry {
  assetId: string;
  /** Turns that made a film get a version (v1..vN); a turn that only talked has none. */
  label: string;
  title: string;
  /** What the person sent in this turn; the content of its bubble. */
  prompt: string;
  /**
   * The message as written in the composer (with pill markers). When present it is rendered, pills as pills.
   *
   * Empty in two cases, both falling back to `prompt`: the message referenced no pill (the two are identical),
   * or it was sent before this field existed.
   */
  promptDisplay?: PromptDisplay;
  /** What came with the message (names and thumbnails); empty when nothing did. */
  attachments: TurnAttachment[];
  /** The poster of the film this turn made; empty when it made none (talk, running, failed). */
  posterUrl?: string;
  status: 'ready' | 'active' | 'failed';
  current: boolean;
  /** Which agent answered (codex, claude…). */
  agent?: string;
  /** The model name shown, e.g. "gpt-5.5 · Medium". */
  model?: string;
  /** How long the turn ran. Only for settled turns whose times make sense. */
  durationMs?: number;
  /** How the turn stopped when it didn't finish normally. Empty when it did. */
  outcome?: 'stopped' | 'failed' | 'balance';
  /** outcome 'balance': which service had no balance left, and its page */
  balance?: Balance;
  /** When the message was sent (ISO). Hovering under the bubble says "N minutes ago". */
  createdAt?: string;
  /** When the turn settled (ISO), only for settled turns. Hovering under the reply says "N minutes ago". */
  settledAt?: string;
  /** What the turn changed in the film, clip by clip (lib/film-changes); none when nothing did. */
  filmChanges?: ClipChange[];
}

/** Longest believable turn: anything longer most likely means a later write touched updatedAt. */
const DURATION_MAX_MS = 3 * 60 * 60 * 1000;

function frameOf(asset: Turn): Pick<ProjectVersionEntry, 'agent' | 'model' | 'durationMs' | 'outcome' | 'balance' | 'createdAt' | 'settledAt'> {
  const settled = asset.status === 'ready' || asset.status === 'error' || asset.status === 'cancelled';
  const ms = Date.parse(asset.updatedAt) - Date.parse(asset.createdAt);
  const model = asset.localAgent?.model ?? null;
  /* no balance left: said by the service's name, the same for every one */
  const balance = asset.status === 'error' ? readBalance((asset as Turn & TurnBalance).balance) : null;
  const outcome = asset.status === 'cancelled' ? 'stopped' as const
    : balance ? 'balance' as const : asset.status === 'error' ? 'failed' as const : null;
  /* a turn saved before turns named their agent: which one is not known */
  const agent = asset.localAgent?.id ?? null;
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(settled && Number.isFinite(ms) && ms > 0 && ms < DURATION_MAX_MS ? { durationMs: ms } : {}),
    ...(outcome ? { outcome } : {}),
    ...(balance ? { balance } : {}),
    ...(asset.createdAt ? { createdAt: asset.createdAt } : {}),
    ...(settled && asset.updatedAt ? { settledAt: asset.updatedAt } : {}),
  };
}

function statusOf(asset: Turn, hasFilm: boolean): ProjectVersionEntry['status'] {
  if (asset.status === 'generating' || asset.status === 'failing' || asset.status === 'canceling') {
    return 'active';
  }
  /* Ready without a film means the turn only talked; it didn't fail. Marked failed, a simple question like
     "how long is this film" would get a red label. */
  if (asset.status === 'ready') return 'ready';
  return hasFilm ? 'ready' : 'failed';
}

export function deriveProjectTurns(
  turns: Turn[],
  videos: LibraryVideo[],
  selectedId: string | null,
): ProjectVersionEntry[] {
  /* The order is set here: callers pass lists from mergeAssetLists, newest first, which would render the
     conversation backwards. */
  const ordered = [...turns].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  let filmCount = 0;
  return ordered.map((asset) => {
    const film = videos.find((item) => item.turnId === asset.id);
    if (film) filmCount += 1;
    const filmChanges = readFilmChanges((asset as Turn & TurnFilmChanges).filmChanges);
    return {
      assetId: asset.id,
      label: film ? `v${filmCount}` : '',
      title: asset.prompt,
      prompt: asset.prompt,
      ...(asset.promptDisplay ? { promptDisplay: asset.promptDisplay } : {}),
      attachments: asset.attachments ?? [],
      ...(film?.result.posterUrl ? { posterUrl: film.result.posterUrl } : {}),
      status: statusOf(asset, Boolean(film)),
      current: asset.id === selectedId,
      ...frameOf(asset),
      ...(filmChanges ? { filmChanges } : {}),
    };
  });
}
