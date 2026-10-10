/**
 * The `openfilm` command the chat's agents run: this app's copy of the package, so the Studio it finds is the one in
 * the window, at the version the window runs. A small script in the app's data folder, put first on the agents' PATH;
 * it runs the package's CLI with the app's own Node (Electron as Node). Reads no Electron module.
 *
 * OPENFILM_NO_UPDATE_CHECK: the CLI's "a newer openfilm is out, run npx -y openfilm@latest" is not for this copy. The
 * app updates itself, and with it this command and the window's Studio: there is nothing for an agent to run.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { nodeBinary } from './node-runtime.mjs';

const require = createRequire(import.meta.url);

/** The package's CLI. */
export function openfilmCli() {
  const manifest = require.resolve('openfilm/package.json');
  const bin = JSON.parse(readFileSync(manifest, 'utf8')).bin.openfilm;
  return join(dirname(manifest), bin);
}

const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The script's text: Electron as Node, running the CLI with whatever it was given. */
export function commandScript(node, cli) {
  return `#!/bin/sh\n# OpenFilm's own copy of the openfilm command (written by the app; changes are lost)\nELECTRON_RUN_AS_NODE=1 OPENFILM_NO_UPDATE_CHECK=1 exec ${sq(node)} ${sq(cli)} "$@"\n`;
}

/** The same for Windows: a `.cmd` (what a command line there finds as `openfilm`). */
export function commandScriptWindows(node, cli) {
  return `@echo off\r\nrem OpenFilm's own copy of the openfilm command (written by the app; changes are lost)\r\nset ELECTRON_RUN_AS_NODE=1\r\nset OPENFILM_NO_UPDATE_CHECK=1\r\n"${node}" "${cli}" %*\r\n`;
}

/** Write the command into `<dir>/bin` and answer that folder, for PATH. */
export function installOpenfilmCommand(dir, node = nodeBinary(), platform = process.platform) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  if (platform === 'win32') {
    writeFileSync(join(bin, 'openfilm.cmd'), commandScriptWindows(node, openfilmCli()));
    return bin;
  }
  const file = join(bin, 'openfilm');
  writeFileSync(file, commandScript(node, openfilmCli()));
  chmodSync(file, 0o755);
  return bin;
}
