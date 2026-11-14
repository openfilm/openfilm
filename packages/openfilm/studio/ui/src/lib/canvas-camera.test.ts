import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_CAMERA, cameraOf, cameraText, cameraWords, picksAnything } from './canvas-camera.ts';

test('a camera pick says the camera, the lens, the focal length and the aperture, in that order; auto says nothing', () => {
  assert.equal(cameraWords(NO_CAMERA), '');
  assert.equal(picksAnything(NO_CAMERA), false);
  const pick = { body: 'y2k', lens: 'fisheye', focal: 'auto', aperture: '11' };
  assert.equal(picksAnything(pick), true);
  assert.equal(cameraWords(pick), 'shot on an early-2000s compact digital camera, direct on-camera flash, slightly oversaturated colors, a fisheye lens, strong barrel distortion, circular vignette, f/11, deep depth of field, everything sharp');
  assert.equal(cameraWords({ ...NO_CAMERA, focal: '85' }), '85mm focal length');
});

test('a node keeps a pick as text and reads it back; a part missing or not on its list is auto', () => {
  const pick = { body: 'film35', lens: 'auto', focal: '18', aperture: '2_8' };
  assert.deepEqual(cameraOf(cameraText(pick)), pick);
  assert.deepEqual(cameraOf(undefined), NO_CAMERA);
  assert.deepEqual(cameraOf('|wide|999'), { body: 'auto', lens: 'wide', focal: 'auto', aperture: 'auto' });
});
