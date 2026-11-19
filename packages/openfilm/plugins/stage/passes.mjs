// @ts-check
/**
 * The other pictures of a shot, beside the white box: its depth (white near, black far, linear in meters, the range
 * fitted to what the camera sees over the whole shot so it does not flicker) and its figures' poses (the 18 points
 * and colored limbs of the OpenPose convention, on black). Each is a page written into the project's
 * `.film/cache/stage/<shot>/`, drawing the shot's own shot.js another way, and rendered like the shot itself. The
 * pages stand on nothing of this plugin: what they need is written into them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The passes there are, beside `beauty` (the shot as it is). */
export const PASSES = ['depth', 'pose'];

/* Runs in the page: the depth of what the camera sees, its range fitted over the shot. */
const DEPTH = `
const THREE = await import('three');
const { scene, camera } = film;
const meshes = [];
scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
const ray = new THREE.Raycaster();
const seen = [];
for (let i = 0; i <= 12; i++) {
  film.frame((film.duration * i * 0.999) / 12);
  scene.updateMatrixWorld(true);
  for (let x = -0.9; x <= 0.91; x += 0.2) for (let y = -0.9; y <= 0.91; y += 0.3) {
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) seen.push(hit.distance);
  }
}
seen.sort((a, b) => a - b);
const near = seen.length ? Math.max(0.05, seen[Math.floor(seen.length * 0.02)] * 0.85) : 0.5;
const far = seen.length ? Math.max(near + 1, seen[Math.floor(seen.length * 0.98)] * 1.15) : 25;
scene.overrideMaterial = new THREE.ShaderMaterial({
  uniforms: { near: { value: near }, far: { value: far } },
  vertexShader: '#include <common>\\n#include <skinning_pars_vertex>\\nvarying float z;\\nvoid main() {\\n#include <skinbase_vertex>\\n#include <begin_vertex>\\n#include <skinning_vertex>\\nvec4 p = modelViewMatrix * vec4(transformed, 1.0);\\nz = -p.z;\\ngl_Position = projectionMatrix * p;\\n}',
  fragmentShader: 'uniform float near;\\nuniform float far;\\nvarying float z;\\nvoid main() { gl_FragColor = vec4(vec3(1.0 - clamp((z - near) / (far - near), 0.0, 1.0)), 1.0); }',
});
scene.background = new THREE.Color(0x000000);
scene.environment = null;
scene.fog = null;
document.title = 'depth ' + near.toFixed(2) + '-' + far.toFixed(2) + ' m';
window.film = { frame: (t) => film.frame(t), duration: film.duration };
`;

