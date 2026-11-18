import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY_LOUDNESS, deliveryGainDb, keptLoudness } from './delivery-loudness.ts';

test('a film is heard and delivered at -14 LUFS until the person picks another, "as mixed" included', () => {
  assert.equal(DELIVERY_LOUDNESS, -14);
  assert.equal(keptLoudness(undefined, false), -14);
  /* null kept before -14 was the default is not a choice; picked, it is */
  assert.equal(keptLoudness(null, false), -14);
  assert.equal(keptLoudness(null, true), null);
  assert.equal(keptLoudness(-23, false), -23);
  assert.equal(keptLoudness('-16', true), -14, 'only a number is a target');
});

test('the preview is turned by what the export would turn the mix by, within ±24 dB', () => {
  assert.equal(deliveryGainDb(-14, -22.5), 8.5);
  assert.equal(deliveryGainDb(-14, -9), -5);
  assert.equal(deliveryGainDb(-14, -70), 24);
  assert.equal(deliveryGainDb(null, -22), 0, 'as mixed');
  assert.equal(deliveryGainDb(-14, null), 0, 'silent, or not measured yet');
  assert.equal(deliveryGainDb(-14, undefined), 0);
});
