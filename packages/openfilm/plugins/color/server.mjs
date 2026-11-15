// @ts-check
/**
 * The color workbench's server code (studio/server/plugin-servers.mjs): Studio answers these under
 * `/api/plugins/color/…` while the plugin is on. They read and write what `openfilm color` does (project.mjs), so the
 * workbench, an agent and the person at the command line change the same grades.
 *
 *   GET  projects/:project/clips               the film's video clips, each with its grade, where it plays and its file
 *   PUT  projects/:project/clips/:clip         { grade }: the clip graded (its LUT written, its style naming it)
 *   GET  projects/:project/clips/:clip/frame   ?s=<file second>&box=<px>: a picture of its footage, its longer side
 *                                             that long, 16-bit RGB as is
 *                                             (`&graded=1`: as it plays, through its LUTs)
 *   POST projects/:project/clips/:clip/auto    a grade balanced from its pictures (not written)
 *   POST projects/:project/clips/:clip/match   { to }: a grade matched to another clip's (not written)
 *   GET  projects/:project/luts                the project's .cube files a grade may name (not the workbench's own)
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FILM_FILE, lutsOf } from '../../src/film-doc.mjs';
import { fileOf } from '../../src/shared.mjs';
import { EditError } from '../../studio/server/film.mjs';
import { balance, match, picturesOf } from './balance.mjs';
import { LOOKS, clipOf, filmOf, gradeOf, inProject, lutsOfGrade, rawFrameOf, timingOf, videoClips, writeGrade } from './project.mjs';

/** The widest picture the workbench asks for. */
const MAX_WIDTH = 1920;
/** Folders not looked in for LUTs: what is the project's own machinery, or other programs'. */
const SKIP = new Set(['.film', 'node_modules', '.git']);

