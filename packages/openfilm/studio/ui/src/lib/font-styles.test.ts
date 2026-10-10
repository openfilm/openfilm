import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cssFamily, joinFontFamily, nearestWeight, parseStyleValue, snapStyle, splitFontFamily, styleOptions, styleValue, weightKey, weightNumber,
} from './font-styles.ts';

test('weights by name: the nearest named one', () => {
  assert.equal(weightKey(275), 300, 'Avenir Next Ultra Light reads Light');
  assert.equal(weightKey(400), 400);
  assert.equal(weightKey(950), 900);
  assert.equal(weightNumber('bold'), 700);
  assert.equal(weightNumber('normal'), 400);
  assert.equal(weightNumber('650'), 650);
  assert.equal(weightNumber('bolder'), null);
});

test('the nearest weight a family has, as CSS font matching picks it', () => {
  const has = [300, 700];
  assert.equal(nearestWeight(has, 700), 700);
  assert.equal(nearestWeight(has, 400), 300, '400: up to 500, then down');
  assert.equal(nearestWeight([300, 500, 700], 400), 500);
  assert.equal(nearestWeight(has, 200), 300, 'lighter: down first, then up');
  assert.equal(nearestWeight(has, 600), 700, 'heavier: up first');
  assert.equal(nearestWeight([300, 400], 900), 400, 'nothing heavier: the heaviest');
  assert.equal(nearestWeight([400], 650, [100, 900]), 650, 'a variable range has it');
  assert.equal(nearestWeight([], 850, [100, 800]), 800, 'past the range: its end');
});

test('the weight menu: each weight, its italic after it', () => {
  assert.deepEqual(styleOptions({ weights: [400, 700], italics: [400] }).map(styleValue), ['400', '400 italic', '700']);
  assert.deepEqual(styleOptions({ weights: [400], variable: [300, 600] }).map(styleValue), ['300', '400', '500', '600']);
  assert.deepEqual(styleOptions({ weights: [400], italics: [400], variable: [400, 500] }).map(styleValue), ['400', '400 italic', '500', '500 italic']);
  assert.deepEqual(parseStyleValue('700 italic'), { weight: 700, italic: true });
  assert.equal(parseStyleValue('x'), null);
});

test('a new family keeps the weight and slant it has, else the nearest', () => {
  assert.deepEqual(snapStyle({ weights: [400, 700] }, { weight: 600, italic: true }), { weight: 700, italic: false }, 'no italic: upright');
  assert.deepEqual(snapStyle({ weights: [400, 700], italics: [400] }, { weight: 700, italic: true }), { weight: 400, italic: true });
  assert.deepEqual(snapStyle({ weights: [100, 900], variable: [100, 900] }, { weight: 450, italic: false }), { weight: 450, italic: false });
});

test('a font-family stack: the first family changes, the fallbacks stay', () => {
  assert.deepEqual(splitFontFamily(`'Geist', "Noto Sans SC", sans-serif`), ['Geist', `"Noto Sans SC", sans-serif`]);
  assert.equal(cssFamily('Geist'), 'Geist');
  assert.equal(cssFamily('Noto Sans SC'), '"Noto Sans SC"');
  assert.equal(cssFamily('3Dumb'), '"3Dumb"', 'a name CSS cannot write bare is quoted');
  assert.equal(joinFontFamily('Inter', `"Noto Sans SC", sans-serif`), `Inter, "Noto Sans SC", sans-serif`);
  assert.equal(joinFontFamily('Noto Sans SC', `"Noto Sans SC", var(--cjk), sans-serif`), `"Noto Sans SC", var(--cjk), sans-serif`, 'not twice');
  assert.equal(joinFontFamily('Inter', ''), 'Inter');
});
