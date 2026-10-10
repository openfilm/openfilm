import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  familiesIn, fontFamiliesUsed, parseFontFaces, projectFamilies, projectFonts, resolveIn, stylesheetsOf, weightRange,
} from './project-fonts.mjs';

test('@font-face rules: family, weight range, style, sources resolved from the file', () => {
  const css = `/* @font-face { font-family: Commented } */
    @font-face { font-family: 'Geist'; src: url(../fonts/Geist.ttf); font-weight: 100 900; font-display: block; }
    @font-face {
      font-family: "Inter Display";
      src: local("Inter Display"), url("lib/inter.woff2?v=2") format("woff2"), url(https://cdn.test/inter.woff) format('woff'),
        url(data:font/woff2;base64,AAAA);
      font-style: italic;
      font-weight: bold;
    }
    @font-face { src: url(x.ttf) }`;
  const faces = parseFontFaces(css, 'lib/shared.css');
  assert.deepEqual(faces, [
    { family: 'Geist', weight: [100, 900], style: 'normal', src: [{ path: 'fonts/Geist.ttf' }], file: 'lib/shared.css' },
    {
      family: 'Inter Display', weight: [700, 700], style: 'italic', file: 'lib/shared.css',
      src: [{ local: 'Inter Display' }, { path: 'lib/lib/inter.woff2', format: 'woff2' }, { url: 'https://cdn.test/inter.woff', format: 'woff' }],
    },
  ]);
});

test('weights and addresses', () => {
  assert.deepEqual(weightRange('100 900'), [100, 900]);
  assert.deepEqual(weightRange('normal'), [400, 400]);
  assert.deepEqual(weightRange(undefined), [400, 400]);
  assert.deepEqual(weightRange('900 300'), [300, 900]);
  assert.equal(resolveIn('a/b.css', '../../x.ttf'), null, 'out of the folder');
  assert.equal(resolveIn('a/b.css', '/x.ttf'), null);
  assert.equal(resolveIn('a/b.css', 'f%20a.ttf'), 'a/f a.ttf');
  assert.equal(resolveIn('', 'a/./b.html'), 'a/b.html');
});

test('the families CSS names: font-family and the font shorthand, no generics or worked-out names', () => {
  assert.deepEqual(familiesIn(`'Geist', "Noto Sans SC", system-ui, sans-serif !important`), ['Geist', 'Noto Sans SC']);
  assert.deepEqual(familiesIn('var(--font), serif'), []);
  const css = `body { font-family: Inter, 'Noto Sans SC', sans-serif }
    .t { font: 400 17px/1.6 'JetBrains Mono', monospace; }
    .u { font: italic bold 2em Georgia }
    @font-face { font-family: Hidden; src: url(h.ttf) }
    el.style.cssText = "font-family:'\${f}'";`;
  assert.deepEqual(fontFamiliesUsed(css), ['Inter', 'Noto Sans SC', 'JetBrains Mono', 'Georgia']);
});

test('the stylesheets a page loads', () => {
  const html = `<link rel="stylesheet" href="lib/shared.css"><link rel=icon href=x.png><link href='b.css' rel='stylesheet preload'>
    <style>@import url("c.css"); @import 'd.css';</style>`;
  assert.deepEqual(stylesheetsOf(html), ['lib/shared.css', 'b.css', 'c.css', 'd.css']);
});

test('families from faces: weights in a range, italics, a family whose files are gone', () => {
  const face = (family, weight, style = 'normal', path = 'f.ttf') => ({ family, weight, style, src: [{ path }], file: 'a.css' });
  const fonts = projectFamilies([face('Mono', [500, 500]), face('Mono', [700, 700], 'italic'), face('Flex', [300, 650]), face('Gone', [400, 400], 'normal', 'gone.ttf')], (p) => p !== 'gone.ttf');
  assert.deepEqual(fonts.map((f) => [f.family, f.weights, f.italics ?? null, f.variable ?? null, f.missing ?? false]), [
    ['Flex', [300, 400, 500, 600, 650], null, [300, 650], false],
    ['Gone', [400], null, null, true],
    ['Mono', [500], [700], null, false],
  ]);
});

test('a project\'s fonts are read again only for files that changed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-fonts-'));
  mkdirSync(join(root, '.film'));
  mkdirSync(join(root, 'node_modules'));
  writeFileSync(join(root, '.film', 'x.css'), '@font-face { font-family: Tool; src: url(t.ttf) }');
  writeFileSync(join(root, 'node_modules', 'x.css'), '@font-face { font-family: Dep; src: url(t.ttf) }');
  writeFileSync(join(root, 'page.html'), '<style>@font-face { font-family: One; src: url(one.ttf) }</style>');
  assert.deepEqual((await projectFonts(root)).fonts.map((f) => f.family), ['One'], 'hidden folders and node_modules are not the project\'s');
  writeFileSync(join(root, 'page.html'), '<style>@font-face { font-family: Two; src: url(two.ttf) }</style>');
  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, 'page.html'), later, later);
  assert.deepEqual((await projectFonts(root)).fonts.map((f) => f.family), ['Two']);
});
