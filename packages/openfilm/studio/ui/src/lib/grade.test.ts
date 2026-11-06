import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeFilter, gradeOf, withGrade } from './grade.ts';

const grade = { mix: [1.1, 0, -0.1, 0, 0, 1, 0, 0, -0.1, 0, 1.1, 0.02], sat: 0.8, all: [0.05, 0.5, 0.95], b: [0.1, 0.55, 0.9] };

test('a grade is one SVG filter that says which it is and how strong', () => {
  const f = gradeFilter('filters/teal', grade, 0.6);
  assert.match(f, /^url\("data:image\/svg\+xml,.*#openfilm-look"\)$/);
  assert.deepEqual(gradeOf(`brightness(1.1) ${f}`), { id: 'filters/teal', amount: 0.6 });
  assert.equal(gradeOf('brightness(1.1)'), null);
});

test('at nothing it leaves the picture as it is; at full it is the grade', () => {
  const svg = decodeURIComponent(gradeFilter('x', grade, 0).slice('url("data:image/svg+xml,'.length, -'#openfilm-look")'.length));
  assert.match(svg, /values='1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0'/);
  assert.match(svg, /type='saturate' values='1'/);
  assert.match(svg, /feFuncR type='table' tableValues='0 0.063 0.125/);
  const full = decodeURIComponent(gradeFilter('x', grade, 1));
  assert.match(full, /feFuncB type='table' tableValues='0.145 /);
});

test('a look goes first, in place of the last, and the adjustments stay', () => {
  const a = gradeFilter('a', grade), b = gradeFilter('b', { sat: 0 });
  const on = withGrade('contrast(1.2) drop-shadow(0 4px 8px black)', a);
  assert.equal(on, `${a} contrast(1.2) drop-shadow(0 4px 8px black)`);
  assert.equal(withGrade(on!, b), `${b} contrast(1.2) drop-shadow(0 4px 8px black)`);
  assert.equal(withGrade(on!, null), 'contrast(1.2) drop-shadow(0 4px 8px black)');
  assert.equal(withGrade(a, null), null);
});
