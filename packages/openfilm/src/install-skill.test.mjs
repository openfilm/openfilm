import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill } from './install-skill.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'of-skill-'));
const noShell = (dir) => ({ env: { PATH: '' }, home: dir });

test('the skill is installed into an agent\'s own folders, and the shared one where it reads it too', () => {
  const dir = home();
  const result = installSkill(['zcode'], noShell(dir));
  assert.equal(result.ok, true, result.lines.join('\n'));
  assert.ok(existsSync(join(dir, '.zcode', 'skills', 'openfilm', 'SKILL.md')));
  assert.ok(existsSync(join(dir, '.agents', 'skills', 'openfilm', 'SKILL.md')));
  /* WorkBuddy runs on CodeBuddy's CLI: both install into ~/.codebuddy/skills */
  assert.equal(installSkill(['workbuddy'], noShell(dir)).ok, true);
  assert.ok(existsSync(join(dir, '.codebuddy', 'skills', 'openfilm', 'SKILL.md')));
  assert.ok(existsSync(join(dir, '.agents', 'skills', 'openfilm', 'SKILL.md')));
});

test('an install again replaces the same skill, and nothing else is touched', () => {
  const dir = home();
  const first = installSkill(['claude'], noShell(dir));
  assert.match(first.lines.join('\n'), /installed/);
  const second = installSkill(['claude'], noShell(dir));
  assert.match(second.lines.join('\n'), /updated/);
  assert.ok(existsSync(join(dir, '.claude', 'skills', 'openfilm', 'SKILL.md')));
});

test('an agent no one knows is a wrong command; with no names, every agent here is installed for', () => {
  const dir = home();
  const unknown = installSkill(['filmora'], noShell(dir));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.usage, true);
  const none = installSkill([], noShell(dir));
  assert.equal(none.ok, false);
  assert.match(none.lines[0], /no coding agent found/);
  mkdirSync(join(dir, '.zcode'), { recursive: true });
  const found = installSkill([], noShell(dir));
  assert.equal(found.ok, true, found.lines.join('\n'));
  assert.ok(found.lines.some((l) => l.startsWith('zcode:')), found.lines.join('\n'));
  assert.ok(!existsSync(join(dir, '.claude')), 'an agent that is not here gets nothing');
});
