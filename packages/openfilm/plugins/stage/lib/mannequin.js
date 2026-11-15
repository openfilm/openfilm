// A figure made of primitives, posed as a function of time. Copied into a project's stage/lib/ by
// `openfilm stage new`; the project's copy is the project's to change, and new poses can be added to it.
//
// A pose is a plain object of joint angles (radians), made by `stand`, `walk`, `run`, `sit`, `turn` and mixed with
// `mix`; `apply` puts one on a figure and keeps its lower foot on the floor (or its seat on a chair). `lookAt` and
// `point` then turn its head and an arm toward a place in the scene. `move` puts the figure on a path. Every function
// gives the same result for the same arguments, so a frame is the same whatever was drawn before it.
import * as THREE from 'three';

/** Body lengths, in meters, for a figure 1.75 m tall. */
const DIM = { hip: 0.1, thigh: 0.45, shin: 0.43, foot: 0.07, spine: 0.52, head: 0.115, upper: 0.29, fore: 0.27, shoulder: 0.19 };
const TALL = 1.75;

/** A color for each figure in turn, easy to tell apart on grey. */
export const COLORS = [0xd9824b, 0x3f7fd1, 0x4fa36b, 0xc4497a, 0xd6b13c, 0x7a5cc4];
let made = 0;

function limb(length, radius, material, name) {
  // a capsule hanging from its pivot (the joint at the top), along -y
  const pivot = new THREE.Group();
  pivot.name = `${name}-joint`;
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.001, length - 2 * radius), 6, 12), material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.name = name;
  pivot.add(mesh);
  return pivot;
}

/**
 * A figure named `name`, `height` meters tall, in `color` (each new figure takes the next of COLORS when none is given).
 * Its `root` stands on the floor at its feet, facing +z; put it in the scene and move `root`.
 * @param {{ name?: string, color?: number, height?: number }} [options]
 */
export function mannequin({ name = `figure-${made + 1}`, color = COLORS[made % COLORS.length], height = TALL } = {}) {
  made++;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const part = (geometry, label) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.name = `${name}-${label}`;
    return mesh;
  };
  const root = new THREE.Group();
  root.name = name;
  root.userData.figure = true;
  root.scale.setScalar(height / TALL);
  const pelvis = new THREE.Group();
  pelvis.name = `${name}-pelvis`;
  root.add(pelvis);

  const hips = part(new THREE.CapsuleGeometry(0.11, 0.16, 6, 12), 'hips');
  hips.rotation.z = Math.PI / 2;
  pelvis.add(hips);

  const chest = new THREE.Group();
  chest.name = `${name}-chest`;
  pelvis.add(chest);
  const torso = part(new THREE.CapsuleGeometry(0.14, DIM.spine - 0.28, 6, 12), 'torso');
  torso.position.y = DIM.spine / 2;
  torso.scale.z = 0.72;
  chest.add(torso);
  const head = new THREE.Group();
  head.name = `${name}-neck`;
  head.position.y = DIM.spine + 0.02;
  chest.add(head);
  const neck = part(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 12), 'neck-bone');
  neck.position.y = 0.02;
  head.add(neck);
  const skull = part(new THREE.SphereGeometry(DIM.head, 20, 16), 'head');
  skull.position.y = 0.06 + DIM.head;
  head.add(skull);
  // a nose, so which way the figure faces reads in every frame
  const nose = part(new THREE.ConeGeometry(0.025, 0.06, 10), 'nose');
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, skull.position.y, DIM.head + 0.02);
  head.add(nose);

  // side -1 is the figure's right (-x when it faces +z), +1 its left
  const legs = [-1, 1].map((side) => {
    const label = side < 0 ? 'right' : 'left';
    const thigh = limb(DIM.thigh, 0.065, mat, `${name}-${label}-thigh`);
    thigh.position.set(side * DIM.hip, 0, 0);
    const shin = limb(DIM.shin, 0.055, mat, `${name}-${label}-shin`);
    shin.position.y = -DIM.thigh;
    // the ankle keeps the foot level with the floor whatever the leg does
    const ankle = new THREE.Group();
    ankle.name = `${name}-${label}-ankle`;
    ankle.position.y = -DIM.shin;
    shin.add(ankle);
    const foot = part(new THREE.BoxGeometry(0.09, DIM.foot, 0.24), `${label}-foot`);
    foot.position.set(0, -DIM.foot / 2 + 0.03, 0.06);
    ankle.add(foot);
    thigh.add(shin);
    pelvis.add(thigh);
    return { thigh, shin, ankle, foot, side };
  });
  const arms = [-1, 1].map((side) => {
    const label = side < 0 ? 'right' : 'left';
    const upper = limb(DIM.upper, 0.05, mat, `${name}-${label}-arm`);
    upper.position.set(side * DIM.shoulder, DIM.spine - 0.02, 0);
    const fore = limb(DIM.fore, 0.042, mat, `${name}-${label}-forearm`);
    fore.position.y = -DIM.upper;
    upper.add(fore);
    chest.add(upper);
    return { upper, fore, side };
  });

  return { name, root, pelvis, chest, head, legs, arms, color };
}

