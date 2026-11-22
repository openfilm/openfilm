import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS } from '../src/agents.mjs';
import { NODE_ENTRIES, importsOf, nodeProgramFiles, unpackPatterns } from './node-programs.mjs';

const put = (/** @type {string} */ file, /** @type {string} */ text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };
const pkg = (/** @type {string} */ dir, /** @type {object} */ json) => put(join(dir, 'package.json'), JSON.stringify(json));

test('what Node runs is unpacked: the scripts it starts with theirs, and every package they need as Node finds it; the rest stays in the archive', () => {
  const stage = mkdtempSync(join(tmpdir(), 'of-node-programs-'));
  try {
    put(join(stage, 'src/agent.mjs'), "import { a } from 'pkg-a';\nimport './side.mjs';\nimport fs from 'node:fs';\nimport path from 'path';\nexport * from './more.mjs';\n");
    put(join(stage, 'src/side.mjs'), "const later = () => import('@s/b/sub/path.js');\n/* a word from 'nowhere' in a comment */\n");
    put(join(stage, 'src/more.mjs'), 'export const x = 1;\n');
    put(join(stage, 'src/main.mjs'), "import 'only-main';\nimport './agent.mjs';\n");
    pkg(join(stage, 'node_modules/pkg-a'), { name: 'pkg-a', dependencies: { 'pkg-c': '2' }, peerDependencies: { 'not-installed': '1' } });
    pkg(join(stage, 'node_modules/pkg-a/node_modules/pkg-c'), { name: 'pkg-c', version: '2.0.0' });
    pkg(join(stage, 'node_modules/pkg-c'), { name: 'pkg-c', version: '1.0.0' });
    pkg(join(stage, 'node_modules/@s/b'), { name: '@s/b', optionalDependencies: { 'pkg-d': '1' } });
    pkg(join(stage, 'node_modules/pkg-d'), { name: 'pkg-d' });
    pkg(join(stage, 'node_modules/adapter'), { name: 'adapter', dependencies: { 'pkg-c': '1' } });
    pkg(join(stage, 'node_modules/only-main'), { name: 'only-main' });
    const found = nodeProgramFiles(stage, { scripts: ['src/agent.mjs'], packages: ['adapter'] });
    assert.deepEqual(found.files, ['src/agent.mjs', 'src/more.mjs', 'src/side.mjs']);
    assert.deepEqual(found.packages, ['node_modules/@s/b', 'node_modules/adapter', 'node_modules/pkg-a', 'node_modules/pkg-a/node_modules/pkg-c', 'node_modules/pkg-c', 'node_modules/pkg-d']);
    assert.deepEqual(unpackPatterns(found).slice(0, 4), ['src/agent.mjs', 'src/more.mjs', 'src/side.mjs', 'node_modules/@s/b/**']);
    assert.throws(() => nodeProgramFiles(stage, { scripts: [], packages: ['missing'] }), /missing is not installed/);
    assert.throws(() => nodeProgramFiles(stage, { scripts: ['src/gone.mjs'], packages: [] }), /src\/gone\.mjs is not in the app/);
  } finally { rmSync(stage, { recursive: true, force: true }); }
});

test("the app's own scripts that run on its Node import only what is unpacked with them, never Electron", () => {
  const found = nodeProgramFiles(fileURLToPath(new URL('..', import.meta.url)), { scripts: NODE_ENTRIES.scripts, packages: [] });
  assert.ok(found.files.includes('src/hidden-windows.mjs'), 'as-node.mjs hides Windows consoles with it');
  assert.ok(!found.files.includes('src/main.mjs'));
  for (const file of found.files) assert.ok(!importsOf(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).includes('electron'), `${file} imports electron`);
});

test("every agent's adapter is among what the app starts on its Node", () => {
  for (const spec of Object.values(AGENTS)) if (spec.adapter) assert.ok(NODE_ENTRIES.packages.includes(spec.adapter), spec.adapter);
});
