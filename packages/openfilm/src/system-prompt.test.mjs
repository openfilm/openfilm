import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { systemPrompt } from './system-prompt.mjs';

test('the system prompt is a few lines: where the agent is, that skills say how, and in the app how to be with the person', () => {
  for (const where of ['terminal', 'app']) {
    const prompt = systemPrompt(where);
    assert.ok(prompt.split(/\s+/).length < (where === 'app' ? 250 : 140), `${where}: ${prompt.split(/\s+/).length} words`);
    /* an agent in a terminal is someone's own: how it talks with them is not OpenFilm's to say */
    assert.equal(prompt.split('Reply in the language').length - 1, where === 'app' ? 1 : 0);
    assert.match(prompt, /`openfilm skill <name>` prints one\./);
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
      ...(where === 'terminal' ? ['`openfilm <command> --help`', '`openfilm open <folder>`'] : []), '`openfilm skill <name>`',
    ].sort());
  }
});

test('an agent in a terminal is told how Studio is opened; one in the app, that it is open beside it', () => {
  assert.match(systemPrompt('terminal'), /`openfilm open <folder>` starts Studio on a project/);
  assert.ok(!systemPrompt('terminal').includes('already open beside this chat'));
  assert.match(systemPrompt('app'), /Studio is open beside this chat/);
  /* in the app Studio is never opened: not a word of how it is */
  assert.ok(!systemPrompt('app').includes('openfilm open'));
  assert.ok(!systemPrompt('app').includes('starts Studio on a project'));
  /* a text of another's with the same marks is read the same way */
  assert.equal(systemPrompt('app', 'A\n\n<!-- in a terminal -->\nT\n\n<!-- in the app -->\nP\n\n<!-- everywhere -->\nE\n'), 'A\n\nP\n\nE\n');
});

test('in the app it says how the person points at Studio and how to point back; what follows `#` is each skill\'s', () => {
  assert.match(systemPrompt('app'), /comes as numbered links after their message/);
  assert.match(systemPrompt('app'), /Point back with Markdown links to the project's files/);
  assert.ok(!systemPrompt('terminal').includes('numbered links'), 'a terminal has no chat to point in');
  for (const where of ['terminal', 'app']) assert.ok(!/#t=|xywh|#s\d/.test(systemPrompt(where)), `${where}: the film's links are the film skill's`);
});

test("`openfilm --help` in the app leaves out what is never run there: opening Studio and updating it", () => {
  const cli = fileURLToPath(new URL('../bin/openfilm.mjs', import.meta.url));
  const help = (agent) => spawnSync(process.execPath, [cli, '--help'], {
    encoding: 'utf8', env: { ...process.env, OPENFILM_AGENT: agent, OPENFILM_RUN: 'openfilm', OPENFILM_NO_UPDATE_CHECK: '1' },
  }).stdout;
  const app = help('app:c1'), terminal = help('');
  for (const command of ['openfilm open', 'openfilm update']) {
    assert.ok(terminal.includes(command), `terminal: ${command}`);
    assert.ok(!app.includes(command), `app: ${command}`);
  }
  for (const text of [app, terminal]) {
    assert.match(text, /openfilm get .*music, sound effects, stickers/);
    assert.ok(!/openfilm canvas|transition/.test(text), 'a plugin\'s command is its skill\'s to say; no transitions');
  }
});
