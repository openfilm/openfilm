// The stage's workbench draws a shot through this page (viewer.html?shot=<name>&mode=camera|above&editor=<origin>),
// served with the project's files: it runs the shot's own shot.js, and talks with the workbench by messages. It never
// changes a shot: what is dragged here is drawn where it was put until the workbench says the shot changed, and the
// workbench turns it into a reference for the agent. A film does not use this page; the shot's index.html is the film's.
//
// From the workbench: { stage: true, time, playing, moved: [Moved], live: Moved | null }
// To the workbench:   { stage: true, ready: { duration } } · { failed } · { moving: Moved } · { moved: Moved } · { key }
// Moved: { kind: 'figure' | 'camera', name, t, from: [x, y, z], to: [x, y, z] }
import * as THREE from 'three';
import { stages } from './stage.js';

const query = new URLSearchParams(location.search);
const name = query.get('shot') ?? '';
const mode = query.get('mode') === 'above' ? 'above' : 'camera';
const editor = query.get('editor') || '*';
const say = (message) => parent.postMessage({ stage: true, ...message }, editor);
const FRAME = 1 / 24;
const near = (a, b) => Math.abs(a - b) < FRAME / 2 + 1e-6;

let film;
try {
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) throw new Error(`no shot ${name}`);
  const { shot } = await import(`../${name}/shot.js`);
  film = shot({ pass: 'beauty' });
  if (!film?.scene || !film.camera) throw new Error('shot.js gives no scene or camera');
  await (typeof film.ready === 'function' ? film.ready() : film.ready);
} catch (e) {
  say({ failed: e instanceof Error ? e.message : String(e) });
  throw e;
}
const { scene, camera } = film;
const stage = stages.find((s) => s.scene === scene);
const view = document.querySelector('canvas');

/* what the workbench says: the moment, whether it plays, and what was dragged where */
const state = { time: 0, playing: false, moved: [], live: null };

const figures = [];
scene.traverse((o) => { if (o.userData?.figure) figures.push(o); });
const inFigure = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.figure) return p; return null; };
/** Where a figure stands: a mannequin at its root, a character from a model where its body is (its animation may move it). */
const box = new THREE.Box3();
const whereOf = (f) => {
  if (f.getObjectByName(`${f.name}-pelvis`)) return f.getWorldPosition(new THREE.Vector3());
  box.setFromObject(f);
  return box.isEmpty() ? f.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
};
const colorOf = (f) => { let c = '#d9824b'; f.traverse((o) => { if (o.isMesh && o.material?.color) c = `#${o.material.color.getHexString()}`; }); return c; };

/** The shot at the moment asked, with what was dragged at that moment where it was put. */
function draw() {
  film.frame(state.time);
  if (state.playing) return;
  const here = [...state.moved.filter((m) => near(m.t, state.time) && !(state.live && state.live.kind === m.kind && state.live.name === m.name)), ...(state.live ? [state.live] : [])];
  if (!here.length) return;
  for (const m of here) {
    if (m.kind === 'camera') camera.position.fromArray(m.to);
    else {
      const f = scene.getObjectByName(m.name);
      if (f) { f.position.x = m.to[0]; f.position.z = m.to[2]; }
    }
  }
  scene.updateMatrixWorld(true);
  stage?.renderer.render(scene, camera);
}

addEventListener('message', (e) => {
  if (e.source !== parent || !e.data?.stage) return;
  Object.assign(state, { time: e.data.time ?? state.time, playing: Boolean(e.data.playing), moved: e.data.moved ?? state.moved, live: e.data.live ?? null });
  if (mode === 'above') plan(); else draw();
});

/* the keys of a player, told to the workbench (a key pressed in this page does not reach it) */
addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); say({ key: e.key }); }
});

/** Follow the pointer until it is let go: `move` as it moves, `done` at the end. */
function follow(target, pointer, move, done) {
  target.setPointerCapture(pointer);
  const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); done(); };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

/** Where a thing dragged before at this moment was first: the shot's own place, kept across drags. */
const firstPlace = (kind, n, now) => state.moved.find((o) => o.kind === kind && o.name === n && near(o.t, state.time))?.from ?? now;

/** Tell the workbench a drag ended, unless nothing moved. */
function settle(m) {
  state.live = null;
  if (Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1], m.to[2] - m.from[2]) < 0.02) { draw(); return; }
  state.moved = [...state.moved.filter((o) => !(o.kind === m.kind && o.name === m.name && near(o.t, m.t))), m];
  say({ moved: m });
}

