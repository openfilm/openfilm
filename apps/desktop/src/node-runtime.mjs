/**
 * The Node the app's own Node programs run on: the agents' adapters, OpenFilm's own agent (pi-agent.mjs), an agent's
 * program that is a script (an npm install on Windows), the `openfilm` command the agents run, and what Studio starts
 * (main.mjs tells it this Node as OPENFILM_NODE; the `openfilm` package's node-program.mjs). Reads no Electron module.
 *
 * The installed app brings a Node of its own (scripts/release.mjs puts it in its resources, `runtime/node`, signed to
 * run JavaScript and nothing more). Electron itself never runs as Node there: its RunAsNode fuse is off, so no
 * program on the computer can run code as OpenFilm and use what the person let OpenFilm use (the microphone, the
 * camera). That Node reads no archive: what it runs is unpacked beside app.asar (scripts/node-programs.mjs) and named
 * by its path there (`onDisk`).
 *
 * From source, Electron's development build runs as Node (ELECTRON_RUN_AS_NODE): on macOS its Helper, not the app's
 * main program, which run as Node would still put a second OpenFilm in the Dock. Under Node (the tests), this Node.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** The Node in an installed app's resources (`resources`: process.resourcesPath). */
export const ownNode = (/** @type {string} */ resources, platform = process.platform) => join(resources, 'runtime', 'node', platform === 'win32' ? 'node.exe' : 'node');

/**
 * The Node to start, and what its environment needs to be Node (`env`: ELECTRON_RUN_AS_NODE from source, else none).
 * `packaged`: an installed app (Electron not started on a folder, as `npm start` starts it).
 * @returns {{ command: string, env: Record<string, string> }}
 */
export function nodeRuntime({ execPath = process.execPath, platform = process.platform, electron = Boolean(process.versions.electron),
  packaged = electron && !process.defaultApp, resources = process.resourcesPath } = {}) {
  if (!electron) return { command: execPath, env: {} };
  if (packaged) return { command: ownNode(resources, platform), env: {} };
  if (platform !== 'darwin') return { command: execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  const name = basename(execPath);
  const helper = join(dirname(execPath), '..', 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`);
  return { command: existsSync(helper) ? helper : execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/** A file of the app as its Node reads it: one in app.asar by its path in app.asar.unpacked; any other path as it is. */
export const onDisk = (/** @type {string} */ path) => path.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
