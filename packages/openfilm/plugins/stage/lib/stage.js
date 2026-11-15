// The stage a shot stands on: a renderer, a camera, a sky and a sun, plus the plain pieces a white-box set is built
// from. Copied into a project's stage/lib/ by `openfilm stage new`; the project's copy is the project's to change.
// Everything is in meters, y up; a figure facing +z faces the open side of a room, where the camera usually is.
import * as THREE from 'three';

/** Every stage made on this page, for the tools that look at a shot (`openfilm stage look`) to draw with its renderer. */
export const stages = [];

/** The grey of a white-box set, and of its floor. */
export const GREY = 0xdedcd7;
export const FLOOR = 0xb9b6b0;

/**
 * A stage: a canvas filling the page, a renderer drawn on demand, a scene with a sky (the light from everywhere, also
 * what shiny things reflect) and a sun (the light that casts shadows), and a camera named `camera` in the scene.
 * `pass`: what is drawn, `beauty` (the white box) or `depth` (white near, black far, linear in meters from the camera).
 * @param {{ pass?: string, background?: number, sky?: number, ground?: number, skyIntensity?: number,
 *   sun?: { color?: number, intensity?: number, from?: number[], to?: number[], area?: number },
 *   fov?: number, depth?: { near?: number, far?: number } }} [options]
 */
export function createStage({
  pass = 'beauty', background = 0xbfc3c7, sky = 0xf3f1ec, ground = 0x8d8a85, skyIntensity = 1,
  sun: sunAt = {}, fov = 40, depth = {},
} = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%';
  document.body.append(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = pass === 'beauty';
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pass === 'depth' ? 0x000000 : background);
  scene.environment = skyMap(renderer, sky, ground);
  scene.environmentIntensity = skyIntensity;
  scene.userData.sky = { sky: new THREE.Color(sky).toArray(), ground: new THREE.Color(ground).toArray(), intensity: skyIntensity };

  const { color = 0xfff1dc, intensity = 2.2, from = [5, 9, 7], to = [0, 0, 0], area = 10 } = sunAt;
  const sun = new THREE.DirectionalLight(color, intensity);
  sun.name = 'sun';
  sun.position.fromArray(from);
  sun.target.position.fromArray(to);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 0.5, far: 60 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(fov, innerWidth / innerHeight, 0.05, 200);
  camera.name = 'camera';
  scene.add(camera);

  if (pass === 'depth') {
    const { near = 0.5, far = 25 } = depth;
    scene.environment = null;
    scene.overrideMaterial = new THREE.ShaderMaterial({
      uniforms: { near: { value: near }, far: { value: far } },
      vertexShader: '#include <common>\n#include <skinning_pars_vertex>\nvarying float z;\nvoid main() {\n#include <skinbase_vertex>\n#include <begin_vertex>\n#include <skinning_vertex>\nvec4 p = modelViewMatrix * vec4(transformed, 1.0);\nz = -p.z;\ngl_Position = projectionMatrix * p;\n}',
      fragmentShader: 'uniform float near;\nuniform float far;\nvarying float z;\nvoid main() { gl_FragColor = vec4(vec3(1.0 - clamp((z - near) / (far - near), 0.0, 1.0)), 1.0); }',
    });
  }

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  const made = { renderer, scene, camera, sun, pass, draw: () => renderer.render(scene, camera) };
  stages.push(made);
  return made;
}

/** The sky as a light from everywhere: `sky` above the horizon, `ground` below, blended across it. */
function skyMap(renderer, sky, ground) {
  const dome = new THREE.Scene();
  dome.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sky: { value: new THREE.Color(sky) }, ground: { value: new THREE.Color(ground) } },
    vertexShader: 'varying vec3 d; void main() { d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 sky; uniform vec3 ground; varying vec3 d; void main() { gl_FragColor = vec4(mix(ground, sky, smoothstep(-0.25, 0.25, d.y)), 1.0); }',
  })));
  const maker = new THREE.PMREMGenerator(renderer);
  const map = maker.fromScene(dome, 0, 0.1, 100).texture;
  maker.dispose();
  return map;
}

