/** The error codes of the OpenFilm API that clients branch on (error-codes.mjs). Only added, never removed. */
export declare const API_ERROR_CODES: readonly [
  'insufficient_credits',
  'daily_limit',
  'key_revoked',
  'tier_not_allowed',
  'command_failed',
  'in_progress',
  'unknown_run',
  'rate_limited',
  'too_many_runs',
  'suspended',
  'not_configured',
  'invalid_request',
  'model_not_offered',
  'upstream_error',
  'upstream_unreachable',
  'internal',
];
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** Whether a value is one of the codes. */
export declare function isApiErrorCode(value: unknown): value is ApiErrorCode;

/** The code of an error body of either shape, or null. */
export declare function apiErrorCode(body: unknown): string | null;