/* Runs in the page: each figure's pose, drawn over black as OpenPose draws its 18 points. */
const POSE = `
const { scene, camera } = film;
for (const c of document.querySelectorAll('canvas')) c.style.visibility = 'hidden';
const out = document.createElement('canvas');
out.style.cssText = 'position:fixed;inset:0;width:100%;height:100%';
document.body.append(out);
const ctx = out.getContext('2d');
const LIMBS = [[1, 2], [1, 5], [2, 3], [3, 4], [5, 6], [6, 7], [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13], [1, 0], [0, 14], [14, 16], [0, 15], [15, 17]];
const COLORS = [[255, 0, 0], [255, 85, 0], [255, 170, 0], [255, 255, 0], [170, 255, 0], [85, 255, 0], [0, 255, 0], [0, 255, 85], [0, 255, 170], [0, 255, 255], [0, 170, 255], [0, 85, 255], [0, 0, 255], [85, 0, 255], [170, 0, 255], [255, 0, 255], [255, 0, 170], [255, 0, 85]];
const figures = [];
scene.traverse((o) => { if (o.userData && o.userData.figure) figures.push(o); });
const at = (fig, name, local) => {
  const o = fig.getObjectByName(fig.name + '-' + name);
  if (!o) return null;
  const v = o.position.clone().set(0, 0, 0);
  if (local) v.set(local[0], local[1], local[2]);
  return o.localToWorld(v);
};
/* the 18 points, in OpenPose's order: nose, neck, right shoulder, elbow, wrist, left shoulder, elbow, wrist, right
   hip, knee, ankle, left hip, knee, ankle, right eye, left eye, right ear, left ear */
/* a rigged character's joints, by the names rigs give them (Rigify's DEF-upper_arm.L, after three.js drops the dot;
   other rigs' LeftArm): side 'l' or 'r' */
const BONES = {
  arm: (x) => [new RegExp('upper_?arm[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'arm$')],
  fore: (x) => [new RegExp('fore_?arm[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'forearm$')],
  hand: (x) => [new RegExp('hand[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'hand$')],
  thigh: (x) => [new RegExp('thigh[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'upleg$')],
  shin: (x) => [new RegExp('(shin|calf)[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'leg$')],
  foot: (x) => [new RegExp('foot[._-]?' + x + '$'), new RegExp((x === 'l' ? 'left' : 'right') + 'foot$')],
};
const boneOf = (fig, tests) => {
  let found = null;
  fig.traverse((o) => { if (!found && o.isBone && tests.some((r) => r.test(o.name.toLowerCase()))) found = o; });
  return found;
};
const rigged = (fig) => {
  const at = (o) => (o ? o.getWorldPosition(o.position.clone()) : null);
  const head = boneOf(fig, [/head$/]);
  const p = new Array(18).fill(null);
  [[2, 'arm', 'r'], [3, 'fore', 'r'], [4, 'hand', 'r'], [5, 'arm', 'l'], [6, 'fore', 'l'], [7, 'hand', 'l'],
    [8, 'thigh', 'r'], [9, 'shin', 'r'], [10, 'foot', 'r'], [11, 'thigh', 'l'], [12, 'shin', 'l'], [13, 'foot', 'l']]
    .forEach(([i, part, side]) => { p[i] = at(boneOf(fig, BONES[part](side))); });
  if (head) {
    /* the face from the head joint: the head's way forward is the figure's, up is up */
    const base = at(head);
    const q = fig.getWorldQuaternion(fig.quaternion.clone());
    const ahead = base.clone().set(0, 0, 1).applyQuaternion(q), right = base.clone().set(-1, 0, 0).applyQuaternion(q);
    const face = (up, fwd, side) => base.clone().add(base.clone().set(0, up, 0)).addScaledVector(ahead, fwd).addScaledVector(right, side);
    p[0] = face(0.1, 0.11, 0); p[14] = face(0.13, 0.09, 0.04); p[15] = face(0.13, 0.09, -0.04); p[16] = face(0.11, 0, 0.09); p[17] = face(0.11, 0, -0.09);
  }
  if (p[2] && p[5]) p[1] = p[2].clone().add(p[5]).multiplyScalar(0.5);
  return p;
};
const points = (fig) => {
  if (!fig.getObjectByName(fig.name + '-pelvis')) return rigged(fig);
  const p = [
    at(fig, 'nose'), null,
    at(fig, 'right-arm-joint'), at(fig, 'right-forearm-joint'), at(fig, 'right-forearm-joint', [0, -0.27, 0]),
    at(fig, 'left-arm-joint'), at(fig, 'left-forearm-joint'), at(fig, 'left-forearm-joint', [0, -0.27, 0]),
    at(fig, 'right-thigh-joint'), at(fig, 'right-shin-joint'), at(fig, 'right-ankle'),
    at(fig, 'left-thigh-joint'), at(fig, 'left-shin-joint'), at(fig, 'left-ankle'),
    at(fig, 'head', [-0.045, 0.025, 0.098]), at(fig, 'head', [0.045, 0.025, 0.098]),
    at(fig, 'head', [-0.112, 0, 0]), at(fig, 'head', [0.112, 0, 0]),
  ];
  if (p[2] && p[5]) p[1] = p[2].clone().add(p[5]).multiplyScalar(0.5);
  return p;
};
window.film = {
  duration: film.duration,
  frame(t) {
    film.frame(t);
    scene.updateMatrixWorld(true);
    const W = out.width = innerWidth * devicePixelRatio, H = out.height = innerHeight * devicePixelRatio;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const stick = Math.max(2, (4 * H) / 512);
    for (const fig of figures) {
      const xy = points(fig).map((p) => {
        if (!p) return null;
        const v = p.clone().project(camera);
        return v.z < 1 ? [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H] : null;
      });
      LIMBS.forEach(([a, b], i) => {
        if (!xy[a] || !xy[b]) return;
        const [x1, y1] = xy[a], [x2, y2] = xy[b];
        ctx.save();
        ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
        ctx.rotate(Math.atan2(y2 - y1, x2 - x1));
        ctx.fillStyle = 'rgba(' + COLORS[i].join(',') + ',0.6)';
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.hypot(x2 - x1, y2 - y1) / 2, stick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
      xy.forEach((p, i) => {
        if (!p) return;
        ctx.fillStyle = 'rgb(' + COLORS[i].join(',') + ')';
        ctx.beginPath();
        ctx.arc(p[0], p[1], stick, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  },
};
`;

/**
 * Write the page that draws `shot` as `pass`, and return its path. @param {string} project
 * @param {{ name: string, dir: string }} shot @param {string} pass one of PASSES
 */
export function passPage(project, shot, pass) {
  const code = pass === 'depth' ? DEPTH : pass === 'pose' ? POSE : null;
  if (!code) throw new Error(`no pass ${pass}: ${PASSES.join(', ')}`);
  const url = (/** @type {string} */ p) => `/${relative(project, p).split(sep).map(encodeURIComponent).join('/')}`;
  const dir = join(project, '.film', 'cache', 'stage', shot.name);
  mkdirSync(dir, { recursive: true });
  const page = join(dir, `${pass}.html`);
  writeFileSync(page, `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${pass}</title>
<script type="importmap">{ "imports": { "three": "${url(join(project, 'stage', 'lib', 'three.module.min.js'))}", "three/addons/": "${url(join(project, 'stage', 'lib', 'addons'))}/" } }</script>
<style>html, body { margin: 0; height: 100%; overflow: hidden; background: #000; }</style>
</head>
<body>
<script type="module">
// stage/${shot.name} drawn as its ${pass}: written by \`openfilm stage render --${pass}\`, made again each time.
import { shot } from '${url(join(shot.dir, 'shot.js'))}';
const film = shot({ pass: '${pass}' });
await (typeof film.ready === 'function' ? film.ready() : film.ready);
${code.trim()}
</script>
</body>
</html>
`);
  return page;
}