const ray = new THREE.Raycaster();
const pointerAt = (e) => new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
/** Where the pointer's line meets the level `height` meters above the floor, or null (beyond 60 m: near the horizon). */
function levelAt(e, height = 0) {
  ray.setFromCamera(pointerAt(e), camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), hit)) return null;
  return hit.distanceTo(ray.ray.origin) < 60 ? hit : null;
}
/** How far the camera is from what it frames: the nearest figure in front of it, else 4 m. */
function framed() {
  const c = camera.getWorldPosition(new THREE.Vector3());
  const dir = camera.getWorldDirection(new THREE.Vector3());
  let best = Infinity;
  for (const f of figures) {
    const to = f.getWorldPosition(new THREE.Vector3()).setY(1.4).sub(c);
    if (to.dot(dir) > 0.3) best = Math.min(best, to.length());
  }
  return Number.isFinite(best) ? best : 4;
}

if (mode === 'camera') {
  view.style.cursor = 'grab';
  /* a figure under the pointer is moved on the floor; anything else moves the camera, the world following the hand */
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    say({ moving: null });
    ray.setFromCamera(pointerAt(e), camera);
    const meshes = [];
    scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const hit = ray.intersectObjects(meshes, false)[0];
    const figure = hit ? inFigure(hit.object) : null;
    view.style.cursor = 'grabbing';
    if (figure) {
      const p = figure.getWorldPosition(new THREE.Vector3());
      /* the figure is moved level, at the height it was taken by: it stays under the pointer */
      const height = hit.point.y;
      const grab = levelAt(e, height) ?? hit.point.clone();
      const live = { kind: 'figure', name: figure.name, t: state.time, from: firstPlace('figure', figure.name, p.toArray()), to: p.toArray() };
      state.live = live;
      follow(view, e.pointerId, (ev) => {
        const on = levelAt(ev, height);
        if (!on) return;
        live.to = [on.x + p.x - grab.x, p.y, on.z + p.z - grab.z];
        draw();
        say({ moving: live });
      }, () => { view.style.cursor = 'grab'; settle(live); });
    } else {
      const c = camera.getWorldPosition(new THREE.Vector3());
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const reach = (2 * Math.tan((camera.fov * Math.PI) / 360) * framed()) / innerHeight;
      const [x0, y0] = [e.clientX, e.clientY];
      const live = { kind: 'camera', name: 'camera', t: state.time, from: firstPlace('camera', 'camera', c.toArray()), to: c.toArray() };
      state.live = live;
      follow(view, e.pointerId, (ev) => {
        const to = c.clone().addScaledVector(right, -(ev.clientX - x0) * reach).addScaledVector(up, (ev.clientY - y0) * reach);
        live.to = [to.x, Math.max(0.1, to.y), to.z];
        draw();
        say({ moving: live });
      }, () => { view.style.cursor = 'grab'; settle(live); });
    }
  });
  /* the wheel moves the camera in and out along where it looks; the drag ends once the wheel stops */
  let wheeling = null, stop = 0;
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const c = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    wheeling ??= { kind: 'camera', name: 'camera', t: state.time, from: firstPlace('camera', 'camera', c.toArray()), to: c.toArray() };
    const to = c.addScaledVector(dir, -e.deltaY * 0.004 * Math.max(1, framed() / 4));
    wheeling.to = to.toArray();
    state.live = wheeling;
    draw();
    say({ moving: wheeling });
    clearTimeout(stop);
    stop = setTimeout(() => { const m = wheeling; wheeling = null; settle(m); }, 600);
  }, { passive: false });
} else {
  view.style.display = 'none';
}

/* ---- from above: the set's footprint, the paths, who and the camera are where now ---- */
let paths = null;
const plate = document.createElement('canvas');
if (mode === 'above') {
  plate.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
  document.body.append(plate);
  /* every path over the shot, sampled once */
  const n = Math.max(24, Math.min(240, Math.round(film.duration * 12)));
  paths = { figures: figures.map((f) => ({ name: f.name, color: colorOf(f), points: [] })), camera: [], solids: [] };
  for (let i = 0; i <= n; i++) {
    film.frame((film.duration - FRAME) * (i / n));
    figures.forEach((f, k) => { const p = whereOf(f); paths.figures[k].points.push([p.x, p.z]); });
    const c = camera.getWorldPosition(new THREE.Vector3());
    paths.camera.push([c.x, c.z]);
  }
  film.frame(0);
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || inFigure(o)) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld);
    const corners = [at(b.min.x, b.min.y, b.min.z), at(b.max.x, b.min.y, b.min.z), at(b.max.x, b.min.y, b.max.z), at(b.min.x, b.min.y, b.max.z)].map((v) => [v.x, v.z]);
    const top = new THREE.Box3().setFromObject(o).max.y;
    paths.solids.push({ corners, top, ground: top <= 0.01 });
  });
  addEventListener('resize', plan);
}

