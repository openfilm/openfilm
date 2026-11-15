// Runs inside a shot's page (openfilm stage look): draws its frames, a view from above with the paths of the figures
// and the camera, and measures the shot over its whole length. Given to page.evaluate as one function, so it imports
// what it uses itself.
/* global window, document, location */

/**
 * @param {{ times: number[], from: number, to: number, step: number }} asked
 */
export async function lookInPage({ times, from, to, step }) {
  const THREE = await import(new URL('../lib/three.module.min.js', location.href).href);
  let stages = [];
  try { ({ stages } = await import(new URL('../lib/stage.js', location.href).href)); } catch { /* a shot of its own making */ }
  const film = /** @type {any} */ (window).film;
  const { scene, camera, frame } = film;
  if (!scene || !camera) throw new Error('the shot gives no scene or camera: shot.js returns { frame, duration, scene, camera }');
  const view = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
  const renderer = stages.find((s) => s.scene === scene)?.renderer;
  const W = view.width, H = view.height;

  // what is solid (not a figure, not the camera), and the figures
  const figures = [];
  scene.traverse((o) => { if (o.userData?.figure) figures.push(o); });
  const inFigure = (o) => { for (let p = o; p; p = p.parent) if (p.userData?.figure) return true; return false; };
  const solids = [];
  scene.traverse((o) => { if (o.isMesh && !inFigure(o) && o.visible) { o.geometry.computeBoundingBox(); solids.push(o); } });
  const colorOf = (fig) => { let c = '#d9824b'; fig.traverse((o) => { if (o.isMesh && o.material?.color) c = `#${o.material.color.getHexString()}`; }); return c; };
  const nameOf = (o) => o.name || o.parent?.name || 'something';
  const inv = new THREE.Matrix4();
  const local = new THREE.Vector3();
  const insideOf = (point, margin = 0.02) => {
    for (const s of solids) {
      inv.copy(s.matrixWorld).invert();
      local.copy(point).applyMatrix4(inv);
      const b = s.geometry.boundingBox;
      if (local.x > b.min.x + margin && local.x < b.max.x - margin && local.y > b.min.y + margin && local.y < b.max.y - margin
        && local.z > b.min.z + margin && local.z < b.max.z - margin) return s;
    }
    return null;
  };
  const ray = new THREE.Raycaster();
  const head = new THREE.Vector3(), feet = new THREE.Vector3(), top = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  const onScreen = (p) => { ndc.copy(p).project(camera); return ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1; };
  const headOf = (fig) => { const h = fig.getObjectByName(`${fig.name}-head`); if (h) h.getWorldPosition(head); else head.copy(fig.position).setY(1.6); return head; };

  // the whole length, a sample every `step` seconds
  const samples = [];
  for (let t = from; t <= to + 1e-6; t += step) {
    frame(Math.min(t, to));
    scene.updateMatrixWorld(true);
    const cam = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const inside = insideOf(cam);
    // something right in front of the lens: rays through a grid over the frame that hit within a meter
    const close = new Map();
    for (let gx = -0.9; gx <= 0.91; gx += 0.3) {
      for (let gy = -0.8; gy <= 0.81; gy += 0.4) {
        ray.setFromCamera({ x: gx, y: gy }, camera);
        ray.far = 1;
        const hit = ray.intersectObjects(solids, false)[0];
        if (hit) close.set(nameOf(hit.object), (close.get(nameOf(hit.object)) ?? 0) + 1);
      }
    }
    const [blockedBy, rays] = [...close].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const s = { t: Math.min(t, to), camera: { at: cam.toArray(), fov: camera.fov, heading: Math.atan2(dir.x, dir.z), pitch: Math.asin(dir.y), inside: inside ? nameOf(inside) : null, blocked: blockedBy ? { by: blockedBy, share: rays / 35 } : null }, figures: {} };
    for (const fig of figures) {
      fig.getWorldPosition(feet);
      headOf(fig);
      top.copy(head).setY(head.y + 0.13);
      const visible = onScreen(head) || onScreen(feet.clone().setY(feet.y + 0.9));
      let hidden = null;
      if (onScreen(head)) {
        const toHead = head.clone().sub(cam);
        ray.set(cam, toHead.clone().normalize());
        ray.far = toHead.length() - 0.15;
        const hit = ray.intersectObjects(solids, false)[0];
        if (hit) hidden = nameOf(hit.object);
      }
      const a = top.clone().project(camera), b = feet.clone().project(camera);
      const through = insideOf(feet.clone().setY(0.5)) ?? insideOf(feet.clone().setY(1.2));
      // the head cut by the top of the frame, or the figure at its side edge
      let cut = null;
      const h = head.clone().project(camera);
      if (visible && h.z < 1 && a.y > 1 && Math.abs(h.x) <= 1) cut = 'top';
      else if (onScreen(head) && Math.abs(h.x) > 0.94) cut = 'edge';
      // where the head looks, and an arm raised (more than 65° from hanging down) and where it points
      const neck = fig.getObjectByName(`${fig.name}-neck`);
      const looks = neck ? new THREE.Vector3(0, 0, 1).applyQuaternion(neck.getWorldQuaternion(new THREE.Quaternion())) : null;
      const arms = {};
      for (const side of ['right', 'left']) {
        const joint = fig.getObjectByName(`${fig.name}-${side}-arm-joint`);
        if (!joint) continue;
        const d = new THREE.Vector3(0, -1, 0).applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()));
        if (d.y < -Math.cos((65 * Math.PI) / 180)) continue; // swinging in a walk or a run stays under 65°
        arms[side] = { heading: Math.atan2(d.x, d.z), up: Math.asin(d.y) };
      }
      s.figures[fig.name] = {
        at: [feet.x, feet.z], facing: fig.rotation.y, seated: (fig.userData.seat ?? 0) > 0.5,
        visible, hidden, cut, through: through ? nameOf(through) : null,
        looking: looks ? { heading: Math.atan2(looks.x, looks.z), up: Math.asin(Math.max(-1, Math.min(1, looks.y))) } : null,
        arms,
        screen: visible ? { x: (a.x + 1) / 2, y: (1 - a.y) / 2, height: Math.abs(a.y - b.y) / 2 } : null,
      };
    }
    samples.push(s);
  }

  // the frames asked for, side by side
  const cols = Math.min(3, times.length), rows = Math.ceil(times.length / cols);
  const fw = times.length === 1 ? W : Math.round(W / 2), fh = times.length === 1 ? H : Math.round(H / 2);
  const sheet = document.createElement('canvas');
  sheet.width = cols * fw; sheet.height = rows * fh;
  const sc = sheet.getContext('2d');
  sc.font = `${Math.round(fh / 14)}px -apple-system, Helvetica, Arial, sans-serif`;
  times.forEach((t, i) => {
    frame(t);
    const x = (i % cols) * fw, y = Math.floor(i / cols) * fh;
    sc.drawImage(view, x, y, fw, fh);
    const label = `${t.toFixed(1)} s`;
    const pad = fh / 40;
    sc.fillStyle = 'rgba(0,0,0,0.55)';
    sc.fillRect(x + pad, y + pad, sc.measureText(label).width + pad * 2, fh / 14 + pad * 2);
    sc.fillStyle = '#fff';
    sc.fillText(label, x + pad * 2, y + pad + fh / 14);
  });

  // from above: the set as it is in the middle of what was asked, the paths drawn over it
  const mid = times[Math.floor(times.length / 2)];
  frame(mid);
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const s of solids) box.expandByObject(s);
  for (const s of samples) { box.expandByPoint(new THREE.Vector3(...s.camera.at)); for (const f of Object.values(s.figures)) box.expandByPoint(new THREE.Vector3(f.at[0], 0, f.at[1])); }
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  let halfW = (box.max.x - box.min.x) / 2 * 1.12 + 0.5, halfH = (box.max.z - box.min.z) / 2 * 1.12 + 0.5;
  if (halfW / halfH < W / H) halfW = halfH * W / H; else halfH = halfW * H / W;
  const above = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 200);
  above.up.set(0, 0, -1);
  above.position.set(cx, Math.max(box.max.y, 3) + 20, cz);
  above.lookAt(cx, 0, cz);
  above.updateMatrixWorld(true);
  const plan = document.createElement('canvas');
  plan.width = W; plan.height = H;
  const pc = plan.getContext('2d');
  if (renderer) {
    renderer.render(scene, above);
    pc.drawImage(view, 0, 0, W, H);
  } else {
    pc.fillStyle = '#bfc3c7'; pc.fillRect(0, 0, W, H);
  }
  const px = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(above); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
  const u = H / 90;
  pc.lineWidth = u * 0.6; pc.lineJoin = 'round'; pc.font = `${Math.round(u * 2.6)}px -apple-system, Helvetica, Arial, sans-serif`;
  const pathOf = (pts, color, dash) => {
    pc.strokeStyle = color; pc.setLineDash(dash ? [u * 1.6, u] : []);
    pc.beginPath(); pts.forEach(([x, y], i) => (i ? pc.lineTo(x, y) : pc.moveTo(x, y))); pc.stroke(); pc.setLineDash([]);
  };
  // a label goes below the ones already placed that it would cover
  const placed = [];
  const label = (text, x0, y) => {
    const w = pc.measureText(text).width, h = u * 3;
    const x = Math.max(u, Math.min(W - w - u, x0));
    let ty = y;
    while (placed.some((r) => x < r.x + r.w && x + w > r.x && ty - h < r.y && ty > r.y - h)) ty += h;
    placed.push({ x, y: ty, w });
    pc.fillStyle = 'rgba(255,255,255,0.7)'; pc.fillRect(x - u * 0.3, ty - h + u * 0.4, w + u * 0.6, h);
    pc.fillStyle = '#111'; pc.fillText(text, x, ty);
  };
  const nearest = (t) => samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  /* the moments, those at the same place (within a few pixels) taken as one: `[first, last, x, y]` */
  const stays = (where) => {
    const out = [];
    for (const t of times) {
      const [x, y] = where(t);
      const last = out[out.length - 1];
      if (last && Math.hypot(last[2] - x, last[3] - y) < u * 1.5) last[1] = t;
      else out.push([t, t, x, y]);
    }
    return out;
  };
  const span = (stay) => (stay[0] === stay[1] ? `${stay[0].toFixed(1)}s` : `${stay[0].toFixed(1)}–${stay[1].toFixed(1)}s`);
  for (const fig of figures) {
    const color = colorOf(fig);
    pathOf(samples.map((s) => px(s.figures[fig.name].at[0], 0, s.figures[fig.name].at[1])), color, false);
    for (const stay of stays((t) => { const f = nearest(t).figures[fig.name]; return px(f.at[0], 0, f.at[1]); })) {
      const f = nearest(stay[1]).figures[fig.name];
      const [x, y] = [stay[2], stay[3]];
      pc.fillStyle = color; pc.beginPath(); pc.arc(x, y, u * 1.1, 0, Math.PI * 2); pc.fill();
      const [hx, hy] = px(f.at[0] + Math.sin(f.facing) * 0.45, 0, f.at[1] + Math.cos(f.facing) * 0.45);
      pc.strokeStyle = color; pc.beginPath(); pc.moveTo(x, y); pc.lineTo(hx, hy); pc.stroke();
      label(`${fig.name} ${span(stay)}`, x + u * 1.6, y - u * 1.2);
    }
  }
  pathOf(samples.map((s) => px(s.camera.at[0], 0, s.camera.at[2])), '#111', true);
  for (const stay of stays((t) => { const c = nearest(t).camera; return px(c.at[0], 0, c.at[2]); })) {
    const c = nearest(stay[1]).camera;
    const [x, y] = [stay[2], stay[3]];
    const half = Math.atan(Math.tan((c.fov * Math.PI) / 360) * (W / H));
    const reach = 1.4;
    const [lx, ly] = px(c.at[0] + Math.sin(c.heading - half) * reach, 0, c.at[2] + Math.cos(c.heading - half) * reach);
    const [rx, ry] = px(c.at[0] + Math.sin(c.heading + half) * reach, 0, c.at[2] + Math.cos(c.heading + half) * reach);
    pc.fillStyle = 'rgba(17,17,17,0.18)'; pc.strokeStyle = '#111';
    pc.beginPath(); pc.moveTo(x, y); pc.lineTo(lx, ly); pc.lineTo(rx, ry); pc.closePath(); pc.fill(); pc.stroke();
    label(`camera ${span(stay)}`, x + u * 1.6, y + u * 3);
  }
  const legend = 'from above · +x right · +z down ·';
  const [m0] = px(0, 0, 0), [m1] = px(1, 0, 0);
  const lw = pc.measureText(legend).width, bar = m1 - m0;
  pc.fillStyle = 'rgba(255,255,255,0.8)'; pc.fillRect(u, H - u * 5, lw + bar + u * 9, u * 4);
  pc.fillStyle = '#111'; pc.fillText(legend, u * 2, H - u * 2);
  pc.lineWidth = u * 0.5; pc.beginPath(); pc.moveTo(u * 3 + lw, H - u * 2.6); pc.lineTo(u * 3 + lw + bar, H - u * 2.6); pc.stroke();
  pc.fillText('1 m', u * 4 + lw + bar, H - u * 2);

  frame(times[0]);
  return {
    figures: figures.map((f) => ({ name: f.name, color: colorOf(f) })),
    samples, sheet: sheet.toDataURL('image/jpeg', 0.86), plan: plan.toDataURL('image/png'),
    size: [W, H], drawn: Boolean(renderer),
  };
}
