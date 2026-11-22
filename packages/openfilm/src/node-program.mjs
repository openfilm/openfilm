// @ts-check
/**
 * How OpenFilm starts a Node program of its own from this process (a model's download or run, a plugin's program, and
 * the `node` and `openfilm` that program finds on its PATH): `command` is the program, `env` its environment, and
 * `file(path)` a script's path as that Node reads it.
 *
 * Under Node, this Node. In the desktop app Studio runs on Electron (a utility process), whose program is the app
 * itself, and the installed app never runs as Node: its RunAsNode fuse is off, so that no program on the computer can
 * run code as OpenFilm and use what the person let OpenFilm use (the microphone, the camera). It brings a Node of its
 * own instead and names it in OPENFILM_NODE. That Node reads no archive: a script inside the app's app.asar is read
 * where the app unpacked it, in app.asar.unpacked. Run from source, the app names none, and Electron runs as Node
 * (ELECTRON_RUN_AS_NODE), which its development build allows.
 *
 * @param {NodeJS.ProcessEnv} [env] the environment to start from (this process's)
 * @returns {{ command: string, env: NodeJS.ProcessEnv, file: (path: string) => string }}
 */
export function nodeProgram(env = process.env) {
  const own = { ...env };
  delete own.ELECTRON_RUN_AS_NODE;
  if (!process.versions.electron) return { command: process.execPath, env: own, file: (path) => path };
  if (env.OPENFILM_NODE) return { command: env.OPENFILM_NODE, env: own, file: unpacked };
  return { command: process.execPath, env: { ...own, ELECTRON_RUN_AS_NODE: '1' }, file: (path) => path };
}

/** A file in an app's app.asar by its path in app.asar.unpacked, where the app put what its Node runs; any other path as it is. */
export const unpacked = (/** @type {string} */ path) => path.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked');
