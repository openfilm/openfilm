// The stage plugin (plugins/stage): its figures' poses, and its commands new, look and render in a project.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN = fileURLToPath(new URL('../plugins/stage/', import.meta.url));
/* the plugin's library imports three.js as `three`, as a shot's page names it with an import map */
const THREE_URL = pathToFileURL(join(PLUGIN, 'lib', 'three.module.min.js')).href;
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : next(s, c); }`)}`);
const THREE = await import(THREE_URL);
const { mannequin, apply, stand, walk, run, sit, mix, move, lookAt, point, pathLength } = await import(pathToFileURL(join(PLUGIN, 'lib', 'mannequin.js')).href);

/** The lowest point of a figure's feet, in meters above the floor. */
function lowestFoot(m) {
  m.root.updateMatrixWorld(true);
  let low = Infinity;
  for (const side of ['right', 'left']) {
    const foot = m.root.getObjectByName(`${m.name}-${side}-foot`);
    foot.geometry.computeBoundingBox();
    const box = foot.geometry.boundingBox.clone().applyMatrix4(foot.matrixWorld);
    low = Math.min(low, box.min.y);
  }
  return low;
}

test('a walking or running figure keeps its lower foot on the floor at every step', () => {
  const m = mannequin({ name: 'a' });
  for (let d = 0; d <= 4; d += 0.05) {
    apply(m, walk(d));
    assert.ok(Math.abs(lowestFoot(m)) < 0.002, `walk ${d.toFixed(2)} m: ${lowestFoot(m).toFixed(3)}`);
    apply(m, run(d));
    assert.ok(Math.abs(lowestFoot(m) - run(d).bob) < 0.002, `run ${d.toFixed(2)} m: ${lowestFoot(m).toFixed(3)}`);
  }
  apply(m, stand());
  assert.ok(Math.abs(lowestFoot(m)) < 0.002);
});

test('a walk given its length settles into standing at the end, and a pose is the same for the same distance', () => {
  assert.deepEqual(walk(5, { stopAt: 5 }), stand());
  assert.deepEqual(walk(7, { stopAt: 5 }), stand());
  assert.notDeepEqual(walk(4.7, { stopAt: 5 }), stand());
  assert.deepEqual(walk(2.3), walk(2.3));
  /* a walk grows out of standing, unless it was under way as the shot starts */
  assert.deepEqual(walk(0), stand());
  assert.notDeepEqual(walk(0.25), stand());
  assert.notDeepEqual(walk(0, { from: null }), stand());
  assert.deepEqual(run(0), stand());
  const half = mix(stand(), sit(1), 0.5);
  assert.equal(half.seat, 0.5);
});

test('a seated figure has its hips on the seat and its feet near the floor', () => {
  const m = mannequin({ name: 'b' });
  apply(m, sit(1, { seat: 0.45 }));
  assert.ok(Math.abs(m.pelvis.position.y - 0.5) < 1e-9);
  assert.ok(Math.abs(lowestFoot(m)) < 0.06, `feet at ${lowestFoot(m).toFixed(3)} m`);
  assert.equal(m.root.userData.seat, 1);
});

test('a figure on a path is where the distance puts it, facing the way it goes', () => {
  const m = mannequin({ name: 'c' });
  const path = [[0, 0], [0, 4], [3, 4]];
  assert.equal(pathLength(path), 7);
  let at = move(m, path, 2);
  assert.deepEqual([m.root.position.x, m.root.position.z], [0, 2]);
  assert.ok(Math.abs(m.root.rotation.y) < 1e-9, 'facing +z');
  at = move(m, path, 6);
  assert.ok(Math.abs(m.root.position.x - 2) < 1e-9 && Math.abs(m.root.position.z - 4) < 1e-9);
  assert.ok(Math.abs(m.root.rotation.y - Math.PI / 2) < 1e-9, 'facing +x');
  assert.equal(at.done, false);
  assert.equal(move(m, path, 9).done, true);
  assert.deepEqual([m.root.position.x, m.root.position.z], [3, 4]);
});

test('a pointing arm points at its target, and a head turns toward what it looks at', () => {
  const m = mannequin({ name: 'd' });
  m.root.position.set(1, 0, 2);
  m.root.rotation.y = 0.7;
  apply(m, stand());
  const target = new THREE.Vector3(-2, 2.2, 5);
  point(m, target, { side: 'right' });
  m.root.updateMatrixWorld(true);
  const arm = m.arms[0];
  const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
  const elbow = arm.fore.getWorldPosition(new THREE.Vector3());
  const angle = elbow.sub(shoulder).normalize().angleTo(target.clone().sub(shoulder).normalize());
  assert.ok(angle < 0.02, `off by ${angle.toFixed(3)} rad`);

  apply(m, stand());
  lookAt(m, [1 + Math.sin(0.7 + 0.9) * 3, 1.6, 2 + Math.cos(0.7 + 0.9) * 3]);
  assert.ok(m.head.rotation.y > 0.4, 'turned to its left');
});

let project;
const S = { cwd: '', env: {} };
const stage = (...args) => spawnSync(process.execPath, [join(PLUGIN, `${args[0]}.mjs`), ...args.slice(1)], { cwd: S.cwd, env: { ...process.env, ...S.env }, encoding: 'utf8' });

before(() => {
  project = mkdtempSync(join(tmpdir(), 'of-stage-'));
  writeFileSync(join(project, 'film.html'), '<!doctype html>\n<html><head><meta charset="utf-8"></head><body></body></html>\n');
  S.cwd = project;
  S.env = { OPENFILM_PROJECT: '', OPENFILM_HOME: join(project, '.home') };
});
after(() => rmSync(project, { recursive: true, force: true }));

