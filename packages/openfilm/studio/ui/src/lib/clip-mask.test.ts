import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASK_SHAPES, clampMask, fadeIn, maskDefault, maskLayersOf, maskOf, maskOwned, maskStackCss, maskStackOf, shapeLayers,
  withFade, withMask, type Mask,
} from './clip-mask.ts';
import { cropCss, fadeCss, withDeclarations, declared } from './clip-look.ts';

const BOX = { w: 1920, h: 1080 };

const css = (m: Mask, box = BOX) => maskStackCss([], shapeLayers(m, box));
const near = (a: Mask, b: Mask, tol = 0.06) => {
  assert.equal(a.shape, b.shape);
  assert.equal(a.invert, b.invert, 'invert');
  for (const k of ['x', 'y', 'w', 'h', 'rotate', 'feather', 'radius'] as const) {
    assert.ok(Math.abs(a[k] - b[k]) <= tol, `${a.shape} ${k}: ${a[k]} vs ${b[k]}`);
  }
};

test('each shape is written as plain CSS mask layers', () => {
  assert.deepEqual(css({ ...maskDefault('linear', BOX), rotate: 0, feather: 0 }), {
    'mask-image': 'linear-gradient(0deg, #000 50%, transparent 50%)', 'mask-composite': null,
  });
  assert.deepEqual(css({ ...maskDefault('mirror', BOX), rotate: 0, h: 20, feather: 0 }), {
    'mask-image': 'linear-gradient(0deg, transparent 40%, #000 40%, #000 60%, transparent 60%)', 'mask-composite': null,
  });
  assert.deepEqual(css({ ...maskDefault('ellipse', BOX), w: 40, h: 60, feather: 0 }), {
    'mask-image': 'radial-gradient(ellipse 20% 30% at 50% 50%, #000 100%, transparent 100%)', 'mask-composite': null,
  });
  const rect = css({ ...maskDefault('rect', BOX), w: 50, h: 50, feather: 0 });
  assert.equal(rect['mask-image'], 'linear-gradient(90deg, transparent 25%, #000 25%, #000 75%, transparent 75%), linear-gradient(180deg, transparent 25%, #000 25%, #000 75%, transparent 75%)');
  assert.equal(rect['mask-composite'], 'intersect');
  const star = css(maskDefault('star', BOX))['mask-image']!;
  assert.match(star, /^url\("data:image\/svg\+xml,%3Csvg xmlns='http:\/\/www.w3.org\/2000\/svg' viewBox='0 0 177.78 100' preserveAspectRatio='none'%3E%3Cpath transform='translate\(88.89 50\) rotate\(0\) scale\(/);
  assert.ok(!/[<>#"]/.test(star.slice(5, -2)), 'what a URL cannot hold is escaped');
});

test('a radius makes a rect an SVG rect; its feather a blur', () => {
  const v = css({ ...maskDefault('rect', BOX), radius: 8, feather: 6 })['mask-image']!;
  const svg = decodeURIComponent(v.slice('url("data:image/svg+xml,'.length, -2));
  assert.match(svg, /<filter id='f' x='-1' y='-1' width='3' height='3'><feGaussianBlur stdDeviation='2'\/><\/filter><rect transform='translate\(88.89 50\) rotate\(0\)' x='-25.004' y='-25' width='50.009' height='50' rx='8' filter='url\(#f\)'\/>/);
});

test('invert: gradients swap their stops; a rect or an SVG is excluded from a whole layer', () => {
  assert.equal(css({ ...maskDefault('linear', BOX), rotate: 0, feather: 0, invert: true })['mask-image'], 'linear-gradient(0deg, transparent 50%, #000 50%)');
  assert.match(css({ ...maskDefault('ellipse', BOX), invert: true })['mask-image']!, /^radial-gradient\(ellipse [^,]+, transparent [\d.]+%, #000 [\d.]+%\)$/);
  const star = css({ ...maskDefault('star', BOX), invert: true });
  assert.match(star['mask-image']!, /^linear-gradient\(#000, #000\), url\(/);
  assert.equal(star['mask-composite'], 'exclude, intersect');
  const rect = css({ ...maskDefault('rect', BOX), invert: true });
  assert.equal(maskLayersOf(rect['mask-image']!).length, 3);
  assert.equal(rect['mask-composite'], 'exclude, intersect, intersect');
});

test('every shape reads back as it was written, in any box', () => {
  for (const box of [BOX, { w: 1080, h: 1920 }, { w: 500, h: 500 }]) {
    for (const shape of MASK_SHAPES) {
      for (const invert of [false, true]) {
        const m = clampMask({
          shape, x: 37, y: 61, w: 33, h: 21, rotate: -32.5, feather: shape === 'rect' ? 4 : 9, radius: 0, invert,
        }, box);
        const written = css(m, box);
        const back = maskOf(written['mask-image']!, written['mask-composite'] ?? undefined, box);
        assert.ok(back, `${shape} reads`);
        /* a line keeps its line, not the point on it: the point read is where it crosses the box's middle's normal */
        if (shape === 'linear' || shape === 'mirror') {
          const again = css(back, box);
          assert.deepEqual(again, written, `${shape} writes the same again`);
          near({ ...back, x: m.x, y: m.y }, m);
        } else {
          near(back, m);
        }
      }
    }
  }
  const round = clampMask({ ...maskDefault('rect', BOX), radius: 6, feather: 3, rotate: 12, invert: true }, BOX);
  const w = css(round);
  near(maskOf(w['mask-image']!, w['mask-composite']!, BOX)!, round);
});

test('the line read is the one written: a point on it, the same angle and feather', () => {
  const m = { ...maskDefault('linear', BOX), x: 30, y: 50, rotate: 0, feather: 10 };
  const back = maskOf(css(m)['mask-image']!, undefined, BOX)!;
  /* unturned the line is level: across it does not matter, down it does */
  assert.equal(back.y, 50);
  assert.equal(back.x, 50);
  assert.equal(back.feather, 10);
});

test('what browsers report back (rgb(), no 180deg) still reads', () => {
  assert.deepEqual(maskOf('linear-gradient(rgb(0, 0, 0) 40%, rgba(0, 0, 0, 0) 60%)', undefined, { w: 100, h: 100 }), {
    shape: 'linear', x: 50, y: 50, w: 0, h: 0, rotate: 180, feather: 20, radius: 0, invert: false,
  });
  const radial = maskOf('radial-gradient(20% 30% at 40% 60%, rgb(0, 0, 0) 90%, rgba(0, 0, 0, 0) 110%)', undefined, { w: 100, h: 100 })!;
  assert.equal(radial.shape, 'ellipse');
  assert.deepEqual([radial.x, radial.y, radial.w, radial.h], [40, 60, 40, 60]);
});

test('anything else is a custom mask, left alone', () => {
  for (const v of ['url(mask.png)', 'radial-gradient(circle, #000, transparent)', 'conic-gradient(#000, transparent)', 'linear-gradient(90deg, red 10%, blue 20%)']) {
    assert.equal(maskOf(v, undefined, BOX), null, v);
    assert.equal(withMask(v, undefined, maskDefault('ellipse', BOX), BOX), null, 'not rewritten');
    assert.ok(!maskOwned('mask-image', v, () => undefined), 'the raw CSS shows it');
  }
  assert.equal(maskOf(undefined, undefined), undefined);
  assert.equal(maskOf('none', undefined), undefined);
  /* an inverted ellipse swaps its stops: a whole layer excluded above one is not something this writes */
  const ellipse = css(maskDefault('ellipse', BOX))['mask-image']!;
  assert.equal(maskOf(`linear-gradient(#000, #000), ${ellipse}`, 'exclude', BOX), null);
});

test('faded edges and a mask share mask-image: fade first, every layer intersected', () => {
  const fade = fadeCss({ sides: { top: false, right: false, bottom: false, left: true }, size: 15 });
  const shape = maskDefault('ellipse', BOX);
  const both = withMask(fade['mask-image']!, fade['mask-composite'] ?? undefined, shape, BOX)!;
  assert.equal(both['mask-image'], `linear-gradient(to right, transparent, #000 15%), ${css(shape)['mask-image']}`);
  assert.equal(both['mask-composite'], 'intersect');
  const read = maskStackOf(both['mask-image']!, both['mask-composite']!, BOX);
  assert.deepEqual(read.fade, { sides: { top: false, right: false, bottom: false, left: true }, size: 15 });
  near(read.shape!, shape);
  assert.ok(maskOwned('mask-image', both['mask-image']!, () => both['mask-composite']!));
  assert.ok(maskOwned('mask-composite', both['mask-composite']!, () => both['mask-image']!));

  /* the fade changed, the shape kept as written; and the other way round */
  const fade2 = withFade(both['mask-image']!, both['mask-composite']!, { sides: { top: true, right: false, bottom: true, left: true }, size: 10 })!;
  assert.deepEqual(fadeIn(fade2['mask-image']!, fade2['mask-composite']!), { sides: { top: true, right: false, bottom: true, left: true }, size: 10 });
  assert.ok(fade2['mask-image']!.endsWith(css(shape)['mask-image']!));
  assert.equal(fade2['mask-composite'], 'intersect');
  const noFade = withFade(fade2['mask-image']!, fade2['mask-composite']!, null)!;
  assert.deepEqual(noFade, css(shape));
  const noShape = withMask(fade2['mask-image']!, fade2['mask-composite']!, null, BOX)!;
  assert.deepEqual(noShape, fadeCss({ sides: { top: true, right: false, bottom: true, left: true }, size: 10 }));
});

test('an inverted shape under faded edges: its exclude in the list, the fade still intersecting', () => {
  const fade = fadeCss({ sides: { top: true, right: true, bottom: false, left: false }, size: 20 });
  const star = { ...maskDefault('star', BOX), invert: true };
  const both = withMask(fade['mask-image']!, fade['mask-composite']!, star, BOX)!;
  assert.equal(maskLayersOf(both['mask-image']!).length, 4);
  assert.equal(both['mask-composite'], 'intersect, intersect, exclude, intersect');
  const read = maskStackOf(both['mask-image']!, both['mask-composite']!, BOX);
  assert.deepEqual(read.fade, { sides: { top: true, right: true, bottom: false, left: false }, size: 20 });
  near(read.shape!, star);
  /* the fade alone, as clip-look reads it, is still what fadeCss wrote */
  assert.deepEqual(withFade(both['mask-image']!, both['mask-composite']!, null), css(star));
});

test('a mask and a crop live side by side: mask-image and clip-path', () => {
  const style = withDeclarations('object-fit: cover', { 'clip-path': cropCss([0, 10, 0, 10], 0) });
  const m = maskDefault('heart', BOX);
  const set = withMask(declared(style, 'mask-image'), declared(style, 'mask-composite'), m, BOX)!;
  const next = withDeclarations(style, set);
  assert.equal(declared(next, 'clip-path'), 'inset(0% 10% 0% 10%)');
  near(maskOf(declared(next, 'mask-image'), declared(next, 'mask-composite'), BOX)!, m);
  assert.equal(declared(next, 'mask-composite'), undefined, 'one layer needs none');
});

test('a new shape keeps the last one\'s place, and only what it has', () => {
  const rect = { ...maskDefault('rect', BOX), x: 30, y: 40, w: 20, h: 25, rotate: 15, radius: 4 };
  const star = maskDefault('star', BOX, rect);
  assert.deepEqual([star.x, star.y, star.w, star.h, star.rotate, star.feather, star.radius], [30, 40, 20, 25, 15, 0, 0]);
  const ellipse = maskDefault('ellipse', BOX, rect);
  assert.equal(ellipse.rotate, 0, 'an ellipse is not turned');
  const line = maskDefault('linear', BOX, rect);
  assert.deepEqual([line.w, line.h], [0, 0]);
  const square = maskDefault('ellipse', BOX);
  assert.ok(Math.abs((square.w / 100) * 1920 - (square.h / 100) * 1080) < 1, 'as wide as high on the picture');
});
