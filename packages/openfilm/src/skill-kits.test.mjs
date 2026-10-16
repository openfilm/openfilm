import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFile } from './skills.mjs';
import { filmFrame, rand as filmRand, wobble } from '../skills/vintage-film/film-look.js';
import { ease, rand as boardRand, shapes } from '../skills/whiteboard/whiteboard.js';
import { inOut } from '../skills/keynote/keynote.js';

const SKILLS = join(import.meta.dirname, '..', 'skills');

test('every official skill: a SKILL.md named as its folder, with a description, and a title and summary in five languages', () => {
  for (const name of readdirSync(SKILLS)) {
    const { fields } = parseSkillFile(readFileSync(join(SKILLS, name, 'SKILL.md'), 'utf8'));
    assert.equal(fields.name, name);
    assert.ok(fields.description.length > 80, `${name} says when to use it`);
    const shown = JSON.parse(readFileSync(join(SKILLS, name, 'openfilm.json'), 'utf8'));
    for (const lang of ['en', 'zh-CN', 'ja', 'ko', 'es']) {
      assert.ok(shown.title[lang], `${name} title ${lang}`);
      assert.ok(shown.summary[lang], `${name} summary ${lang}`);
    }
  }
});

test('film look: the same t always gives the same grain frame and drift, and grain changes 24 times a second', () => {
  assert.equal(filmFrame(1), 24);
  assert.equal(filmFrame(1.04), 24);
  assert.equal(filmFrame(1.042), 25);
  assert.equal(filmRand(7), filmRand(7));
  assert.notEqual(filmRand(7), filmRand(8));
  assert.equal(wobble(2.37, 3), wobble(2.37, 3));
  for (let t = 0; t < 5; t += 0.13) assert.ok(Math.abs(wobble(t, 1)) <= 1);
});

test('whiteboard: strokes from shapes, an ease from 0 to 1, and the same seed the same wobble', () => {
  assert.equal(shapes.arrow(0, 0, 100, 0).length, 2);
  assert.equal(shapes.rect(0, 0, 10, 10)[0].length, 5);
  assert.equal(ease(0, 1, 2), 0);
  assert.equal(ease(3, 1, 2), 1);
  assert.equal(ease(2, 1, 2), 0.5);
  assert.equal(boardRand(3), boardRand(3));
  assert.equal(inOut(0.5), 0.5);
});
