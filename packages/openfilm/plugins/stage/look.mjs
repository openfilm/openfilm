#!/usr/bin/env node
// @ts-check
/**
 * `openfilm stage look [shot] [t | a-b] [--json]`: a shot as an agent checks it. Frames from the camera, a view from
 * above with the paths of the figures and the camera, where each figure and the camera are at those moments, and what
 * is wrong over the whole length: the camera inside something, a figure walking through something, a figure out of
 * frame or hidden. The look convention (src/plugin-look.mjs): lines, or JSON; pictures under .film/look/stage/.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, serve } from '../../src/host.mjs';
import { runLook } from '../../src/plugin-look.mjs';
import { lookInPage } from './look-page.js';
import { RUN, listShots, shotOf } from './shots.mjs';

const USAGE = `${RUN} stage look [shot] [t | a-b] [--json]

  A shot as the camera sees it, and from above: frames (six over its length, or the one moment asked), the paths of
  the figures and the camera, where each is at those moments (meters; facing in degrees, 0° toward +z, 90° toward +x),
  where heads look and arms point when they turn away from the body, and what is wrong over the whole length
  (✗ the camera inside something, a figure walking through something; ! something right in front of the lens, a
  figure out of frame, hidden, its head cut by the top of the frame or at the side edge). No shot: every shot. Pictures go in .film/look/stage/.`;

/** The moments a look shows: the one asked, or six across the stretch. @param {number | null} at @param {[number, number] | null} range @param {number} duration */
export function momentsOf(at, range, duration) {
  const end = Math.max(0, duration - 1 / 24);
  if (at != null) return [Math.min(at, end)];
  const [a, b] = range ? [range[0], Math.min(range[1], end)] : [0, end];
  return Array.from({ length: 6 }, (_, i) => Number((a + ((b - a) * i) / 5).toFixed(2)));
}

/** The stretches where `test` holds, over samples a step apart (each knowing the one before it). @template T @param {{ t: number, prev: number | null }[]} samples @param {(s: any) => T | null | false} test */
export function spans(samples, test) {
  /** @type {{ from: number, to: number, what: T }[]} */
  const out = [];
  for (const s of samples) {
    const what = test(s);
    const last = out[out.length - 1];
    if (what && last && last.to === s.prev && last.what === what) last.to = s.t;
    else if (what) out.push({ from: s.t, to: s.t, what });
  }
  return out;
}

const deg = (/** @type {number} */ r) => `${Math.round((((r * 180) / Math.PI) % 360 + 360) % 360)}°`;
const m = (/** @type {number} */ v) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2).replace(/\.?0+$/, '').replace('-', '−'));
const sec = (/** @type {number} */ t) => `${t.toFixed(1)} s`;
const between = (/** @type {{ from: number, to: number }} */ s) => (s.from === s.to ? `at ${sec(s.from)}` : `from ${sec(s.from)} to ${sec(s.to)}`);

