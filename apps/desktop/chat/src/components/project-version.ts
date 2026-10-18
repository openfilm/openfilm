import type { PromptDisplay, TurnAttachment } from '@openfilm/shared';
import type { FileChange } from '@/lib/file-changes';
import type { Balance } from '@/lib/balance';

/**
 * One turn of the conversation as the chat draws it: what the person said, what they brought, who answered, how
 * long it took and how it ended.
 */
export interface ProjectVersion {
  assetId: string;
  label: string;
  title: string;
  prompt: string;
  /** The message as written in the composer (with pill markers); without it, `prompt` is rendered. */
  promptDisplay?: PromptDisplay;
  /** What came with the message (names and thumbnails). */
  attachments: TurnAttachment[];
  posterUrl?: string;
  status: 'ready' | 'active' | 'failed';
  current: boolean;
  /** The turn's frame (who answered, which model, how long, how it stopped); see project-versions. */
  agent?: string;
  model?: string;
  durationMs?: number;
  outcome?: 'stopped' | 'failed' | 'balance';
  /** outcome 'balance': which service had no balance left, and its page to top it up */
  balance?: Balance;
  /** outcome 'failed': why, as the turn kept it (on its footer's Interrupted, on hover) */
  error?: string;
  /** When it was sent / settled (ISO): hover says "N minutes ago". */
  createdAt?: string;
  settledAt?: string;
  /** what the turn changed in the project's files (lib/file-changes); none when nothing did */
  fileChanges?: FileChange[];
  /** 'background': the agent started it by itself, a background task of its own having come back (no message) */
  origin?: 'background';
}
