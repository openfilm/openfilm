/**
 * The production line as the person reads it in Studio (`GET /api/projects/:id/pipeline`): the pipeline's state and,
 * when the storyboard is written, what its check says the film still needs. Read-only — the agent writes the line
 * through the `openfilm pipeline` command (src/pipeline.mjs, src/storyboard.mjs); Studio shows it as it stands.
 */
import { readPipeline, STAGES } from '../../src/pipeline.mjs';
import { checkStoryboard, readStoryboard } from '../../src/storyboard.mjs';

/**
 * The pipeline of the project at `folder` (the one with film.html), with its storyboard check. The stages come as an
 * ordered array, each with what it leaves (`leaves`), so a reader needs no knowledge of the line's order; a state
 * file that cannot be read comes as `problem` with no pipeline.
 */
export function pipelineState(folder) {
  const read = readPipeline(folder);
  const pipeline = read && !read.problem
    ? { ...read, stages: STAGES.map(({ name, leaves }) => ({ name, leaves, ...read.stages[name] })) }
    : null;
  const board = readStoryboard(folder);
  return {
    ...(read?.problem ? { problem: read.problem } : {}),
    pipeline,
    check: board ? checkStoryboard(folder, board, { seconds: read?.seconds }) : null,
  };
}
