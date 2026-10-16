import { test } from 'node:test';
import assert from 'node:assert/strict';
import { override, restore } from './overrides.mjs';

/** An element as override() uses it: its inline style, set and read back by name. */
function element() {
  const props = new Map();
  return {
    childNodes: [], children: [],
    style: {
      setProperty: (name, value, priority = '') => props.set(name, [value, priority]),
      removeProperty: (name) => props.delete(name),
      getPropertyValue: (name) => props.get(name)?.[0] ?? '',
      getPropertyPriority: (name) => props.get(name)?.[1] ?? '',
    },
    props,
  };
}

test('a custom property is set as it is named, its value as it is; a camelCase one as CSS names it', () => {
  const root = element();
  const c = { win: { document: { querySelectorAll: (at) => (at === ':root' ? [root] : []) } }, touched: new Map(), found: [] };
  override(c, [{ at: ':root', style: { '--accentColor': '#ff5746', '--count': 3, fontSize: 48 } }]);
  assert.deepEqual(root.props.get('--accentColor'), ['#ff5746', 'important'], 'case kept: custom properties are case-sensitive');
  assert.deepEqual(root.props.get('--count'), ['3', 'important'], 'no unit added');
  assert.deepEqual(root.props.get('font-size'), ['48px', 'important']);
  restore(c);
  assert.equal(root.props.size, 0, 'taken away, nothing left behind');
});
