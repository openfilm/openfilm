import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewPlan, adaptiveSide, analysisVariant } from './vision-preview.mjs';
import { videoEffects } from './vision-config.mjs';
import { serve, launch } from './host.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inputKey, previousInput, keepInput, clearInputCache } from './vision-input-cache.mjs';

test('inference reuse requires identical normalized input and backend and remains bounded', async () => {
  clearInputCache();
  const pixels = new Uint8Array([0, 128, 255]);
  const key = await inputKey('portrait:gpu:3x1', pixels), mask = { alpha: [0, 100, 255] };
  keepInput('portrait:gpu:3x1', key, mask);
  assert.equal(previousInput('portrait:gpu:3x1', await inputKey('portrait:gpu:3x1', pixels.slice())), mask);
  assert.equal(previousInput('portrait:cpu:3x1', key), null);
  assert.equal(previousInput('portrait:gpu:3x1', await inputKey('portrait:gpu:3x1', new Uint8Array([0, 129, 255]))), null);
  for (let n=0;n<8;n++) keepInput(`other:${n}`, `key:${n}`, mask);
  assert.equal(previousInput('portrait:gpu:3x1', key), null);
  clearInputCache();
  assert.equal(previousInput('other:7', 'key:7'), null);
});

test('preview strategy changes interactive work without changing selected effects or export', () => {
  const chosen = { ...videoEffects(() => undefined), cutout: true, mode: 4, quality: 1, smooth: .5 };
  const draft = previewPlan(chosen, { playing: true });
  assert.equal(draft.settings.mode, 1); assert.equal(draft.settings.quality, 0); assert.equal(draft.profile, 'draft');
  assert.equal(chosen.mode, 4); assert.equal(chosen.quality, 1);
  for (const mode of ['auto','smooth','quality']) {
    const exported = previewPlan(chosen, { playing: true, exact: true, mode });
    assert.equal(exported.settings, chosen); assert.equal(exported.side, Infinity); assert.equal(exported.preview, false);
  }
  assert.equal(previewPlan(chosen).profile, 'quality');
  const general = previewPlan({ ...chosen, mode: 2 }, { playing: true });
  assert.equal(general.profile, 'original'); assert.equal(general.settings.mode, 2, 'an object is never silently replaced by a person');
  assert.equal(analysisVariant(chosen), analysisVariant({ ...chosen, smooth: .9, lip: .7, lipColor: '#ff0000' }));
  assert.equal(adaptiveSide(192, 80), 192); assert.equal(adaptiveSide(320, 2), 320);
  assert.equal(adaptiveSide(256, 45), 224); assert.equal(adaptiveSide(256, 24), 256);
});

test('local analysis cache survives reload, supports typed masks, and can be cleared without affecting other storage', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'of-analysis-cache-')); let site, browser;
  try {
    writeFileSync(join(root, 'index.html'), '<!doctype html><body>Cache test'); site = await serve(root); browser = await launch();
    const page = await browser.newPage(); await page.goto(site.url + '/index.html');
    await page.evaluate(async () => {
      localStorage.setItem('keep-me', 'yes');
      const { storeAnalysis } = await import('/__film/vision-cache.mjs');
      await storeAnalysis('source-a:pts:1:model:4', { person: { w: 2, h: 1, data: new Uint8Array([0,255]) } }, 2);
    });
    await page.reload();
    const result = await page.evaluate(async () => {
      const { cachedAnalysis, clearAnalysisCache } = await import('/__film/vision-cache.mjs');
      const value = await cachedAnalysis('source-a:pts:1:model:4');
      const differentSource = await cachedAnalysis('source-b:pts:1:model:4');
      await clearAnalysisCache();
      return { pixels: Array.from(value.person.data), typed: value.person.data instanceof Uint8Array, differentSource, cleared: await cachedAnalysis('source-a:pts:1:model:4'), keep: localStorage.getItem('keep-me') };
    });
    assert.deepEqual(result, { pixels: [0,255], typed: true, differentSource: null, cleared: null, keep: 'yes' });
  } finally { await browser?.close(); await site?.close(); rmSync(root, { recursive: true, force: true }); }
});
