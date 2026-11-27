/**
 * Which agent a conversation goes on with, and with which options. Reads no React, so `node --test` can use it.
 *
 * A conversation keeps the agent it used and the options it used it with (on its session, lib/project-sessions):
 * opened again, after a restart too, it goes on with them, whatever was picked since in another one. A new
 * conversation takes the agent picked last.
 */
import type { LocalAgentId, RosterAgent } from './desktop-bridge';
import type { ProjectSessionItem } from './project-sessions';

type Prefs = Partial<Record<LocalAgentId, Record<string, unknown>>>;

/** Gets the saved agent and options while the conversation still has turns. */
export function conversationAgentOverrides(session: ProjectSessionItem | undefined): Pick<ProjectSessionItem, 'agent' | 'agentPrefs'> | undefined {
  return session?.turns === 0 ? undefined : session;
}

/**
 * The agent a conversation goes on with: the one it `used` while that one is switched on and ready (or still being
 * checked or signing in, as just after a restart), else `fallback`, the one picked last. `was`: the one it used, when
 * it cannot go on with it.
 */
export function conversationAgent(used: LocalAgentId | undefined, roster: RosterAgent[] | null, fallback: LocalAgentId): { agent: LocalAgentId; was: LocalAgentId | null } {
  if (!used) return { agent: fallback, was: null };
  const it = roster?.find((a) => a.id === used);
  if (!roster || (it?.shown && (it.status === 'ready' || it.status === 'checking' || it.status === 'waiting'))) return { agent: used, was: null };
  return { agent: fallback, was: fallback === used ? null : used };
}

/**
 * What a conversation keeps of the options a turn ran with: the model and effort it ran on, the person's pick or else
 * the agent's own (as its session reported it), so a pick made later in another conversation does not change them. Not
 * the options the app sets for every turn (its permission mode).
 */
export function keptPrefs(options: Array<{ id: string; category?: string | null; currentValue?: unknown }> | undefined, prefs: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const o of options ?? []) {
    if (o.category !== 'model' && o.category !== 'thought_level') continue;
    const value = o.id in prefs ? prefs[o.id] : o.currentValue;
    if (value != null) kept[o.id] = value;
  }
  return kept;
}

/** The options picked last for each agent (`picked`), with a conversation's `own` for the agents it used standing over them. */
export function conversationPrefs(picked: Prefs, own: Prefs | undefined): Prefs {
  if (!own) return picked;
  const out: Prefs = { ...picked };
  for (const [agent, values] of Object.entries(own) as Array<[LocalAgentId, Record<string, unknown>]>) out[agent] = { ...picked[agent], ...values };
  return out;
}

/** Keeps the options from a turn alongside the options already used in the conversation. */
export function conversationPrefsAfterTurn(session: ProjectSessionItem, agent: LocalAgentId, used: Record<string, unknown> | undefined): Prefs | undefined {
  const own = conversationAgentOverrides(session)?.agentPrefs;
  return used ? { ...own, [agent]: { ...own?.[agent], ...used } } : own;
}
