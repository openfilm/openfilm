/**
 * The bodies that carry the OpenFilm API's error codes, and the codes themselves (error-codes.mjs, plain JavaScript
 * so code without a TypeScript step can use them too).
 *
 * Two shapes:
 *   - `/v1/media/*` and `/api/*`: `{ error: <code>, message, …details }`.
 *   - `/v1/agent/*` (OpenAI-compatible): `{ error: { message, type: <code>, code: <code> } }`.
 *
 * Codes are only added, never renamed or removed.
 */
import { z } from 'zod';

export { API_ERROR_CODES, apiErrorCode, isApiErrorCode, type ApiErrorCode } from './error-codes.mjs';

/** Any `{ error, message }` body. */
export const apiErrorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>;

/** The quote a media refusal carries: what the call would have cost. */
const refusedQuoteSchema = z.object({
  credits: z.number().int().nonnegative(),
  basis: z.string(),
});

// ── /v1/media/* ──────────────────────────────────────────────────

/** 402 insufficient_credits. */
export const mediaInsufficientCreditsErrorSchema = z.object({
  error: z.literal('insufficient_credits'),
  message: z.string(),
  balance: z.number(),
  needed: z.number(),
  quote: refusedQuoteSchema,
  /** Where the account's plan and credits are managed. */
  billing_url: z.string().url(),
});

/** 402 daily_limit. */
export const mediaDailyLimitErrorSchema = z.object({
  error: z.literal('daily_limit'),
  message: z.string(),
  /** The limit, and what the last 24 hours spent, in credits. */
  limit: z.number(),
  spent: z.number(),
  needed: z.number(),
  quote: refusedQuoteSchema,
  billing_url: z.string().url(),
});

/** 401 key_revoked. */
export const keyRevokedErrorSchema = z.object({
  error: z.literal('key_revoked'),
  message: z.string(),
});

/** 403 tier_not_allowed. */
export const tierNotAllowedErrorSchema = z.object({
  error: z.literal('tier_not_allowed'),
  message: z.string(),
  tier: z.string(),
  model: z.string().optional(),
  /** The account's plan id. */
  plan: z.string(),
  billing_url: z.string().url(),
});

/** A command that ran and failed; what was charged was refunded. */
export const commandFailedErrorSchema = z.object({
  error: z.literal('command_failed'),
  message: z.string(),
  call_id: z.string(),
  refunded: z.number(),
  idempotent_replay: z.literal(true).optional(),
});

/** 409 in_progress. */
export const inProgressErrorSchema = z.object({
  error: z.literal('in_progress'),
  message: z.string(),
  call_id: z.string(),
});

/** The errors `/v1/media/*` answers with a code. */
export const mediaErrorSchema = z.discriminatedUnion('error', [
  mediaInsufficientCreditsErrorSchema,
  mediaDailyLimitErrorSchema,
  keyRevokedErrorSchema,
  tierNotAllowedErrorSchema,
  commandFailedErrorSchema,
  inProgressErrorSchema,
  z.object({ error: z.literal('unknown_run'), message: z.string() }),
  z.object({ error: z.literal('rate_limited'), message: z.string() }),
  z.object({ error: z.literal('too_many_runs'), message: z.string() }),
  z.object({ error: z.literal('internal'), message: z.string() }),
]);
export type MediaError = z.infer<typeof mediaErrorSchema>;

// ── /v1/agent/* (OpenAI-compatible) ──────────────────────────────

/** An agent error with this code. */
export function agentErrorSchemaFor<C extends string>(code: C) {
  return z.object({
    error: z.object({
      message: z.string(),
      type: z.literal(code),
      code: z.literal(code),
    }),
  });
}

/** Any agent error. */
export const agentErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string(),
  }),
});
export type AgentError = z.infer<typeof agentErrorSchema>;

/** 402 insufficient_credits, 402 daily_limit, 401 key_revoked, as the agent door says them. */
export const agentInsufficientCreditsErrorSchema = agentErrorSchemaFor('insufficient_credits');
export const agentDailyLimitErrorSchema = agentErrorSchemaFor('daily_limit');
export const agentKeyRevokedErrorSchema = agentErrorSchemaFor('key_revoked');
