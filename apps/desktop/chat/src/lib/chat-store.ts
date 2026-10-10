/**
 * A project's chat record, kept by the app in the project's own folder (`.film/chat`, src/chat-store.mjs): its
 * conversations, the one shown last, and each finished turn with what the chat shows of it. Read once when the
 * project opens (openProjectChat), held here so the chat reads it as it always has, and written back as it changes.
 */
import React from 'react';
import type { Turn } from '@openfilm/shared';
import type { TranscriptItem } from '@/lib/agent-transcript';
import type { ProjectSessionItem } from '@/lib/project-sessions';
import { app } from '../app-bridge';

export interface SavedTurn { turn: Turn; items: TranscriptItem[] }
interface ProjectChat { sessions: ProjectSessionItem[]; last: string | null; turns: SavedTurn[] }

const projects = new Map<string, ProjectChat>();
const loading = new Map<string, Promise<void>>();
/** which project each folder's record was read for: a project deleted and another made in its folder (a new
 * "Untitled" where the last one was) is not the same project, and does not get its chat */
const readFor = new Map<string, string>();
const EMPTY: ProjectChat = { sessions: [], last: null, turns: [] };

/**
 * Read the project's record from its folder (once a launch, and again when another project takes the folder); the
 * chat waits for it before it shows the project. `project`: its folder; `id`: Studio's id for it.
 */
export function openProjectChat(project: string, id: string): Promise<void> {
  if (readFor.get(project) !== id) {
    readFor.set(project, id);
    projects.delete(project);
  }
  if (projects.has(project)) return Promise.resolve();
  const key = `${id}\0${project}`;
  const inFlight = loading.get(key);
  if (inFlight) return inFlight;
  const mine = () => readFor.get(project) === id;
  const pending: Promise<void> = app.chat.load(project)
    .then((chat) => {
      if (!mine()) return;
      projects.set(project, {
        sessions: Array.isArray(chat?.sessions) ? chat.sessions as ProjectSessionItem[] : [],
        last: typeof chat?.last === 'string' ? chat.last : null,
        turns: Array.isArray(chat?.turns) ? chat.turns as SavedTurn[] : [],
      });
    })
    /* not readable (not one of Studio's projects yet, a folder gone): an empty record, written once it changes */
    .catch(() => { if (mine()) projects.set(project, { ...EMPTY, sessions: [], turns: [] }); })
    .finally(() => { loading.delete(key); });
  loading.set(key, pending);
  return pending;
}

const record = (project: string): ProjectChat => {
  let chat = projects.get(project);
  if (!chat) { chat = { ...EMPTY, sessions: [], turns: [] }; projects.set(project, chat); }
  return chat;
};

/* the conversations are written a moment after the last change: renaming one, or a turn touching it, is a burst */
const sessionWrites = new Map<string, ReturnType<typeof setTimeout>>();
function writeSessions(project: string) {
  clearTimeout(sessionWrites.get(project));
  sessionWrites.set(project, setTimeout(() => {
    sessionWrites.delete(project);
    const chat = record(project);
    void app.chat.saveSessions(project, chat.sessions, chat.last).catch(() => { /* written next time */ });
  }, 150));
}

export const chatSessions = (project: string): ProjectSessionItem[] => record(project).sessions;
export function setChatSessions(project: string, sessions: ProjectSessionItem[]) {
  record(project).sessions = sessions;
  writeSessions(project);
}

export const lastSession = (project: string): string | null => record(project).last;
export function setLastSession(project: string, id: string) {
  const chat = record(project);
  if (chat.last === id) return;
  chat.last = id;
  writeSessions(project);
}

export const chatTurns = (project: string): SavedTurn[] => record(project).turns;
export function putChatTurn(project: string, entry: SavedTurn) {
  const chat = record(project);
  chat.turns = [...chat.turns.filter((t) => t.turn.id !== entry.turn.id), entry];
  void app.chat.saveTurn(project, entry.turn, entry.items).catch(() => { /* kept for this launch */ });
}

/** Whether `project`'s record has been read (reading it if not): the chat shows the project once it has. */
export function useProjectChat(project: { id: string; path: string } | null): boolean {
  const key = project ? `${project.id}\0${project.path}` : null;
  const [loaded, setLoaded] = React.useState<string | null>(() => (project && readFor.get(project.path) === project.id && projects.has(project.path) ? key : null));
  React.useEffect(() => {
    if (!project || !key) return undefined;
    let alive = true;
    void openProjectChat(project.path, project.id).then(() => { if (alive) setLoaded(key); });
    return () => { alive = false; };
  }, [key]);
  return key != null && loaded === key;
}
