#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage render <shot> [a-b] [--depth] [--pose] [--still]`: the shot as a video, `assets/stage/<shot>/whitebox.mp4`
 * (a stretch: `whitebox-<a>-<b>.mp4`), drawn by OpenFilm's own page render, which draws WebGL on the graphics chip;
 * with its depth and its figures' poses as videos beside it (passes.mjs), and its first frame as a picture.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { render } from '../../src/render.mjs';
import { UsageError } from '../../src/shared.mjs';
import { launch, serve } from '../../src/host.mjs';
import { blenderVersion, findBlender, renderWithBlender } from './blender.mjs';
import { passPage } from './passes.mjs';
import { RUN, command, projectHere, shotOf } from './shots.mjs';

const HELP = `${RUN} stage render <shot> [a-b] [--depth] [--pose] [--still] [--fps 24] [--engine blender [--cycles] [--samples n]]

  The shot as a video: assets/stage/<shot>/whitebox.mp4, 1920 × 1080 (in the project's media, for the canvas and
  the edit); a stretch (0-5) is whitebox-0-5.mp4 beside it.
  This is the white box a video model is given as its reference for the camera and the movement.
  --depth   also depth.mp4: white near, black far, its range fitted to the shot
  --pose    also pose.mp4: each figure's pose as OpenPose draws it, on black
  --still   also still.png: the first frame, 1920 × 1080 (for a picture model to restyle, keeping the framing)
  --engine blender   the white box drawn by Blender, when it is on this computer: real bounce light and soft
            shadows, slower (EEVEE about a second a frame; --cycles path-traced, much slower; --samples, 32 or 128).
            The scene is kept as .film/cache/stage/<shot>/blender/shot.blend; ${RUN} stage blend <shot> gives you a
            copy of your own to open in Blender.`;

await command(async () => {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: {
      fps: { type: 'string' }, depth: { type: 'boolean' }, pose: { type: 'boolean' }, still: { type: 'boolean' },
      engine: { type: 'string' }, cycles: { type: 'boolean' }, samples: { type: 'string' },
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
  if (values.engine && values.engine !== 'blender' && values.engine !== 'three') throw new UsageError(`--engine is blender (or three, the default)`);
  if ((values.cycles || values.samples) && values.engine !== 'blender') throw new UsageError('--cycles and --samples go with --engine blender');
  if (values.samples && !(Number(values.samples) >= 1 && Number(values.samples) <= 4096)) throw new UsageError('--samples is a number from 1 to 4096');
  const blender = values.engine === 'blender' ? findBlender() : null;
  if (values.engine === 'blender' && !blender) throw new Error('Blender is not on this computer (or set OPENFILM_BLENDER to where it is): the white box is drawn in the browser without it');
  if (blender && !blenderVersion(blender)) throw new Error(`${blender} did not say it is Blender`);
  const project = projectHere();
  const shot = shotOf(project, what);
  /* what is rendered is the project's media: the library, the canvas and the edit see it there */
  const media = join(project, 'assets', 'stage', shot.name);
  mkdirSync(media, { recursive: true });
  const suffix = range ? `-${range[0]}-${range[1]}` : '';
  const span = range ? [`${range[0]}-${range[1]}`] : [];
  const length = range ? ` · ${range[1] - range[0]} s of it` : ' · the whole shot';
  const said = (/** @type {string} */ out, /** @type {number} */ started) =>
    `rendered  [${shot.name}](${relative(project, out).split('\\').join('/')})${length} · drawn in ${((Date.now() - started) / 1000).toFixed(1)} s`;
  let software = false;
  for (const [pass, name] of /** @type {[string, string][]} */ ([['beauty', 'whitebox'], ['depth', 'depth'], ['pose', 'pose']])) {
    if (pass !== 'beauty' && !values[pass]) continue;
    const out = join(media, `${name}${suffix}.mp4`);
    const started = Date.now();
    if (pass === 'beauty' && blender) {
      const { blend } = await renderWithBlender({
        project, shot, out, fps, range: /** @type {[number, number] | null} */ (range), engine: values.cycles ? 'cycles' : 'eevee',
        samples: Number(values.samples ?? (values.cycles ? 64 : 32)), blender, say: (line) => console.log(line),
      });
      console.log(`${said(out, started)} · by Blender (${values.cycles ? 'Cycles' : 'EEVEE'})`);
      console.log(`          the scene: ${relative(project, blend).split('\\').join('/')}`);
      continue;
    }
    const page = pass === 'beauty' ? shot.page : passPage(project, shot, pass);
    await render([page, ...span], { out, fps, root: project, onSoftware: () => { software = true; } });
    console.log(said(out, started));
  }
  if (values.still) {
    const out = join(media, `still${suffix}.png`);
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
    const png = await tab.evaluate(async (at) => {
      const film = /** @type {any} */ (window).film;
      await (typeof film.ready === 'function' ? film.ready() : film.ready);
      film.frame(Math.min(at, film.duration - 1 / 24));
      return /** @type {HTMLCanvasElement} */ (document.querySelector('canvas')).toDataURL('image/png');
    }, t);
    writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
  } finally {
    await browser.close();
    await site.close();
  }
}
