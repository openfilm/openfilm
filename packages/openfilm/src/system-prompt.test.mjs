import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt } from './system-prompt.mjs';

test('the system prompt is a few lines: where the agent is, that skills say how, and in the app how to be with the person', () => {
  for (const where of ['terminal', 'app']) {
    const prompt = systemPrompt(where);
    assert.ok(prompt.split(/\s+/).length < (where === 'app' ? 210 : 140), `${where}: ${prompt.split(/\s+/).length} words`);
    /* an agent in a terminal is someone's own: how it talks with them is not OpenFilm's to say */
    assert.equal(prompt.split('Reply in the language').length - 1, where === 'app' ? 1 : 0);
    assert.match(prompt, /`openfilm skill <name>` prints one, `openfilm skills` lists them all/);
    assert.ok(!prompt.includes('<!--'), 'the marks of the file are not part of it');
  }
});

test('it holds nothing of any one kind of work: no film, no page, no command but the ones that reach the skills and Studio', () => {
  for (const where of ['terminal', 'app']) {
    const prompt = systemPrompt(where);
    for (const word of ['film.html', 'window.film', 'openfilm look', 'openfilm render', 'openfilm get', 'openfilm canvas', '`edit`', '`media`']) {
      assert.ok(!prompt.includes(word), `${where}: ${word}`);
    }
    assert.deepEqual([...new Set(prompt.match(/`openfilm[^`]*`/g))].sort(), [
      ...(where === 'terminal' ? ['`openfilm <command> --help`'] : []), '`openfilm open <folder>`', '`openfilm open`', '`openfilm skill <name>`', '`openfilm skills`',
    ].filter((c) => (where === 'terminal' ? c !== '`openfilm open`' : c !== '`openfilm open <folder>`')).sort());
  }
});

test('an agent in a terminal is told how Studio is opened; one in the app, that it is open beside it', () => {
  assert.match(systemPrompt('terminal'), /`openfilm open <folder>` starts Studio on a project/);
  assert.ok(!systemPrompt('terminal').includes('already open beside this chat'));
  assert.match(systemPrompt('app'), /Studio is already open beside this chat.*never open it yourself/);
  assert.ok(!systemPrompt('app').includes('starts Studio on a project'));
  /* a text of another's with the same marks is read the same way */
  assert.equal(systemPrompt('app', 'A\n\n<!-- in a terminal -->\nT\n\n<!-- in the app -->\nP\n\n<!-- everywhere -->\nE\n'), 'A\n\nP\n\nE\n');
});
