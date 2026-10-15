import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUCTIONS, STUDIO_REFERENCES, ownAgentPrompt } from './agents.mjs';

const count = (text, part) => text.split(part).length - 1;

test("the app's own agent's prompt says each thing once and never tells it to go and print the manual it carries", () => {
  const prompt = ownAgentPrompt();
  assert.equal(count(prompt, '<manual>'), 1);
  assert.ok(!prompt.includes('npx openfilm'), 'the command on its PATH, as the manual reads for it');
  assert.ok(!prompt.includes(INSTRUCTIONS), 'not the words for another agent');
  assert.ok(!/run\s+`openfilm`\s+with no arguments/.test(prompt), 'no telling it to print the manual it already has');
  assert.equal(count(prompt, STUDIO_REFERENCES), 1, 'how Studio is pointed at, once');
  assert.equal(count(prompt, 'Reply in the language'), 1);
  assert.match(prompt, /Never run `openfilm open`/, 'Studio is open beside it, whatever the manual says of `open`');
});

test('every agent is told how to point at Studio', () => {
  assert.ok(INSTRUCTIONS.endsWith(STUDIO_REFERENCES));
});
