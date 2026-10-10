import type { VideoResult } from './contract';

/**
 * A finished film in the library; a turn makes at most one. Versions chain by `parentVideoId` (editing v3 makes v4).
 */
export interface LibraryVideo {
  id: string;
  ownerId: string;
  /** The project it belongs to. */
  projectId: string;
  /** The turn that made it. */
  turnId: string;
  /** The session it was made in. */
  sessionId: string;
  /** Empty: a film has no name of its own (the project's title is shown). */
  title: string;
  /** The project's title, when the person gave one. Lists include it; elsewhere it may be absent. */
  projectTitle?: string;
  description?: string;
  tags?: string[];
  result: VideoResult;
  /** The version it was made from; null for a project's first. */
  parentVideoId: string | null;
  createdAt: string;
  updatedAt: string;
}
