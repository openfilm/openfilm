import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inspectorActiveTab, inspectorFieldVisible, inspectorTabForSection, inspectorTabs,
} from './inspector-sections.ts';

test('categories only contain controls offered by the selection, in a stable order', () => {
  assert.deepEqual(inspectorTabs(['sound', 'position', 'adjust', 'mask', 'effects', 'advanced']),
    ['properties', 'adjust', 'effects', 'sound', 'advanced']);
  assert.deepEqual(inspectorTabs(['timing', 'fades', 'sound']), ['properties', 'sound']);
  assert.deepEqual(inspectorTabs(['film-stage', 'film-rate', 'film-info']), ['properties', 'info']);
  assert.deepEqual(inspectorTabs(['film-stage', 'export-motion-blur', 'film-info']), ['properties', 'advanced', 'info']);
  assert.deepEqual(inspectorTabs(['properties', 'advanced-properties']), ['properties', 'advanced']);
  assert.deepEqual(inspectorTabs([]), []);
  /* a clip opens on its properties, its animation next; a line of words on its own three */
  assert.deepEqual(inspectorTabs(['motion', 'position', 'adjust', 'sound']), ['properties', 'motion', 'adjust', 'sound']);
  assert.deepEqual(inspectorTabs(['text', 'wordart', 'motion', 'position']), ['text', 'wordart', 'motion', 'properties']);
  assert.equal(inspectorTabForSection('properties'), 'properties', 'a component keeps its published controls first');
});

test('an unavailable remembered category falls back without hiding the next selection', () => {
  assert.equal(inspectorActiveTab('effects', ['properties', 'sound']), 'properties');
  assert.equal(inspectorActiveTab('sound', ['properties', 'sound']), 'sound');
  assert.equal(inspectorActiveTab('adjust', []), 'properties');
});

test('Tab navigation skips hidden categories and folded groups', () => {
  const field = (hidden: boolean) => ({ closest: () => hidden ? {} : null });
  assert.equal(inspectorFieldVisible(field(true)), false);
  assert.equal(inspectorFieldVisible(field(false)), true);
});
