// @ts-check
/**
 * Blender as the stage's other renderer: optional, used only when it is on this computer, never shipped with OpenFilm
 * (it is run as a program of its own). A shot is not written twice: its page is baked to glTF (each moving thing's
 * place, turn and size at every frame, the camera, the lights, the materials, skins and instances, by three.js's own
 * exporter), Blender's own importer reads it (blender/import.py), and Blender renders it. What glTF has no place for
 * goes beside it in a small JSON: the camera's field of view at every frame, the sky, the background, shadow flags.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { launch, serve } from '../../src/host.mjs';
import { ffmpeg, kill } from '../../src/shared.mjs';
import { PLUGIN } from './shots.mjs';

/**
 * Blender's program on this computer, or null: OPENFILM_BLENDER when set, else where it is installed (the newest
 * version when there are several), else `blender` on the PATH.
 */
export function findBlender() {
  const said = process.env.OPENFILM_BLENDER;
  if (said) return existsSync(said) ? said : null;
  /** @type {string[]} */
  const places = [];
  if (process.platform === 'darwin') {
    for (const apps of ['/Applications', join(homedir(), 'Applications')]) {
      let names = [];
      try { names = readdirSync(apps).filter((n) => /^Blender.*\.app$/i.test(n)).sort().reverse(); } catch { /* none */ }
      for (const n of names) places.push(join(apps, n, 'Contents', 'MacOS', 'Blender'));
    }
  } else if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const dir = join(/** @type {string} */ (root), 'Blender Foundation');
      let names = [];
      try { names = readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); } catch { /* none */ }
      for (const n of names) places.push(join(dir, n, 'blender.exe'));
    }
  }
  const found = places.find((p) => existsSync(p));
  if (found) return found;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], { encoding: 'utf8' });
  const line = which.status === 0 ? which.stdout.split(/\r?\n/)[0].trim() : '';
  return line || null;
}

/** Blender's version, as it says it (`5.2.2`), or null. @param {string} blender */
export function blenderVersion(blender) {
  const said = spawnSync(blender, ['-b', '--factory-startup', '--version'], { encoding: 'utf8', timeout: 60_000 });
  return /Blender (\d+\.\d+(\.\d+)?)/.exec(said.stdout ?? '')?.[1] ?? null;
}

