import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, titleFile } from '../chat/src/lib/step-file.ts';

test('a path names its file, with either separator', () => {
  assert.equal(baseName('C:\\Users\\me\\Videos\\OpenFilm\\Projects\\a film\\.film\\cache\\look\\0-5s.png'), '0-5s.png');
  assert.equal(baseName('/Users/me/Movies/OpenFilm/Projects/a film/film.html'), 'film.html');
  assert.equal(baseName('C:\\Users\\me\\Videos\\OpenFilm\\Projects\\a film\\'), 'a film');
  assert.equal(baseName('film.html'), 'film.html');
});

test('a read titled by its path names the file, as each agent titles it', () => {
  /* the titles of reads as the agents sent them on Windows, then two as on macOS */
  const titles = [
    ['Claude Code', 'Read .film\\cache\\look\\0-5s.png', '0-5s.png'],
    ['Claude Code', 'Read scenes\\title.html (76 - 81)', 'title.html'],
    ['Claude Code', 'Read scenes\\title.html (from line 76)', 'title.html'],
    ['OpenCode', 'Users\\me\\Videos\\OpenFilm\\Projects\\a film\\.film\\cache\\look\\0-5s.png', '0-5s.png'],
    ['Copilot', 'Viewing ...ts\\a film\\.film\\cache\\look\\0-5s.png', '0-5s.png'],
    ['Copilot', 'Viewing ...eos\\OpenFilm\\Projects\\a film', 'a film'],
    ['Cursor', 'Read C:\\Users\\me\\.claude\\skills\\openfilm\\SKILL.md', 'SKILL.md'],
    ['Cursor', 'Read film.html', 'film.html'],
    ['Codex', 'View Image C:\\Users\\me\\Videos\\OpenFilm\\Projects\\a film\\.film\\cache\\look\\0-5s.png', '0-5s.png'],
    ['Claude Code', 'Read .film/cache/look/0-5s.png (1 - 40)', '0-5s.png'],
    ['OpenCode', 'Users/me/Movies/OpenFilm/Projects/a film/film.html', 'film.html'],
  ];
  for (const [agent, title, file] of titles) assert.equal(titleFile(title), file, `${agent}: ${title}`);
});

test('a title that is no path names no file, so the row keeps the one it has', () => {
  /* Claude Code's before it knows which file, kept for the call's later updates; OpenCode's at first */
  for (const title of ['Read File', 'read', '']) assert.equal(titleFile(title), undefined, title);
});
