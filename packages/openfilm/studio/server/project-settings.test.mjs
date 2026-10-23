import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { frameRateOf, parseProjectSettings, patchProjectSettings, PROJECT_SETTINGS_FILE, readProjectSettings, readAudioSmoothingMs } from './project-settings.mjs';

const folder = () => mkdtempSync(join(tmpdir(), 'of-settings-'));

test('audio smoothing is opt-in, persisted per project, restricted to presets and removable', async () => {
  const root = folder();
  assert.equal((await readProjectSettings(root)).audioSmoothingMs, undefined);
  assert.equal((await patchProjectSettings(root, { audioSmoothingMs: 10 })).audioSmoothingMs, 10);
  assert.equal((await readProjectSettings(root)).audioSmoothingMs, 10);
  await patchProjectSettings(root, { fps: 24 });
  assert.equal((await readProjectSettings(root)).audioSmoothingMs, 10);
  for (const bad of [true, '10', 0, 9, -1, {}, NaN]) await assert.rejects(patchProjectSettings(root, { audioSmoothingMs: bad }), /audioSmoothingMs/);
  await patchProjectSettings(root, { audioSmoothingMs: null });
  assert.equal((await readProjectSettings(root)).audioSmoothingMs, undefined);
});

test('enforcement refuses unreadable or invalid audio policy instead of silently disabling it', async () => {
  const root = folder();
  assert.equal(await readAudioSmoothingMs(root), 0);
  mkdirSync(join(root, '.film'));
  writeFileSync(join(root, PROJECT_SETTINGS_FILE), '{broken');
  await assert.rejects(readAudioSmoothingMs(root), /Cannot read/);
  writeFileSync(join(root, PROJECT_SETTINGS_FILE), '{"audioSmoothingMs":9}');
  await assert.rejects(readAudioSmoothingMs(root), /Invalid audioSmoothingMs/);
});

test('a probed rate is named as editors name it; other rates are not project rates', () => {
  assert.equal(frameRateOf(29.97002997), 29.97);
  assert.equal(frameRateOf(23.976023976), 23.976);
  assert.equal(frameRateOf(25), 25);
  assert.equal(frameRateOf(12), null);
  assert.equal(frameRateOf('30'), null);
});

test('settings are read field by field: what is not one is left out', () => {
  assert.deepEqual(parseProjectSettings({ fps: 24, trackNames: [{ name: ' Dialogue ', index: 2, clips: ['a', 3] }, { name: '', index: 0 }], other: 1 }),
    { fps: 24, trackNames: [{ name: 'Dialogue', index: 2, clips: ['a'] }] });
  assert.deepEqual(parseProjectSettings({ fps: 31 }), {});
  assert.deepEqual(parseProjectSettings(null), {});
});

test('a project keeps its settings in .film/settings.json; null takes one away', async () => {
  const root = folder();
  try {
    assert.deepEqual(await readProjectSettings(root), {}, 'none yet');
    assert.deepEqual(await patchProjectSettings(root, { fps: 29.97 }), { fps: 29.97 });
    assert.deepEqual(await patchProjectSettings(root, { trackNames: [{ name: 'Music', index: 3, clips: [] }] }), { fps: 29.97, trackNames: [{ name: 'Music', index: 3, clips: [] }] });
    assert.deepEqual(JSON.parse(readFileSync(join(root, PROJECT_SETTINGS_FILE), 'utf8')).fps, 29.97);
    assert.deepEqual(await patchProjectSettings(root, { fps: null }), { trackNames: [{ name: 'Music', index: 3, clips: [] }] });
    await assert.rejects(patchProjectSettings(root, { fps: 12 }), /fps: one of/);
    /* a file written wrong reads as no settings */
    mkdirSync(join(root, '.film'), { recursive: true });
    writeFileSync(join(root, PROJECT_SETTINGS_FILE), '{ not json');
    assert.deepEqual(await readProjectSettings(root), {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('track heights are kept with the clips their tracks had, within the heights a track can be', async () => {
  assert.deepEqual(parseProjectSettings({ trackHeights: [{ height: 400, index: 1, clips: ['a'] }, { height: 'big', index: 0 }, { height: 36, index: 2 }] }),
    { trackHeights: [{ height: 160, index: 1, clips: ['a'] }, { height: 36, index: 2, clips: [] }] });
  const root = folder();
  try {
    assert.deepEqual(await patchProjectSettings(root, { trackHeights: [{ height: 90, index: 0, clips: ['shot'] }] }), { trackHeights: [{ height: 90, index: 0, clips: ['shot'] }] });
    assert.deepEqual(await patchProjectSettings(root, { fps: 25 }), { fps: 25, trackHeights: [{ height: 90, index: 0, clips: ['shot'] }] });
    assert.deepEqual(await patchProjectSettings(root, { trackHeights: null }), { fps: 25 });
    await assert.rejects(patchProjectSettings(root, { trackHeights: 'tall' }), /trackHeights: a list/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
