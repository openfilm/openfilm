import type { Modality } from './modality';
import type { CancelReason, GenResult, TurnAttachment } from './contract';
import type { PromptDisplay } from './prompt-reference';

/**
 * A turn: what the person said, and everything the agent did for it. Projects hold sessions, sessions hold turns; a
 * film a turn makes is a LibraryVideo of its own (an edit makes a new turn and a new film, never changing the parent).
 */
export type TurnStatus =
  | 'generating'
  | 'failing'
  | 'canceling'
  | 'ready'
  | 'error'
  | 'cancelled';

export interface Turn {
  id: string;
  ownerId: string;
  /** The project it belongs to. */
  projectId: string;
  /** The session it belongs to (the agent's conversation memory). */
  sessionId: string;
  /** The session's title, for recents and the conversation; independent of the film's. */
  sessionTitle: string;
  /** The film this turn starts from; null for a new one. */
  baseVideoId?: string | null;
  modality: Modality;
  /** Empty: the project's title is shown. */
  title: string;
  /** The project's title, when the person gave one. Lists include it; elsewhere it may be absent. */
  projectTitle?: string;
  /** A one-line description of the film. */
  description?: string;
  /** Content tags (3 to 6). */
  tags?: string[];
  status: TurnStatus;
  /** The person's message as sent to the model. */
  prompt: string;
  /**
   * The same message as it looked in the composer, with its pills (`prompt` is the expanded text sent to the model).
   * Only when the message has pills.
   */
  promptDisplay?: PromptDisplay | null;
  /** What the person attached (names and thumbnails), for display only. */
  attachments?: TurnAttachment[] | null;
  /** What the turn made; null while it runs. */
  result: GenResult | null;
  error?: string | null;
  /** The model it ran on. */
  model?: string | null;
  /**
   * A turn run by a local agent on the person's computer (Codex, Claude Code), kept only there; `model` is the name
   * shown in its menu (e.g. "gpt-5.5 · Medium").
   */
  localAgent?: { id: string; model?: string | null } | null;
  /** The turn carried pictures. */
  vision?: boolean;
  /** When a stop was asked for, and when it stopped. */
  cancelRequestedAt?: string | null;
  cancelledAt?: string | null;
  /** Why it stopped; null means `'user'`. */
  cancelReason?: CancelReason | null;
  /** When it was removed from recents (the film stays in the library); absent while it is shown. */
  removedFromRecentsAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
