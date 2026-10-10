/**
 * A turn of the chat: what it carried, what it made, and the events the chat shows while it runs.
 */
import { z } from 'zod';
import {
  AGENT_ACTS,
  AGENT_ACT_QUERY_MAX,
  AGENT_ASK_QUESTION_MAX,
  AGENT_ASK_LABEL_MAX,
  AGENT_ASK_DESCRIPTION_MAX,
  AGENT_ASK_OPTIONS_MAX,
  AGENT_ASK_ANSWER_MAX,
  type AgentAsk,
  type AgentAct,
  type AgentActAsset,
} from './agent-activity';

/** The largest attachment thumbnail (a data URL; a 320px webp is usually 8 to 25 KB). */
export const TURN_ATTACHMENT_THUMB_MAX_CHARS = 64 * 1024;

/**
 * What a message carried, kept so the person can see what they sent: a name, a thumbnail and the original's content
 * hash. The originals themselves are not kept here.
 */
export const turnAttachmentSchema = z.object({
  kind: z.enum(['image', 'document']),
  name: z.string().min(1).max(255),
  /** A 320px thumbnail (data URL); documents have none. */
  thumb: z.string().max(TURN_ATTACHMENT_THUMB_MAX_CHARS).optional(),
  /** The original's sha256, to open it at full size (only its owner can). Older messages have none. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type TurnAttachment = z.infer<typeof turnAttachmentSchema>;

// ──────────────────────────────────────────────────────────────
//  What a turn made
// ──────────────────────────────────────────────────────────────

/** A film, as clients see it. */
export const videoResultSchema = z.object({
  kind: z.literal('video'),
  /** Empty: a film has no name of its own (the project's title is shown). */
  title: z.string(),
  /** A title suggested for a project that has none yet. */
  suggestedTitle: z.string().max(80).optional(),
  /** A one-line description of the film. */
  description: z.string().optional(),
  /** Content tags (3 to 6). */
  tags: z.array(z.string()).optional(),
  /** Where it plays. */
  playbackUrl: z.string().optional(),
  /** Whether a static package of it is ready at `playbackUrl`; absent means true. */
  packaged: z.boolean().optional(),
  /** Whether it has a poster. */
  hasPoster: z.boolean().optional(),
  /** The library card's cover. */
  posterUrl: z.string().optional(),
  /** The film it was edited from; absent for an original. */
  parentVideoId: z.string().optional(),
  durationSec: z.number(),
  aspect: z.string().default('16:9'),
  locale: z.string().optional(),
  voice: z.string().optional(),
  /**
   * Delivered, with a part missing: `silent-tts`, the voice-over could not be made and the film is silent;
   * `no-bgm`, the music could not be made.
   */
  degraded: z.array(z.enum(['silent-tts', 'no-bgm'])).optional(),
  /** The public storage prefix that holds playback/. */
  storagePublicPrefix: z.string().optional(),
  /** The source bundle's version, for editor migrations. */
  sourceVersion: z.number().optional(),
  /** The project this version belongs to. */
  projectId: z.string().optional(),
  /** The commit of this version's source. */
  sourceCommit: z.string().optional(),
  /** How many source files it has. */
  sourceFileCount: z.number().optional(),
});
export type VideoResult = z.infer<typeof videoResultSchema>;

/** A script, waiting for review. */
export const scriptResultSchema = z.object({
  kind: z.literal('script'),
  title: z.string(),
  scriptUrl: z.string().optional(),
  chapterCount: z.number().optional(),
  shotCount: z.number().optional(),
});
export const genResultSchema = z.discriminatedUnion('kind', [videoResultSchema, scriptResultSchema]);
export type GenResult = z.infer<typeof genResultSchema>;

// ──────────────────────────────────────────────────────────────
//  The events a client sees while a turn runs
// ──────────────────────────────────────────────────────────────

/** Why a turn stopped: the person stopped it. Absent means `user`. */
export const cancelReasonSchema = z.enum(['user']);
export type CancelReason = z.infer<typeof cancelReasonSchema>;

/** The most an agent's message may say in one event; longer text is clipped by the server. */
export const TRANSCRIPT_TEXT_MAX = 8_000;

/** A made media file shown in the chat; only `assets/…` paths. */
export const agentActAssetSchema = z.object({
  kind: z.enum(['image', 'audio', 'video']),
  src: z.string().max(240).refine((v) => /^assets\//.test(v)),
  dur: z.number().positive().optional(),
});

/** The question an agent asked (see agent-activity's publicAsk). */
export const agentAskSchema = z.object({
  question: z.string().max(AGENT_ASK_QUESTION_MAX),
  options: z.array(z.object({
    label: z.string().max(AGENT_ASK_LABEL_MAX),
    description: z.string().max(AGENT_ASK_DESCRIPTION_MAX).optional(),
  })).max(AGENT_ASK_OPTIONS_MAX),
  answer: z.string().max(AGENT_ASK_ANSWER_MAX).optional(),
  status: z.enum(['answered', 'skipped', 'timeout']).optional(),
});

/**
 * The events a turn's owner sees. A projection: the agent's words as they are, its tool calls as closed-set actions
 * (see agent-activity), and a bare "thinking" signal. Tool names, arguments, outputs and paths are not in it.
 * There is no progress percentage: the actions themselves are the progress.
 */
export const publicGenerationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('completed'),
    result: genResultSchema,
  }),
  /** The turn ended with a reply and no new film (not a failure). */
  z.object({
    type: z.literal('replied'),
    text: z.string().max(TRANSCRIPT_TEXT_MAX),
  }),
  z.object({
    type: z.literal('failed'),
    message: z.string(),
  }),
  /** Stopped. */
  z.object({
    type: z.literal('cancelled'),
    reason: cancelReasonSchema.optional(),
  }),
  /** Paused, and can resume. */
  z.object({ type: z.literal('paused') }),
  /** An expensive step waits for the person's yes: how long it would be, and its prompt. */
  z.object({
    type: z.literal('confirm'),
    id: z.string().max(64),
    command: z.string().max(40),
    seconds: z.number().positive().optional(),
    prompt: z.string().max(240).optional(),
  }),
  z.object({ type: z.literal('confirm-settled'), id: z.string().max(64), decision: z.enum(['allow', 'deny', 'timeout']).optional() }),
  z.object({
    type: z.literal('resource-wait'),
    id: z.string().max(128),
    resource: z.literal('render'),
    waiting: z.boolean(),
  }),
  /* a question waiting for an answer in this turn */
  z.object({
    type: z.literal('ask'),
    id: z.string().max(64),
    question: z.string().max(AGENT_ASK_QUESTION_MAX),
    options: z.array(z.object({
      label: z.string().max(AGENT_ASK_LABEL_MAX),
      description: z.string().max(AGENT_ASK_DESCRIPTION_MAX).optional(),
    })).max(AGENT_ASK_OPTIONS_MAX),
  }),
  z.object({
    type: z.literal('ask-settled'),
    id: z.string().max(64),
    status: z.enum(['answered', 'skipped', 'timeout']),
    answer: z.string().max(AGENT_ASK_ANSWER_MAX).optional(),
  }),
  /** The project's source changed (its content hash): the picture should be evaluated again. */
  z.object({ type: z.literal('source-changed'), hash: z.string().max(64) }),
  /**
   * The agent's words. The same `partId` is sent again with the text so far; `done: true` is final.
   */
  z.object({
    type: z.literal('agent-text'),
    turnNo: z.number().int().nonnegative(),
    partId: z.string().optional(),
    done: z.boolean().optional(),
    text: z.string().max(TRANSCRIPT_TEXT_MAX),
  }),
  /** The model is thinking (no text); `done: true` ends it. Not kept in the history. */
  z.object({
    type: z.literal('agent-thinking'),
    done: z.boolean().optional(),
  }),
  /** One thing the agent did: a closed-set action and a short visible text (search words, a description). */
  z.object({
    type: z.literal('agent-act'),
    callId: z.string(),
    turnNo: z.number().int().nonnegative(),
    act: z.enum(AGENT_ACTS),
    query: z.string().max(AGENT_ACT_QUERY_MAX).optional(),
    /** Only for `chat.ask`: the question and its options. */
    ask: agentAskSchema.optional(),
  }),
  /** That thing is done. No success or failure: a turn that fails says so with `failed`. */
  z.object({
    type: z.literal('agent-act-done'),
    callId: z.string().optional(),
    /** The media it made (see agent-activity's publicActivityResult). */
    asset: agentActAssetSchema.optional(),
  }),
  /**
   * How full the conversation's context is, as a percentage, and what fills it (`parts` add up to `percent`).
   * `compacted: true`: earlier conversation was just folded into a summary.
   */
  z.object({
    type: z.literal('context'),
    percent: z.number().min(0).max(100),
    compacted: z.boolean().optional(),
    parts: z
      .array(
        z.object({
          kind: z.enum(['system', 'tools', 'summary', 'history']),
          percent: z.number().min(0).max(100),
        }),
      )
      .optional(),
  }),
]);
export type PublicGenerationEvent = z.infer<typeof publicGenerationEventSchema>;

