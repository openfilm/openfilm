import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT_DEFAULTS, currentOf, textVars, textWords, withLook, withMotion, withVars, withWords } from './text-look.ts';

const clip = [{ fade: [0.2, 0] }, { at: ':root', style: { '--clip-length': '3s', '--color': 'red', '--stroke': '0.1em', '--size': '9vw', '--in': 'pop' } }, { at: '.t', text: 'Hi' }];

test('a text clip reads its own variables over the page\'s, and its words', () => {
  const vars = textVars(clip);
  assert.equal(vars['--color'], 'red');
  assert.equal(vars['--weight'], TEXT_DEFAULTS['--weight']);
  assert.equal(textWords(clip), 'Hi');
  assert.equal(textWords([]), null);
});

test('a look takes the last look off (not the size, the motions or the length) and puts its own on', () => {
  const next = withLook(clip, { '--color': 'transparent', '--fill': 'linear-gradient(red, blue)' });
  assert.deepEqual(next[1], { at: ':root', style: { '--clip-length': '3s', '--size': '9vw', '--in': 'pop', '--color': 'transparent', '--fill': 'linear-gradient(red, blue)' } });
  assert.deepEqual(next[0], { fade: [0.2, 0] });
});

test('a motion replaces only its own slot', () => {
  const next = withMotion(clip, 'in', { '--in': 'fade', '--in-time': '0.6s' });
  assert.equal(next[1].style['--in'], 'fade');
  assert.equal(next[1].style['--color'], 'red');
  const none = withMotion(clip, 'out', { '--out': 'sink', '--out-time': '0.5s' });
  assert.equal(none[1].style['--out'], 'sink');
  assert.equal(none[1].style['--in'], 'pop');
});

test('variables set and taken away; an entry left empty goes; words set and cleared', () => {
  assert.deepEqual(withVars([{ at: ':root', style: { '--color': 'red' } }], {}, ['--color']), []);
  assert.deepEqual(withVars(undefined, { '--size': '5vw' }), [{ at: ':root', style: { '--size': '5vw' } }]);
  assert.equal(textWords(withWords(clip, 'Bye')), 'Bye');
  assert.equal(textWords(withWords(clip, '')), null);
  /* the line named by its path (typed in place on the picture): read as its words, and given up when they are set */
  const typed = [{ at: 'body > div.stage > div.box > span.t', text: 'Typed' }, { at: '.t', text: 'Default text' }];
  assert.equal(textWords(typed.slice(0, 1)), 'Typed');
  assert.deepEqual(withWords(typed, 'New'), [{ at: '.t', text: 'New' }]);
  assert.deepEqual(withWords([], 'New'), [{ at: '.t', text: 'New' }]);
});

test('the inspector lights the look or motion the clip has now', () => {
  const looks = [{ id: 'a', vars: { '--color': 'red', '--stroke': '0.1em' } }, { id: 'b', vars: { '--color': 'blue' } }];
  assert.equal(currentOf(textVars(clip), looks, ['--color', '--stroke'])?.id, 'a');
  assert.equal(currentOf(textVars(clip), looks.slice(1), ['--color', '--stroke']), null);
});
