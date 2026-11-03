import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipelineState } from './pipeline.mjs';

/** A project: a folder with a film.html, as a project's folder is. */
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'of-pipeline-state-'));
  writeFileSync(join(dir, 'film.html'), '<!doctype html>');
  return dir;
};

/** The project's pipeline state and storyboard written as the agent's command writes them. */
const begin = (dir, { storyboard }) => {
  mkdirSync(join(dir, '.film', 'pipeline'), { recursive: true });
  writeFileSync(join(dir, '.film', 'pipeline.json'), JSON.stringify({
    version: 1, title: 'A launch film', seconds: 10,
    stages: Object.fromEntries(['brief', 'script', 'storyboard', 'assets', 'assembly', 'review', 'deliver'].map((name, i) => [name, { status: i < 3 ? 'done' : 'todo' }])),
  }));
  if (storyboard) writeFileSync(join(dir, '.film', 'pipeline', 'storyboard.md'), storyboard);
};

test('no production line, nothing to show: both null', () => {
  const said = pipelineState(project());
  assert.equal(said.pipeline, null);
  assert.equal(said.check, null);
});

test('the line as it stands, its stages in order with what each leaves, and what the check says is missing', () => {
  const dir = project();
  begin(dir, { storyboard: ['## Shot 1 — 4s', 'page: title.html', 'vo: One prompt, one film.', ''].join('\n') });
  const { pipeline, check } = pipelineState(dir);
  assert.equal(pipeline.title, 'A launch film');
  assert.deepEqual(pipeline.stages.map((s) => s.name), ['brief', 'script', 'storyboard', 'assets', 'assembly', 'review', 'deliver']);
  assert.match(pipeline.stages[3].leaves, /assets\//);
  assert.equal(pipeline.stages[0].status, 'done');
  assert.equal(pipeline.stages[4].status, 'todo');
  assert.equal(check.ok, false);
  const text = check.lines.join('\n');
  assert.match(text, /page title\.html is not written yet/);
  assert.match(text, /voice not recorded/);
  assert.match(text, /the shots add up to 4 s; the film is 10 s/);
});

test('a state file that cannot be read is said so, with no pipeline pretended', () => {
  const dir = project();
  mkdirSync(join(dir, '.film'), { recursive: true });
  writeFileSync(join(dir, '.film', 'pipeline.json'), '{ not json');
  const { problem, pipeline } = pipelineState(dir);
  assert.match(problem, /pipeline\.json/);
  assert.equal(pipeline, null);
});

test('the check is quiet when the work has landed, and the panel can say so', () => {
  const dir = project();
  begin(dir, { storyboard: ['## Shot 1 — 4s', 'page: title.html', 'vo: One prompt, one film.', '',
    '## Shot 2 — 6s', 'page: demo.html', ''].join('\n') });
  writeFileSync(join(dir, 'title.html'), '<!doctype html>');
  writeFileSync(join(dir, 'demo.html'), '<!doctype html>');
  writeFileSync(join(dir, 'film.html'), '<section><iframe src="title.html#t=0,4"></iframe><iframe src="demo.html#t=0,6"></iframe></section>');
  mkdirSync(join(dir, 'assets', 'audio', 'vo'), { recursive: true });
  writeFileSync(join(dir, 'assets', 'audio', 'vo', 'shot-1.wav'), 'x');
  const { check } = pipelineState(dir);
  assert.equal(check.ok, true);
});
