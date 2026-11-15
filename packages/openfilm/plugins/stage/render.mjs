#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage render <shot> [a-b] [--depth] [--pose] [--still]`: the shot as a video, `stage/<shot>/whitebox.mp4`
 * (a stretch: `whitebox-<a>-<b>.mp4`), drawn by OpenFilm's own page render, which draws WebGL on the graphics chip;
 * with its depth and its figures' poses as videos beside it (passes.mjs), and its first frame as a picture.
 */
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '../../src/render.mjs';
import { UsageError } from '../../src/shared.mjs';
import { launch, serve } from '../../src/host.mjs';
import { passPage } from './passes.mjs';
import { RUN, command, projectHere, shotOf } from './shots.mjs';

const HELP = `${RUN} stage render <shot> [a-b] [--depth] [--pose] [--still] [--fps 24]

  The shot as a video: stage/<shot>/whitebox.mp4, 1920 × 1080; a stretch (0-5) is stage/<shot>/whitebox-0-5.mp4.
  This is the white box a video model is given as its reference for the camera and the movement.
  --depth   also depth.mp4: white near, black far, its range fitted to the shot
  --pose    also pose.mp4: each figure's pose as OpenPose draws it, on black
  --still   also still.png: the first frame, 1920 × 1080 (for a picture model to restyle, keeping the framing)`;

await command(async () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: {
      fps: { type: 'string' }, depth: { type: 'boolean' }, pose: { type: 'boolean' }, still: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
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
  const suffix = range ? `-${range[0]}-${range[1]}` : '';
  const span = range ? [`${range[0]}-${range[1]}`] : [];
  const length = range ? ` · ${range[1] - range[0]} s of it` : ' · the whole shot';
  const said = (/** @type {string} */ out, /** @type {number} */ started) =>
    `rendered  [${shot.name}](${relative(project, out).split('\\').join('/')})${length} · drawn in ${((Date.now() - started) / 1000).toFixed(1)} s`;
  let software = false;
  for (const [pass, name] of /** @type {[string, string][]} */ ([['beauty', 'whitebox'], ['depth', 'depth'], ['pose', 'pose']])) {
    if (pass !== 'beauty' && !values[pass]) continue;
    const out = join(shot.dir, `${name}${suffix}.mp4`);
    const page = pass === 'beauty' ? shot.page : passPage(project, shot, pass);
    const started = Date.now();
    await render([page, ...span], { out, fps, root: project, onSoftware: () => { software = true; } });
    console.log(said(out, started));
  }
  if (values.still) {
    const out = join(shot.dir, `still${suffix}.png`);
    const started = Date.now();
    await still(project, shot.entry, range ? range[0] : 0, out);
    console.log(`drew      [${shot.name} at ${range ? range[0] : 0} s](${relative(project, out).split('\\').join('/')}) · in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
  if (software) console.log('! WebGL was drawn without the graphics chip here: slower, the same picture');
}, 'render');

/** One frame of a shot as a picture, 1920 × 1080. @param {string} project @param {string} entry @param {number} t @param {string} out */
async function still(project, entry, t, out) {
  const site = await serve(project);
  const browser = await launch();
  try {
    const tab = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await tab.goto(`${site.url}/${entry}`);
    await tab.waitForFunction(() => /** @type {any} */ (window).film?.frame, null, { timeout: 20_000 });
    const png = await tab.evaluate((at) => {
      const film = /** @type {any} */ (window).film;
      film.frame(Math.min(at, film.duration - 1 / 24));
      return /** @type {HTMLCanvasElement} */ (document.querySelector('canvas')).toDataURL('image/png');
    }, t);
    writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  } finally {
    await browser.close();
    await site.close();
  }
}