/**
 * @typedef {object} Pose joint angles in radians; right and left are the figure's own
 * @property {number} thighR @property {number} thighL forward swing of each thigh (negative: back)
 * @property {number} kneeR @property {number} kneeL bend of each knee
 * @property {number} spreadR @property {number} spreadL each leg out to its side
 * @property {number} armR @property {number} armL forward swing of each upper arm
 * @property {number} outR @property {number} outL each arm out to its side
 * @property {number} elbowR @property {number} elbowL bend of each elbow
 * @property {number} lean the chest forward (negative: back)
 * @property {number} twist the chest turned left (negative: right) over the hips
 * @property {number} sway the hips turned left
 * @property {number} headTurn @property {number} headNod the head turned left, and down
 * @property {number} seat 0 standing on its feet, 1 sitting on a seat `seatHeight` high
 * @property {number} seatHeight meters
 * @property {number} bob meters the hips rise above where the feet put them
 */

/** Standing still, arms down. @returns {Pose} */
export function stand() {
  return {
    thighR: 0, thighL: 0, kneeR: 0.04, kneeL: 0.04, spreadR: 0.02, spreadL: 0.02,
    armR: 0, armL: 0, outR: 0.07, outL: 0.07, elbowR: 0.15, elbowL: 0.15,
    lean: 0, twist: 0, sway: 0, headTurn: 0, headNod: 0, seat: 0, seatHeight: 0.45, bob: 0,
  };
}

/**
 * Walking: the pose after `distance` meters, a step every `stride / 2` meters. The steps grow out of standing over the
 * first half meter after `from` (0; `null`: already walking when the shot starts), and with `stopAt` (the length of
 * the walk) settle into standing over the last half meter, so the figure starts and stops instead of freezing
 * mid-step. @returns {Pose}
 */
export function walk(distance, { stride = 1.3, swing = 0.42, from = 0, stopAt = Infinity } = {}) {
  const p = gait(phaseOf(distance, stride, stopAt), { swing, knee: 0.75, arm: 0.32, elbow: 0.25, lean: 0.04 });
  return settled(p, distance, from, stopAt, 0.5);
}

/** Running: the pose after `distance` meters; `from` and `stopAt` as for `walk`, over a meter. @returns {Pose} */
export function run(distance, { stride = 2.4, swing = 0.75, from = 0, stopAt = Infinity } = {}) {
  const phase = phaseOf(distance, stride, stopAt);
  const p = gait(phase, { swing, knee: 1.5, arm: 0.65, elbow: 1.4, lean: 0.22 });
  p.bob = 0.05 * Math.abs(Math.sin(phase));
  return settled(p, distance, from, stopAt, 1);
}

const phaseOf = (distance, stride, stopAt) => (Math.min(distance, stopAt) / stride) * Math.PI * 2;

/** A gait's pose, eased out of standing after `from` and back into it before `stopAt`, each over `over` meters. */
function settled(p, distance, from, stopAt, over) {
  const d = Math.min(distance, stopAt);
  const start = from == null ? 1 : Math.min(1, Math.max(0, (d - from) / over));
  const end = Math.min(1, Math.max(0, (stopAt - d) / over));
  const k = Math.min(start, end);
  return k < 1 ? mix(stand(), p, k) : p;
}

