/**
 * The production line as Studio's panel says it: which stage the film is at, how far it has come. The stages' names
 * and their order are the pipeline's own (the agent's `openfilm pipeline` command keeps them; the server sends them
 * in order); what the person reads around them is the panel's (i18n).
 */
import type { Pipeline, PipelineStage } from '@/api';

/** The stage the film is at: the first not done, or null when every one is. */
export const nextStage = (pipeline: Pipeline): PipelineStage | null =>
  pipeline.stages.find((stage) => stage.status !== 'done') ?? null;

/** How far the line has come: its stages done, of all of them. */
export const progress = (pipeline: Pipeline): { done: number; total: number } => ({
  done: pipeline.stages.filter((stage) => stage.status === 'done').length,
  total: pipeline.stages.length,
});