/** One step as a client sees it: an action, or the agent's words. */
export type PublicTimelineStep =
  | {
    id: string;
    kind: 'act';
    act: AgentAct;
    query?: string;
    asset?: AgentActAsset;
    ask?: AgentAsk;
    running?: boolean;
    turnNo?: number;
  }
  | {
    id: string;
    kind: 'text';
    text: string;
    running?: boolean;
    turnNo?: number;
  };

/** A turn's progress as a client sees it. */
export interface PublicProgressSnapshot {
  assetId: string;
  steps: PublicTimelineStep[];
  finished: boolean;
  updatedAt: number;
}

/**
 * Clips text to `max` characters, saying how much was cut. `max` includes that note, so the result always fits a
 * schema's `.max()`.
 */
export function clipTranscriptText(text: string, max: number): string {
  if (text.length <= max) return text;
  const tail = (keep: number) => `\n…(+${text.length - keep})`;
  // keeping one less character can add a digit to the note: converge
  let keep = Math.max(0, max - tail(max).length);
  while (keep > 0 && keep + tail(keep).length > max) keep -= 1;
  return `${text.slice(0, keep)}${tail(keep)}`;
}

/**
 * Merges streamed text without repeats: the full text so far (it starts with the current) replaces it; a repeat
 * changes nothing; anything else is appended.
 */
export function mergeStreamText(cur: string, next: string): string {
  if (!cur) return next;
  if (next.startsWith(cur)) return next;
  if (cur.includes(next)) return cur;
  return cur + next;
}
