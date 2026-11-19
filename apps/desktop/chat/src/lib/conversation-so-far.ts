/**
 * A conversation whose agent session could not be taken up again (the agent lost its record of it, or refused it)
 * goes on in a new session that remembers nothing. So that the agent goes on from where the person is, its first
 * message carries what was said so far: each message and the agent's reply, newest kept when it is long.
 */
import type { SavedTurn } from '@/lib/chat-store';
import { readFileChanges, type TurnFileChanges } from './file-changes.ts';

/** at most this many characters of what was said before, and of one reply in it */
export const SO_FAR_MAX = 24_000;
export const REPLY_MAX = 2_000;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()} …` : text);

/** `text` as sent to a new session of a conversation that has `earlier` turns (oldest first); unchanged without them. */
export function withConversationSoFar(earlier: readonly SavedTurn[], text: string): string {
  const said: string[] = [];
  let size = 0;
  let cut = false;
  for (const { turn, items } of [...earlier].reverse()) {
    const reply = items.filter((item) => item.kind === 'text' && item.text?.trim()).map((item) => item.text!.trim()).join('\n\n');
    const prompt = turn.prompt?.trim();
    if (!prompt && !reply) continue;
    const one = [prompt ? `Person: ${prompt}` : '', reply ? `You: ${clip(reply, REPLY_MAX)}` : ''].filter(Boolean).join('\n');
    if (size + one.length > SO_FAR_MAX) { cut = true; break; }
    said.unshift(one);
    size += one.length;
  }
  if (!said.length) return text;
  return 'What was said earlier in this conversation'
    + `${cut ? ' (the latest of it)' : ''}:\n\n<conversation-so-far>\n${said.join('\n\n')}\n</conversation-so-far>\n\n${text}`;
}

/** The selected agent has a separate session; give it the task and the work it can verify in the same folder. */
export function withInterruptedTask(earlier: readonly SavedTurn[], { turn, items }: SavedTurn): string {
  const changes = readFileChanges((turn as TurnFileChanges).fileChanges) ?? [];
  const recordedSteps = items.filter((item) => item.kind === 'act' && item.act).slice(-24)
    .map((item) => [item.act, item.detail || item.query].filter(Boolean).join(' ').slice(0, 300));
  const progress = {
    originalRequest: turn.prompt,
    partialReply: items.filter((item) => item.kind === 'text').map((item) => item.text).join('\n\n').slice(-8_000),
    recordedSteps,
    changedFiles: changes.slice(0, 40).map(({ path, change }) => ({ path, change })),
  };
  return withConversationSoFar(earlier, [
    'Continue this interrupted task in the current project. Verify the existing work in the project before making changes.',
    'Use the recorded steps as a progress record and avoid repeating completed edits or paid operations.',
    JSON.stringify(progress),
  ].join('\n\n'));
}
