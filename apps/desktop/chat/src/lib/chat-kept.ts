/**
 * A project's chat record read late (it could not be read when the project opened): what it holds joins what this
 * launch added, the conversations and turns it has that this launch does not, so writing it loses none of them.
 */
import type { ProjectChat, SavedTurn } from '@/lib/chat-store';
import type { ProjectSessionItem } from '@/lib/project-sessions';

export function joinKept(chat: ProjectChat, kept: { sessions?: unknown; last?: unknown; turns?: unknown } | null | undefined): void {
  const sessions = new Set(chat.sessions.map((s) => s.id));
  const keptSessions = (Array.isArray(kept?.sessions) ? kept.sessions : []) as ProjectSessionItem[];
  chat.sessions = [...chat.sessions, ...keptSessions.filter((s) => typeof s?.id === 'string' && !sessions.has(s.id))];
  const turns = new Set(chat.turns.map((t) => t.turn.id));
  const keptTurns = (Array.isArray(kept?.turns) ? kept.turns : []) as SavedTurn[];
  chat.turns = [...keptTurns.filter((t) => typeof t?.turn?.id === 'string' && !turns.has(t.turn.id)), ...chat.turns];
  chat.last ??= typeof kept?.last === 'string' ? kept.last : null;
}
