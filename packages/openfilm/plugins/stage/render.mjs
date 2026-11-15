#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage render <shot> [a-b]`: the shot as a video, `stage/<shot>/whitebox.mp4` (a stretch:
 * `whitebox-<a>-<b>.mp4`), drawn by OpenFilm's own page render, which draws WebGL on the graphics chip.
 */
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '../../src/render.mjs';
import { UsageError } from '../../src/shared.mjs';
import { RUN, command, projectHere, shotOf } from './shots.mjs';

const HELP = `${RUN} stage render <shot> [a-b] [--fps 24]

  The shot as a video: stage/<shot>/whitebox.mp4, 1920 × 1080; a stretch (0-5) is stage/<shot>/whitebox-0-5.mp4.
  This is the white box a video model is given as its reference for the camera and the movement.`;

await command(async () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: { fps: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) { console.log(HELP); return; }
  /* the shot, and a stretch (a-b) or by mistake one moment, in any order */
  let what = null, at = null, range = null;
  for (const word of positionals) {
    const stretch = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(word);
    if (stretch) range = [Number(stretch[1]), Number(stretch[2])];
    else if (/^\d+(\.\d+)?$/.test(word)) at = Number(word);
    else what = word;
  }
  if (range && !(range[1] > range[0])) throw new UsageError(`${range[0]}-${range[1]}: the end comes after the start`);
  if (!what) throw new UsageError(`say which shot\n\n${HELP}`);
  if (at != null) throw new UsageError(`render takes a stretch (for example ${at}-${at + 2}), not one moment: for one moment, ${RUN} stage look ${what} ${at}`);
  const fps = Number(values.fps ?? 24);
  if (!(fps > 0 && fps <= 120)) throw new UsageError('--fps is a number of frames a second, 1 to 120');
  const project = projectHere();
  const shot = shotOf(project, what);
  const out = join(shot.dir, range ? `whitebox-${range[0]}-${range[1]}.mp4` : 'whitebox.mp4');
  const started = Date.now();
  let software = false;
  await render([shot.page, ...(range ? [`${range[0]}-${range[1]}`] : [])], {
    out, fps, root: project, onSoftware: () => { software = true; },
  });
  const path = relative(project, out).split('\\').join('/');
  const length = range ? range[1] - range[0] : null;
  console.log(`rendered  [${shot.name}](${path})${length != null ? ` · ${length} s of it` : ' · the whole shot'} · drawn in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (software) console.log('! WebGL was drawn without the graphics chip here: slower, the same picture');
}, 'render');
