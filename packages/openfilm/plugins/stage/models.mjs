#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage models [name…]`: the models that come with the stage (models/, CC0), listed; or the ones named copied
 * into the project's `assets/models/`, where a shot places them from (a film needs only the project's files).
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../../src/shared.mjs';
import { PLUGIN, RUN, command, projectHere } from './shots.mjs';

const HELP = `${RUN} stage models [name…]

  The models that come with the stage, free to use (CC0): actor (a rigged mannequin with animations) and furniture.
  No name: their names. Names: copied into assets/models/ (actor.glb, furniture as <name>.glb), to place in a shot.`;

/** Every model, name → its file in the plugin. */
function catalog() {
  /** @type {Map<string, string>} */
  const all = new Map([['actor', join(PLUGIN, 'models', 'actor.glb')]]);
  for (const f of readdirSync(join(PLUGIN, 'models', 'furniture')).sort()) if (f.endsWith('.glb')) all.set(f.slice(0, -4), join(PLUGIN, 'models', 'furniture', f));
  return all;
}

await command(() => {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log(HELP); return; }
  const all = catalog();
  if (!positionals.length) {
    console.log('actor      a rigged mannequin, 1.83 m; its animations: openfilm stage models actor, then character(…).clips');
    console.log(`furniture  ${[...all.keys()].filter((n) => n !== 'actor').join(', ')}`);
    console.log('           in meters, standing on the floor, facing +z');
    return;
  }
  const unknown = positionals.filter((n) => !all.has(n));
  if (unknown.length) throw new UsageError(`no model ${unknown.join(', ')}: ${RUN} stage models lists them`);
  const project = projectHere();
  const dir = join(project, 'assets', 'models');
  mkdirSync(dir, { recursive: true });
  for (const name of positionals) {
    const to = join(dir, `${name}.glb`);
    if (existsSync(to)) { console.log(`kept      assets/models/${name}.glb is there already`); continue; }
    copyFileSync(/** @type {string} */ (all.get(name)), to);
    console.log(`copied    assets/models/${name}.glb`);
  }
}, 'models');
