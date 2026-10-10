/**
 * `/api/desktop/*`: what a signed-in client (Studio, the desktop app) asks the account for, with its account token.
 *
 *   POST /api/desktop/agent-key   mint a short-lived agent key for `/v1/*` (one live key per label)
 *   GET  /api/desktop/profile     who is signed in
 */
import { z } from 'zod';

/** The body of `POST /api/desktop/agent-key`. */
export const agentKeyRequestSchema = z.object({
  /** One live key per label: a new one retires the old. */
  label: z.string().optional(),
  /** How long it lives, in seconds. */
  ttlSec: z.number().int().positive().optional(),
});
export type AgentKeyRequest = z.infer<typeof agentKeyRequestSchema>;

/** 200 from `POST /api/desktop/agent-key`. 400 is `{ error }`. */
export const agentKeyResponseSchema = z.object({
  id: z.string(),
  /** The key itself (`Authorization: Bearer …`); shown once. */
  token: z.string(),
  label: z.string(),
  /** ISO time. */
  expiresAt: z.string().datetime(),
  userId: z.string(),
});
export type AgentKeyResponse = z.infer<typeof agentKeyResponseSchema>;

/** 200 from `GET /api/desktop/profile`. */
export const profileResponseSchema = z.object({
  user: z.object({
    id: z.string(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    fullName: z.string(),
    username: z.string().nullable(),
    hasImage: z.boolean(),
    imageUrl: z.string(),
    primaryEmailAddress: z.object({ emailAddress: z.string() }),
  }),
});
export type ProfileResponse = z.infer<typeof profileResponseSchema>;