/** The shared cycle of a walk and a run: legs swinging in turn, each arm against its leg. */
function gait(phase, { swing, knee, arm, elbow, lean }) {
  const p = stand();
  const leg = (offset) => {
    const x = phase + offset;
    return { thigh: swing * Math.sin(x), knee: 0.08 + knee * Math.max(0, Math.cos(x)) ** 2 };
  };
  const r = leg(0), l = leg(Math.PI);
  Object.assign(p, {
    thighR: r.thigh, kneeR: r.knee, thighL: l.thigh, kneeL: l.knee,
    armR: -arm * Math.sin(phase), armL: arm * Math.sin(phase),
    elbowR: elbow + 0.2 * Math.max(0, Math.sin(phase)), elbowL: elbow + 0.2 * Math.max(0, -Math.sin(phase)),
    lean, sway: 0.06 * Math.sin(phase), twist: -0.1 * Math.sin(phase),
  });
  return p;
}

/**
 * Sitting down: `amount` 0 standing, 1 seated on a seat `seat` meters high (a chair is about 0.45 m). Put the figure's
 * root where the middle of the seat is, facing away from the chair's back; the feet end up in front of it.
 * @returns {Pose}
 */
export function sit(amount = 1, { seat = 0.45 } = {}) {
  const k = Math.min(1, Math.max(0, amount));
  const p = stand();
  const bend = (Math.PI / 2) * k;
  Object.assign(p, {
    thighR: bend, thighL: bend, kneeR: bend, kneeL: bend, spreadR: 0.06, spreadL: 0.06,
    armR: 0.35 * k, armL: 0.35 * k, elbowR: 0.15 + 0.6 * k, elbowL: 0.15 + 0.6 * k,
    lean: 0.35 * Math.sin(Math.PI * k), seat: k, seatHeight: seat,
  });
  return p;
}

/**
 * Turning on the spot: the small steps of having turned by `angle` radians so far. Turn the root itself by the same
 * angle (`root.rotation.y`). @returns {Pose}
 */
export function turn(angle) {
  const p = gait(Math.abs(angle) * 4, { swing: 0.14, knee: 0.3, arm: 0.05, elbow: 0.2, lean: 0 });
  const settle = Math.min(1, Math.abs(Math.sin(Math.abs(angle) * 2)));
  return mix(stand(), p, settle);
}

/** Between two poses: `a` at 0, `b` at 1. @returns {Pose} */
export function mix(a, b, k) {
  /** @type {any} */
  const out = {};
  for (const key of Object.keys(a)) out[key] = a[key] + ((b[key] ?? a[key]) - a[key]) * k;
  return out;
}

const _corner = new THREE.Vector3();

/** The lowest point of a figure's feet, in its root's own space (meters at 1.75 m tall). */
function lowestFoot(m) {
  m.root.updateMatrixWorld(true);
  const toRoot = m.root.matrixWorld.clone().invert();
  let low = Infinity;
  for (const { foot } of m.legs) {
    if (!foot.geometry.boundingBox) foot.geometry.computeBoundingBox();
    const { min, max } = foot.geometry.boundingBox;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      low = Math.min(low, _corner.set(x, y, z).applyMatrix4(foot.matrixWorld).applyMatrix4(toRoot).y);
    }
  }
  return low;
}

