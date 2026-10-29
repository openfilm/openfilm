import type { LocalAgentId } from './desktop-bridge';
import type { SkillsGiven } from './skill-pages';

/**
 * A project's sessions: their shape on the client.
 */

export interface ProjectSessionItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** How many turns the session has. 0: just opened, nothing said yet. */
  turns: number;
  /** The agent this conversation goes on with: the one it used last, after a restart too (lib/conversation-agent). */
  agent?: LocalAgentId;
  /** The options (model, effort) it used each agent with, by agent: they stand over the ones picked last. */
  agentPrefs?: Partial<Record<LocalAgentId, Record<string, unknown>>>;
  /** Each agent's own id of this conversation (by agent): its next turn goes on with it, after a restart too. */
  agentSessions?: Record<string, string>;
  /** The skills whose SKILL.md each agent's session has had in this conversation (lib/skill-pages), by agent. */
  skillsGiven?: SkillsGiven;
  /** Kept on top of the history. */
  pinned?: boolean;
  /** Out of the history's list, under Archived at its foot; still opened from there. */
  archived?: boolean;
}
