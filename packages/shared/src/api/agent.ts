/**
 * `/v1/agent/*`: the OpenFilm agent's models, OpenAI-compatible.
 *
 *   POST /v1/agent/chat/completions   the Chat Completions API for one of the models offered
 *   GET  /v1/agent/models             the models offered; 503 not_configured until the service can answer
 */
import { z } from 'zod';

/** One model offered. */
export const agentModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  name: z.string(),
  owned_by: z.string(),
  /** How hard it can think (e.g. low … max, or off / on). */
  efforts: z.array(z.string()),
  default_effort: z.string(),
  /** The tokens it takes. */
  context_length: z.number().int().positive(),
});
export type AgentModel = z.infer<typeof agentModelSchema>;

/** 200 from `GET /v1/agent/models`. */
export const agentModelsResponseSchema = z.object({
  object: z.literal('list'),
  /** The model for someone who has not chosen one. */
  default: z.string(),
  data: z.array(agentModelSchema),
});
export type AgentModelsResponse = z.infer<typeof agentModelsResponseSchema>;
