// @ts-check
/**
 * The color workbench's server code (studio/server/plugin-servers.mjs): Studio answers these under
 * `/api/plugins/color/…` while the plugin is on. They only read and work out; what changes is written by the workbench
 * itself, as files and film.html in one step of the edit's undo (studio/ui lib/color-files), so the person, an agent
 * and the workbench always work on the same files.
 *
 *   GET  projects/:project/frame ?src=<file>&s=<second>&box=<px>   a picture of a video file at its own depth: 16-bit
 *                                         RGB as it is, its longer side `box` long (headers x-width, x-height)
 *   GET  projects/:project/footage ?src=<file>   what the file says it is: { kind: 'hlg' | 'pq' | null, full }
 *   GET  transforms/:name                 one of OpenFilm's color transforms (src/color/transforms), as text
 *   GET  projects/:project/input ?src=<file>&kind=<kind>   the input file for footage of that kind (the variant for
 *                                         a full-range file when it has one): { path, text }
 *   POST projects/:project/clips/:clip/balance          { path, text, chain, before, after }: its balance worked out
 *   POST projects/:project/clips/:clip/match  { to }    the same, matched to another clip or a picture
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILM_FILE, srcHref } from '../../src/film-doc.mjs';
import { fileOf } from '../../src/shared.mjs';
import { facts, filmOf, gradedClips, INPUTS, planBalance, planMatch, referenceOf, TRANSFORMS } from './grade.mjs';

/** The longest side of a picture the workbench asks for. */
const MAX_BOX = 1920;

