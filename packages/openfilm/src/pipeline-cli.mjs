/**
 * `openfilm pipeline`: the production line (src/pipeline.mjs). Its own options (--title, --seconds, --brief, --done,
 * --note) are parsed here, not in the shared CLI parser, which knows only the options every command shares.
 */
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { UsageError } from './shared.mjs';
import { pipelineFile, readPipeline, setStage, startPipeline, statusLines, STAGES } from './pipeline.mjs';

export const PIPELINE_HELP = `openfilm pipeline [stage --done] [--title t] [--seconds n] [--brief text]

  The production line a film goes through, and where this one stands. The stages go in order:
  brief → script → storyboard → assets → assembly → review → deliver
  each leaving its work behind (run with no arguments to see what and where).

  (no arguments)   the stages of the project around the current folder, and the next thing to do
  start            begin the line for this film: --title "…" --seconds N, and --brief "…" to write
                   .film/pipeline/brief.md and mark the brief stage done in one step
  stage --done     a stage's work is finished (its stage before it must be): \`openfilm pipeline script --done\`
    --note "…"     one line on what the stage left (a stage's own words in the status)
`;

/** The project `from` is in (it, or a folder above it), if any. */
const around = (from) => {
  for (let up = resolve(from); up !== dirname(up); up = dirname(up)) if (existsSync(join(up, 'film.html'))) return up;
  return null;
};

/** The stages, one per line, for the answer when none has started. */
const stageHelpLines = () => STAGES.map(({ name, leaves }, i) => `  ${i + 1}  ${name.padEnd(10)}  ${leaves}`);

/** `openfilm pipeline`, as the agent or the person runs it. */
export async function pipelineCommand(args, run = 'openfilm') {
  const project = around('.');
  if (!project) {
    return { ok: false, usage: true, lines: [`${run} pipeline: ${process.cwd()} is not in a project; \`${run} open\` makes one and shows it in Studio`] };
  }
  const [verb, ...rest] = args;
  if (verb === 'start') {
    let o;
    try { o = parseArgs({ args: rest, options: { title: { type: 'string' }, seconds: { type: 'string' }, brief: { type: 'string' } } }).values; } catch { throw new UsageError(PIPELINE_HELP.trim()); }
    const seconds = o.seconds == null ? undefined : Number(o.seconds);
    if (o.seconds != null && !Number.isFinite(seconds)) throw new UsageError(`openfilm pipeline start: --seconds is a number, not ${o.seconds}`);
    const pipeline = startPipeline(project, { title: o.title, seconds, brief: o.brief });
    return { ok: true, lines: [`The production line is started for this film; the person can read it at ${pipelineFile(project)}.`, '', ...statusLines(pipeline, { project, run })] };
  }
  if (verb === '--help' || verb === '-h' || verb === 'help') return { ok: true, lines: [PIPELINE_HELP.trim()] };
  if (verb && !verb.startsWith('-')) {
    let o;
    try { o = parseArgs({ args: rest, options: { done: { type: 'boolean' }, note: { type: 'string' } } }).values; } catch { throw new UsageError(PIPELINE_HELP.trim()); }
    if (!o.done) return { ok: false, usage: true, lines: [`${run} pipeline: say what the stage is now: \`--done\` when its work is finished (or run \`${run} pipeline\` for where things stand)`] };
    return setStage(project, verb, 'done', { note: o.note });
  }
  const read = readPipeline(project);
  if (!read) {
    return { ok: true, lines: [
      `No production line for the film here (${pipelineFile(project)} is absent): make it as the manual says, or begin one:`,
      '',
      `  ${run} pipeline start --title "A 20-second launch video" --seconds 20 --brief "what it says, to whom, in what tone"`,
      '',
      ...stageHelpLines(),
    ] };
  }
  if (read.problem) return { ok: false, lines: [`${run} pipeline: ${read.problem}`] };
  return { ok: true, lines: statusLines(read, { project, run }) };
}
