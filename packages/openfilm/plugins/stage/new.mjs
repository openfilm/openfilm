#!/usr/bin/env node
// @ts-check
/** `openfilm stage new <name>`: a new shot, `stage/<name>/` with its page and a shot.js to rewrite. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../../src/shared.mjs';
import { NAME, PLUGIN, RUN, command, copyLib, projectHere } from './shots.mjs';

const HELP = `${RUN} stage new <name>

  A new shot in stage/<name>/: index.html (the page, a page of a film) and shot.js (the set, the figures and the
  camera, each a function of t), a working example to rewrite. stage/lib/ (three.js, stage.js, mannequin.js) is
  copied in the first time. <name>: lowercase letters, digits and dashes (s1, door-entrance).`;

await command(() => {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log(HELP); return; }
  const [name, ...extra] = positionals;
  if (!name || extra.length) throw new UsageError(`say the shot's name, and only that\n\n${HELP}`);
  if (!NAME.test(name) || name === 'lib') throw new UsageError(`${name}: a shot's name is lowercase letters, digits and dashes, not "lib"`);
  const project = projectHere();
  const dir = join(project, 'stage', name);
  if (existsSync(dir)) throw new Error(`stage/${name} is there already: change its shot.js, or pick another name`);
  const copied = copyLib(project);
  mkdirSync(dir, { recursive: true });
  for (const file of ['index.html', 'shot.js']) writeFileSync(join(dir, file), readFileSync(join(PLUGIN, 'template', file)));
  for (const file of copied) console.log(`copied  ${file}`);
  console.log(`made    [${name}](stage/${name}/index.html)  stage/${name}/shot.js`);
  console.log(`next    rewrite stage/${name}/shot.js, then ${RUN} stage look ${name}`);
}, 'new');
