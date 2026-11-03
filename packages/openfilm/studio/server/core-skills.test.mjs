import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startStudio } from './server.mjs';

test("Studio lists OpenFilm's own skills first, in their order, installed, and only turned off", async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-core-skills-'));
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_SHARED_HOME: join(root, 'shared'), OPENFILM_LIBRARY: join(root, 'library'), OPENFILM_SKILLS: join(root, 'mine') };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  mkdirSync(variables.OPENFILM_HOME);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path, { method = 'GET', body } = {}) => fetch(studio.origin + path, {
    method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const listed = async () => (await (await api('/api/skills')).json()).skills;
  const core = (await listed()).slice(0, 3);
  assert.deepEqual(core.map((s) => [s.name, s.core, s.installed]), [
    ['openfilm-edit', true, true], ['openfilm-media', true, true], ['openfilm-canvas', true, true],
  ]);
  assert.equal(core[0].shown.title['zh-CN'], '剪辑');
  assert.deepEqual(core.map((s) => s.id), ['openfilm/openfilm/openfilm-edit', 'openfilm/openfilm/openfilm-media', 'openfilm/openfilm/openfilm-canvas']);
  assert.ok((await listed()).slice(3).every((s) => !s.core), 'the library\'s are not');
  assert.equal((await api('/api/skills/openfilm-canvas/on', { method: 'PUT', body: { on: false } })).status, 200);
  assert.equal((await listed()).find((s) => s.name === 'openfilm-canvas').off, true);
  assert.equal((await api('/api/skills/openfilm-canvas/installed', { method: 'PUT', body: { installed: false } })).status, 404, 'never uninstalled');
  assert.equal((await api('/api/skills/openfilm-canvas', { method: 'DELETE' })).status, 404, 'never removed');
});
