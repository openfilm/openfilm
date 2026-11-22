/**
 * The flyout reads session names and activity dates. A project's turns and agent-specific records stay in the chat.
 * @param {Array<{id: string; title?: string; pinned?: boolean; archived?: boolean; updatedAt?: string}>} sessions
 * @param {string | null} current
 */
export function navigationSessions(sessions, current) {
  return {
    current,
    sessions: sessions.filter(session => !session.archived).map(session => ({
      id: session.id, title: typeof session.title === 'string' ? session.title : '',
      pinned: Boolean(session.pinned), updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : '',
    })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)),
  };
}
