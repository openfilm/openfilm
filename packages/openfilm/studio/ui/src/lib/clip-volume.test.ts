import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVolume, volumeAtLineY, volumeEdit, volumeLineY, volumeOf, volumeText } from './clip-volume.ts';

test('the volume line: the loudest at the top, silence at the bottom, as is a little above the middle', () => {
  assert.equal(volumeLineY(5, 30), 0);
  assert.equal(volumeLineY(0, 30), 30);
  assert.equal(Math.round(volumeLineY(1, 30) * 10) / 10, 12.5);
  /* louder or quieter than a clip goes: at the ends */
  assert.equal(volumeLineY(9, 30), 0);
  assert.equal(volumeLineY(-1, 30), 30);
  /* the taper: −20 dB still has a quarter of the height under it */
  assert.ok(volumeLineY(0.1, 30) < 22.5);
});

test('the line let go: on the inspector\'s 0.1 dB steps, as is near where it sits, within the volumes a clip has', () => {
  assert.equal(volumeAtLineY(0, 30), 5);
  assert.equal(volumeAtLineY(30, 30), 0);
  assert.equal(volumeAtLineY(-8, 30), 5);
  assert.equal(volumeAtLineY(40, 30), 0);
  /* within 2 px of as is: exactly as is */
  const asIs = volumeLineY(1, 30);
  assert.equal(volumeAtLineY(asIs + 1.9, 30), 1);
  assert.equal(volumeAtLineY(asIs - 1.9, 30), 1);
  assert.notEqual(volumeAtLineY(asIs + 3, 30), 1);
  /* back and forth: where the line is drawn reads back as its volume */
  for (const v of [0.1, 0.5, 2, 3.162]) assert.ok(Math.abs(volumeAtLineY(volumeLineY(v, 30), 30) - v) / v < 0.012, String(v));
  /* no height: nothing to read, as is */
  assert.equal(volumeAtLineY(5, 0), 1);
});

test('a volume as the line says it', () => {
  assert.equal(volumeText(1), '0.0 dB');
  assert.equal(volumeText(0.5), '−6.0 dB');
  assert.equal(volumeText(2), '+6.0 dB');
  assert.equal(volumeText(0), '−∞ dB');
});

test('the edit is the inspector\'s: `volume` in film.html, `gainDb` in a film made of code; none when unchanged', () => {
  const sound = { kind: 'music', loc: 'film.html#1.0' };
  assert.deepEqual(volumeEdit(sound, 0.5), { loc: 'film.html#1.0', prop: 'volume', value: 0.5 });
  assert.equal(volumeEdit(sound, 1), null);
  assert.equal(volumeEdit({ ...sound, volume: 0.5 }, 0.5), null);
  assert.deepEqual(volumeEdit({ ...sound, volume: 0.5 }, 1), { loc: 'film.html#1.0', prop: 'volume', value: 1 });
  const coded = { kind: 'voice', loc: 'voices.json#0', gainDb: -6 };
  assert.equal(Math.round(volumeOf(coded) * 100) / 100, 0.5);
  assert.deepEqual(volumeEdit(coded, 0.25), { loc: 'voices.json#0', prop: 'gainDb', value: -12.041 });
  assert.deepEqual(volumeEdit(coded, 1), { loc: 'voices.json#0', prop: 'gainDb', value: null });
  /* a page, or a video without its own sound, has no volume */
  assert.equal(hasVolume({ kind: 'mg' }), false);
  assert.equal(hasVolume({ kind: 'video' }), false);
  assert.equal(hasVolume({ kind: 'video', ownAudio: true }), true);
  assert.equal(volumeEdit({ kind: 'video', loc: 'film.html#0.0' }, 0.5), null);
  assert.equal(volumeEdit({ kind: 'music' }, 0.5), null);
});