/**
 * A box standing on the floor (or on whatever is at `at`'s height): `size` [width x, height y, depth z], `at` [x, y, z]
 * the middle of its bottom. Casts and takes shadows. @returns {THREE.Mesh}
 */
export function box(parent, { size = [1, 1, 1], at = [0, 0, 0], color = GREY, name = '', turn = 0, roughness = 0.95 } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), new THREE.MeshStandardMaterial({ color, roughness }));
  mesh.position.set(at[0], at[1] + size[1] / 2, at[2]);
  mesh.rotation.y = turn;
  mesh.castShadow = mesh.receiveShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  return mesh;
}

/**
 * A wall from `from` [x, z] to `to` [x, z] on the floor, `height` high and `thickness` thick, with openings cut in it:
 * each `{ at, width, bottom, top }`, `at` its middle in meters from the wall's start, `bottom` 0 for a door. The pieces
 * are one group named `name`. @returns {THREE.Group}
 */
export function wall(parent, { from, to, height = 3, thickness = 0.2, openings = [], color = GREY, name = 'wall' }) {
  const group = new THREE.Group();
  group.name = name;
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  group.position.set(from[0], 0, from[1]);
  group.rotation.y = Math.atan2(-dz, dx);
  const piece = (a, b, y0, y1) => {
    if (b - a < 0.001 || y1 - y0 < 0.001) return;
    box(group, { size: [b - a, y1 - y0, thickness], at: [(a + b) / 2, y0, 0], color, name: `${name}-${group.children.length + 1}` });
  };
  let x = 0;
  for (const o of [...openings].sort((p, q) => p.at - q.at)) {
    const a = Math.max(x, o.at - o.width / 2), b = Math.min(length, o.at + o.width / 2);
    const bottom = o.bottom ?? 0, top = Math.min(height, o.top ?? (bottom === 0 ? 2.1 : bottom + 1.2));
    piece(x, a, 0, height);
    piece(a, b, 0, bottom);
    piece(a, b, top, height);
    x = b;
  }
  piece(x, length, 0, height);
  parent.add(group);
  return group;
}

/**
 * A room: a floor `width` (x) by `depth` (z) centered on the origin, and walls `height` high on its back (-z), left (-x)
 * and right (+x) sides; the front (+z) is open for the camera unless `front` is given. Each side is `true`, `false`
 * (none) or `{ openings }` (see `wall`, `at` measured from the side's left end as seen from inside, facing it).
 * Returns the floor and the walls by side.
 */
export function room(parent, { width = 8, depth = 8, height = 3, thickness = 0.2, back = true, left = true, right = true, front = false, color = GREY, floor = FLOOR, name = 'room' } = {}) {
  const w = width / 2, d = depth / 2, t = thickness / 2;
  const ground = box(parent, { size: [width, 0.1, depth], at: [0, -0.1, 0], color: floor, name: `${name}-floor` });
  const sides = {
    back: { from: [-w - t * 2, -d - t], to: [w + t * 2, -d - t] },
    right: { from: [w + t, -d - t * 2], to: [w + t, d] },
    front: { from: [w + t * 2, d + t], to: [-w - t * 2, d + t] },
    left: { from: [-w - t, d], to: [-w - t, -d - t * 2] },
  };
  /** @type {Record<string, THREE.Group>} */
  const walls = {};
  for (const [side, said] of Object.entries({ back, right, front, left })) {
    if (!said) continue;
    walls[side] = wall(parent, { ...sides[side], height, thickness, openings: said === true ? [] : said.openings ?? [], color, name: `${name}-${side}` });
  }
  return { floor: ground, walls };
}

/** `x` held to 0–1. */
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** From `a` to `b` by `k`. */
export const lerp = (a, b, k) => a + (b - a) * k;
/** Ease in and out (cubic): slow, fast, slow. */
export const ease = (x) => { const k = clamp01(x); return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2; };
/** How far `t` is from `start` to `end`, 0–1, eased in and out. */
export const progress = (t, start, end) => ease((t - start) / (end - start));
