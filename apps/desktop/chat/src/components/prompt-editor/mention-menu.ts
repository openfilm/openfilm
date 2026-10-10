/**
 * The `@` menu: when typing counts as an `@`, which items show, and in what order.
 *
 * Pure logic; the Lexical half is in MentionMenuPlugin. Kept apart so these rules can be
 * tested on plain strings: an email address opening the menu, or the best match ranked
 * eighth, raises no error.
 */
import type { PromptReference, PromptReferenceKind } from './prompt-text';

/**
 * One menu item.
 *
 * It does not know whether it stands for a moment or a file; the provider does. Here it
 * is only an icon, a label, what typing finds it, and the reference it yields.
 */
export interface MentionItem {
  /** Unique in the menu. The id of the reference it will become is simplest. */
  id: string;
  /** The kind of reference it yields; the menu draws the same icon as the pill. */
  kind: PromptReferenceKind;
  label: string;
  /** The small text after the label: a file size, a timecode. */
  detail?: string;
  /** Other words that find it besides the label: English aliases, the full path. */
  keywords?: string[];
  /** Not usable now; with no film yet, there is no current time. */
  disabled?: boolean;
  /** Why it is not usable; a gray item without a reason looks broken. */
  disabledHint?: string;
  /**
   * Picks it: records what it needs and returns how it appears in the sentence, possibly
   * several references (the current selection is every selected thing). Null or empty
   * means it failed (too many references, or the thing is gone).
   */
  select: () => PromptReference | PromptReference[] | null;
}

/**
 * A group of things `@` can pick.
 *
 * The menu only knows groups, not moments or files. Something new to mention is a new
 * provider in the array.
 */
export interface MentionProvider {
  /** The group's id, used as the render key; unique within one menu. */
  id: string;
  /** The group title, already localized; this layer has no i18n. */
  groupLabel: string;
  items: MentionItem[];
}

/** One menu row: the item, its group, and whether the group title goes above it. */
export interface MentionEntry {
  item: MentionItem;
  providerId: string;
  groupLabel: string;
  firstOfGroup: boolean;
}

/** The longest query after `@`; anything longer is an ordinary @ in the text. */
const MAX_QUERY_CHARS = 32;

/* ASCII characters of an email local part: after one of them, `@` does not open the
   menu, so typing a@b.com is not taken as a mention.
   Deliberately looser than "`@` must follow whitespace or line start": Chinese and
   Japanese text has no spaces, so `@` must work right after a word there. */
const EMAIL_LOCAL_CHAR = /[A-Za-z0-9._%+-]/;

export interface MentionTrigger {
  /** The index of `@` in the text; the popup anchors there and replacement starts there. */
  leadOffset: number;
  /** What has been typed after `@`, used to filter. */
  query: string;
  /** The text replaced on pick, including `@`. */
  replaceableString: string;
}

/**
 * Whether the text before the caret ends in an `@` being typed.
 *
 * Only the last `@` counts: earlier ones are already pills or ordinary characters.
 */
export function matchMentionTrigger(textBeforeCursor: string): MentionTrigger | null {
  const at = textBeforeCursor.lastIndexOf('@');
  if (at < 0) return null;
  const before = at > 0 ? textBeforeCursor[at - 1]! : '';
  if (before && EMAIL_LOCAL_CHAR.test(before)) return null;
  const query = textBeforeCursor.slice(at + 1);
  /* Whitespace ends the mention: file names can have spaces, but what follows a space is
     usually the next word, and a lingering menu would cover it. */
  if (query.length > MAX_QUERY_CHARS || /\s/.test(query)) return null;
  return { leadOffset: at, query, replaceableString: textBeforeCursor.slice(at) };
}

/* Ranking: prefix < word start < substring < subsequence (other characters in between).
   Within a tier, an earlier match ranks higher: "video" at position 3 of my-video.mp4
   beats position 20 of a-really-long-name-video.mp4.
   Both are packed into one number: tier × TIER_STEP + match position. */
const TIER_STEP = 1000;
const TIER_PREFIX = 0;
const TIER_WORD = 1;
const TIER_SUBSTRING = 2;
const TIER_SUBSEQUENCE = 3;

/** Characters that separate words in file names: `-`, `_`, `.` and path separators start a word. */
const WORD_BOUNDARY = /[\s._\-/\\]/;

/**
 * How well the text matches the query; lower is better, null is no match.
 *
 * The last tier is a subsequence (`bgm` matches `background-music.mp3`): file names are
 * long and hard to remember, so a few remembered letters should be enough.
 */
export function scoreMentionText(text: string, query: string): number | null {
  if (!query) return TIER_PREFIX * TIER_STEP;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  if (haystack.startsWith(needle)) return TIER_PREFIX * TIER_STEP;
  const index = haystack.indexOf(needle);
  if (index >= 0) {
    const tier = WORD_BOUNDARY.test(haystack[index - 1] ?? '') ? TIER_WORD : TIER_SUBSTRING;
    return tier * TIER_STEP + Math.min(index, TIER_STEP - 1);
  }
  const start = subsequenceStart(haystack, needle);
  return start == null ? null : TIER_SUBSEQUENCE * TIER_STEP + Math.min(start, TIER_STEP - 1);
}

/** Matches if every character of the query appears in order; returns where the first one is. */
function subsequenceStart(haystack: string, needle: string): number | null {
  let start: number | null = null;
  let cursor = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found < 0) return null;
    if (start == null) start = found;
    cursor = found + 1;
  }
  return start;
}

/** Tries the label and every keyword and keeps the best score. */
export function scoreMentionItem(item: MentionItem, query: string): number | null {
  let best: number | null = null;
  for (const text of [item.label, ...(item.keywords ?? [])]) {
    const score = scoreMentionText(text, query);
    if (score != null && (best == null || score < best)) best = score;
  }
  return best;
}

/** The most rows the menu shows; with hundreds of files, typing a little more beats scrolling. */
export const MENTION_MENU_LIMIT = 20;

/**
 * Flattens the providers into the menu's rows.
 *
 * Groups stay together, each one kind of thing; sorting happens only within a group.
 */
export function buildMentionMenu(
  providers: MentionProvider[],
  query: string,
  limit: number = MENTION_MENU_LIMIT,
): MentionEntry[] {
  const entries: MentionEntry[] = [];
  for (const provider of providers) {
    provider.items
      .map((item, order) => ({ item, order, score: scoreMentionItem(item, query) }))
      .filter((row): row is { item: MentionItem; order: number; score: number } => row.score != null)
      .sort((a, b) => {
        /* Disabled items sink to the bottom of their group: they must not push down a
           usable item or be picked by Enter. */
        if (!!a.item.disabled !== !!b.item.disabled) return a.item.disabled ? 1 : -1;
        if (a.score !== b.score) return a.score - b.score;
        // Ties keep the provider's order (files come newest first).
        return a.order - b.order;
      })
      .forEach((row, index) => {
        entries.push({
          item: row.item,
          providerId: provider.id,
          groupLabel: provider.groupLabel,
          firstOfGroup: index === 0,
        });
      });
  }
  /* Cut from the end, so every remaining group keeps its first row and title. */
  return entries.slice(0, limit);
}