process.exitCode = await runLook(async ({ project, what, at, range, dir, shown }) => {
  const shots = what ? [shotOf(project, what)] : listShots(project).map((name) => shotOf(project, name));
  if (!shots.length) return { ok: false, lines: [`no shots in this project yet: ${RUN} stage new <name>`] };
  const site = await serve(project);
  const browser = await launch();
  /** @type {string[]} */
  const lines = [], files = [];
  /** @type {Record<string, unknown>[]} */
  const data = [];
  let ok = true;
  try {
    for (const shot of shots) {
      const tab = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      /** @type {string[]} */
      const errors = [];
      /** @type {(e: Error) => void} */
      let fail = () => {};
      /* a shot that throws as it starts is said at once, not after the wait */
      const failed = new Promise((_, reject) => { fail = reject; });
      failed.catch(() => {});
      tab.on('pageerror', (e) => { errors.push(e.message); fail(e); });
      tab.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
      try {
        await tab.goto(`${site.url}/${shot.entry}`);
        await Promise.race([tab.waitForFunction(() => /** @type {any} */ (window).film?.frame, null, { timeout: 20_000 }), failed]).catch(() => {
          throw new Error(`stage/${shot.name} did not start${errors.length ? `: ${errors.join('; ')}` : ': window.film was never set'}`);
        });
        const duration = Number(await tab.evaluate(() => /** @type {any} */ (window).film.duration));
        if (!(duration > 0)) throw new Error(`stage/${shot.name}: window.film.duration is not a length in seconds`);
        const times = momentsOf(at, range, duration);
        const [from, to] = range ? [range[0], Math.min(range[1], duration)] : [0, duration - 1 / 24];
        const step = Math.max(0.1, (to - from) / 120);
        const seen = await tab.evaluate(lookInPage, { times, from, to, step });
        /* a moment or a stretch looked at has pictures of its own, beside the whole shot's */
        const base = `${shot.name.replace(/\//g, '-')}${at != null ? `-${at}` : range ? `-${range[0]}-${range[1]}` : ''}`;
        const sheet = join(dir(), `${base}-frames.jpg`);
        const plan = join(dir(), `${base}-above.png`);
        writeFileSync(sheet, Buffer.from(seen.sheet.split(',')[1], 'base64'));
        writeFileSync(plan, Buffer.from(seen.plan.split(',')[1], 'base64'));
        files.push(sheet, plan);
        const samples = seen.samples.map((/** @type {any} */ s, /** @type {number} */ i, /** @type {any[]} */ all) => ({ ...s, prev: i ? all[i - 1].t : null }));
        const near = (/** @type {number} */ t) => samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
        lines.push(`stage/${shot.name} · ${sec(duration)} · ${seen.figures.length ? seen.figures.map((/** @type {any} */ f) => f.name).join(', ') : 'no figures'} · frames at ${times.map((t) => t.toFixed(1)).join(', ')} s`);
        for (const t of times) {
          const c = near(t).camera;
          lines.push(`camera  ${sec(t)}  at x ${m(c.at[0])} y ${m(c.at[1])} z ${m(c.at[2])} m · fov ${Math.round(c.fov)}° · facing ${deg(c.heading)} · ${c.pitch < 0 ? 'down' : 'up'} ${Math.abs(Math.round((c.pitch * 180) / Math.PI))}°`);
        }
        for (const { name } of seen.figures) {
          for (const t of times) {
            const i = samples.indexOf(near(t));
            const f = samples[i].figures[name];
            const other = samples[i + 1] ?? samples[i - 1];
            const speed = other ? Math.hypot(other.figures[name].at[0] - f.at[0], other.figures[name].at[1] - f.at[1]) / Math.abs(other.t - samples[i].t) : 0;
            const how = f.seated ? 'seated' : speed > 0.05 ? `moving ${speed.toFixed(2)} m/s` : 'still';
            const shownAs = !f.visible ? 'out of frame' : f.hidden ? `hidden behind ${f.hidden}` : `in frame, head to feet ${Math.round(f.screen.height * 100)} % of the frame's height, head ${Math.round(f.screen.x * 100)} % across`;
            const turned = f.looking && Math.abs(Math.atan2(Math.sin(f.looking.heading - f.facing), Math.cos(f.looking.heading - f.facing))) > 0.17;
            const nod = f.looking && Math.abs(f.looking.up) > 0.35; // past the lean of a walk, a run or a seat
            const looks = turned || nod ? ` · looking ${deg(f.looking.heading)}${nod ? `, ${f.looking.up > 0 ? 'up' : 'down'} ${Math.abs(Math.round((f.looking.up * 180) / Math.PI))}°` : ''}` : '';
            const arms = Object.entries(f.arms ?? {}).map(([side, a]) => ` · ${side} arm raised toward ${deg(a.heading)}, ${a.up >= 0 ? 'up' : 'down'} ${Math.abs(Math.round((a.up * 180) / Math.PI))}°`).join('');
            lines.push(`${name}  ${sec(t)}  at x ${m(f.at[0])} z ${m(f.at[1])} m · facing ${deg(f.facing)}${looks}${arms} · ${how} · ${shownAs}`);
          }
        }
        const wrong = spans(samples, (s) => s.camera.inside);
        const blocked = spans(samples, (s) => s.camera.blocked?.by).map((sp) => ({
          ...sp, share: Math.max(...samples.filter((s) => s.t >= sp.from && s.t <= sp.to).map((s) => s.camera.blocked?.share ?? 0)),
        }));
        const through = seen.figures.flatMap((/** @type {any} */ f) => spans(samples, (s) => s.figures[f.name].through).map((sp) => ({ ...sp, who: f.name })));
        const out = seen.figures.flatMap((/** @type {any} */ f) => spans(samples, (s) => !s.figures[f.name].visible && 'out').map((sp) => ({ ...sp, who: f.name })));
        const cut = seen.figures.flatMap((/** @type {any} */ f) => spans(samples, (s) => s.figures[f.name].cut).map((sp) => ({ ...sp, who: f.name })));
        const hidden = seen.figures.flatMap((/** @type {any} */ f) => spans(samples, (s) => s.figures[f.name].hidden).map((sp) => ({ ...sp, who: f.name })));
        for (const s of wrong) lines.push(`✗ the camera is inside ${s.what} ${between(s)}`);
        for (const s of blocked) lines.push(`! ${s.what} is less than a meter in front of the camera, covering up to ${Math.round(s.share * 100)} % of the frame, ${between(s)}`);
        for (const s of through) lines.push(`✗ ${s.who} goes through ${s.what} ${between(s)}`);
        for (const s of out) lines.push(`! ${s.who} is out of frame ${between(s)}`);
        for (const s of cut) lines.push(s.what === 'top' ? `! ${s.who}'s head is cut by the top of the frame ${between(s)}` : `! ${s.who} is at the side edge of the frame ${between(s)}`);
        for (const s of hidden) lines.push(`! ${s.who} is hidden behind ${s.what} ${between(s)}`);
        if (!wrong.length && !through.length) lines.push('✓ the camera is never inside anything, and no figure goes through anything');
        if (seen.figures.length && !out.length && !hidden.length && !cut.length) lines.push('✓ every figure is in frame and in sight the whole time');
        if (!seen.drawn) lines.push('! the shot does not use createStage (stage/lib/stage.js): the view from above shows only the paths');
        if (errors.length) { ok = false; lines.push(...errors.map((e) => `✗ the page said: ${e}`)); }
        lines.push(`→ ${shown(sheet)}`, `→ ${shown(plan)}`, '');
        data.push({ shot: shot.name, duration, times, figures: seen.figures, problems: { camera: wrong, blocked, through, out, cut, hidden }, samples: seen.samples });
      } catch (e) {
        ok = false;
        lines.push(`✗ ${e instanceof Error ? e.message : String(e)}`, '');
      } finally {
        await tab.close();
      }
    }
  } finally {
    await browser.close();
    await site.close();
  }
  return { ok, lines: lines.at(-1) === '' ? lines.slice(0, -1) : lines, files, data: { shots: data } };
}, { plugin: 'stage', usage: USAGE });
