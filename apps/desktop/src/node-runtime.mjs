/**
 * The Node the app's own scripts run with (the `openfilm` command, the agents' adapters): Electron itself, as Node
 * (ELECTRON_RUN_AS_NODE). On macOS its Helper, not the app's main program: the main program run as Node would still
 * put a second OpenFilm in the Dock. Reads no Electron module.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function nodeBinary(execPath = process.execPath, platform = process.platform) {
  if (!process.versions.electron || platform !== 'darwin') return execPath;
  const name = basename(execPath);
  const helper = join(dirname(execPath), '..', 'Frameworks', `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`);
  return existsSync(helper) ? helper : execPath;
}