/* Runs in the shot's page: every node's motion baked frame by frame into one glTF animation, exported as GLB. */
async function bakeInPage(/** @type {{ exporter: string, fps: number, from: number, frames: number }} */ { exporter, fps, from, frames }) {
  const THREE = await import(new URL('../lib/three.module.min.js', location.href).href);
  const { GLTFExporter } = await import(exporter);
  const film = /** @type {any} */ (window).film;
  const { scene, camera, frame } = film;
  if (!scene || !camera) throw new Error('the shot gives no scene or camera: shot.js returns { frame, duration, scene, camera }');
  if (!camera.parent) scene.add(camera);
  /* every node needs a name of its own: glTF's animation and Blender's objects find each other by it */
  const seen = new Set(); let n = 0;
  scene.traverse((/** @type {any} */ o) => { if (o === scene) return; if (!o.name || seen.has(o.name)) o.name = `${o.name || o.type}_${n++}`; seen.add(o.name); });
  /** @type {string[]} */
  const dropped = [];
  /** @type {any[]} */
  const aimed = [];
  scene.traverse((/** @type {any} */ o) => {
    if ((o.isDirectionalLight || o.isSpotLight) && o.target) aimed.push(o);
    if (o.isMesh || o.isLight) o.userData.castShadow = Boolean(o.castShadow);
    if (o.isMesh) o.userData.receiveShadow = Boolean(o.receiveShadow);
    if (o.isMesh && o.material?.isShaderMaterial) dropped.push(`${o.name}: a custom shader, drawn grey`);
    if (o.isLine || o.isPoints || o.isSprite) dropped.push(`${o.name}: lines, points and sprites are not drawn`);
  });
  /* a directional or spot light points down its own -z in glTF: aimed at its target, the target hung on it */
  for (const o of aimed) { o.lookAt(o.target.getWorldPosition(new THREE.Vector3())); o.add(o.target); o.target.position.set(0, 0, -1); }
  if (scene.fog) dropped.push('fog');
  /** @type {any[]} */
  const nodes = [];
  scene.traverse((/** @type {any} */ o) => { if (o !== scene) nodes.push(o); });
  const rec = nodes.map(() => ({ p: /** @type {number[]} */ ([]), q: /** @type {number[]} */ ([]), s: /** @type {number[]} */ ([]) }));
  /** @type {number[]} */
  const fov = [];
  for (let f = 0; f < frames; f++) {
    frame(from + f / fps);
    nodes.forEach((o, i) => {
      const r = rec[i];
      r.p.push(...o.position.toArray());
      const q = o.quaternion.toArray();
      const k = r.q.length - 4; /* each quaternion on the same side as the one before it, so nothing spins the long way */
      if (k >= 0 && q[0] * r.q[k] + q[1] * r.q[k + 1] + q[2] * r.q[k + 2] + q[3] * r.q[k + 3] < 0) q.forEach((/** @type {number} */ v, /** @type {number} */ j) => (q[j] = -v));
      r.q.push(...q);
      r.s.push(...o.scale.toArray());
    });
    fov.push(camera.fov);
  }
  const times = Array.from({ length: frames }, (_, f) => f / fps);
  const varies = (/** @type {number[]} */ a, /** @type {number} */ w) => a.some((v, i) => Math.abs(v - a[i % w]) > 1e-6);
  const tracks = [];
  nodes.forEach((o, i) => {
    const r = rec[i];
    if (varies(r.p, 3)) tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`, times, r.p));
    if (varies(r.q, 4)) tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`, times, r.q));
    if (varies(r.s, 3)) tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.scale`, times, r.s));
  });
  /* glTF keeps one pose besides the animation: the first frame's */
  frame(from);
  const clip = new THREE.AnimationClip('shot', Math.max(1 / fps, (frames - 1) / fps), tracks);
  const glb = new Uint8Array(await new GLTFExporter().parseAsync(scene, { binary: true, animations: tracks.length ? [clip] : [] }));
  let bin = '';
  for (let i = 0; i < glb.length; i += 0x8000) bin += String.fromCharCode(...glb.subarray(i, i + 0x8000));
  /* the stage's sky (stage.js), else a hemisphere light's colors as one */
  let sky = scene.userData.sky ?? null;
  scene.traverse((/** @type {any} */ o) => { if (!sky && o.isHemisphereLight) sky = { sky: o.color.toArray(), ground: o.groundColor.toArray(), intensity: o.intensity / Math.PI }; });
  return {
    glb: btoa(bin),
    side: { fps, frames, fov, camera: camera.name, sky, background: scene.background?.isColor ? scene.background.toArray() : null, dropped, moving: new Set(tracks.map((t) => t.name.split('.')[0])).size, nodes: nodes.length },
  };
}

/**
 * Render `shot` with Blender into `out` (an .mp4): baked, imported, rendered frame by frame into the project's
 * `.film/cache/stage/<shot>/blender/` (frames already there are kept), and encoded. `say` hears the progress.
 * With `out` null, only the scene is made (the .blend), nothing rendered.
 * @param {{ project: string, shot: { name: string, entry: string }, out: string | null, fps: number, range: [number, number] | null,
 *   engine: 'eevee' | 'cycles', samples: number, size?: [number, number], blender: string, say: (line: string) => void }} how
 */
export async function renderWithBlender({ project, shot, out, fps, range, engine, samples, size = [1920, 1080], blender, say }) {
  const dir = join(project, '.film', 'cache', 'stage', shot.name, 'blender');
  mkdirSync(dir, { recursive: true });
  /* the exporter is served from the project's cache, where the shot's page imports it from */
  const lib = join(project, '.film', 'cache', 'stage', 'lib');
  mkdirSync(lib, { recursive: true });
  copyFileSync(join(PLUGIN, 'lib', 'GLTFExporter.js'), join(lib, 'GLTFExporter.js'));

  const site = await serve(project);
  const browser = await launch();
  let baked;
  try {
    const tab = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
    /** @type {string[]} */
    const errors = [];
    tab.on('pageerror', (e) => errors.push(e.message));
    await tab.goto(`${site.url}/${shot.entry}`);
    await tab.waitForFunction(() => /** @type {any} */ (window).film?.frame, null, { timeout: 20_000 }).catch(() => {
      throw new Error(`stage/${shot.name} did not start${errors.length ? `: ${errors.join('; ')}` : ''}`);
    });
    const duration = Number(await tab.evaluate(() => /** @type {any} */ (window).film.duration));
    const [a, b] = range ?? [0, duration];
    const frames = Math.max(1, Math.round((Math.min(b, duration) - a) * fps));
    baked = await tab.evaluate(bakeInPage, { exporter: `${site.url}/.film/cache/stage/lib/GLTFExporter.js`, fps, from: a, frames });
  } finally {
    await browser.close();
    await site.close();
  }
  const base = join(dir, 'shot');
  writeFileSync(`${base}.glb`, Buffer.from(baked.glb, 'base64'));
  writeFileSync(`${base}.json`, JSON.stringify(baked.side));
  for (const d of baked.side.dropped) say(`! not in Blender's picture: ${d}`);

  /* the frames of an earlier render of another stretch or size are not this one's */
  const frames = join(dir, 'frames');
  const key = JSON.stringify({ range, fps, engine, samples, size, glb: baked.glb.length });
  const keyFile = join(dir, 'frames.json');
  if (out) {
    if (!existsSync(keyFile) || readFileSync(keyFile, 'utf8') !== key) rmSync(frames, { recursive: true, force: true });
    mkdirSync(frames, { recursive: true });
    writeFileSync(keyFile, key);
  }

  await new Promise((done, fail) => {
    const proc = spawn(blender, ['-b', '--factory-startup', '-P', join(PLUGIN, 'blender', 'import.py'), '--', base, out ? frames : '-', engine, String(samples), String(size[0]), String(size[1])], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => kill(proc);
    process.once('SIGINT', stop);
    let tail = '';
    let last = 0;
    proc.stdout.on('data', (d) => {
      tail = (tail + d).slice(-4000);
      for (const m of String(d).matchAll(/PROGRESS (\d+) (\d+)/g)) {
        const [done, total] = [Number(m[1]), Number(m[2])];
        if (done === total || Date.now() - last > 2000) { say(`  ${done}/${total} frames in Blender`); last = Date.now(); }
      }
    });
    proc.stderr.on('data', (d) => { tail = (tail + d).slice(-4000); });
    proc.on('error', (e) => fail(new Error(`Blender could not be run: ${e.message}`)));
    proc.on('close', (code) => {
      process.off('SIGINT', stop);
      if (code === 0 && tail.includes('DONE')) done(undefined);
      else fail(new Error(`Blender stopped (${code}): ${tail.split('\n').filter((l) => /error|Error|Traceback|raise/.test(l)).slice(-4).join(' · ') || tail.trim().split('\n').slice(-3).join(' · ')}`));
    });
  });
  if (!out) return { blend: join(dir, 'shot.blend'), dropped: baked.side.dropped };
  const { done } = ffmpeg(['-framerate', String(fps), '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', '-movflags', '+faststart', out], { what: 'encoding the frames' });
  await done;
  return { blend: join(dir, 'shot.blend'), dropped: baked.side.dropped };
}
