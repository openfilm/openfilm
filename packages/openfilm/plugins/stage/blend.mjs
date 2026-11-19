#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage blend <shot> [--open]`: the shot as a Blender scene of the person's own, `stage/<shot>/blender/shot.blend`,
 * to refine in Blender (lights, materials, anything Blender does). Made from the shot as it is now; once there it is
 * theirs, and never written over: a new one is made only when it is gone.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { UsageError } from '../../src/shared.mjs';
import { findBlender, renderWithBlender } from './blender.mjs';
import { RUN, command, projectHere, shotOf } from './shots.mjs';

const HELP = `${RUN} stage blend <shot> [--open]

  The shot as a Blender scene of your own, stage/<shot>/blender/shot.blend: the set, the figures' moves and the camera,
  to refine in Blender. It is never written over once there; move it away to make it again. --open opens it in Blender.`;

await command(async () => {
  const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, options: { open: { type: 'boolean' }, fps: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
  if (values.help) { console.log(HELP); return; }
  const [what, ...extra] = positionals;
  if (!what || extra.length) throw new UsageError(`say which shot, and only that\n\n${HELP}`);
  const blender = findBlender();
  if (!blender) throw new Error('Blender is not on this computer (or set OPENFILM_BLENDER to where it is)');
  const project = projectHere();
  const shot = shotOf(project, what);
  const mine = join(shot.dir, 'blender', 'shot.blend');
  if (existsSync(mine)) {
    console.log(`kept      ${relative(project, mine).split('\\').join('/')} is there already, yours: it is not made again`);
  } else {
    const { blend } = await renderWithBlender({ project, shot, out: null, fps: Number(values.fps ?? 24), range: null, engine: 'eevee', samples: 32, blender, say: (line) => console.log(line) });
    mkdirSync(join(shot.dir, 'blender'), { recursive: true });
    copyFileSync(blend, mine);
    console.log(`made      ${relative(project, mine).split('\\').join('/')}`);
  }
  if (values.open) spawn(blender, [mine], { detached: true, stdio: 'ignore' }).unref();
}, 'blend');
