/**
 * The error codes of the OpenFilm API that clients branch on, as plain JavaScript: Electron's main process and other
 * code that runs without a TypeScript step import them from `@openfilm/shared/api/error-codes`. Their types are in
 * error-codes.d.mts; errors.ts re-exports them with the schemas of the bodies that carry them.
 *
 * Two shapes carry a code:
 *   - `/v1/media/*` and `/api/*`: `{ error: <code>, message, …details }`.
 *   - `/v1/agent/*` (OpenAI-compatible): `{ error: { message, type: <code>, code: <code> } }`.
 *
 * Codes are only added, never renamed or removed.
 */
export const API_ERROR_CODES = Object.freeze([
  /** 402: the balance is too small for the call. */
  'insufficient_credits',
  /** 402: the call would pass the daily spending limit the account's owner set. */
  'daily_limit',
  /** 401: the agent key was revoked or replaced; mint a new one. */
  'key_revoked',
  /** 403: the plan does not include this model or tier. */
  'tier_not_allowed',
  /** 422 / 502 / …: the command ran and failed (refunded). */
  'command_failed',
  /** 409: the same Idempotency-Key is still running. */
  'in_progress',
  /** 404: no async run with this key here; POST it again with the same Idempotency-Key. */
  'unknown_run',
  /** 429: too many runs started in the last minute. */
  'rate_limited',
  /** 429: too many async runs waiting for this account. */
  'too_many_runs',
  /** 403: the account is suspended. */
  'suspended',
  /** 503: the service is not set up to answer this yet. */
  'not_configured',
  /** 400: the request body is not valid. */
  'invalid_request',
  /** 400: the agent model is not one offered. */
  'model_not_offered',
  /** The agent's model service refused the call, or could not be reached. */
  'upstream_error',
  'upstream_unreachable',
  /** 500. */
  'internal',
]);

/** Whether a value is one of the codes. */
export function isApiErrorCode(value) {
  return typeof value === 'string' && API_ERROR_CODES.includes(value);
}

/** The code of an error body of either shape, or null. */
export function apiErrorCode(body) {
  const error = body?.error;
  if (typeof error === 'string') return error;
  const code = error?.code;
  return typeof code === 'string' ? code : null;
}
