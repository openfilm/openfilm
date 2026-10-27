/**
 * The system notifications for the chat's turns, while OpenFilm is not in front (#230): a turn done, one stopped by an
 * error, and an agent waiting for the person's answer (a question, a permission). Clicking one shows its project's tab
 * (main.mjs). Settings › General switches them off (`notify`, chat-ipc.mjs preferences).
 *
 * Pure: no Electron, so `node --test` runs it.
 */
import { TURN_NOTICE_WORDS } from './i18n/turn-notices.mjs';

/**
 * How a turn ended, for its notification: 'done', 'failed', or null for one the person stopped (they were there).
 * @param {{ ok: boolean, stopReason?: unknown }} result what the prompt answered (local-agents-ipc.mjs)
 * @returns {'done' | 'failed' | null}
 */
export function turnOutcome(result) {
  if (!result.ok) return 'failed';
  const reason = typeof result.stopReason === 'object' && result.stopReason ? /** @type {any} */ (result.stopReason).stopReason : result.stopReason;
  return reason === 'cancelled' ? null : 'done';
}

/**
 * A notification's title and words, or null for none: OpenFilm in front (the person sees the chat), or notifications
 * switched off. The project is the title; a long error is cut, the notification shows a line or two.
 * @param {'done' | 'failed' | 'asking'} kind
 * @param {{ project: string, agent: string | null, error?: string, language: string, inFront: boolean, on: boolean }} o
 * `agent`: its name; null for the app's own agent (the own key), named "the agent".
 */
export function turnNotice(kind, { project, agent, error = '', language, inFront, on }) {
  if (!on || inFront) return null;
  const words = /** @type {Record<string, Record<string, string>>} */ (TURN_NOTICE_WORDS)[language] ?? TURN_NOTICE_WORDS.en;
  const why = error.replace(/\s+/g, ' ').trim();
  const body = words[kind].replace('{agent}', agent ?? words.agent).replace('{error}', why.length > 140 ? `${why.slice(0, 139)}…` : why);
  return { title: project, body };
}
