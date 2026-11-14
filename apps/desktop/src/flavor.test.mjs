import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FLAVORS, flavorName } from './flavor.mjs';

test('which app this is: packaged, the release unless built as the preview; from source, dev when asked', () => {
  assert.equal(flavorName({}, true, null), 'release');
  assert.equal(flavorName({}, true, 'preview'), 'preview');
  assert.equal(flavorName({ OPENFILM_DESKTOP_FLAVOR: 'dev' }, true, null), 'release', 'a packaged app is never dev');
  assert.equal(flavorName({ OPENFILM_DESKTOP_FLAVOR: 'dev' }, false), 'dev');
  assert.equal(flavorName({}, false), 'release');
});

test('the preview shares nothing with an installed OpenFilm or the dev app', () => {
  const { release, preview, dev } = FLAVORS;
  for (const other of [release, dev]) {
    assert.notEqual(preview.productName, other.productName);
    assert.notEqual(preview.bundleId, other.bundleId);
    assert.notEqual(preview.studioPort, other.studioPort);
    assert.notEqual(preview.studioHome, other.studioHome);
  }
  assert.ok(preview.studioHome, 'its own Studio home, not the machine\'s ~/.openfilm');
});

test('every app makes its projects in the person\'s one library', () => {
  for (const flavor of Object.values(FLAVORS)) {
    assert.equal(flavor.library, null);
    /* the folder the person chose for it is kept in the machine's Studio home */
    assert.equal(flavor.sharedHome ?? join(homedir(), '.openfilm'), join(homedir(), '.openfilm'));
  }
});

test('a lane of the dev app shares nothing but the library with the dev app or another lane', async () => {
  const { devIdentity } = await import('./flavor.mjs');
  assert.equal(devIdentity(undefined), FLAVORS.dev);
  assert.equal(devIdentity('Not A Name'), FLAVORS.dev);
  const sound = devIdentity('sound');
  const color = devIdentity('color');
  assert.deepEqual(devIdentity('sound'), sound, 'the same lane comes back the same');
  for (const other of [FLAVORS.release, FLAVORS.preview, FLAVORS.dev, color]) {
    assert.notEqual(sound.productName, other.productName);
    assert.notEqual(sound.bundleId, other.bundleId);
    assert.notEqual(sound.studioHome, other.studioHome);
    assert.ok(Math.abs(sound.studioPort - other.studioPort) >= 3, 'a Studio uses its port and the two after it');
  }
  assert.equal(sound.productName, 'OpenFilm Dev sound');
  assert.equal(sound.library, null);
  assert.equal(sound.sharedHome, join(homedir(), '.openfilm'));
});
