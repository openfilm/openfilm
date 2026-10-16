import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import type { FilmOverride } from './film.ts';
import { changedImage, changedText, changedVar, cssUrl, fieldOf, isFontVar, labelOf, relativeTo, urlOf, valueOf, withImage, withText, withVar } from './template-controls.ts';

it('a custom property is changed as a color, a number with its unit, words, or as typed', () => {
  assert.deepEqual(fieldOf('#ff5746'), { kind: 'color', value: '#ff5746' });
  assert.deepEqual(fieldOf(' rgb(10 20 30 / 50%) '), { kind: 'color', value: 'rgb(10 20 30 / 50%)' });
  assert.deepEqual(fieldOf('oklch(70% 0.1 30)'), { kind: 'color', value: 'oklch(70% 0.1 30)' });
  assert.deepEqual(fieldOf('red'), { kind: 'raw', value: 'red' }, 'a named color takes a browser to know');
  assert.deepEqual(fieldOf('red', (v) => v === 'red'), { kind: 'color', value: 'red' });
  assert.deepEqual(fieldOf('96px'), { kind: 'number', value: 96, unit: 'px' });
  assert.deepEqual(fieldOf('.5'), { kind: 'number', value: 0.5, unit: '' });
  assert.deepEqual(fieldOf('-12.5deg'), { kind: 'number', value: -12.5, unit: 'deg' });
  assert.deepEqual(fieldOf('1.2S'), { kind: 'number', value: 1.2, unit: 's' });
  assert.deepEqual(fieldOf('"Aura Pods"'), { kind: 'text', value: 'Aura Pods' });
  assert.deepEqual(fieldOf(`'It\\'s here'`), { kind: 'text', value: "It's here" });
  assert.deepEqual(fieldOf('calc(10px + 2vw)'), { kind: 'raw', value: 'calc(10px + 2vw)' });
  assert.deepEqual(fieldOf('Helvetica, sans-serif'), { kind: 'raw', value: 'Helvetica, sans-serif' });
});

it('a field writes back what CSS reads', () => {
  assert.equal(valueOf({ kind: 'number', value: 1.23456, unit: 's' }), '1.235s');
  assert.equal(valueOf({ kind: 'text', value: 'Say "hi"' }), '"Say \\"hi\\""');
  assert.equal(valueOf({ kind: 'text', value: 'two\nlines' }), '"two\\A lines"');
  assert.equal(valueOf({ kind: 'color', value: '#00ff00' }), '#00ff00');
  for (const raw of ['"Aura Pods"', '96px', '#ff5746', 'calc(1px + 2px)']) assert.equal(valueOf(fieldOf(raw)), raw, raw);
});

it('a custom property is named as a person reads it', () => {
  assert.equal(labelOf('--accent-color'), 'Accent color');
  assert.equal(labelOf('--titleSize'), 'Title size');
  assert.equal(labelOf('--bg_2'), 'Bg 2');
  assert.equal(labelOf('--'), '--');
});

it('a custom property is kept in the :root entry, beside what else the person changed', () => {
  const title: FilmOverride = { at: '#title', text: 'Hello' };
  const fade = { fade: [0.5, 0] } as unknown as FilmOverride;
  let all = withVar([fade, title], '--accent', '#00ff00');
  assert.deepEqual(all, [fade, title, { at: ':root', style: { '--accent': '#00ff00' } }]);
  all = withVar(all ?? undefined, '--size', '120px');
  assert.equal(changedVar(all ?? undefined, '--accent'), '#00ff00');
  assert.equal(changedVar(all ?? undefined, '--size'), '120px');
  assert.equal(changedVar(all ?? undefined, '--other'), null);
  all = withVar(all ?? undefined, '--accent', null);
  assert.deepEqual(all?.at(-1), { at: ':root', style: { '--size': '120px' } });
  /* the last one back to the page's: no :root entry left */
  assert.deepEqual(withVar(all ?? undefined, '--size', null), [fade, title]);
  assert.equal(withVar(undefined, '--size', null), null, 'nothing to take back');
});

it('a layer\'s words are its text override, by its selector and which match', () => {
  let all = withText(undefined, 'p.line', 2, 'Second');
  assert.deepEqual(all, [{ at: 'p.line', n: 2, text: 'Second' }]);
  assert.equal(changedText(all ?? undefined, 'p.line', 2), 'Second');
  assert.equal(changedText(all ?? undefined, 'p.line'), null, 'every match is another layer');
  all = withText(all ?? undefined, 'p.line', 2, null);
  assert.equal(all, null);
});

it('a picture put in a page is named from the page\'s folder, as CSS writes a url', () => {
  assert.equal(relativeTo('pages/lower.html', 'assets/logo.png'), '../assets/logo.png');
  assert.equal(relativeTo('lower.html', 'assets/logo.png'), 'assets/logo.png');
  assert.equal(relativeTo('saved/x/pages/a.html', 'saved/x/pages/img/b.png'), 'img/b.png');
  assert.equal(relativeTo('a/b/c.html', 'a/d.png'), '../d.png');
  assert.equal(cssUrl('../my "logo".png'), 'url("../my \\"logo\\".png")');
  for (const path of ['../assets/logo.png', 'a b.png', 'my "logo".png']) assert.equal(urlOf(cssUrl(path)), path);
  assert.equal(urlOf("url('x.png')"), 'x.png');
  assert.equal(urlOf('url(x.png)'), 'x.png');
  assert.equal(urlOf('none'), null);
});

it('a picture is replaced with the CSS that draws another file in its place: content for an <img>, a background for a box', () => {
  const logo = { at: 'img.logo', kind: 'img' as const };
  const card = { at: '.card', n: 2, kind: 'bg' as const };
  let all = withImage(undefined, logo, '../assets/new.png');
  all = withImage(all ?? undefined, card, 'bg.jpg');
  assert.deepEqual(all, [
    { at: 'img.logo', style: { content: 'url("../assets/new.png")' } },
    { at: '.card', n: 2, style: { backgroundImage: 'url("bg.jpg")' } },
  ]);
  assert.equal(changedImage(all ?? undefined, logo), '../assets/new.png');
  assert.equal(changedImage(all ?? undefined, { at: '.card', kind: 'bg' }), null, 'another match is another layer');
  assert.deepEqual(withImage(all ?? undefined, logo, null), [{ at: '.card', n: 2, style: { backgroundImage: 'url("bg.jpg")' } }]);
});

it('a custom property that names a font gets the font picker', () => {
  assert.equal(isFontVar('--title-font', '"Inter", sans-serif'), true);
  assert.equal(isFontVar('--fontFamily', 'Geist'), true);
  assert.equal(isFontVar('--font-size', '48px'), false);
  assert.equal(isFontVar('--font-color', '#fff'), false);
  assert.equal(isFontVar('--accent', 'Inter'), false);
});
