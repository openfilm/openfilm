import { test as it } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshName, propOf, propValue, propsAttr, propsOf, renamedProp, withProp, withPropValue, withPropsReset, withoutProp,
  type ComponentProp,
} from './component-props.ts';

const title: ComponentProp = { name: 'Title', type: 'text', at: '#title' };
const photo: ComponentProp = { name: 'Photo', type: 'image', at: '.picture > img', kind: 'img' };
const logo: ComponentProp = { name: 'Show logo', type: 'boolean', at: '#logo' };
const accent: ComponentProp = { name: 'Accent', type: 'var', var: '--accent' };
const bloom: ComponentProp = { name: 'Bloom', type: 'var', var: '--post-bloom', advanced: true };

it('a clip\'s properties are read from its data-props, anything not one left out', () => {
  const attrs = { 'data-props': JSON.stringify([title, photo, { name: 'Bad', type: 'image', at: '#x' }, { name: 'Title', type: 'text', at: '#again' }, logo, accent, bloom, 'no']) };
  assert.deepEqual(propsOf({ attrs }), [title, photo, logo, accent, bloom]);
  assert.deepEqual(propsOf({ attrs: { 'data-props': '{oops' } }), []);
  assert.deepEqual(propsOf({}), []);
  assert.equal(propsAttr([]), null, 'none left: the attribute goes');
  assert.deepEqual(JSON.parse(propsAttr([title])!), [title]);
});

it('a property is made of one thing once: made again it is replaced, its name kept unique; renamed and removed by name', () => {
  let list = withProp([], title);
  list = withProp(list, { name: 'Title', type: 'text', at: '#subtitle' });
  assert.deepEqual(list.map((p) => p.name), ['Title', 'Title 2']);
  list = withProp(list, { name: 'Headline', type: 'text', at: '#title' });
  assert.deepEqual(list.map((p) => p.name), ['Title 2', 'Headline'], 'the same layer\'s words: one property');
  assert.equal(propOf(list, 'text', { at: '#title' })?.name, 'Headline');
  assert.equal(propOf(list, 'boolean', { at: '#title' }), null, 'its showing is another property');
  assert.deepEqual(renamedProp(list, 'Headline', 'Title 2').map((p) => p.name), ['Title 2', 'Headline'], 'a name taken: as it was');
  assert.deepEqual(renamedProp(list, 'Headline', '  Name ').map((p) => p.name), ['Title 2', 'Name']);
  assert.deepEqual(withoutProp(list, 'Title 2').map((p) => p.name), ['Headline']);
  assert.equal(freshName([title], ''), 'Property');
});

it('each property is filled in as an override, and back at its default leaves none', () => {
  let o = withPropValue(undefined, title, 'Hello') ?? undefined;
  o = withPropValue(o, photo, '../assets/new.png') ?? undefined;
  o = withPropValue(o, logo, false) ?? undefined;
  o = withPropValue(o, accent, '#00ff00') ?? undefined;
  assert.deepEqual(o, [
    { at: '#title', text: 'Hello' },
    { at: '.picture > img', style: { content: 'url("../assets/new.png")' } },
    { at: '#logo', style: { visibility: 'hidden' } },
    { at: ':root', style: { '--accent': '#00ff00' } },
  ]);
  assert.equal(propValue(o, title), 'Hello');
  assert.equal(propValue(o, photo), '../assets/new.png');
  assert.equal(propValue(o, logo), false);
  assert.equal(propValue(o, accent), '#00ff00');
  assert.equal(propValue(withPropValue(o, logo, true) ?? undefined, logo), null, 'shown again: its default');
  /* a move made on the picture is not a property: Reset all leaves it */
  const moved = [...o!, { at: '#other', t: [10, 0] as [number, number] }];
  assert.deepEqual(withPropsReset(moved, [title, photo, logo, accent]), [{ at: '#other', t: [10, 0] }]);
  assert.equal(withPropsReset(o, [title, photo, logo, accent]), null);
});
