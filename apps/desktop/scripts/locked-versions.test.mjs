import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockedOverrides, versionsOffLock } from './locked-versions.mjs';

/* the shape of `pnpm list --prod --depth Infinity --json` */
const tree = {
  dependencies: {
    '@earendil-works/pi-coding-agent': { version: '1.1.0', dependencies: {
      '@earendil-works/pi-codemode': { version: '1.1.0' },
      diff: { version: '8.0.4' },
    } },
    '@agentclientprotocol/codex-acp': { version: '1.13.1', dependencies: { diff: { version: '9.0.0' } } },
    diff: { version: '9.0.0' },
    openfilm: { version: 'link:../../packages/openfilm', dependencies: { 'playwright-core': { version: '1.50.0' } } },
  },
};

test("the installer's npm install is pinned to the lockfile's versions", () => {
  assert.deepEqual(lockedOverrides(tree), {
    '@earendil-works/pi-codemode': '1.1.0',
    'playwright-core': '1.50.0',
    /* two versions of diff: each under what depends on it; the package's own (exact) is not overridden */
    '@earendil-works/pi-coding-agent': { diff: '8.0.4' },
    '@agentclientprotocol/codex-acp': { diff: '9.0.0' },
  });
});

test('a package installed at a version the lockfile does not have is named', () => {
  const nm = mkdtempSync(join(tmpdir(), 'of-nm-'));
  const put = (dir, name, version) => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version })); };
  put(join(nm, '@earendil-works/pi-coding-agent'), '@earendil-works/pi-coding-agent', '1.1.0');
  put(join(nm, '@earendil-works/pi-codemode'), '@earendil-works/pi-codemode', '1.2.0');
  put(join(nm, '@earendil-works/pi-coding-agent/node_modules/diff'), 'diff', '8.0.4');
  put(join(nm, 'diff'), 'diff', '9.0.0');
  assert.deepEqual(versionsOffLock(tree, nm), [{ name: '@earendil-works/pi-codemode', version: '1.2.0', locked: ['1.1.0'] }]);
});
