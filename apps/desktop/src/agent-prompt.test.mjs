import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, STUDIO_REFERENCES, ownAgentPrompt } from './agents.mjs';

const count = (text, part) => text.split(part).length - 1;

test("the app's own agent's prompt is OpenFilm's system prompt for an agent in the app: where it is and how it talks; how any work is done is in the skills", () => {
  const prompt = ownAgentPrompt();
  assert.ok(prompt.split(/\s+/).length < 330, 'a few lines');
  for (const word of ['## film.html', 'window.film', '`edit`', 'openfilm look', 'openfilm render', 'openfilm get']) assert.ok(!prompt.includes(word), `nothing of one kind of work: ${word}`);
  assert.ok(!prompt.includes(INSTRUCTIONS), 'not the words for another agent');
  assert.equal(count(prompt, STUDIO_REFERENCES), 1, 'how Studio is pointed at, once');
  assert.equal(count(prompt, 'Reply in the language'), 1);
  assert.match(prompt, /already open beside this chat/);
  assert.match(prompt, /Read the one a task needs, whole, before you start it/);
  assert.match(prompt, /Run OpenFilm's commands as `openfilm`, also where a skill says `npx openfilm`/);
});

test('another agent is told to run openfilm for the system prompt and the skills, and nothing of how a film is made', () => {
  assert.match(INSTRUCTIONS, /run `openfilm` with no\narguments and follow what it prints/);
  for (const word of ['window.film', 'openfilm look', 'Reply in the language']) assert.ok(!INSTRUCTIONS.includes(word), word);
});

test('every agent is told how to point at Studio', () => {
  assert.ok(INSTRUCTIONS.endsWith(STUDIO_REFERENCES));
});
