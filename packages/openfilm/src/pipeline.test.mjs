import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize, pipelineFile, readPipeline, renderGate, setStage, startPipeline, statusLines, STAGES } from './pipeline.mjs';

/** A project: a folder with a film.html, as look and render take one. */
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-pipeline-'));
  writeFileSync(join(dir, 'film.html'), '<!doctype html>');
  return dir;
};

test('start begins the line: every stage to do, the brief written and done when one is given', () => {
  const dir = project();
  const begun = startPipeline(dir, { title: 'A launch video', seconds: 20 });
  assert.equal(begun.title, 'A launch video');
  assert.deepEqual(Object.values(begun.stages).map((s) => s.status), ['todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo']);
  assert.ok(!existsSync(join(dir, '.film', 'pipeline', 'brief.md')));
  const withBrief = startPipeline(dir, { brief: 'Say what the tool does, to developers, in 20 seconds.' });
  assert.equal(withBrief.stages.brief.status, 'done');
  assert.equal(readPipeline(dir).stages.brief.status, 'done');
  assert.ok(existsSync(join(dir, '.film', 'pipeline', 'brief.md')));
});

test('a stage is marked done in order: one before an open one is refused, its own turn is taken, already done is said', () => {
  const dir = project();
  startPipeline(dir, {});
  const early = setStage(dir, 'storyboard', 'done');
  assert.equal(early.ok, false);
  assert.match(early.lines[0], /brief is not done yet/);
  const brief = setStage(dir, 'brief', 'done', { note: 'said and aimed' });
  assert.equal(brief.ok, true);
  const again = setStage(dir, 'brief', 'done');
  assert.equal(again.ok, true);
  assert.match(again.lines[0], /already done/);
  const unknown = setStage(dir, 'filming', 'done');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.usage, true);
});

test('the status says what each open stage leaves, and the next thing to do', () => {
  const dir = project();
  startPipeline(dir, { title: 'T' });
  setStage(dir, 'brief', 'done');
  const lines = statusLines(readPipeline(dir), { project: dir });
  const at = lines.findIndex((l) => l.includes('script'));
  assert.match(lines[at + 1], /\.film\/pipeline\/script\.md/, lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('next     script:')), lines.join('\n'));
  const allDone = STAGES.map(({ name }) => setStage(dir, name, 'done'));
  assert.ok(allDone.every((r) => r.ok), allDone.filter((r) => !r.ok).map((r) => r.lines[0]).join('\n'));
  const last = statusLines(readPipeline(dir), { project: dir });
  assert.ok(last.some((l) => l.includes('all stages done')), last.join('\n'));
});

test('render holds until the film is made and checked, and goes once it is', () => {
  const dir = project();
  assert.equal(renderGate(readPipeline(dir)), null, 'no pipeline, no gate');
  startPipeline(dir, {});
  assert.match(renderGate(readPipeline(dir)), /assembly and review/);
  setStage(dir, 'brief', 'done');
  setStage(dir, 'script', 'done');
  setStage(dir, 'storyboard', 'done');
  setStage(dir, 'assets', 'done');
  assert.match(renderGate(readPipeline(dir)), /assembly and review/);
  setStage(dir, 'assembly', 'done');
  assert.match(renderGate(readPipeline(dir)), /review/);
  setStage(dir, 'review', 'done');
  assert.equal(renderGate(readPipeline(dir)), null);
});

test('a pipeline that cannot be read is said so, and one that is partly written is made whole', () => {
  const dir = project();
  const write = (text) => { mkdirSync(join(dir, '.film'), { recursive: true }); writeFileSync(pipelineFile(dir), text); };
  write('{ not json');
  const broken = readPipeline(dir);
  assert.match(broken.problem, /pipeline\.json/);
  write(JSON.stringify({ stages: { brief: 'done', script: { status: 'wild' } } }));
  const madeWhole = readPipeline(dir);
  assert.equal(madeWhole.stages.brief.status, 'done');
  assert.equal(madeWhole.stages.script.status, 'todo');
  assert.equal(madeWhole.stages.storyboard.status, 'todo');
  assert.equal(normalize({ stages: null }), null);
});
