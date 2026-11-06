import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addSkills } from '../../src/skills.mjs';
import { skillsCommand } from '../../src/skills-cli.mjs';
import { startStudio } from './server.mjs';

/** Discover as last read (skill-catalog.mjs): the index naming one skill of OpenFilm's, kept at its commit. */
function discover(/** @type {string} */ home) {
  const entry = { name: 'replicate', repo: 'https://github.com/openfilm/skill-replicate', path: 'skills/replicate', version: '0.1.0', commit: 'a'.repeat(40) };
  const folder = join(home, 'skill-catalog', 'openfilm', `replicate@${entry.commit}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), '---\nname: replicate\ndescription: Remake a video\n---\nSteps.');
  writeFileSync(join(folder, '.source.json'), JSON.stringify(entry));
  writeFileSync(join(home, 'skill-catalog', 'index.json'), JSON.stringify({ read: new Date().toISOString(), entries: [entry] }));
}

test('a replacement skill cover has a new gallery URL and serves the chosen bytes', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-gallery-'));
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_LIBRARY: join(root, 'library'), OPENFILM_SKILLS: join(root, 'mine'), OPENFILM_TRASH_DIR: join(root, 'trash'), OPENFILM_SHARED_HOME: join(root, 'home') };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  mkdirSync(variables.OPENFILM_TRASH_DIR);
  discover(variables.OPENFILM_SHARED_HOME);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'SKILL.md'), '---\nname: covered\ndescription: A cover\n---\nSteps.');
  writeFileSync(join(source, 'openfilm.json'), '{"cover":"original.png","custom":"keep me"}');
  writeFileSync(join(source, 'original.png'), 'original asset');
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path, { method = 'GET', body } = {}) => fetch(studio.origin + path, {
    method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const covers = [
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ];
  const urls = [];
  for (const picture of covers) {
    await addSkills(source, { covers: { covered: `data:image/png;base64,${picture}` } });
    const { skills } = await (await api('/api/skills')).json();
    const url = skills.find((s) => s.name === 'covered').cover;
    urls.push(url);
    const response = await api(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(picture, 'base64'));
  }
  assert.notEqual(urls[0], urls[1], 'the browser must not reuse its cached previous cover');
  const endpoint = '/api/skills/local%2Fcovered/cover';
  const replacement = await api(endpoint, { method: 'PUT', body: { cover: `data:image/png;base64,${covers[0]}` } });
  assert.equal(replacement.status, 200);
  const changed = await replacement.json();
  assert.notEqual(changed.cover, urls[1]);
  assert.deepEqual(Buffer.from(await (await api(changed.cover)).arrayBuffer()), Buffer.from(covers[0], 'base64'));
  const invalid = await api(endpoint, { method: 'PUT', body: { cover: 'data:image/png;base64,bm90IGEgcG5n' } });
  assert.equal(invalid.status, 400);
  assert.equal((await api(endpoint, { method: 'PUT', body: {} })).status, 400);
  assert.deepEqual(Buffer.from(await (await api(endpoint)).arrayBuffer()), Buffer.from(covers[0], 'base64'));
  const removed = await api(endpoint, { method: 'DELETE' });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).cover, null);
  assert.equal((await api(endpoint)).status, 404);
  const installed = join(variables.OPENFILM_SKILLS, 'covered');
  assert.deepEqual(JSON.parse(readFileSync(join(installed, 'openfilm.json'), 'utf8')), { custom: 'keep me' });
  assert.ok(existsSync(join(installed, 'original.png')), 'removal preserves the original asset');
  assert.equal(readFileSync(join(installed, 'SKILL.md'), 'utf8'), readFileSync(join(source, 'SKILL.md'), 'utf8'));
  const { skills } = await (await api('/api/skills')).json();
  assert.equal(skills.find((s) => s.name === 'covered').cover, undefined, 'removal persists when listed again');
  const official = skills.find((s) => s.source === 'official' && !s.core);
  assert.ok(official);
  assert.equal((await api(`/api/skills/${encodeURIComponent(official.uid)}/cover`, { method: 'DELETE' })).status, 403);
  assert.equal((await api('/api/skills/local%2Fmissing-skill/cover', { method: 'DELETE' })).status, 404);
  const project = (await (await api('/api/projects', { method: 'POST', body: { name: 'Override' } })).json()).project;
  mkdirSync(join(project.path, 'skills', 'covered'), { recursive: true });
  writeFileSync(join(project.path, 'skills', 'covered', 'SKILL.md'), '---\nname: covered\n---\nProject steps.');
  assert.equal((await api(`/api/skills/project%2Fcovered/cover?project=${project.id}`, { method: 'DELETE' })).status, 403, 'a project\'s own is not the person\'s');
});

test('skills: turned off and on, an official one installed and uninstalled, one of the person\'s removed to the trash', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-off-'));
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_LIBRARY: join(root, 'library'), OPENFILM_SKILLS: join(root, 'mine'), OPENFILM_TRASH_DIR: join(root, 'trash'), OPENFILM_SHARED_HOME: join(root, 'home') };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  mkdirSync(variables.OPENFILM_TRASH_DIR);
  discover(variables.OPENFILM_SHARED_HOME);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'SKILL.md'), '---\nname: quiet\ndescription: One to turn off\n---\nSteps.');
  await addSkills(source);
  mkdirSync(variables.OPENFILM_HOME, { recursive: true });
  writeFileSync(join(variables.OPENFILM_HOME, 'prefs.json'), '{"projectsFolder":null,"kept":"as it was"}');
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path, { method = 'GET', body } = {}) => fetch(studio.origin + path, {
    method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const listed = async () => (await (await api('/api/skills')).json()).skills.find((s) => s.name === 'quiet');
  const command = () => skillsCommand('openfilm', { cwd: root }).lines.join('\n');
  assert.equal((await listed()).off, undefined);
  assert.match(command(), /quiet/);

  assert.equal((await api('/api/skills/local%2Fquiet/on', { method: 'PUT', body: { on: false } })).status, 200);
  assert.equal((await listed()).off, true, 'still in the gallery, to turn on again');
  assert.doesNotMatch(command(), /quiet/, 'offered to no agent');
  assert.equal(JSON.parse(readFileSync(join(variables.OPENFILM_HOME, 'prefs.json'), 'utf8')).kept, 'as it was', 'the rest of prefs.json kept');

  assert.equal((await api('/api/skills/local%2Fquiet/on', { method: 'PUT', body: { on: true } })).status, 200);
  assert.equal((await listed()).off, undefined);
  assert.match(command(), /quiet/);
  assert.equal((await api('/api/skills/local%2Fquiet/on', { method: 'PUT', body: { on: 'yes' } })).status, 400);
  assert.equal((await api('/api/skills/..%2Fx/on', { method: 'PUT', body: { on: false } })).status, 404);
  assert.equal((await listed()).installed, true, 'the person\'s own is theirs already');

  /* an official one: in the catalog, used once installed */
  const replicate = async () => (await (await api('/api/skills')).json()).skills.find((s) => s.name === 'replicate');
  assert.equal((await replicate()).installed, false);
  assert.doesNotMatch(command(), /replicate/);
  assert.equal((await api('/api/skills/openfilm%2Freplicate/installed', { method: 'PUT', body: { installed: true } })).status, 200);
  assert.equal((await replicate()).installed, true);
  assert.match(command(), /replicate/);
  assert.equal((await api('/api/skills/openfilm%2Freplicate', { method: 'DELETE' })).status, 400, 'uninstalled, not removed');
  assert.equal((await api('/api/skills/openfilm%2Freplicate/installed', { method: 'PUT', body: { installed: false } })).status, 200);
  assert.doesNotMatch(command(), /replicate/);
  assert.equal((await api('/api/skills/local%2Fquiet/installed', { method: 'PUT', body: { installed: false } })).status, 404, 'only an official one');

  /* one of the person's own removed: to the trash */
  assert.equal((await api('/api/skills/local%2Fquiet', { method: 'DELETE' })).status, 200);
  assert.equal(await listed(), undefined);
  assert.ok(existsSync(join(variables.OPENFILM_TRASH_DIR, 'quiet')) || readdirSync(variables.OPENFILM_TRASH_DIR).length > 0, 'in the trash');
});
