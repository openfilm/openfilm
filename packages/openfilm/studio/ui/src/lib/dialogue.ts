/** A dialogue of two voices as the speak dialog writes it (SpeakDialog) and `openfilm get tts` takes it: a turn a line. */

/** A turn of a dialogue: whose (the pair's first or second voice) and what is said. */
export type Turn = { who: 0 | 1; text: string };
export const TURN_MAX = 300;
export const DIALOGUE_MAX = 10_000;

/** Pasted lines as turns: "1:"/"2:", "A:"/"B:" or a member's name before a colon says whose, else they take turns. */
export function pastedTurns(text: string, names: string[], from: 0 | 1): Turn[] {
  const turns: Turn[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([^:：]{1,12})\s*[:：]\s*/.exec(line);
    const tag = m?.[1]?.trim().toLowerCase() ?? '';
    const named = tag === '1' || tag === 'a' ? 0 : tag === '2' || tag === 'b' ? 1 : names.findIndex((n) => n.toLowerCase() === tag);
    const said = (named >= 0 && m ? line.slice(m[0].length) : line).trim();
    if (!said) continue;
    turns.push({ who: (named >= 0 ? named : turns.length ? 1 - turns[turns.length - 1]!.who : from) as 0 | 1, text: said.slice(0, TURN_MAX) });
  }
  return turns;
}

/** The dialogue as `openfilm get tts` takes it: a turn a line, each saying whose. */
export const dialogueText = (turns: Turn[]) => turns.filter((t) => t.text.trim()).map((t) => `${t.who + 1}: ${t.text.trim()}`).join('\n');
