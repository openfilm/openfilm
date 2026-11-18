// @ts-check
/**
 * The programs of plugins: a plugin someone made may bring a program that stays running while its workbench is used
 * (its package.json's `scripts.start`, npm's own field; src/skills.mjs programIn). Its surface is then the program's
 * own: Studio starts it, and shows what it serves. How the page and its program talk is theirs alone, and the program
 * does on this computer whatever its author wrote, so it runs only once the person has said this plugin may
 * (`mayRun`), and only while the plugin is on.
 *
 * One is started for a plugin in a project, when its workbench is first shown there, in the plugin's folder, by the
 * system's shell, with:
 *   PORT              the port to serve on, on this computer (HOST: 127.0.0.1)
 *   OPENFILM_PROJECT  the project's folder
 *   OPENFILM_PLUGIN   the plugin's own folder
 *   OPENFILM_RUN      how `openfilm` is typed, to run OpenFilm's and other plugins' commands
 * and `node` and `openfilm` first on its PATH: the Node this Studio runs on and this Studio's own command, so a
 * plugin needs nothing installed. It is ready once it answers on its port (READY_MS at most), and is stopped, with
 * all it started, when the plugin is turned off or no longer let run, and when Studio closes or is gone in any way
 * (plugin-program-run.mjs stands between and watches for that).
 */
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** How long a program has to answer on its port. */
export const READY_MS = 20_000;
/** The lines of what a program printed that are kept, to say why it did not start. */
const KEPT_LINES = 30;

const sq = (/** @type {string} */ s) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * `node` and `openfilm` as files in `dir`, for a program's PATH: this process's Node (Electron as Node, in the app)
 * and this checkout's command. Returns `dir`.
 * @param {string} dir @param {{ node?: string, cli?: string, electron?: boolean, platform?: string }} [with_]
 */
export function programBin(dir, { node = process.execPath, cli = fileURLToPath(new URL('../../bin/openfilm.mjs', import.meta.url)), electron = Boolean(process.versions.electron), platform = process.platform } = {}) {
  mkdirSync(dir, { recursive: true });
  if (platform === 'win32') {
    const asNode = electron ? 'set ELECTRON_RUN_AS_NODE=1\r\n' : '';
    writeFileSync(join(dir, 'node.cmd'), `@echo off\r\n${asNode}"${node}" %*\r\n`);
    writeFileSync(join(dir, 'openfilm.cmd'), `@echo off\r\n${asNode}"${node}" "${cli}" %*\r\n`);
    return dir;
  }
  const asNode = electron ? 'ELECTRON_RUN_AS_NODE=1 ' : '';
  for (const [name, line] of [['node', `${asNode}exec ${sq(node)} "$@"`], ['openfilm', `${asNode}exec ${sq(node)} ${sq(cli)} "$@"`]]) {
    writeFileSync(join(dir, name), `#!/bin/sh\n# written by OpenFilm Studio for the programs of plugins (changes are lost)\n${line}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  return dir;
}

/** A port nothing listens on now. @returns {Promise<number>} */
const freePort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.once('error', fail);
  probe.listen(0, '127.0.0.1', () => { const { port } = /** @type {import('node:net').AddressInfo} */ (probe.address()); probe.close(() => done(port)); });
});

/** What runs a program and stops it with all it started (plugin-program-run.mjs). */
const RUNNER = fileURLToPath(new URL('./plugin-program-run.mjs', import.meta.url));

/** Stop a program and all it started: its runner is told, by its input closing and a signal. @param {import('node:child_process').ChildProcess} child */
function stopTree(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  child.stdin?.end();
  if (process.platform !== 'win32') child.kill('SIGTERM');
}

/**
 * `bin`: the folder `node` and `openfilm` are written in. `mayRun`: whether the person lets this plugin run its
 * program for this project, asked at every start. `readyMs`: for a test.
 * @typedef {{ uid: string, source: string, folder: string, program: string }} Program
 * @param {{ bin: string, mayRun: (plugin: Program, project: { id: string, path: string }) => boolean, readyMs?: number }} options
 */
export function startPluginPrograms({ bin, mayRun, readyMs = READY_MS }) {
  /** @type {Map<string, { uid: string, child: import('node:child_process').ChildProcess, ready: Promise<string>, lines: string[] }>} */
  const running = new Map();
  let path = '';
  const stopAll = () => { for (const one of running.values()) stopTree(one.child); running.clear(); };
  process.once('exit', stopAll);

  return {
    /**
     * The address of a plugin's program for a project, started when it is not running. Throws an Error with a
     * `status`: 403 when the person has not let it run, 502 when it did not start (with what it printed).
     * @param {Program} plugin @param {{ id: string, path: string }} project @returns {Promise<string>}
     */
    async ensure(plugin, project) {
      if (!mayRun(plugin, project)) throw Object.assign(new Error('This plugin runs a program on this computer. The person allows it on the plugin\'s page in the library.'), { status: 403 });
      const key = `${plugin.uid}\0${project.id}`;
      const had = running.get(key);
      if (had) return had.ready;
      path ||= programBin(bin);
      const port = await freePort();
      const run = process.platform === 'win32' ? 'openfilm' : sq(join(path, 'openfilm'));
      const child = spawn(process.execPath, [RUNNER, plugin.program], {
        cwd: plugin.folder, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), PATH: `${path}${delimiter}${process.env.PATH ?? ''}`, PORT: String(port), HOST: '127.0.0.1', OPENFILM_PROJECT: project.path, OPENFILM_PLUGIN: plugin.folder, OPENFILM_RUN: run },
      });
      /** @type {string[]} */
      const lines = [];
      const keep = (/** @type {Buffer} */ chunk) => { lines.push(...String(chunk).split(/\r?\n/).filter(Boolean)); lines.splice(0, Math.max(0, lines.length - KEPT_LINES)); };
      child.stdout?.on('data', keep);
      child.stderr?.on('data', keep);
      const gone = new Promise((done) => { child.once('exit', (code, signal) => done(`it stopped (${signal ?? `status ${code}`})`)); child.once('error', (e) => done(e.message)); });
      const ready = (async () => {
        const until = Date.now() + readyMs;
        for (;;) {
          /* by either name of this computer: a program may listen on one only */
          for (const host of ['127.0.0.1', 'localhost']) {
            const answered = await Promise.race([fetch(`http://${host}:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(2000) }).then(() => true, () => false), gone.then(() => false)]);
            /* shown by the name the film's and the plugins' origins have: another site than the editor's (127.0.0.1) to a browser */
            if (answered) return `http://localhost:${port}/`;
          }
          const why = await Promise.race([gone, new Promise((later) => setTimeout(() => later(null), 150))]);
          if (why || Date.now() > until) {
            stopTree(child);
            running.delete(key);
            const said = lines.length ? `\n${lines.join('\n')}` : '';
            throw Object.assign(new Error(`The plugin's program did not start: ${why ?? `nothing answered on its port (PORT) in ${Math.round(readyMs / 1000)} s`}.${said}`), { status: 502 });
          }
        }
      })();
      running.set(key, { uid: plugin.uid, child, ready, lines });
      child.once('exit', () => { if (running.get(key)?.child === child) running.delete(key); });
      ready.catch(() => { /* said to whoever asked */ });
      return ready;
    },
    /** Stop a plugin's programs, in every project (it was turned off, or is no longer let run). @param {string} uid */
    stop(uid) {
      for (const [key, one] of running) if (one.uid === uid) { stopTree(one.child); running.delete(key); }
    },
    /** How many are running (for a test). */
    get count() { return running.size; },
    close() { stopAll(); process.removeListener('exit', stopAll); },
  };
}