/** Meters to pixels on the plate: the whole set and every path in view, +x right, +z down. */
function fit() {
  const xs = [], zs = [];
  for (const s of paths.solids) if (!s.ground) for (const [x, z] of s.corners) { xs.push(x); zs.push(z); }
  for (const f of paths.figures) for (const [x, z] of f.points) { xs.push(x); zs.push(z); }
  for (const [x, z] of paths.camera) { xs.push(x); zs.push(z); }
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const pad = 18, w = innerWidth, h = innerHeight;
  const scale = Math.min((w - pad * 2) / Math.max(1, x1 - x0), (h - pad * 2) / Math.max(1, z1 - z0));
  const ox = (w - (x1 - x0) * scale) / 2 - x0 * scale, oz = (h - (z1 - z0) * scale) / 2 - z0 * scale;
  return { at: (x, z) => [ox + x * scale, oz + z * scale], back: (px, py) => [(px - ox) / scale, (py - oz) / scale] };
}

function plan() {
  if (!paths) return;
  film.frame(state.time);
  const ratio = devicePixelRatio, w = innerWidth, h = innerHeight;
  plate.width = w * ratio; plate.height = h * ratio;
  const g = plate.getContext('2d');
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = '#1c1c1c';
  g.fillRect(0, 0, w, h);
  const { at } = fit();
  const poly = (corners) => { g.beginPath(); corners.forEach(([x, z], i) => { const [px, py] = at(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); };
  for (const s of paths.solids.filter((s) => s.ground)) { poly(s.corners); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fill(); }
  for (const s of paths.solids.filter((s) => !s.ground).sort((a, b) => a.top - b.top)) { poly(s.corners); g.fillStyle = `rgba(205,205,200,${Math.min(0.8, 0.25 + s.top / 5)})`; g.fill(); }
  const line = (pts, color, dash) => {
    g.strokeStyle = color; g.lineWidth = 1.5; g.setLineDash(dash ? [5, 4] : []);
    g.beginPath(); pts.forEach(([x, z], i) => { const [px, py] = at(x, z); if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); g.setLineDash([]);
  };
  for (const f of paths.figures) line(f.points, f.color, false);
  line(paths.camera, '#f0f0f0', true);
  const placed = (kind, n) => (state.live && state.live.kind === kind && state.live.name === n ? state.live
    : state.playing ? null : state.moved.find((m) => m.kind === kind && m.name === n && near(m.t, state.time)));
  g.font = '11px -apple-system, system-ui, sans-serif';
  for (const f of figures) {
    const p = whereOf(f);
    const m = placed('figure', f.name);
    const [px, py] = at(m ? m.to[0] : p.x, m ? m.to[2] : p.z);
    const color = colorOf(f);
    g.fillStyle = color; g.beginPath(); g.arc(px, py, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(f.rotation.y) * 14, py + Math.cos(f.rotation.y) * 14); g.stroke();
    g.fillStyle = '#eee'; g.fillText(f.name, px + 9, py - 7);
  }
  const c = camera.getWorldPosition(new THREE.Vector3());
  const m = placed('camera', 'camera');
  const [cx, cy] = at(m ? m.to[0] : c.x, m ? m.to[2] : c.z);
  const dir = camera.getWorldDirection(new THREE.Vector3());
  const heading = Math.atan2(dir.x, dir.z), half = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * 16 / 9);
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.strokeStyle = '#eee'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(cx, cy);
  for (const a of [heading - half, heading + half]) g.lineTo(cx + Math.sin(a) * 46, cy + Math.cos(a) * 46);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#eee'; g.beginPath(); g.arc(cx, cy, 4, 0, Math.PI * 2); g.fill();
}

if (mode === 'above') {
  /* a figure's dot or the camera dragged here moves it on the floor, as in the viewfinder */
  plate.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    film.frame(state.time);
    const { at, back } = fit();
    const c = camera.getWorldPosition(new THREE.Vector3());
    const things = [...figures.map((f) => ({ kind: 'figure', name: f.name, p: f.getWorldPosition(new THREE.Vector3()).toArray() })), { kind: 'camera', name: 'camera', p: c.toArray() }];
    let hit = null, best = 14;
    for (const th of things) {
      const m = state.moved.find((o) => o.kind === th.kind && o.name === th.name && near(o.t, state.time));
      const p = m ? m.to : th.p;
      const [px, py] = at(p[0], p[2]);
      const d = Math.hypot(px - e.clientX, py - e.clientY);
      if (d < best) { best = d; hit = { ...th, p, first: m ? m.from : th.p }; }
    }
    if (!hit) return;
    const live = { kind: hit.kind, name: hit.name, t: state.time, from: hit.first, to: hit.p };
    state.live = live;
    follow(plate, e.pointerId, (ev) => {
      const [x, z] = back(ev.clientX, ev.clientY);
      live.to = [x, hit.p[1], z];
      plan();
      say({ moving: live });
    }, () => { settle(live); plan(); });
  });
}

say({ ready: { duration: film.duration } });
if (mode === 'above') plan(); else draw();
