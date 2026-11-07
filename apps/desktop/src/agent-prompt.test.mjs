import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, STUDIO_REFERENCES, ownAgentPrompt } from './agents.mjs';

const count = (text, part) => text.split(part).length - 1;

test("the app's own agent's prompt is short: where it is and how it talks; how a film is made is in OpenFilm's skills", () => {
  const prompt = ownAgentPrompt();
  assert.ok(prompt.split(/\s+/).length < 300, 'a page, not the manual');
  assert.ok(!prompt.includes('<manual>') && !prompt.includes('## film.html'), 'the manual is not carried: its skills are');
  assert.match(prompt, /read `edit` before you make or change a film/);
  assert.ok(!prompt.includes(INSTRUCTIONS), 'not the words for another agent');
  assert.equal(count(prompt, STUDIO_REFERENCES), 1, 'how Studio is pointed at, once');
  assert.equal(count(prompt, 'Reply in the language'), 1);
  assert.match(prompt, /already open beside this chat/);
  assert.ok(!prompt.includes('openfilm render'), 'the person exports from Studio');
  const without = ownAgentPrompt({ edit: false });
  assert.ok(!without.includes('`edit`') && without.includes("OpenFilm's skills, listed below, say how."), 'turned off: not sent to it');
});

test('every agent is told how to point at Studio', () => {
  assert.ok(INSTRUCTIONS.endsWith(STUDIO_REFERENCES));
});