/** Put `pose` on figure `m`: its joints, and its hips at the height that keeps the lower foot on the floor. */
export function apply(m, pose) {
  const p = { ...stand(), ...pose };
  const [right, left] = m.legs;
  right.thigh.rotation.set(-p.thighR, 0, -p.spreadR);
  right.shin.rotation.set(p.kneeR, 0, 0);
  left.thigh.rotation.set(-p.thighL, 0, p.spreadL);
  left.shin.rotation.set(p.kneeL, 0, 0);
  const [armR, armL] = m.arms;
  armR.upper.rotation.set(-p.armR, 0, -p.outR);
  armR.fore.rotation.set(-p.elbowR, 0, 0);
  armL.upper.rotation.set(-p.armL, 0, p.outL);
  armL.fore.rotation.set(-p.elbowL, 0, 0);
  m.chest.rotation.set(p.lean, p.twist, 0);
  m.pelvis.rotation.set(0, p.sway, 0);
  m.head.rotation.set(p.headNod, p.headTurn, 0, 'YXZ');
  right.ankle.rotation.set(p.thighR - p.kneeR, 0, 0);
  left.ankle.rotation.set(p.thighL - p.kneeL, 0, 0);
  m.pelvis.position.y = 0;
  const standing = -lowestFoot(m);
  const seated = p.seatHeight + 0.05; // the hips sink a little into the seat, so the feet reach the floor
  m.pelvis.position.y = standing + (seated - standing) * p.seat + p.bob;
  m.pose = p;
  m.root.userData.seat = p.seat;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const DOWN = new THREE.Vector3(0, -1, 0);

/**
 * Turn figure `m`'s head (and a little of its chest) toward `target`, a point [x, y, z] or Vector3, by `amount` (0–1).
 * Call after `apply`. The head turns at most 75° and nods at most 40°.
 */
export function lookAt(m, target, amount = 1) {
  const at = Array.isArray(target) ? _w.fromArray(target) : _w.copy(target);
  m.root.updateMatrixWorld(true);
  m.head.getWorldPosition(_v);
  _v.y += 0.18 * m.root.scale.y;
  const local = m.root.worldToLocal(at.clone()).sub(m.root.worldToLocal(_v.clone()));
  const yaw = Math.max(-1.3, Math.min(1.3, Math.atan2(local.x, local.z)));
  const pitch = Math.max(-0.7, Math.min(0.7, -Math.atan2(local.y, Math.hypot(local.x, local.z))));
  m.chest.rotation.y += 0.3 * yaw * amount;
  m.head.rotation.y += 0.7 * yaw * amount;
  m.head.rotation.x += pitch * amount;
}

/**
 * Raise one arm of figure `m` (`side`: 'right' or 'left') straight toward `target` [x, y, z], by `amount` (0–1).
 * Call after `apply` (and after `lookAt`).
 */
export function point(m, target, { side = 'right', amount = 1 } = {}) {
  const arm = m.arms[side === 'left' ? 1 : 0];
  const at = Array.isArray(target) ? _w.fromArray(target) : _w.copy(target);
  m.root.updateMatrixWorld(true);
  arm.upper.getWorldPosition(_v);
  const dir = at.clone().sub(_v).normalize();
  // the direction in the arm's parent (the chest), where the arm's own rotation is measured
  arm.upper.parent.getWorldQuaternion(_q);
  dir.applyQuaternion(_q.invert());
  const toward = new THREE.Quaternion().setFromUnitVectors(DOWN, dir);
  arm.upper.quaternion.slerp(toward, Math.min(1, Math.max(0, amount)));
  arm.fore.rotation.x *= 1 - amount;
}

/**
 * Put figure `m` on a path at `distance` meters along it: `path` is a list of [x, z] points on the floor. It faces where
 * it goes, turning smoothly at corners. Returns the path's `length` and whether the figure is at its end (`done`).
 */
export function move(m, path, distance) {
  const length = pathLength(path);
  const d = Math.min(length, Math.max(0, distance));
  const [x, z] = along(path, d);
  m.root.position.set(x, m.root.position.y, z);
  const ahead = along(path, Math.min(length, d + 0.35));
  const behind = along(path, Math.max(0, d - 0.35));
  if (ahead[0] !== behind[0] || ahead[1] !== behind[1]) m.root.rotation.y = Math.atan2(ahead[0] - behind[0], ahead[1] - behind[1]);
  return { length, done: d >= length };
}

/** The length of a path of [x, z] points, in meters. */
export function pathLength(path) {
  let sum = 0;
  for (let i = 1; i < path.length; i++) sum += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return sum;
}

/** The point `distance` meters along a path of [x, z] points. */
export function along(path, distance) {
  let left = distance;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i];
    const seg = Math.hypot(bx - ax, bz - az);
    if (left <= seg && seg > 0) return [ax + ((bx - ax) * left) / seg, az + ((bz - az) * left) / seg];
    left -= seg;
  }
  return [...path[path.length - 1]];
}
