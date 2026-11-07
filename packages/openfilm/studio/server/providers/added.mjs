// @ts-check
/**
 * Services the person (or their agent) added themselves, beside the built-in ones: a folder each in
 * `<shared home>/providers/<folder>/`, whose `provider.mjs` default-exports a Provider (contract.mjs) the way the
 * built-in ones do. Once its key is added in Settings → Services it makes media like any other: on the canvas, in
 * Settings, with `openfilm get --via <id>`. Each is read when Studio asks what there is, and read again when its file
 * changes; one that cannot be read, or takes a built-in service's id, is left out, and why is kept (`addedProblems`).
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sharedHome } from '../../../src/locations.mjs';

/** @typedef {import('./contract.mjs').Provider} Provider */

/** Where the added services are: a folder each. */
export const addedDir = () => join(sharedHome(), 'providers');

/** each provider.mjs read, by its path: as it was when last changed */
const read = /** @type {Map<string, { changed: number, provider: Provider }>} */ (new Map());
/** why a folder's service was left out, by the folder's name */
export const addedProblems = /** @type {Map<string, string>} */ (new Map());

/**
 * The services added in `addedDir()`, by their folders' names; `taken`: the built-in services' ids, which none may take.
 * @param {ReadonlySet<string>} taken @returns {Promise<Provider[]>}
 */
export async function addedProviders(taken) {
  /** @type {string[]} */
  let folders = [];
  try {
    folders = (await readdir(addedDir(), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch { /* none added */ }
  addedProblems.clear();
  /** @type {Provider[]} */
  const added = [];
  for (const folder of folders) {
    const file = join(addedDir(), folder, 'provider.mjs');
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    try {
      let kept = read.get(file);
      if (!kept || kept.changed !== info.mtimeMs) {
        /* a changed file is a new module: its address carries when it changed */
        const module = await import(`${pathToFileURL(file).href}?changed=${info.mtimeMs}`);
        kept = { changed: info.mtimeMs, provider: checked(module.default) };
        read.set(file, kept);
      }
      if (taken.has(kept.provider.id) || added.some((p) => p.id === kept.provider.id)) throw new Error(`its id "${kept.provider.id}" is another service's`);
      added.push(kept.provider);
    } catch (e) {
      addedProblems.set(folder, e instanceof Error ? e.message : String(e));
    }
  }
  return added;
}

/** A module's default export as a Provider, or why it is not one. @param {unknown} value @returns {Provider} */
function checked(value) {
  const p = /** @type {Record<string, unknown>} */ (value && typeof value === 'object' ? value : {});
  if (!value || typeof value !== 'object') throw new Error('provider.mjs has no default export');
  for (const field of ['id', 'name', 'env']) if (typeof p[field] !== 'string' || !p[field]) throw new Error(`its "${field}" is missing`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(/** @type {string} */ (p.id))) throw new Error('its "id" is lowercase letters, digits and dashes');
  if (!Array.isArray(p.verbs) || !p.verbs.length) throw new Error('its "verbs" are missing');
  if (typeof p.run !== 'function') throw new Error('its "run" is missing');
  return /** @type {Provider} */ ({ keysUrl: '', billingUrl: '', ...p, added: true });
}
