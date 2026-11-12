import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { workspaceChatWidth } from '../../../packages/openfilm/studio/ui/src/lib/workspaces.ts';

const bridgeSource = readFileSync(new URL('../shell/bridge.ts', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../../../packages/openfilm/studio/ui/src/api.ts', import.meta.url), 'utf8');

// Run the real bridge and API together; only their native, DOM and network boundaries are replaced.
function loadSource(context, source) {
  const js = ts.transpileModule(source.replace(/^import .*;\n/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  vm.runInContext(js.replace(/^export /gm, '').replace(/^\{\s*\};?$/gm, ''), context);
}
function harness() {
  const requests = [], sockets = [], timers = [];
  const events = new Map();
  const element = () => ({ style: {}, dataset: {}, toggleAttribute() {} });
  const column = element();
  const location = { pathname: '/projects/a', protocol: 'http:', host: 'localhost:4787' };
  const native = {
    platform: 'linux',
    hello: async () => ({ chatOpen: true, chatWidth: 420, chatMin: 340, studioMin: 640, fullScreen: false }),
    agents: {}, localAgents: {}, chat: {}, skills: {},
    setTheme() {}, setLanguage() {}, onFullScreen() {}, onToggleChat() {},
  };
  const context = vm.createContext({
    window: { openfilmNative: native },
    location,
    history: Object.fromEntries(['pushState', 'replaceState'].map((method) => [method, (_state, _title, url) => { location.pathname = url; }])),
    document: { documentElement: element(), getElementById: () => column, createElement: element, head: { append() {} } },
    MutationObserver: class { observe() {} },
    WebSocket: class {
      constructor(url) { this.url = url; sockets.push(this); }
      close() { this.closed = true; }
      emit(event) { this.onmessage({ data: JSON.stringify(event) }); }
    },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
    innerWidth: 1280,
    workspaceChatWidth,
    addEventListener: (name, listener) => events.set(name, listener),
    flushSync: (fn) => fn(),
    fetch: (url, init) => new Promise((resolve) => {
      requests.push({ url, init, respond: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) });
    }),
  });
  loadSource(context, bridgeSource);
  context.studioHost = context.window.openfilmHost;
  loadSource(context, apiSource);
  const api = vm.runInContext('api', context);
  const projectEvents = vm.runInContext('projectEvents', context);
  const bridge = context.window.openfilmDesktop;
  const changed = [];
  bridge.onProject((project) => changed.push({ ...project }));
  return {
    api, bridge, native, requests, changed, sockets, column,
    subscribe: (id = 'a', listener = () => {}) => projectEvents(id, listener),
    reconnect: () => { sockets.at(-1).onclose(); timers.at(-1)(); sockets.at(-1).onopen(); },
    navigate: (path) => context.history.pushState(null, '', path),
  };
}
const project = (name = 'Untitled', id = 'a') => ({ id, name, path: `/projects/${name}`, openedAt: 1, missing: false });
const shown = (p) => ({ id: p.id, name: p.name, path: p.path });
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function opened(h) {
  h.requests[0].respond({ projects: [project()] });
  await h.bridge.hello();
}

test('a confirmed rename updates the existing chat immediately, ahead of its pending project lookup', async () => {
  const h = harness();
  const chat = h.bridge.chat;
  const renamed = project('My film');
  const rename = h.api.rename('a', renamed.name);
  assert.equal(h.requests[1].url, '/api/projects/a');
  assert.equal(h.requests[1].init.method, 'PATCH');
  h.requests[1].respond({ project: renamed });
  assert.equal((await rename).path, renamed.path);
  assert.deepEqual(h.changed, [shown(renamed)]);
  h.requests[0].respond({ projects: [project()] });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(renamed));
  assert.equal(h.bridge.chat, chat, 'the same chat bridge stays attached');
});

test('film reads cannot restore an old folder after a confirmed rename', async () => {
  const h = harness();
  await opened(h);
  const oldFilm = h.api.film('a');
  const rename = h.api.rename('a', 'My film');
  h.requests[2].respond({ project: project('My film') });
  await rename;
  h.requests[1].respond({ project: project(), text: '', rev: '' });
  await oldFilm;
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('My film')));
  assert.deepEqual(h.changed.map((p) => p.name), ['Untitled', 'My film']);
});

