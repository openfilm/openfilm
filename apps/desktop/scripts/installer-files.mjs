/**
 * The Windows uninstaller removes OpenFilm's program files by name (build/installer.nsh) and leaves everything else in
 * the installation folder where it is. A program file the lists miss would stay behind after every update and
 * uninstall, so the release reads the lists here and compares them with the app it packaged.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The files and folders installer.nsh names, as paths in the installation folder (backslashes, lower case: Windows
 * names do not tell case apart). `exe`: the program's own file, which the script names by a definition.
 * @param {string} nsh @param {string} exe @returns {{ files: string[], folders: string[] }}
 */
export function programFiles(nsh, exe) {
  const names = (/** @type {string} */ macro) => {
    const body = new RegExp(`^!macro ${macro} DO\\r?\\n([\\s\\S]*?)^!macroend`, 'm').exec(nsh)?.[1];
    if (body === undefined) throw new Error(`installer.nsh has no ${macro} macro`);
    return [...body.matchAll(/^[ \t]*!insertmacro \$\{DO\} "([^"]+)"/gm)]
      .map((line) => line[1].replace('${APP_EXECUTABLE_FILENAME}', exe).toLowerCase());
  };
  return { files: names('OpenFilmProgramFiles'), folders: names('OpenFilmProgramFolders') };
}

/**
 * What a packaged app (`dir`, electron-builder's win-unpacked) has that the lists do not cover: files not named, and
 * folders that are neither named nor on the way to something named.
 * @param {string} dir @param {{ files: string[], folders: string[] }} lists @returns {string[]}
 */
export function unlistedProgramFiles(dir, { files, folders }) {
  const leadsToListed = (/** @type {string} */ path) => [...files, ...folders].some((name) => name.startsWith(`${path}\\`));
  /** @type {string[]} */
  const unlisted = [];
  const walk = (/** @type {string} */ at, /** @type {string} */ prefix) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      const key = path.toLowerCase();
      if (!entry.isDirectory()) {
        if (!files.includes(key)) unlisted.push(path);
      } else if (!folders.includes(key)) {
        if (leadsToListed(key)) walk(join(at, entry.name), `${path}\\`);
        else unlisted.push(`${path}\\`);
      }
    }
  };
  walk(dir, '');
  return unlisted;
}