test('stage new makes a shot and copies the library in once; a name taken or wrong is refused', () => {
  const made = stage('new', 's1');
  assert.equal(made.status, 0, made.stderr);
  for (const f of ['stage/s1/index.html', 'stage/s1/shot.js', 'stage/lib/three.module.min.js', 'stage/lib/three.core.min.js', 'stage/lib/stage.js', 'stage/lib/mannequin.js', 'stage/lib/three.LICENSE']) {
    assert.ok(existsSync(join(project, f)), f);
  }
  assert.match(made.stdout, /\[s1\]\(stage\/s1\/index\.html\)/);
  /* the project's library is its own: a second shot leaves it as it is */
  writeFileSync(join(project, 'stage/lib/mannequin.js'), `${readFileSync(join(project, 'stage/lib/mannequin.js'), 'utf8')}\n// changed here\n`);
  const second = stage('new', 's2');
  assert.equal(second.status, 0, second.stderr);
  assert.doesNotMatch(second.stdout, /copied/);
  assert.match(readFileSync(join(project, 'stage/lib/mannequin.js'), 'utf8'), /changed here/);
  assert.equal(stage('new', 's1').status, 1);
  assert.equal(stage('new', 'Shot 1').status, 2);
  assert.equal(stage('new', 'lib').status, 2);
  const away = spawnSync(process.execPath, [join(PLUGIN, 'new.mjs'), 's3'], { cwd: tmpdir(), env: { ...process.env, OPENFILM_PROJECT: '' }, encoding: 'utf8' });
  assert.equal(away.status, 2);
  assert.match(away.stderr, /not in a project/);
});

test('stage look tells where the figure and the camera are, what is wrong, and saves its pictures', () => {
  const looked = stage('look', 's1');
  assert.equal(looked.status, 0, looked.stderr + looked.stdout);
  assert.match(looked.stdout, /^stage\/s1 · 6\.0 s · ana · frames at 0\.0, 1\.2, 2\.4, 3\.6, 4\.8, 6\.0 s$/m);
  assert.match(looked.stdout, /^camera {2}0\.0 s {2}at x 2\.6 y 2\.2 z 6\.5 m · fov 38°/m);
  assert.match(looked.stdout, /^ana {2}0\.0 s {2}at x −2\.2 z −4\.4 m · facing 17° · moving 0\.90 m\/s · in frame/m);
  assert.match(looked.stdout, /✓ the camera is never inside anything/);
  for (const f of ['s1-frames.jpg', 's1-above.png']) assert.ok(existsSync(join(project, '.film/look/stage', f)), f);

  /* the camera put inside the back wall, the walk crossing the table */
  const shot = join(project, 'stage/s2/shot.js');
  writeFileSync(shot, readFileSync(shot, 'utf8')
    .replace('camera.position.set(lerp(2.6, 1.6, k), lerp(2.2, 1.5, k), lerp(6.5, 2.6, k));', 'camera.position.set(0, 1.5, -4.1);')
    .replace('const path = [[-2.2, -4.4], [-1.6, -2.4], [0.6, -0.6]];', 'const path = [[0.5, -1.6], [3.5, -1.6]];'));
  const wrong = stage('look', 's2', '--json');
  assert.equal(wrong.status, 0, wrong.stderr);
  const { ok, files, shots } = JSON.parse(wrong.stdout);
  assert.equal(ok, true);
  assert.equal(files.length, 2);
  assert.match(shots[0].problems.camera[0].what, /^room-back-/);
  assert.equal(shots[0].problems.through[0].what, 'table');

  /* the camera close and low on a figure standing still: its head is cut by the top of the frame */
  writeFileSync(shot, readFileSync(join(project, 'stage/s1/shot.js'), 'utf8')
    .replace(/function frame\(t\) \{[^]*?draw\(\);/, 'function frame(t) {\n    ana.root.position.set(0, 0, 0);\n    apply(ana, walk(0));\n    camera.position.set(0, 1, 1.2);\n    camera.lookAt(0, 0.9, 0);\n    draw();'));
  const close = stage('look', 's2');
  assert.match(close.stdout, /! ana's head is cut by the top of the frame from 0\.0 s to 5\.9 s/);
  assert.doesNotMatch(close.stdout, /every figure is in frame/);

  const one = stage('look', 's1', '2.5');
  assert.match(one.stdout, /frames at 2\.5 s/);
  assert.ok(existsSync(join(project, '.film/look/stage/s1-2.5-frames.jpg')), 'a moment looked at keeps pictures of its own');
  assert.equal(stage('look', 'nope').status, 2);
});

test('stage look says what a shot that fails to start said', () => {
  writeFileSync(join(project, 'stage/s2/shot.js'), 'export function shot() { throw new Error("the set fell over"); }\n');
  const looked = stage('look', 's2');
  assert.equal(looked.status, 1);
  assert.match(looked.stdout, /✗ stage\/s2 did not start: .*the set fell over/);
});

test('stage render draws a shot, or a stretch of it, as a video beside it', () => {
  const rendered = stage('render', 's1', '0-1', '--fps', '12');
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.ok(existsSync(join(project, 'stage/s1/whitebox-0-1.mp4')));
  assert.match(rendered.stdout, /rendered {2}\[s1\]\(stage\/s1\/whitebox-0-1\.mp4\) · 1 s of it · drawn in \d+\.\d s/);
  assert.equal(stage('render', 's1', '2').status, 2);
  assert.equal(stage('render').status, 2);
});