test('the shared project stream updates chat for a rename in another page', async () => {
  const h = harness();
  await opened(h);
  const received = [];
  h.subscribe('a', (event) => received.push(event.type));
  h.subscribe('a');
  assert.equal(h.sockets.length, 1);
  const renamed = project('Renamed elsewhere');
  h.sockets[0].emit({ type: 'project', project: renamed });
  h.sockets[0].emit({ type: 'film', rev: '' });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(renamed));
  assert.deepEqual(h.changed.map((p) => p.name), ['Untitled', 'Renamed elsewhere']);
  assert.deepEqual(received, ['project', 'film']);
  assert.equal(h.requests.length, 1, 'current project metadata needs no extra HTTP lookup');
});

test('the project snapshot on reconnect repairs a rename missed while disconnected', async () => {
  const h = harness();
  await opened(h);
  const received = [];
  h.subscribe('a', (event) => received.push(event.type));
  h.reconnect();
  assert.equal(h.sockets.length, 2);
  h.sockets[1].emit({ type: 'project', project: project('Renamed while offline') });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Renamed while offline')));
  assert.deepEqual(received, ['film', 'files', 'history', 'project']);
});

test('an initial project snapshot prevents an older list response from restoring the old folder', async () => {
  const h = harness();
  h.subscribe();
  h.sockets[0].emit({ type: 'project', project: project('Current folder') });
  h.requests[0].respond({ projects: [project()] });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Current folder')));
});

test('an earlier project-list response cannot replace the project reached by navigation', async () => {
  const h = harness();
  h.navigate('/projects/b');
  h.requests[1].respond({ projects: [project('Project B', 'b')] });
  await h.bridge.hello();
  h.requests[0].respond({ projects: [project()] });
  await tick();
  assert.deepEqual(h.changed, [shown(project('Project B', 'b'))]);
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Project B', 'b')));
});

test('a previous project rename does not cancel the newly opened project lookup', async () => {
  const h = harness();
  await opened(h);
  const rename = h.api.rename('a', 'Renamed A');
  h.subscribe('a');
  h.navigate('/projects/b');
  h.requests[1].respond({ project: project('Renamed A') });
  await rename;
  h.sockets[0].emit({ type: 'project', project: project('Renamed A again') });
  h.requests[2].respond({ projects: [project('Project B', 'b')] });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Project B', 'b')));
});

test('leaving keeps the chat mounted and returning invalidates reads from the earlier visit', async () => {
  const h = harness();
  await opened(h);
  const chat = h.bridge.chat;
  h.navigate('/projects/a');
  h.navigate('/');
  assert.equal(h.column.hidden, true);
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project()));
  assert.equal(h.bridge.chat, chat);
  assert.deepEqual(h.changed, [shown(project())], 'no null/reset project notification on leaving');
  h.navigate('/projects/a');
  assert.equal(h.column.hidden, false);
  h.requests[1].respond({ projects: [project('Earlier visit')] });
  await tick();
  assert.deepEqual(h.changed.map((p) => p.name), ['Untitled']);
  h.requests[2].respond({ projects: [project('Current visit')] });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Current visit')));
});

test('late events from an unsubscribed project stream cannot overwrite its next visit', async () => {
  const h = harness();
  await opened(h);
  const stop = h.subscribe();
  stop();
  assert.equal(h.sockets[0].closed, true);
  h.navigate('/');
  h.navigate('/projects/a');
  h.subscribe();
  h.sockets[1].emit({ type: 'project', project: project('Current visit') });
  h.sockets[0].emit({ type: 'project', project: project('Previous visit') });
  h.requests[1].respond({ projects: [project()] });
  assert.deepEqual({ ...(await h.bridge.hello()).project }, shown(project('Current visit')));
});

test('a refused rename leaves the chat path unchanged and preserves the reason for Studio', async () => {
  const h = harness();
  await opened(h);
  const rename = h.api.rename('a', 'My film');
  h.requests[1].respond({ error: 'Stop the agent first.', code: 'agent-running' }, 409);
  await assert.rejects(rename, (error) => error.status === 409 && error.body.code === 'agent-running');
  assert.deepEqual(h.changed, [shown(project())]);
});
