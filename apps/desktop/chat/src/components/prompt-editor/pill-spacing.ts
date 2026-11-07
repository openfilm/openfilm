/**
 * The spaces around a pill that moves in the sentence (dragged to another place between words).
 *
 * A pill dropped against a word would run into it once sent ("look at/Users/me/a.png"), so it gets a space on that
 * side; the place it left keeps one space, not two. Chinese and Japanese put no spaces between words, so a pill
 * between their characters gets none.
 *
 * `before` and `after` are the one character on each side: '' at the start or end of a line. A pill next to it
 * counts as a word (`PILL_NEIGHBOR`), since two pills sent side by side would run together too.
 */

export const PILL_NEIGHBOR = 'a';

/* Characters of scripts written without spaces, and their punctuation. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;
/* What a pill may sit right after: a space, or an opening bracket or quote. */
const OPENS = /[\s([{"'“‘«]/u;
/* What may follow a pill right away: a space, or punctuation that closes or ends a phrase. */
const CLOSES = /[\s)\]}"'”’»,.;:!?…]/u;

/** Whether a pill put between these two characters needs a space before it and after it. */
export function spacesAroundPill(before: string, after: string): { before: boolean; after: boolean } {
  return {
    before: before !== '' && !OPENS.test(before) && !UNSPACED.test(before),
    after: after !== '' && !CLOSES.test(after) && !UNSPACED.test(after),
  };
}

/**
 * Whether the space after the place a pill left should go: it had a space after it, and before it there was a
 * space too, or nothing (the start of a line).
 */
export function dropSpaceAfterRemoval(before: string, after: string): boolean {
  return after === ' ' && (before === '' || /\s/u.test(before));
}
