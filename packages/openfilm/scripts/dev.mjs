#!/usr/bin/env node
// @ts-check
/**
 * `npm run dev`: Studio from this checkout, apart from an installed OpenFilm. Its state, projects and exports are in
 * .dev/ (git-ignored), and it listens on port 4848 (OPENFILM_STUDIO_PORT for another). The editor is rebuilt when
 * studio/ui changes (reload the page); Studio restarts when studio/server or src change. It opens a sample project in
 * your browser (OPENFILM_NO_BROWSER=1: it only prints the address). Ctrl+C stops it all.
 *
 * It also writes .dev/bin/openfilm (and openfilm.cmd on Windows): this checkout's command on this Studio, for your own
 * agent to try your changes with.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEV = join(ROOT, '.dev');
const env = {
  ...process.env,
  OPENFILM_HOME: join(DEV, 'home'),
  OPENFILM_LIBRARY: join(DEV, 'projects'),
  OPENFILM_EXPORTS: join(DEV, 'exports'),
  OPENFILM_STUDIO_PORT: process.env.OPENFILM_STUDIO_PORT || '4848',
  OPENFILM_NO_UPDATE_CHECK: '1',
  /* Studio itself, without the supervisor `openfilm open` gives it: this script starts it again when its code changes */
  OPENFILM_STUDIO_WORKER: '1',
};

/* this checkout's `openfilm` on this Studio, for your agent: the same environment, and it names itself in the manual */
const BIN = join(DEV, 'bin');
mkdirSync(BIN, { recursive: true });
const CLI = join(ROOT, 'bin', 'openfilm.mjs');
const SHARED = ['OPENFILM_HOME', 'OPENFILM_LIBRARY', 'OPENFILM_EXPORTS', 'OPENFILM_STUDIO_PORT', 'OPENFILM_NO_UPDATE_CHECK'];
const sh = join(BIN, 'openfilm');
writeFileSync(sh, `#!/bin/sh\n${SHARED.map((k) => `export ${k}='${env[k]}'`).join('\n')}\nOPENFILM_RUN="${sh}" exec '${process.execPath}' '${CLI}' "$@"\n`);
chmodSync(sh, 0o755);
if (process.platform === 'win32') {
  writeFileSync(join(BIN, 'openfilm.cmd'), `@echo off\r\n${SHARED.map((k) => `set "${k}=${env[k]}"`).join('\r\n')}\r\nset "OPENFILM_RUN=%~f0"\r\n"${process.execPath}" "${CLI}" %*\r\n`);
}

/* a small film to open: one page, drawn by frame(t) */
const SAMPLE = join(DEV, 'projects', 'Sample');
if (!existsSync(join(SAMPLE, 'film.html'))) {
  mkdirSync(SAMPLE, { recursive: true });
  writeFileSync(join(SAMPLE, 'film.html'), `<meta name="viewport" content="width=1920, height=1080">
<section>
  <iframe src="title.html"></iframe>
</section>
`);
  writeFileSync(join(SAMPLE, 'title.html'), `<!doctype html>
<style>
  body { margin: 0; width: 1920px; height: 1080px; background: #0b0d12; display: grid; place-items: center; }
  h1 { font: 700 120px system-ui, sans-serif; color: #fff; }
</style>
<h1 id="title">Hello, OpenFilm</h1>
<script type="module">
const title = document.getElementById('title');
window.film = {
  duration: 4,
  frame(t) {
    const k = Math.min(1, t / 1.2);
    title.style.opacity = String(k);
    title.style.transform = \`translateY(\${(1 - k) * 40}px)\`;
  },
};
</script>
`);
}

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];
const run = (/** @type {string[]} */ args) => {
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: 'inherit' });
  children.push(child);
  child.once('exit', () => { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); });
  return child;
};

/* the editor: built again on every change to studio/ui; Studio serves the files from disk */
run([join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--watch', '--config', 'studio/ui/vite.config.ts']);

/* Studio, started again when its code changes (pages open on it reconnect by themselves) */
let server = run(['studio/server/main.mjs']);
let timer = /** @type {NodeJS.Timeout | undefined} */ (undefined);
const restart = (/** @type {string | null} */ file) => {
  if (!file || /\.test\.|\.d\.mts$/.test(file)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`\n${file} changed: restarting Studio`);
    const old = server;
    /* one that stopped by itself (an error on load) is simply started again */
    if (old.exitCode != null || old.signalCode != null) server = run(['studio/server/main.mjs']);
    else { old.once('exit', () => { server = run(['studio/server/main.mjs']); }); old.kill(); }
  }, 200);
};
for (const dir of ['studio/server', 'src']) watch(join(ROOT, dir), { recursive: true }, (_, file) => restart(file && `${dir}/${file}`));

/* once Studio says where it listens (run.json), open the sample in it */
const runFile = join(env.OPENFILM_HOME, 'run.json');
for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((r) => setTimeout(r, 250))) {
  let up;
  try { up = JSON.parse(readFileSync(runFile, 'utf8')); } catch { continue; }
  if (up.pid !== server.pid) continue;
  const quiet = Boolean(process.env.OPENFILM_NO_BROWSER);
  const res = await fetch(`${up.origin}/api/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-studio-key': up.key },
    body: JSON.stringify({ path: SAMPLE, now: !quiet, fallback: 0 }),
  }).catch((e) => ({ ok: false, json: async () => ({ error: e.message }) }));
  const said = await res.json();
  const command = process.platform === 'win32' ? join(BIN, 'openfilm.cmd') : sh;
  console.log(res.ok ? `\nStudio (dev)  ${said.url}\nhome          ${env.OPENFILM_HOME}\nyour agent    tell it to run ${command} instead of npx openfilm: this checkout, on this Studio\n` : `\ncould not open the sample: ${said.error}\n`);
  break;
}

const stop = () => {
  for (const child of children) child.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
