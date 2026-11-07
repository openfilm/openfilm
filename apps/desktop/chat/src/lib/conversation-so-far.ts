/**
 * A conversation whose agent session could not be taken up again (the agent lost its record of it, or refused it)
 * goes on in a new session that remembers nothing. So that the agent goes on from where the person is, its first
 * message carries what was said so far: each message and the agent's reply, newest kept when it is long.
 */
import type { SavedTurn } from '@/lib/chat-store';

/** at most this many characters of what was said before, and of one reply in it */
export const SO_FAR_MAX = 24_000;
export const REPLY_MAX = 2_000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()} …` : text);

/** `text` as sent to a new session of a conversation that has `earlier` turns (oldest first); unchanged without them. */
export function withConversationSoFar(earlier: readonly SavedTurn[], text: string): string {
  const said: string[] = [];
  let size = 0;
  for (const { turn, items } of [...earlier].reverse()) {
    const reply = items.filter((item) => item.kind === 'text' && item.text?.trim()).map((item) => item.text!.trim()).join('\n\n');
    const prompt = turn.prompt?.trim();
    if (!prompt && !reply) continue;
    const one = [prompt ? `Person: ${prompt}` : '', reply ? `You: ${clip(reply, REPLY_MAX)}` : ''].filter(Boolean).join('\n');
    if (size + one.length > SO_FAR_MAX) break;
    said.unshift(one);
    size += one.length;
  }
  if (!said.length) return text;
  return 'This conversation went on before, in a session of yours that could not be opened again. What was said so far'
    + `${said.length < earlier.length ? ' (the latest of it)' : ''}:\n\n<conversation-so-far>\n${said.join('\n\n')}\n</conversation-so-far>\n\n${text}`;
}
