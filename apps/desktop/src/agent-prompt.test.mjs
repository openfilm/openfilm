import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, ownAgentPrompt } from './agents.mjs';

const count = (text, part) => text.split(part).length - 1;

test("the app's own agent's prompt is OpenFilm's system prompt for an agent in the app: where it is and how it talks; how any work is done is in the skills", () => {
  const prompt = ownAgentPrompt();
  assert.ok(prompt.split(/\s+/).length < 330, 'a few lines');
  for (const word of ['## film.html', 'window.film', '`edit`', 'openfilm look', 'openfilm render', 'openfilm get']) assert.ok(!prompt.includes(word), `nothing of one kind of work: ${word}`);
  assert.ok(!prompt.includes(INSTRUCTIONS), 'not the words for another agent');
  assert.equal(count(prompt, 'numbered links after their message'), 1, 'how Studio is pointed at, once: the system prompt says it');
  assert.equal(count(prompt, 'Reply in the language'), 1);
  assert.match(prompt, /Studio is open beside this chat/);
  assert.match(prompt, /Read the one a task needs, whole, before you start it/);
  for (const word of ['npx', 'openfilm open']) assert.ok(!prompt.includes(word), `nothing a desktop agent never runs: ${word}`);
});

test('another agent is told to run openfilm for the system prompt and the skills, and nothing of how a film is made', () => {
  assert.match(INSTRUCTIONS, /run `openfilm` with no arguments and follow\swhat it prints/);
  for (const word of ['window.film', 'openfilm look', 'Reply in the language']) assert.ok(!INSTRUCTIONS.includes(word), word);
});

test('another agent is told nothing it never runs in the app, nor how to point: what `openfilm` prints says that', () => {
  for (const word of ['npx', 'openfilm open', '#t=']) assert.ok(!INSTRUCTIONS.includes(word), word);
});

test("the app's own agent is told which of its skills build on which, as `openfilm` tells others", () => {
  const line = 'Read a skill after those it builds on: `openfilm-motion` after `openfilm-film`.';
  assert.ok(ownAgentPrompt(line).includes(line));
  assert.ok(!ownAgentPrompt().includes('Read a skill after'), 'none said when none builds on another');
});
