/**
 * The production line a film goes through (`.film/pipeline.json`), and what the `openfilm pipeline` command says about
 * it. A film needs no pipeline: an agent may improvise, as the manual allows. When one is started, the stages are the
 * agreed order of work and `render` holds until the film has been made and checked — so "make me a video" becomes a
 * line the person can read, in Studio's files as anywhere, instead of a black box.
 *
 * The state lives beside the rest of the tools' area (.film/), which Studio does not watch; it is written by the
 * agent through this command, and read by the person whenever they like. Reads no Electron module and needs no
 * Studio, so an agent in a terminal (web mode) runs it as it is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The stages, in the order they are worked, and what each one leaves behind. */
export const STAGES = Object.freeze([
  { name: 'brief', leaves: '.film/pipeline/brief.md — what the film says, to whom, how long, in what tone' },
  { name: 'script', leaves: '.film/pipeline/script.md — the words, and the shots in order' },
  { name: 'storyboard', leaves: '.film/pipeline/storyboard.md — one entry per shot: its page, seconds, media, on-screen text' },
  { name: 'assets', leaves: 'assets/ — the voice, music, pictures and video the storyboard calls for (openfilm get, or your services)' },
  { name: 'assembly', leaves: 'the pages (window.film) cut together by film.html — the whole film, watchable in Studio' },
  { name: 'review', leaves: 'openfilm look run, its sheets read, what it found fixed; the person\'s Studio edits kept' },
  { name: 'deliver', leaves: 'the MP4 (openfilm render) or an export from Studio, as the person asked' },
]);

const STATUSES = new Set(['todo', 'doing', 'done']);
const STAGE_NAMES = STAGES.map((s) => s.name);

/** The pipeline file of the project `project` (the folder with film.html). */
export const pipelineFile = (project) => join(project, '.film', 'pipeline.json');
/** The folder the stages' written work goes in. */
export const pipelineDir = (project) => join(project, '.film', 'pipeline');

/** The pipeline as it stands, or null when there is none (or it cannot be read: `problem` says why). */
export function readPipeline(project) {
  const file = pipelineFile(project);
  if (!existsSync(file)) return null;
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { problem: `${file}: ${e.message}` }; }
  return normalize(data) ?? { problem: `${file}: not a pipeline (no stages)` };
}

/** A pipeline made whole: stages in order, each with a status; null when it is not one. */
export function normalize(data) {
  if (!data || typeof data !== 'object' || typeof data.stages !== 'object' || !data.stages) return null;
  const stages = {};
  for (const { name } of STAGES) {
    const stage = data.stages[name];
    const status = typeof stage === 'string' ? stage : stage?.status;
    stages[name] = {
      status: STATUSES.has(status) ? status : 'todo',
      ...(stage?.note ? { note: String(stage.note) } : {}),
      ...(stage?.at ? { at: String(stage.at) } : {}),
    };
  }
  return {
    version: 1,
    ...(typeof data.title === 'string' ? { title: data.title } : {}),
    ...(Number.isFinite(data.seconds) ? { seconds: data.seconds } : {}),
    stages,
  };
}

const write = (project, pipeline) => {
  mkdirSync(join(project, '.film'), { recursive: true });
  writeFileSync(pipelineFile(project), `${JSON.stringify(pipeline, null, 2)}\n`);
};

/**
 * The line started: every stage to do, the brief written when one is given (its stage done — the writing is the
 * stage). `brief` is what the film is for; it is the first thing the person reads.
 */
export function startPipeline(project, { title, seconds, brief } = {}) {
  const stages = Object.fromEntries(STAGE_NAMES.map((name) => [name, { status: 'todo' }]));
  if (brief) {
    mkdirSync(pipelineDir(project), { recursive: true });
    writeFileSync(join(pipelineDir(project), 'brief.md'), `${brief.trim()}\n`);
    stages.brief = { status: 'done', note: 'the brief, from `pipeline start`', at: new Date().toISOString() };
  }
  const pipeline = { version: 1, ...(title ? { title } : {}), ...(Number.isFinite(seconds) ? { seconds } : {}), stages };
  write(project, pipeline);
  return pipeline;
}

/** A stage marked, when its turn has come (every stage before it done); an answer line either way. */
export function setStage(project, stage, status, { note } = {}) {
  const read = readPipeline(project);
  if (!read) return { ok: false, lines: ['openfilm pipeline: none started here; `openfilm pipeline start --title "…" [--seconds N] [--brief "…"]` begins one'] };
  if (read.problem) return { ok: false, lines: [`openfilm pipeline: ${read.problem}`] };
  if (!STAGE_NAMES.includes(stage)) return { ok: false, usage: true, lines: [`openfilm pipeline: no stage ${stage}; these are the stages: ${STAGE_NAMES.join(', ')}`] };
  const firstOpen = STAGE_NAMES.find((name) => read.stages[name].status !== 'done');
  if (read.stages[stage].status === 'done' && status === 'done') return { ok: true, lines: [`openfilm pipeline: ${stage} was already done`] };
  if (STAGE_NAMES.indexOf(stage) > STAGE_NAMES.indexOf(firstOpen)) {
    return { ok: false, lines: [`openfilm pipeline: ${firstOpen} is not done yet; the stages go in order (${STAGE_NAMES.join(' → ')})`] };
  }
  read.stages[stage] = { status, ...(note ? { note } : {}), at: new Date().toISOString() };
  write(project, read);
  return { ok: true, lines: statusLines(read, { project }) };
}

/** The pipeline as lines for a terminal (the `openfilm pipeline` command's answer). */
export function statusLines(pipeline, { project, run = 'openfilm' } = {}) {
  const lines = [];
  if (pipeline.title) lines.push(`title    ${pipeline.title}`);
  if (pipeline.seconds != null) lines.push(`seconds  ${pipeline.seconds}`);
  const width = Math.max(...STAGE_NAMES.map((s) => s.length));
  STAGES.forEach(({ name, leaves }, i) => {
    const stage = pipeline.stages[name];
    const mark = stage.status === 'done' ? 'done' : stage.status === 'doing' ? 'doing' : '    ';
    lines.push(`  ${i + 1}  ${name.padEnd(width)}  ${mark}${stage.note ? `  ${stage.note}` : ''}`);
    if (stage.status !== 'done') lines.push(`      leaves  ${leaves}`);
  });
  const firstOpen = STAGE_NAMES.find((name) => pipeline.stages[name].status !== 'done');
  lines.push('', firstOpen
    ? `next     ${firstOpen}: ${STAGES.find((s) => s.name === firstOpen).leaves}`
    : 'all stages done; render or export when the person asks');
  if (project) lines.push(`state    ${pipelineFile(project)}`);
  return lines;
}

/** Why `render` holds, or null when it may go: a started pipeline wants the film made and checked first. */
export function renderGate(pipeline) {
  if (!pipeline) return null;
  const open = ['assembly', 'review'].filter((name) => pipeline.stages[name].status !== 'done');
  if (!open.length) return null;
  return `the pipeline's ${open.join(' and ')} stage${open.length > 1 ? 's are' : ' is'} not done yet; make the film and check it with \`openfilm look\`, then mark the stages done (\`openfilm pipeline ${open[0]} --done\`)`;
}
