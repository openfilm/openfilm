import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

test('a plugin someone made: its page on the plugins\' origin, the project read from there, and written only once the person lets it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-skill-surface-'));
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_LIBRARY: join(root, 'library'), OPENFILM_SKILLS: join(root, 'mine'), OPENFILM_TRASH_DIR: join(root, 'trash'), OPENFILM_SHARED_HOME: join(root, 'home') };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const PAGE = '<!doctype html><title>Board</title><script src="app.js"></script>';
  for (const [name, files] of [['board', { 'index.html': PAGE, 'app.js': 'window.board = 1;', '.env': 'SECRET=1' }], ['plain', {}], ['tool', { 'package.json': '{"bin":{"run":"run.mjs","check":"./run.mjs"}}', 'run.mjs': '' }],
    ['own', { 'package.json': '{"browser":"ui.js"}', 'ui.js': 'export default class extends HTMLElement {}' }],
    ['bench', { 'index.html': PAGE, 'package.json': '{"scripts":{"start":"node server.mjs"}}', 'server.mjs': 'import { createServer } from "node:http"; createServer((q, r) => r.end(process.env.OPENFILM_PROJECT)).listen(Number(process.env.PORT), process.env.HOST);' }]]) {
    mkdirSync(join(variables.OPENFILM_SKILLS, name), { recursive: true });
    writeFileSync(join(variables.OPENFILM_SKILLS, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\nSteps.`);
    for (const [file, text] of Object.entries(files)) writeFileSync(join(variables.OPENFILM_SKILLS, name, file), text);
  }
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path, { method = 'GET', body } = {}) => fetch(studio.origin + path, {
    method, headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const project = (await (await api('/api/projects', { method: 'POST', body: { path: join(root, 'film') } })).json()).project;
  const listed = async (query = `?project=${project.id}`) => (await (await api(`/api/skills${query}`)).json()).skills;
  const board = (await listed()).find((k) => k.uid === 'local/board');
  assert.equal((await listed()).find((k) => k.uid === 'local/plain').surface, undefined);
  /* one that brings commands is listed with their names: a plugin with no surface */
  const tool = (await listed()).find((k) => k.uid === 'local/tool');
  assert.deepEqual([tool.commands, tool.surface], [['run', 'check'], undefined]);
  assert.equal(board.commands, undefined);
  /* one that brings a program: listed as one, with no page of the plugins' origin; whether it runs is the person's to say */
  const bench = (await listed()).find((k) => k.uid === 'local/bench');
  assert.deepEqual([bench.program, bench.runs, bench.surface], [true, undefined, undefined]);
  assert.equal((await api(`/api/skills/local%2Fbench/start?project=${project.id}`, { method: 'POST' })).status, 403);
  assert.equal((await api('/api/skills/local%2Fplain/runs', { method: 'PUT', body: { on: true } })).status, 404);
  assert.equal((await api('/api/skills/local%2Fbench/runs', { method: 'PUT', body: { on: true } })).status, 200);
  assert.equal((await listed()).find((k) => k.uid === 'local/bench').runs, true);
  assert.equal((await api('/api/skills/local%2Fbench/start', { method: 'POST' })).status, 404);
  if (process.platform !== 'win32') {
    /* started for the project, and stopped when the plugin is turned off */
    const started = await api(`/api/skills/local%2Fbench/start?project=${project.id}`, { method: 'POST' });
    assert.equal(started.status, 200);
    const { url } = await started.json();
    assert.equal(await (await fetch(url)).text(), project.path);
    assert.equal((await api('/api/skills/local%2Fbench/on', { method: 'PUT', body: { on: false } })).status, 200);
    assert.equal((await api(`/api/skills/local%2Fbench/start?project=${project.id}`, { method: 'POST' })).status, 409);
    let stopped = false;
    for (let i = 0; i < 50 && !stopped; i++) { stopped = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true); if (!stopped) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(stopped, 'the program stopped with its plugin');
  }
  /* one that brings an element (its package.json's `browser`): listed as in the app, its module's address given only
     once the person lets it run; the editor's page then reads the module and the project, and writes the project */
  const own = (await listed()).find((k) => k.uid === 'local/own');
  assert.deepEqual([own.inApp, own.runs, own.element, own.surface], [true, undefined, undefined, undefined]);
  assert.equal((await api('/api/skills/local%2Fown/runs', { method: 'PUT', body: { on: true } })).status, 200);
  const let_ = (await listed()).find((k) => k.uid === 'local/own');
  assert.ok(let_.runs && let_.element.startsWith(`${studio.pluginOrigin}/s/`) && /\/ui\.js\?v=[\w-]+$/.test(let_.element), let_.element);
  const module = await fetch(let_.element, { headers: { origin: studio.origin } });
  assert.equal(await module.text(), 'export default class extends HTMLElement {}');
  assert.equal(module.headers.get('access-control-allow-origin'), studio.origin);
  /* no other site is answered so */
  assert.equal((await fetch(let_.element, { headers: { origin: studio.filmOrigin } })).headers.get('access-control-allow-origin'), null);
  const fromEditor = await fetch(new URL('film.html', let_.files), { headers: { origin: studio.origin } });
  assert.deepEqual([fromEditor.status, fromEditor.headers.get('access-control-allow-origin'), fromEditor.headers.get('access-control-expose-headers')], [200, studio.origin, 'etag']);
  const asked = await fetch(new URL('own.md', let_.files), { method: 'OPTIONS', headers: { origin: studio.origin, 'access-control-request-method': 'PUT' } });
  assert.deepEqual([asked.status, asked.headers.get('access-control-allow-methods')], [204, 'GET, HEAD, PUT']);
  assert.equal((await fetch(new URL('own.md', let_.files), { method: 'PUT', body: 'from the app', headers: { origin: studio.origin } })).status, 201);
  assert.equal(readFileSync(join(project.path, 'own.md'), 'utf8'), 'from the app');
  assert.equal((await fetch(new URL('own.md', let_.files), { method: 'PUT', body: 'x', headers: { origin: studio.filmOrigin } })).status, 403);
  /* OpenFilm's own plugins bring their workbench the same way: the edit's element is a module in its folder, on the
     plugins' origin, read by the editor's page; it names what was built with the editor, which the page's map finds */
  const ours = (await (await api('/api/plugins')).json()).plugins;
  const edit = ours.find((p) => p.id === 'edit');
  assert.ok(edit.element.startsWith(`${studio.pluginOrigin}/s/`) && edit.element.endsWith('/ui.js'), edit.element);
  const stub = await fetch(edit.element, { headers: { origin: studio.origin } });
  assert.match(await stub.text(), /export \{ default \} from 'openfilm\/workbench\/edit';/);
  assert.equal(stub.headers.get('access-control-allow-origin'), studio.origin);
  /* the canvas brings its own */
  for (const [id, workbench] of [['canvas', 'canvas']]) {
    const own = ours.find((p) => p.id === id);
    assert.ok(own.element.startsWith(`${studio.pluginOrigin}/s/`) && own.element.endsWith('/ui.js'), own.element);
    assert.ok((await (await fetch(own.element, { headers: { origin: studio.origin } })).text()).includes(`export { default } from 'openfilm/workbench/${workbench}';`));
  }
  /* OpenFilm's own are not plugins of this kind */
  assert.ok((await listed()).filter((k) => k.core).every((k) => k.surface === undefined && k.commands === undefined));

  /* its page: on the plugins' origin (another than the editor's and the film's), as its author wrote it, nothing hidden */
  assert.ok(studio.pluginOrigin !== studio.origin && studio.pluginOrigin !== studio.filmOrigin);
  assert.ok(board.surface.startsWith(`${studio.pluginOrigin}/s/`) && board.surface.endsWith('/index.html'), board.surface);
  assert.equal(await (await fetch(board.surface)).text(), PAGE);
  assert.equal(await (await fetch(new URL('app.js', board.surface))).text(), 'window.board = 1;');
  assert.equal((await fetch(new URL('.env', board.surface))).status, 404);
  assert.equal((await fetch(new URL('app.js', board.surface), { method: 'PUT', body: 'x' })).status, 405);
  /* listed for no project, it has no project's files */
  assert.equal((await listed('')).find((k) => k.uid === 'local/board').files, undefined);

  /* the project's files, read as they are on disk: film.html with nothing put in it, and a tag to write it back by */
  assert.ok(board.files.startsWith(`${studio.pluginOrigin}/f/`) && board.files.endsWith('/'), board.files);
  const onDisk = readFileSync(join(project.path, 'film.html'), 'utf8');
  const read = await fetch(new URL('film.html', board.files));
  assert.equal(await read.text(), onDisk);
  const tag = read.headers.get('etag');
  assert.ok(tag);
  assert.equal((await fetch(new URL('film.html', board.files), { headers: { 'if-none-match': tag } })).status, 304);
  assert.equal((await fetch(new URL('.film/id', board.files))).status, 404);

  /* a write: only from a page of the plugins' origin, and only once the person lets this plugin */
  const put = (path, body, headers = {}) => fetch(new URL(path, board.files), { method: 'PUT', body, headers: { origin: studio.pluginOrigin, ...headers } });
  assert.equal(board.writes, undefined);
  assert.equal((await put('notes.md', 'hello')).status, 403);
  assert.equal((await api('/api/skills/local%2Fboard/writes', { method: 'PUT', body: { on: true } })).status, 200);
  assert.equal((await api('/api/skills/local%2Fplain/writes', { method: 'PUT', body: { on: true } })).status, 404);
  assert.equal((await listed()).find((k) => k.uid === 'local/board').writes, true);
  /* a film's page (the film's origin), any other site, or a request that says no origin: refused */
  assert.equal((await put('notes.md', 'hello', { origin: studio.filmOrigin })).status, 403);
  assert.equal((await put('notes.md', 'hello', { origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(new URL('notes.md', board.files), { method: 'PUT', body: 'hello' })).status, 403);
  assert.equal(existsSync(join(project.path, 'notes.md')), false);

  const made = await put('notes/first.md', 'hello');
  assert.equal(made.status, 201);
  assert.equal(readFileSync(join(project.path, 'notes', 'first.md'), 'utf8'), 'hello');
  /* written back by its tag; a tag of before, or "only if new" over a file, is refused and the file left */
  assert.equal((await put('notes/first.md', 'again', { 'if-match': made.headers.get('etag') })).status, 204);
  assert.equal((await put('notes/first.md', 'stale', { 'if-match': '"0-0"' })).status, 412);
  assert.equal((await put('notes/first.md', 'new only', { 'if-none-match': '*' })).status, 412);
  assert.equal(readFileSync(join(project.path, 'notes', 'first.md'), 'utf8'), 'again');
  /* the film itself is written by the tag it was read with */
  const next = onDisk.replace('</body>', '<section></section>\n</body>');
  assert.equal((await put('film.html', next, { 'if-match': tag })).status, 204);
  assert.equal(readFileSync(join(project.path, 'film.html'), 'utf8'), next);
  /* never Studio's own folder, a hidden file, a folder, or a way out of the project */
  for (const path of ['.film/settings.json', '.env', 'notes/', 'notes', '..%2Foutside.txt', 'a/..%2F..%2Foutside.txt']) {
    const status = (await put(path, 'x')).status;
    assert.ok([403, 404, 409].includes(status), `${path}: ${status}`);
  }
  assert.equal(existsSync(join(root, 'outside.txt')), false);
  assert.equal(readdirSync(join(project.path, 'notes')).join(), 'first.md');
  /* no longer let: its page reads on, and writes nothing */
  assert.equal((await api('/api/skills/local%2Fboard/writes', { method: 'PUT', body: { on: false } })).status, 200);
  assert.equal((await put('notes/first.md', 'after')).status, 403);
  assert.equal((await fetch(new URL('notes/first.md', board.files))).status, 200);
});

test('a plugin\'s app icon has a new URL when its file changes, so the page does not keep the old one', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'of-plugin-icon-'));
  const plugins = join(root, 'plugins');
  cpSync(join(import.meta.dirname, '..', '..', 'plugins'), plugins, { recursive: true });
  const variables = { OPENFILM_HOME: join(root, 'home'), OPENFILM_LIBRARY: join(root, 'library'), OPENFILM_SHARED_HOME: join(root, 'home'), OPENFILM_PLUGINS: plugins };
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
  Object.assign(process.env, variables);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  });
  const studio = await startStudio({ port: 0, openBrowser: () => {} });
  t.after(() => studio.close());
  const api = (path) => fetch(studio.origin + path, { headers: { 'x-studio-key': studio.key } });
  const iconOf = async () => (await (await api('/api/plugins')).json()).plugins.find((p) => p.id === 'edit').appIcon;
  const before = await iconOf();
  assert.ok(before);
  const drawn = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#123456"/></svg>';
  writeFileSync(join(plugins, 'edit', 'icon.svg'), drawn);
  const after = await iconOf();
  assert.notEqual(after, before);
  assert.equal(await (await api(after)).text(), drawn);
});
