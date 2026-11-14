import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_CAMERA, cameraWords, picksAnything } from './canvas-camera.ts';

test('a camera pick says the camera, the lens, the focal length and the aperture, in that order; auto says nothing', () => {
  assert.equal(cameraWords(NO_CAMERA), '');
  assert.equal(picksAnything(NO_CAMERA), false);
  const pick = { body: 'y2k', lens: 'fisheye', focal: 'auto', aperture: '11' };
  assert.equal(picksAnything(pick), true);
  assert.equal(cameraWords(pick), 'shot on an early-2000s compact digital camera, direct on-camera flash, slightly oversaturated colors, a fisheye lens, strong barrel distortion, circular vignette, f/11, deep depth of field, everything sharp');
  assert.equal(cameraWords({ ...NO_CAMERA, focal: '85' }), '85mm focal length');
});
