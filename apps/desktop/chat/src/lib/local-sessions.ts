/**
 * A project's conversations (the session bar's list), kept with the project (lib/chat-store.ts: its .film/chat), in
 * the shape of lib/project-sessions.ts; the turns of each are kept beside them.
 */
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { chatSessions, lastSession, setChatSessions, setLastSession } from '@/lib/chat-store';

const MAX = 200;

export function loadSessions(project: string): ProjectSessionItem[] {
  return chatSessions(project).filter((s): s is ProjectSessionItem => Boolean(s && typeof s.id === 'string' && typeof s.createdAt === 'string'));
}

export function saveSessions(project: string, sessions: ProjectSessionItem[]): void {
  setChatSessions(project, sessions.slice(0, MAX));
}

export function newSession(): ProjectSessionItem {
  const now = new Date().toISOString();
  return { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, title: '', createdAt: now, updatedAt: now, turns: 0 };
}

/** The one shown last in this project, remembered across launches. */
export const loadLastSession = (project: string): string | null => lastSession(project);
export const saveLastSession = (project: string, id: string): void => setLastSession(project, id);
