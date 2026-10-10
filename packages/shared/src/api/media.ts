/**
 * `/v1/media/*`: media commands paid with the account's credits.
 *
 *   POST /v1/media/run       run one command (Idempotency-Key header required); with `Prefer: respond-async`, 202 first
 *   GET  /v1/media/run?key=  an async run's result: 202 while it runs, then the status and body the run answered
 *   POST /v1/media/quote     the quote only
 */
import { z } from 'zod';

/** The commands the service runs. */
export const MEDIA_COMMANDS = [
  'audio voice',
  'audio tts',
  'audio sfx',
  'audio music',
  'audio asr',
  'audio translate',
  'image search',
  'image gen',
  'web search',
  'web fetch',
  'video gen',
] as const;
export type MediaCommandName = (typeof MEDIA_COMMANDS)[number];

/** The tiers a command can run on. */
export const MEDIA_TIERS = ['flash', 'pro', 'ultra'] as const;
export type MediaTierName = (typeof MEDIA_TIERS)[number];

/** The most input files one run takes. */
export const MEDIA_RUN_MAX_INPUTS = 12;
/** The longest Idempotency-Key. */
export const IDEMPOTENCY_KEY_MAX = 200;

const mediaArgValueSchema = z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]);

/** The body of `POST /v1/media/run` and `POST /v1/media/quote`. */
export const mediaRunRequestSchema = z.object({
  command: z.enum(MEDIA_COMMANDS),
  /** Named options (`--text`, `--voice` …). */
  args: z.record(z.string(), mediaArgValueSchema).optional(),
  /** Files the command reads, by their project path. */
  inputs: z.array(z.object({ path: z.string(), base64: z.string() })).max(MEDIA_RUN_MAX_INPUTS).optional(),
  /** A media model by id; it wins over `tier`. */
  model: z.string().optional(),
  tier: z.enum(MEDIA_TIERS).optional(),
  /** Facts of the caller's project. */
  context: z.object({
    contentLocale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  }).optional(),
});
export type MediaRunRequest = z.infer<typeof mediaRunRequestSchema>;

/** A file a run made. */
export const mediaFileSchema = z.object({
  path: z.string(),
  base64: z.string(),
  bytes: z.number().int().nonnegative(),
});

/** What a run cost, in credits: held up front, measured, given back, and the net. */
export const mediaCreditsSchema = z.object({
  quoted: z.number().int().nonnegative(),
  charged: z.number().int().nonnegative(),
  metered: z.number().int().nonnegative(),
  refunded: z.number().int().nonnegative(),
  cost: z.number().int(),
});

/** 200 from `POST /v1/media/run` (and from `GET /v1/media/run?key=` once it finished). */
export const mediaRunResponseSchema = z.object({
  call_id: z.string(),
  command: z.string(),
  /** The command's receipt, as the command gives it (null on a replay). */
  receipt: z.unknown(),
  files: z.array(mediaFileSchema),
  /** Rows describing the made files, as the command gives them. */
  index: z.array(z.record(z.string(), z.unknown())),
  credits: mediaCreditsSchema,
  /** The balance after the run; null on a replay. */
  balance: z.number().nullable(),
  /** This answer replays an earlier run with the same Idempotency-Key. */
  idempotent_replay: z.boolean(),
  /** A replay has the bill but not the files, receipt or index. */
  files_unavailable: z.literal(true).optional(),
});
export type MediaRunResponse = z.infer<typeof mediaRunResponseSchema>;

/** 202 from an async run while it runs. */
export const mediaRunPendingSchema = z.object({
  status: z.literal('running'),
  idempotency_key: z.string(),
});
export type MediaRunPending = z.infer<typeof mediaRunPendingSchema>;

/** A quote: an upper bound in credits, and how it was reached. */
export const mediaQuoteSchema = z.object({
  command: z.enum(MEDIA_COMMANDS),
  credits: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
  basis: z.string(),
  /** Settled to what it measured after the run (some may come back); false: the quote is the price. */
  settles: z.boolean(),
});
export type MediaQuoteBody = z.infer<typeof mediaQuoteSchema>;

/** 200 from `POST /v1/media/quote`. */
export const mediaQuoteResponseSchema = z.object({
  quote: mediaQuoteSchema,
  tier: z.enum(MEDIA_TIERS),
});
export type MediaQuoteResponse = z.infer<typeof mediaQuoteResponseSchema>;
