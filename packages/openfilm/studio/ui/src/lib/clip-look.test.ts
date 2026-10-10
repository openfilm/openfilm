import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjustOf, cropCss, cropForRatio, cropOf, cropRatio, declared, fadeCss, fadeOf, framingCss, framingOf, ownedDeclaration, shadowOf,
  strokeCss, strokeOf, withAdjust, withDeclarations, withShadow,
} from './clip-look.ts';

test('a clip\'s own CSS: each control writes its properties, the rest stays as it was', () => {
  const style = 'border-radius: 24px; filter: blur(2px)';
  assert.equal(withDeclarations(style, { 'border-radius': '8px', 'object-fit': 'cover' }), 'border-radius: 8px; filter: blur(2px); object-fit: cover');
  assert.equal(withDeclarations(style, { 'border-radius': null }), 'filter: blur(2px)');
  assert.equal(declared(style, 'filter'), 'blur(2px)');
});

test('a crop is an inset clip-path, its corners kept round', () => {
  assert.deepEqual(cropOf('inset(0% 0% 13% 0%)'), [0, 0, 13, 0]);
  assert.deepEqual(cropOf('inset(10% round 24px)'), [10, 10, 10, 10]);
  assert.deepEqual(cropOf(undefined), [0, 0, 0, 0]);
  assert.equal(cropOf('circle(40%)'), null, 'any other shape is the CSS field\'s, not the crop\'s');
  assert.equal(cropCss([0, 0, 13, 0], 24), 'inset(0% 0% 13% 0% round 24px)');
  assert.equal(cropCss([0, 0, 0, 0], 24), null);
});

test('a crop to a ratio, centered, and the ratio a crop leaves', () => {
  assert.deepEqual(cropForRatio(1920, 1080, 1), [0, 21.88, 0, 21.88]);
  assert.deepEqual(cropForRatio(1920, 1080, 9 / 16), [0, 34.18, 0, 34.18]);
  assert.deepEqual(cropForRatio(1080, 1920, 16 / 9), [34.18, 0, 34.18, 0]);
  assert.deepEqual(cropForRatio(1920, 1080, 16 / 9), [0, 0, 0, 0]);
  assert.ok(Math.abs(cropRatio([0, 21.875, 0, 21.875], 1920, 1080) - 1) < 1e-9);
});

test('framing is object-position in %, keywords read too', () => {
  assert.deepEqual(framingOf(undefined), [50, 50]);
  assert.deepEqual(framingOf('top'), [50, 0]);
  assert.deepEqual(framingOf('left'), [0, 50]);
  assert.deepEqual(framingOf('top left'), [0, 0]);
  assert.deepEqual(framingOf('30% 80%'), [30, 80]);
  assert.equal(framingOf('12px 4px'), null, 'other units are the raw CSS\'s');
  assert.equal(framingCss([50, 50]), null);
  assert.equal(framingCss([30, 80]), '30% 80%');
});

test('adjustments are filter functions, read back and kept in place', () => {
  assert.deepEqual(adjustOf('brightness(1.08) contrast(96%) hue-rotate(0.5turn) blur(2px) grayscale(1)'), {
    brightness: 8, contrast: -4, saturate: 0, hue: 180, blur: 2, grayscale: 100,
  });
  assert.equal(adjustOf('brightness(var(--b))').brightness, null, 'unreadable: not a number');
  assert.equal(withAdjust(undefined, 'saturate', 20), 'saturate(1.2)');
  assert.equal(withAdjust('sepia(1) brightness(1.1)', 'brightness', 30), 'sepia(1) brightness(1.3)', 'in place, the rest as written');
  assert.equal(withAdjust('brightness(1.1)', 'brightness', 0), null, 'neutral: the function goes, then the filter');
  assert.equal(withAdjust('drop-shadow(0 8px 24px #000)', 'blur', 4), 'blur(4px) drop-shadow(0 8px 24px #000)', 'before the shadow');
  assert.equal(withAdjust('hue-rotate(30deg)', 'hue', -45), 'hue-rotate(-45deg)');
});

test('a drop shadow is the filter\'s last function', () => {
  assert.deepEqual(shadowOf('brightness(1.1) drop-shadow(0 8px 24px rgba(0, 0, 0, 0.45))'), { x: 0, y: 8, blur: 24, color: 'rgba(0, 0, 0, 0.45)' });
  assert.deepEqual(shadowOf('drop-shadow(rgba(0, 0, 0, 0.5) 2px 4px 6px)'), { x: 2, y: 4, blur: 6, color: 'rgba(0, 0, 0, 0.5)' }, 'color first, as computed');
  assert.equal(shadowOf('blur(2px)'), undefined);
  assert.equal(withShadow('brightness(1.1)', { x: 0, y: 8, blur: 24, color: '#00000073' }), 'brightness(1.1) drop-shadow(0px 8px 24px #00000073)');
  assert.equal(withShadow('drop-shadow(0 8px 24px #000)', null), null);
});

test('a stroke is a border shorthand', () => {
  assert.deepEqual(strokeOf('2px dashed #ffffff'), { width: 2, style: 'dashed', color: '#ffffff' });
  assert.deepEqual(strokeOf('solid 4px rgb(255, 0, 0)'), { width: 4, style: 'solid', color: 'rgb(255, 0, 0)' });
  assert.equal(strokeOf('0px none rgb(0, 0, 0)'), undefined, 'as computed with none');
  assert.equal(strokeOf('2px double red'), null, 'another style: the raw CSS\'s');
  assert.equal(strokeCss({ width: 2, style: 'dotted', color: '#fff' }), '2px dotted #fff');
  assert.equal(strokeCss({ width: 0, style: 'solid', color: '#fff' }), null);
});

test('faded edges are mask-image gradients, one an axis, intersected', () => {
  const one = fadeCss({ sides: { top: false, right: false, bottom: false, left: true }, size: 15 });
  assert.deepEqual(one, { 'mask-image': 'linear-gradient(to right, transparent, #000 15%)', 'mask-composite': null });
  const both = fadeCss({ sides: { top: true, right: true, bottom: false, left: true }, size: 10 });
  assert.deepEqual(both, {
    'mask-image': 'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent), linear-gradient(to bottom, transparent, #000 10%)',
    'mask-composite': 'intersect',
  });
  assert.deepEqual(fadeOf(both['mask-image']!, 'intersect'), { sides: { top: true, right: true, bottom: false, left: true }, size: 10 });
  assert.deepEqual(fadeOf('linear-gradient(to top, transparent, #000 20%)'), { sides: { top: false, right: false, bottom: true, left: false }, size: 20 });
  assert.equal(fadeOf('radial-gradient(circle, #000, transparent)'), null);
  assert.equal(fadeOf(undefined), undefined);
  assert.deepEqual(fadeCss(null), { 'mask-image': null, 'mask-composite': null });
});

test('what the controls say is left out of the raw CSS', () => {
  const none = () => undefined;
  assert.ok(ownedDeclaration('filter', 'brightness(1.1) drop-shadow(0 8px 24px #000)', none));
  assert.ok(!ownedDeclaration('filter', 'sepia(1)', none), 'a function without a control');
  assert.ok(ownedDeclaration('clip-path', 'inset(10%)', none));
  assert.ok(!ownedDeclaration('clip-path', 'circle(40%)', none));
  assert.ok(!ownedDeclaration('box-shadow', '0 8px 24px #000', none));
  assert.ok(ownedDeclaration('mask-image', 'linear-gradient(to right, transparent, #000 15%)', none));
});
