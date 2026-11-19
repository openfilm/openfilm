// @ts-check
/**
 * The stage's routes in Studio (studio/server/plugin-servers.mjs): the project's shots for its workbench, when a shot's
 * files last changed (the workbench draws it again then), and "make video": the white box rendered and laid out on
 * the canvas for a video model, with the same commands an agent runs (`openfilm stage render`, `openfilm canvas
 * apply`), so the person's button and the agent do one thing the same way.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyLib } from './shots.mjs';

const OPENFILM = fileURLToPath(new URL('../../bin/openfilm.mjs', import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** The newest change to a shot's files and the project's stage/lib, in ms. @param {string} root @param {string} name */
function changed(root, name) {
  let newest = 0;
  for (const dir of [join(root, 'stage', name), join(root, 'stage', 'lib')]) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) if (/\.(js|html)$/.test(n)) newest = Math.max(newest, statSync(join(dir, n)).mtimeMs);
  }
  /* a set kept beside the shots (stage/<place>.js) is shared by them */
  try { for (const n of readdirSync(join(root, 'stage'))) if (n.endsWith('.js')) newest = Math.max(newest, statSync(join(root, 'stage', n)).mtimeMs); } catch { /* none */ }
  return newest;
}

/** Run `openfilm <args…>` in the project, against this Studio. @param {string} cwd @param {string[]} args @param {string} port */
function run(cwd, args, port) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [OPENFILM, ...args], { cwd, env: { ...process.env, OPENFILM_STUDIO_PORT: port, OPENFILM_PROJECT: cwd }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', fail);
    child.on('close', (code) => (code === 0 ? done(out) : fail(new Error(out.trim().split('\n').slice(-3).join(' · ') || `exit ${code}`))));
  });
}

/** @param {any} studio */
export default (studio) => ({
  'GET /projects/:project/shots': async ({ params }) => {
    const { path } = await studio.project(params.project);
    const dir = join(path, 'stage');
    /* the workbench draws a shot through stage/lib/viewer.html, and shots load models with its addons: a project whose
       shots came before them gets them */
    if (existsSync(dir) && !existsSync(join(dir, 'lib', 'addons', 'loaders', 'GLTFLoader.js'))) copyLib(path);
    let names = [];
    try { names = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'lib' && existsSync(join(dir, e.name, 'index.html'))).map((e) => e.name).sort(); } catch { /* none */ }
    return {
      shots: names.map((name) => {
        const has = (/** @type {string} */ f) => existsSync(join(path, 'assets', 'stage', name, f)) ? `assets/stage/${name}/${f}` : null;
        const note = /^\/\/\s*(.+)$/m.exec((() => { try { return readFileSync(join(dir, name, 'shot.js'), 'utf8'); } catch { return ''; } })())?.[1] ?? '';
        return { name, page: `stage/${name}/index.html`, changed: changed(path, name), whitebox: has('whitebox.mp4'), still: has('still.png'), note };
      }),
    };
  },

  'GET /projects/:project/shots/:shot/changed': async ({ params }) => {
    const { path } = await studio.project(params.project);
    if (!NAME.test(params.shot)) throw new studio.HttpError(400, 'no such shot');
    return { changed: changed(path, params.shot) };
  },

  /* the white box and its first frame rendered, then laid out on the canvas for a video model, in a group of its own */
  'POST /projects/:project/shots/:shot/make': async ({ req, params }) => {
    const { path } = await studio.project(params.project);
    if (!NAME.test(params.shot) || !existsSync(join(path, 'stage', params.shot, 'index.html'))) throw new studio.HttpError(404, 'no such shot');
    const body = /** @type {{ duration?: number, note?: string }} */ (await studio.readJson(req));
    const port = String(req.headers.host ?? '').split(':').pop() || process.env.OPENFILM_STUDIO_PORT || '4747';
    const shot = params.shot;
    studio.emit(path, { shot, making: 'render' });
    await run(path, ['stage', 'render', shot, '--still'], port);
    const group = `stage-${shot}-${Date.now().toString(36)}`;
    const sec = Math.max(1, Math.round(Number(body.duration) || 5));
    const note = (body.note || `stage/${shot}`).slice(0, 500);
    studio.emit(path, { shot, making: 'canvas' });
    await run(path, ['canvas', 'apply', JSON.stringify([
      { op: 'add', kind: 'group', id: group, name: shot },
      { op: 'add', kind: 'note', id: `${group}-note`, text: note, group },
      { op: 'add', kind: 'file', id: `${group}-box`, path: `assets/stage/${shot}/whitebox.mp4`, group },
      { op: 'add', kind: 'file', id: `${group}-still`, path: `assets/stage/${shot}/still.png`, group },
      { op: 'add', kind: 'image', id: `${group}-look`, prompt: 'The same framing, layout and poses as the picture, as a photograph of the real place, filling the whole frame', inputs: [`${group}-note`, `${group}-still`], group },
      { op: 'add', kind: 'video', id: `${group}-video`, prompt: 'Follow the reference video for the camera and the movement', opts: { mode: 'omni', sec }, inputs: [`${group}-note`, `${group}-look`, `${group}-box`], group },
    ])], port);
    studio.emit(path, { shot, making: null });
    return { group, link: `.film/canvas.json#${group}` };
  },
});
