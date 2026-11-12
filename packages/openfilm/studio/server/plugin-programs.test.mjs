import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { programBin, startPluginPrograms } from './plugin-programs.mjs';

/** A program that serves what it was started with, as JSON, on PORT. */
const SERVES = `import { createServer } from 'node:http';
createServer((req, res) => res.end(JSON.stringify({ project: process.env.OPENFILM_PROJECT, plugin: process.env.OPENFILM_PLUGIN, run: process.env.OPENFILM_RUN, cwd: process.cwd(), path: process.env.PATH.split(${JSON.stringify(process.platform === 'win32' ? ';' : ':')})[0] })))
  .listen(Number(process.env.PORT), process.env.HOST);
`;

const places = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'of-plugin-programs-')));
  const plugin = (name, files, program = 'node server.mjs') => {
    const folder = join(root, name);
    mkdirSync(folder, { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(folder, file), text);
    return { uid: `local/${name}`, source: 'mine', folder, program };
  };
  return { root, plugin, bin: join(root, 'bin'), project: { id: 'p1', path: join(root, 'film') } };
};
const answers = (url) => fetch(url, { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
const until = async (what, ms = 5000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (await what()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };

test('a plugin\'s program: started once for a project with node and openfilm on its PATH, and stopped when told', { skip: process.platform === 'win32' }, async (t) => {
  const { root, plugin, bin, project } = places();
  let allowed = false;
  const programs = startPluginPrograms({ bin, mayRun: () => allowed });
  t.after(() => { programs.close(); rmSync(root, { recursive: true, force: true }); });
  const shots = plugin('shots', { 'server.mjs': SERVES });
  /* not until the person lets it */
  await assert.rejects(programs.ensure(shots, project), (e) => e.status === 403);
  assert.equal(programs.count, 0);
  allowed = true;
  const url = await programs.ensure(shots, project);
  assert.match(url, /^http:\/\/localhost:\d+\/$/);
  assert.deepEqual(await (await fetch(url)).json(), { project: project.path, plugin: shots.folder, run: `'${join(bin, 'openfilm')}'`, cwd: shots.folder, path: bin });
  /* asked again, the one that runs; another project gets its own */
  assert.equal(await programs.ensure(shots, project), url);
  const other = await programs.ensure(shots, { id: 'p2', path: join(root, 'other') });
  assert.notEqual(other, url);
  assert.equal(programs.count, 2);
  /* node and openfilm there are files that run */
  assert.ok(statSync(join(bin, 'node')).mode & 0o100);
  assert.match(readFileSync(join(bin, 'openfilm'), 'utf8'), /bin\/openfilm\.mjs' "\$@"\n$/);
  /* turned off, or no longer let run: all of it stops */
  programs.stop(shots.uid);
  assert.equal(programs.count, 0);
  assert.ok(await until(async () => !(await answers(url)) && !(await answers(other))), 'both stopped');
});

test('a plugin\'s program that does not start says why', { skip: process.platform === 'win32' }, async (t) => {
  const { root, plugin, bin, project } = places();
  const programs = startPluginPrograms({ bin, mayRun: () => true, readyMs: 1500 });
  t.after(() => { programs.close(); rmSync(root, { recursive: true, force: true }); });
  /* one that ends: its status and what it printed */
  await assert.rejects(programs.ensure(plugin('ends', { 'server.mjs': 'console.error("no config"); process.exit(3);' }), project),
    (e) => e.status === 502 && /did not start: it stopped \(status 3\)\.\nno config/.test(e.message));
  /* one that never serves on its port is stopped */
  await assert.rejects(programs.ensure(plugin('deaf', { 'server.mjs': 'setInterval(() => {}, 1000);' }), project),
    (e) => e.status === 502 && /nothing answered on its port/.test(e.message));
  assert.equal(programs.count, 0);
});

test('node and openfilm for a program: this Node, as Node when it is Electron', () => {
  const root = mkdtempSync(join(tmpdir(), 'of-program-bin-'));
  const posix = programBin(join(root, 'a'), { node: '/App/Helper', cli: '/App/bin/openfilm.mjs', electron: true, platform: 'darwin' });
  assert.equal(readFileSync(join(posix, 'node'), 'utf8').split('\n').at(-2), `ELECTRON_RUN_AS_NODE=1 exec '/App/Helper' "$@"`);
  assert.equal(readFileSync(join(posix, 'openfilm'), 'utf8').split('\n').at(-2), `ELECTRON_RUN_AS_NODE=1 exec '/App/Helper' '/App/bin/openfilm.mjs' "$@"`);
  const win = programBin(join(root, 'b'), { node: 'C:\\App\\node.exe', cli: 'C:\\App\\bin\\openfilm.mjs', electron: false, platform: 'win32' });
  assert.equal(readFileSync(join(win, 'openfilm.cmd'), 'utf8'), '@echo off\r\n"C:\\App\\node.exe" "C:\\App\\bin\\openfilm.mjs" %*\r\n');
  rmSync(root, { recursive: true, force: true });
});
