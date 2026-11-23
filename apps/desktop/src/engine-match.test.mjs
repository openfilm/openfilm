// The preview and exports draw with the same Chromium (the `openfilm` package's src/engine.mjs): this app's Electron
// and the headless shell of the playwright-core the `openfilm` package depends on. Upgrading one of them without the
// other fails here: move both (Playwright's release notes name its Chromium), then ENGINE_CHROMIUM, then run the
// engine suite (packages/openfilm: `node --test src/engine.test.mjs`, `node scripts/engine-report.mjs`).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ENGINE_CHROMIUM } from 'openfilm/engine';

const require = createRequire(import.meta.url);
const major = (/** @type {string} */ version) => Number(version.split('.')[0]);

test('exports draw with the Chromium engine.mjs names: the headless shell of the playwright-core openfilm depends on', () => {
  const playwright = dirname(createRequire(require.resolve('openfilm/package.json')).resolve('playwright-core/package.json'));
  const { browsers } = JSON.parse(readFileSync(join(playwright, 'browsers.json'), 'utf8'));
  const shell = browsers.find((/** @type {{ name: string }} */ b) => b.name === 'chromium-headless-shell');
  assert.equal(major(shell.browserVersion), ENGINE_CHROMIUM, `playwright-core's headless shell is Chromium ${shell.browserVersion}`);
});

/* Electron's version of Chromium is known from its binary only. Its package fetches the binary on first use, and CI
   never does (ELECTRON_SKIP_BINARY_DOWNLOAD): where it is not here, this is skipped, not fetched */
const electronDir = dirname(require.resolve('electron/package.json'));
const pathFile = join(electronDir, 'path.txt');
const binary = existsSync(pathFile) ? join(electronDir, 'dist', readFileSync(pathFile, 'utf8').trim()) : null;

test('the preview draws with the Chromium engine.mjs names: this app\'s Electron', { skip: !(binary && existsSync(binary)) && 'Electron\'s binary is not downloaded here' }, () => {
  const r = spawnSync(/** @type {string} */ (binary), ['-p', 'process.versions.chrome'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(major(r.stdout.trim()), ENGINE_CHROMIUM, `Electron's Chromium is ${r.stdout.trim()}`);
});
