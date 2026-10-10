import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metricCss, metricOf, parseMetric, showMetric, stepMetric } from './type-metrics.ts';

test('line height: auto, %, px and multiples, written as CSS', () => {
  assert.equal(parseMetric('line-height', 'Auto'), 'auto');
  assert.equal(parseMetric('line-height', '自动', '自动'), 'auto', 'the word in the person\'s language');
  assert.deepEqual(parseMetric('line-height', '120%'), { n: 120, unit: '%' });
  assert.deepEqual(parseMetric('line-height', '24 px'), { n: 24, unit: 'px' });
  assert.deepEqual(parseMetric('line-height', '1,2'), { n: 1.2, unit: '' });
  assert.equal(parseMetric('line-height', 'tall'), null);
  assert.equal(parseMetric('line-height', '-10%'), null, 'no negative line height');
  assert.equal(metricCss('line-height', 'auto'), 'normal');
  assert.equal(metricCss('line-height', { n: 120, unit: '%' }), '120%');
  assert.equal(metricCss('line-height', { n: 1.2, unit: '' }), '1.2');
});

test('letter spacing: % of the size as em, a bare number as px', () => {
  assert.deepEqual(parseMetric('letter-spacing', '5%'), { n: 5, unit: '%' });
  assert.equal(metricCss('letter-spacing', { n: 5, unit: '%' }), '0.05em');
  assert.equal(metricCss('letter-spacing', { n: -2.5, unit: '%' }), '-0.025em');
  assert.deepEqual(parseMetric('letter-spacing', '2'), { n: 2, unit: 'px' });
  assert.deepEqual(parseMetric('letter-spacing', '-0.1em'), { n: -10, unit: '%' });
  assert.equal(metricCss('letter-spacing', 'auto'), 'normal');
});

test('the page\'s values, shown', () => {
  assert.equal(showMetric(metricOf('line-height', 1.25), 'Auto'), '1.25');
  assert.equal(showMetric(metricOf('line-height', '120%'), 'Auto'), '120%');
  assert.equal(showMetric(metricOf('line-height', 'normal'), 'Auto'), 'Auto');
  assert.equal(showMetric(metricOf('letter-spacing', '0.05em'), 'Auto'), '5%');
  assert.equal(showMetric(metricOf('letter-spacing', -1.5), 'Auto'), '-1.5px');
  assert.equal(metricOf('line-height', undefined), undefined);
});

test('stepping keeps the unit; from auto it starts at what auto is', () => {
  assert.deepEqual(stepMetric('line-height', { n: 1.2, unit: '' }, 2), { n: 1.3, unit: '' });
  assert.deepEqual(stepMetric('line-height', 'auto', 1), { n: 1.25, unit: '' });
  assert.deepEqual(stepMetric('line-height', { n: 120, unit: '%' }, -3), { n: 117, unit: '%' });
  assert.deepEqual(stepMetric('letter-spacing', undefined, -2), { n: -2, unit: 'px' });
  assert.deepEqual(stepMetric('line-height', { n: 0.1, unit: '' }, -10), { n: 0.05, unit: '' }, 'stays above 0');
});