/** @param {import('../../studio/server/plugin-servers.mjs').PluginStudio} studio */
export default (studio) => {
  const { HttpError, readJson } = studio;
  const rootOf = async (/** @type {string} */ id) => (await studio.project(id)).path;
  /** A clip of the film, or 404. @param {string} root @param {string} id */
  const clipAt = async (root, id) => {
    const film = await filmOf(root).catch((e) => { throw new HttpError(409, e.message); });
    try { return { film, clip: clipOf(film.value, id) }; } catch (e) { throw new HttpError(404, /** @type {Error} */ (e).message); }
  };

  /** @type {Record<string, import('../../studio/server/plugin-servers.mjs').PluginHandler>} */
  const routes = {
    'GET /projects/:project/clips': async ({ params }) => {
      const root = await rootOf(params.project);
      const film = await filmOf(root).catch((e) => { throw new HttpError(409, e.message); });
      const clips = await Promise.all(videoClips(film.value).map(async ({ clip, track }) => {
        const { grade, lut, others, file, auto } = await gradeOf(root, clip);
        const t = timingOf(clip);
        return {
          id: clip.id, src: clip.src, file: inProject(root, file), track, at: t.at, end: t.end,
          from: clip.time?.[0] ?? 0, to: clip.time?.[1] ?? null, speed: clip.speed ?? 1,
          graded: Boolean(lut), lut, others, grade, auto,
        };
      }));
      return { rev: film.rev, clips };
    },

    'PUT /projects/:project/clips/:clip': async ({ req, params }) => {
      const root = await rootOf(params.project);
      const body = /** @type {{ grade?: unknown }} */ (await readJson(req));
      if (!body || typeof body.grade !== 'object') throw new HttpError(400, 'say the grade: { "grade": { … } }');
      await clipAt(root, params.clip);
      try {
        const done = await writeGrade(root, params.clip, body.grade);
        const { grade } = await gradeOf(root, (await clipAt(root, params.clip)).clip);
        studio.emit(root, { type: 'graded', clip: params.clip, lut: done.lut });
        return { ...done, grade };
      } catch (e) {
        if (e instanceof EditError) throw new HttpError(409, e.message);
        throw new HttpError(400, e instanceof Error ? e.message : String(e));
      }
    },

    'GET /projects/:project/clips/:clip/frame': async ({ res, params, url }) => {
      const root = await rootOf(params.project);
      const { clip } = await clipAt(root, params.clip);
      const { file, lut, others } = await gradeOf(root, clip);
      const s = Number(url.searchParams.get('s') ?? clip.time?.[0] ?? 0);
      const luts = url.searchParams.get('graded') === '1' ? [lut, ...others].filter((u) => u !== null).map((u) => fileOf(root, FILM_FILE, /** @type {string} */ (u))) : [];
      const w = Math.min(MAX_WIDTH, Math.max(16, Math.round(Number(url.searchParams.get('box') ?? url.searchParams.get('w') ?? 960) / 2) * 2));
      const box = url.searchParams.has('box');
      if (!Number.isFinite(s) || !Number.isFinite(w)) throw new HttpError(400, 'say the second (s) and the width (w) as numbers');
      let frame;
      try { frame = await rawFrameOf(file, s, box ? { box: w, luts } : { width: w, luts }); } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
      res.writeHead(200, {
        'content-type': 'application/octet-stream', 'content-length': frame.raw.length, 'cache-control': 'no-store',
        'x-width': String(frame.w), 'x-height': String(frame.h), 'access-control-expose-headers': 'x-width, x-height',
      });
      res.end(frame.raw);
      return undefined;
    },

    'POST /projects/:project/clips/:clip/auto': async ({ req, params }) => {
      const root = await rootOf(params.project);
      const { clip } = await clipAt(root, params.clip);
      const body = /** @type {{ grade?: unknown }} */ (await readJson(req).catch(() => ({})));
      const { grade } = await gradeOf(root, clip);
      const from = body?.grade && typeof body.grade === 'object' ? /** @type {import('./engine/grade.mjs').Grade} */ ({ ...grade, ...body.grade }) : grade;
      try {
        return balance(await picturesOf(root, clip), from, lutsOfGrade(root, from));
      } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
    },

    'POST /projects/:project/clips/:clip/match': async ({ req, params }) => {
      const root = await rootOf(params.project);
      const body = /** @type {{ to?: string, grade?: unknown }} */ (await readJson(req));
      if (!body?.to) throw new HttpError(400, 'say which clip to match: { "to": "<clip id>" }');
      const [{ clip }, { clip: to }] = await Promise.all([clipAt(root, params.clip), clipAt(root, body.to)]);
      const [{ grade }, { grade: toGrade }] = await Promise.all([gradeOf(root, clip), gradeOf(root, to)]);
      const from = body.grade && typeof body.grade === 'object' ? /** @type {import('./engine/grade.mjs').Grade} */ ({ ...grade, ...body.grade }) : grade;
      try {
        const [rgb, toRgb] = await Promise.all([picturesOf(root, clip), picturesOf(root, to)]);
        return match(rgb, from, toRgb, toGrade, { luts: lutsOfGrade(root, from), toLuts: lutsOfGrade(root, toGrade) });
      } catch (e) { throw new HttpError(422, e instanceof Error ? e.message : String(e)); }
    },

    'GET /projects/:project/luts': async ({ params }) => {
      const root = await rootOf(params.project);
      /** @type {string[]} */
      const found = [];
      const walk = async (/** @type {string} */ dir, /** @type {number} */ depth) => {
        if (depth > 6 || found.length >= 500) return;
        let entries;
        try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.') && e.name !== '.') { if (SKIP.has(e.name)) continue; }
          const path = join(dir, e.name);
          if (e.isDirectory()) { if (!SKIP.has(e.name)) await walk(path, depth + 1); }
          else if (/\.cube$/i.test(e.name)) {
            const rel = inProject(root, path);
            if (!rel.startsWith(`${LOOKS}/`)) found.push(rel);
          }
        }
      };
      await walk(root, 0);
      /* the LUTs the film's clips name, though they are kept elsewhere (a link) */
      const film = await filmOf(root).catch(() => null);
      for (const { clip } of film ? videoClips(film.value) : []) {
        for (const u of lutsOf(clip)) if (!u.startsWith(`${LOOKS}/`) && !found.includes(u)) { try { fileOf(root, FILM_FILE, u); found.push(u); } catch { /* not readable */ } }
      }
      return { luts: found.sort() };
    },
  };
  return routes;
};