/** @param {import('../../studio/server/plugin-servers.mjs').PluginStudio} studio */
export default (studio) => {
  const { HttpError, readJson } = studio;
  const rootOf = async (/** @type {string} */ id) => (await studio.project(id)).path;
  /** A file of the project by its path from film.html, or 400. @param {string} root @param {string | null} src */
  const fileAt = (root, src) => {
    if (!src) throw new HttpError(400, 'say the file: ?src=<path>');
    try { return fileOf(root, FILM_FILE, srcHref(src)); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : String(e)); }
  };
  /** A clip of the film with a picture to grade (a video, a page, a still), or 404. @param {string} root @param {string} id */
  const clipAt = async (root, id) => {
    const film = await filmOf(root).catch((e) => { throw new HttpError(409, e.message); });
    const all = gradedClips(film.value);
    const clip = all.find((c) => c.id === id);
    if (!clip) throw new HttpError(404, `there is no clip with a picture ${id}`);
    return { clip, all };
  };
  /** What the workbench is told of a change worked out. @param {Awaited<ReturnType<typeof planBalance>>} done */
  const said = (done) => ({
    path: done.own.url, text: done.text, chain: done.chain,
    before: { middle: done.before.luma.median, kelvin: done.before.white.kelvin },
    after: { middle: done.after.luma.median, kelvin: done.after.white.kelvin },
  });

  /** @type {Record<string, import('../../studio/server/plugin-servers.mjs').PluginHandler>} */
  const routes = {
    'GET /projects/:project/frame': async ({ res, params, url }) => {
      const root = await rootOf(params.project);
      const file = fileAt(root, url.searchParams.get('src'));
      const s = Number(url.searchParams.get('s') ?? 0);
      const box = Math.min(MAX_BOX, Math.max(16, Number(url.searchParams.get('box') ?? 512)));
      if (!Number.isFinite(s) || !Number.isFinite(box)) throw new HttpError(400, 'say the second (s) and the size (box) as numbers');
      let frame;
      try { frame = await rawFrame(file, s, box); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
      res.writeHead(200, {
        'content-type': 'application/octet-stream', 'content-length': frame.raw.length, 'cache-control': 'no-store',
        'x-width': String(frame.w), 'x-height': String(frame.h), 'access-control-expose-headers': 'x-width, x-height',
      });
      res.end(frame.raw);
      return undefined;
    },

    'GET /projects/:project/footage': async ({ params, url }) => {
      const root = await rootOf(params.project);
      const f = await facts(fileAt(root, url.searchParams.get('src'))).catch(() => null);
      return { kind: f?.transfer === 'arib-std-b67' ? 'hlg' : f?.transfer === 'smpte2084' ? 'pq' : null, full: Boolean(f?.full) };
    },

    'GET /transforms/:name': async ({ params }) => {
      if (!/^(in|out)-[\w.-]+\.ctf$/.test(params.name)) throw new HttpError(400, 'one of OpenFilm\'s transforms, please');
      const at = join(TRANSFORMS, params.name);
      if (!existsSync(at)) throw new HttpError(404, `${params.name}: no such transform`);
      return { text: readFileSync(at, 'utf8') };
    },

    'GET /projects/:project/input': async ({ params, url }) => {
      const root = await rootOf(params.project);
      const spec = INPUTS[url.searchParams.get('kind') ?? ''];
      if (!spec) throw new HttpError(400, `one of: ${Object.keys(INPUTS).join(', ')}`);
      const f = await facts(fileAt(root, url.searchParams.get('src'))).catch(() => null);
      const name = spec.cv && f?.full ? spec.file.replace(/\.ctf$/, '-full.ctf') : spec.file;
      return { path: `looks/${name}`, text: readFileSync(join(TRANSFORMS, name), 'utf8') };
    },

    'POST /projects/:project/clips/:clip/balance': async ({ params }) => {
      const root = await rootOf(params.project);
      const { clip } = await clipAt(root, params.clip);
      try { return said(await planBalance(root, clip)); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
    },

    'POST /projects/:project/clips/:clip/match': async ({ req, params }) => {
      const root = await rootOf(params.project);
      const body = /** @type {{ to?: string }} */ (await readJson(req));
      if (!body?.to) throw new HttpError(400, 'say what to match: { "to": "<clip id or picture>" }');
      const { clip, all } = await clipAt(root, params.clip);
      try { return said(await planMatch(root, clip, await referenceOf(root, all, body.to))); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
    },
  };
  return routes;
};

/**
 * A picture of a video file at `seconds`, its longer side `box` long, as ffmpeg reads it for a graded copy: 16-bit RGB,
 * little-endian, three values a pixel, rows from the top. @param {string} file @param {number} seconds @param {number} box
 * @returns {Promise<{ w: number, h: number, raw: Buffer }>}
 */
async function rawFrame(file, seconds, box) {
  const even = (/** @type {number} */ n) => Math.max(2, Math.round(n / 2) * 2);
  const [fw, fh] = await shapeOf(file);
  const k = even(box) / Math.max(fw, fh);
  const w = even(fw * k), h = even(fh * k);
  const raw = await new Promise((done, fail) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-ss', String(Math.max(0, seconds)), '-i', file, '-frames:v', '1',
      '-vf', `scale=w=${w}:h=${h}:in_color_matrix=auto:in_range=auto:flags=area,format=rgb48le`, '-f', 'rawvideo', 'pipe:1'], { windowsHide: true });
    /** @type {Buffer[]} */
    const out = [];
    let err = '';
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => fail(new Error(`ffmpeg: ${/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT' ? 'not found on the PATH' : e.message}`)));
    p.on('close', (code) => (code === 0 ? done(Buffer.concat(out)) : fail(new Error(`ffmpeg: ${err.trim().split('\n').pop() || `exit ${code}`}`))));
  });
  if (raw.length !== w * h * 6) throw new Error(`no picture at ${seconds.toFixed(2)} s`);
  return { w, h, raw };
}

/** A video's width and height as it is shown (turned as its rotation says). @param {string} file @returns {Promise<[number, number]>} */
function shapeOf(file) {
  return new Promise((done) => {
    const p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation', '-of', 'json', file], { windowsHide: true });
    let s = '';
    p.stdout.on('data', (d) => { s += d; });
    p.on('error', () => done([16, 9]));
    p.on('close', () => {
      try {
        const st = JSON.parse(s).streams?.[0] ?? {};
        const turned = Math.abs(Number(st.side_data_list?.[0]?.rotation ?? 0)) % 180 === 90;
        const w = Number(st.width) || 16, h = Number(st.height) || 9;
        done(turned ? [h, w] : [w, h]);
      } catch { done([16, 9]); }
    });
  });
}
