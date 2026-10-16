import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFile } from './skills.mjs';

const SKILLS = join(import.meta.dirname, '..', 'skills');
const NAMES = readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

test('every official skill: a SKILL.md named as its folder, with a description, and a title and summary in five languages', () => {
  assert.ok(NAMES.length > 0);
  for (const name of NAMES) {
    const { fields } = parseSkillFile(readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8'));
    assert.equal(fields.name, name);
    assert.ok(fields.description.length > 80, `${name} says when to use it`);
    const shown = JSON.parse(readFileSync(join(SKILLS, name, 'openfilm.json'), 'utf8'));
    assert.equal(shown.repository, `https://github.com/openfilm/skills/tree/main/skills/${name}`);
    for (const lang of ['en', 'zh-CN', 'ja', 'ko', 'es']) {
      assert.ok(shown.title[lang], `${name} title ${lang}`);
      assert.ok(shown.summary[lang], `${name} summary ${lang}`);
    }
  }
});

test('every file a skill names in its own folder is there', () => {
  for (const name of NAMES) {
    const md = readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8');
    for (const [, file] of md.matchAll(/<this skill's folder>\/([\w.-]+)/g)) {
      assert.ok(existsSync(join(SKILLS, name, file)), `${name} names ${file}`);
    }
  }
});

test('the official skills are a copy of openfilm/skills, and say of which commit', () => {
  assert.match(readFileSync(join(SKILLS, 'SOURCE'), 'utf8'), /^https:\/\/github\.com\/openfilm\/skills\/commit\/[0-9a-f]{40}\n/);
});
